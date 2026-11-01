//! File-based export / import of Muffin data. No tokens, cookies or account rows are ever included.
//!
//! Paths never cross IPC: the native dialog is opened from Rust, an imported file is parsed and
//! validated once, staged in memory (`import_pick` → preview), and applied from that staged copy
//! (`import_apply`) in a single SQLite transaction.
use std::collections::{BTreeMap, HashSet};
use std::io::Read;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::db::{self, now_ms, Db};
use crate::error::{AppError, Result};
use crate::launch::{is_share_code, validate_place_id};
use crate::store::{
    clean_icon_url, clean_name, library_get, library_list_conn, library_upsert_conn, searches_add_at,
    to_db_id, validate_setting, LibraryUpsert,
};

pub const FORMAT_VERSION: u64 = 1;
const APP_ID: &str = "muffin";
pub const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;

const MAX_LIBRARY: usize = 10_000;
const MAX_HISTORY: usize = 10_000;
const MAX_SEARCHES: usize = 100;
const MAX_SERVERS: usize = 5_000;
const MAX_SESSIONS: usize = 50_000;
const MAX_SETTINGS: usize = 100;
const MAX_NAME_CHARS: usize = 200;
const MAX_FIELD_CHARS: usize = 120;
const MAX_LABEL_CHARS: usize = 40;
const MAX_QUERY_CHARS: usize = 100;
const MAX_URL_CHARS: usize = 500;
const MAX_COUNT: i64 = 10_000_000;
const MAX_POSITION: i64 = 1_000_000_000;
/// 2100-01-01T00:00:00Z. Anything later is garbage, not a timestamp.
const MAX_TS: i64 = 4_102_444_800_000;
const MAX_SESSION_MS: i64 = 30 * 86_400_000;

/// Settings tied to this machine's OS state (shortcut registration, autostart entry) or local files
/// (`backgroundImage`: the image itself is never exported): never exported, never imported.
const MACHINE_SETTINGS: &[&str] = &["globalShortcut", "autoStart", "backgroundImage"];

// ---- file format -----------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibRow {
    pub place_id: u64,
    #[serde(default)]
    pub universe_id: Option<u64>,
    pub name: String,
    #[serde(default)]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub creator: Option<String>,
    #[serde(default)]
    pub genre: Option<String>,
    pub favorite: bool,
    pub pinned: bool,
    pub added_at: i64,
    pub position: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistRow {
    pub place_id: u64,
    #[serde(default)]
    pub universe_id: Option<u64>,
    pub name: String,
    #[serde(default)]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub genre: Option<String>,
    pub last_launched_at: i64,
    pub launch_count: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchRow {
    pub query: String,
    pub last_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServerRow {
    pub place_id: u64,
    pub label: String,
    pub code: String,
    pub kind: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlayRow {
    pub place_id: u64,
    #[serde(default)]
    pub universe_id: Option<u64>,
    pub name: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportFile {
    pub app: String,
    pub version: u64,
    pub exported_at: i64,
    #[serde(default)]
    pub library: Vec<LibRow>,
    #[serde(default)]
    pub history: Vec<HistRow>,
    #[serde(default)]
    pub searches: Vec<SearchRow>,
    #[serde(default)]
    pub private_servers: Vec<ServerRow>,
    #[serde(default)]
    pub playtime: Vec<PlayRow>,
    #[serde(default)]
    pub settings: BTreeMap<String, Value>,
}

// ---- parsing & validation --------------------------------------------------------------------

fn invalid_file(msg: impl std::fmt::Display) -> AppError {
    AppError::invalid(format!("This isn't a valid Muffin export: {msg}"))
}

fn check_text(what: &str, s: &str, max: usize) -> Result<()> {
    let n = s.trim().chars().count();
    if n == 0 || n > max || s.chars().any(char::is_control) {
        return Err(invalid_file(format!("bad {what}")));
    }
    Ok(())
}

fn check_opt_text(what: &str, s: &Option<String>, max: usize) -> Result<()> {
    match s {
        Some(s) if !s.trim().is_empty() => check_text(what, s, max),
        _ => Ok(()),
    }
}

fn check_ts(what: &str, ts: i64) -> Result<()> {
    if !(0..=MAX_TS).contains(&ts) {
        return Err(invalid_file(format!("bad {what}")));
    }
    Ok(())
}

fn check_id(what: &str, id: u64) -> Result<()> {
    validate_place_id(id).map(|_| ()).map_err(|_| invalid_file(format!("bad {what}")))
}

fn check_opt_id(what: &str, id: Option<u64>) -> Result<()> {
    id.map_or(Ok(()), |id| check_id(what, id))
}

fn check_len(what: &str, len: usize, max: usize) -> Result<()> {
    if len > max {
        return Err(invalid_file(format!("too many {what} (max {max})")));
    }
    Ok(())
}

/// Parse and fully validate an export. Garbage, oversized input, other versions and out-of-range
/// fields are rejected here, so everything downstream can trust the data.
pub fn parse_export(bytes: &[u8]) -> Result<ExportFile> {
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(AppError::invalid("That file is larger than 10 MB, so it can't be a Muffin export"));
    }
    let raw: Value = serde_json::from_slice(bytes).map_err(|_| invalid_file("not a JSON file"))?;
    let obj = raw.as_object().ok_or_else(|| invalid_file("not a JSON object"))?;
    if obj.get("app").and_then(Value::as_str) != Some(APP_ID) {
        return Err(invalid_file("it wasn't created by Muffin"));
    }
    match obj.get("version").and_then(Value::as_u64) {
        Some(FORMAT_VERSION) => {}
        Some(v) if v > FORMAT_VERSION => {
            return Err(AppError::invalid(
                "This export was created by a newer version of Muffin. Update Muffin to import it.",
            ))
        }
        _ => return Err(invalid_file("unsupported version")),
    }
    let file: ExportFile = serde_json::from_value(raw).map_err(|e| invalid_file(e))?;
    validate(&file)?;
    Ok(file)
}

fn validate(f: &ExportFile) -> Result<()> {
    check_ts("export time", f.exported_at)?;
    check_len("library entries", f.library.len(), MAX_LIBRARY)?;
    check_len("history entries", f.history.len(), MAX_HISTORY)?;
    check_len("searches", f.searches.len(), MAX_SEARCHES)?;
    check_len("private servers", f.private_servers.len(), MAX_SERVERS)?;
    check_len("playtime sessions", f.playtime.len(), MAX_SESSIONS)?;
    check_len("settings", f.settings.len(), MAX_SETTINGS)?;

    let mut seen = HashSet::new();
    for r in &f.library {
        check_id("library game id", r.place_id)?;
        if !seen.insert(r.place_id) {
            return Err(invalid_file("a game appears twice in the library"));
        }
        check_opt_id("library universe id", r.universe_id)?;
        check_text("library name", &r.name, MAX_NAME_CHARS)?;
        check_opt_text("library creator", &r.creator, MAX_FIELD_CHARS)?;
        check_opt_text("library genre", &r.genre, MAX_FIELD_CHARS)?;
        check_opt_text("library icon", &r.icon_url, MAX_URL_CHARS)?;
        check_ts("library date", r.added_at)?;
        if !(0..=MAX_POSITION).contains(&r.position) {
            return Err(invalid_file("bad library position"));
        }
    }
    seen.clear();
    for r in &f.history {
        check_id("history game id", r.place_id)?;
        if !seen.insert(r.place_id) {
            return Err(invalid_file("a game appears twice in the history"));
        }
        check_opt_id("history universe id", r.universe_id)?;
        check_text("history name", &r.name, MAX_NAME_CHARS)?;
        check_opt_text("history genre", &r.genre, MAX_FIELD_CHARS)?;
        check_opt_text("history icon", &r.icon_url, MAX_URL_CHARS)?;
        check_ts("history date", r.last_launched_at)?;
        if !(0..=MAX_COUNT).contains(&r.launch_count) {
            return Err(invalid_file("bad launch count"));
        }
    }
    for r in &f.searches {
        check_text("search", &r.query, MAX_QUERY_CHARS)?;
        check_ts("search date", r.last_at)?;
    }
    for r in &f.private_servers {
        check_id("private server game id", r.place_id)?;
        check_text("private server label", &r.label, MAX_LABEL_CHARS)?;
        if !is_share_code(&r.code) || r.kind != "Server" {
            return Err(invalid_file("bad private server link"));
        }
        check_ts("private server date", r.created_at)?;
    }
    for r in &f.playtime {
        check_id("playtime game id", r.place_id)?;
        check_opt_id("playtime universe id", r.universe_id)?;
        check_text("playtime name", &r.name, MAX_NAME_CHARS)?;
        check_ts("session start", r.started_at)?;
        check_ts("session end", r.ended_at)?;
        if r.ended_at < r.started_at || !(0..=MAX_SESSION_MS).contains(&r.duration_ms) {
            return Err(invalid_file("bad playtime session"));
        }
    }
    for k in f.settings.keys() {
        check_text("setting name", k, 60)?;
    }
    Ok(())
}

/// Settings from a file that may be applied: allowlisted key, valid value, not machine-specific.
fn applicable_settings(f: &ExportFile) -> Vec<(&String, &Value)> {
    f.settings
        .iter()
        .filter(|(k, v)| !MACHINE_SETTINGS.contains(&k.as_str()) && validate_setting(k, v).is_ok())
        .collect()
}

// ---- export ----------------------------------------------------------------------------------

pub fn build_export(conn: &Connection, now: i64) -> Result<ExportFile> {
    let library = library_list_conn(conn)?
        .into_iter()
        .map(|e| LibRow {
            place_id: e.place_id,
            universe_id: e.universe_id,
            name: e.name,
            icon_url: e.icon_url,
            creator: e.creator,
            genre: e.genre,
            favorite: e.favorite,
            pinned: e.pinned,
            added_at: e.added_at,
            position: e.position,
        })
        .collect();

    let history = conn
        .prepare(
            "SELECT place_id, universe_id, name, icon_url, genre, last_launched_at, launch_count
             FROM history ORDER BY last_launched_at DESC, place_id DESC",
        )?
        .query_map([], |r| {
            Ok(HistRow {
                place_id: r.get::<_, i64>(0)? as u64,
                universe_id: r.get::<_, Option<i64>>(1)?.map(|v| v as u64),
                name: r.get(2)?,
                icon_url: r.get(3)?,
                genre: r.get(4)?,
                last_launched_at: r.get(5)?,
                launch_count: r.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let searches = conn
        .prepare("SELECT query, last_at FROM searches ORDER BY last_at DESC, rowid DESC")?
        .query_map([], |r| {
            Ok(SearchRow {
                query: r.get(0)?,
                last_at: r.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let private_servers = conn
        .prepare("SELECT place_id, label, code, kind, created_at FROM private_servers ORDER BY id")?
        .query_map([], |r| {
            Ok(ServerRow {
                place_id: r.get::<_, i64>(0)? as u64,
                label: r.get(1)?,
                code: r.get(2)?,
                kind: r.get(3)?,
                created_at: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    // Only finished sessions: a running one has no end yet.
    let playtime = conn
        .prepare(
            "SELECT place_id, universe_id, name, started_at, ended_at, duration_ms
             FROM playtime_sessions WHERE ended_at IS NOT NULL ORDER BY started_at, id",
        )?
        .query_map([], |r| {
            Ok(PlayRow {
                place_id: r.get::<_, i64>(0)? as u64,
                universe_id: r.get::<_, Option<i64>>(1)?.map(|v| v as u64),
                name: r.get(2)?,
                started_at: r.get(3)?,
                ended_at: r.get(4)?,
                duration_ms: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    // Allowlist at export time too: `activeAccountId` and anything else Rust writes for itself
    // are not in `settings_set`'s allowlist, so they are never exported.
    let mut settings = BTreeMap::new();
    let rows = conn
        .prepare("SELECT key, value FROM settings")?
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (k, v) in rows {
        let Ok(v) = serde_json::from_str::<Value>(&v) else { continue };
        if !MACHINE_SETTINGS.contains(&k.as_str()) && validate_setting(&k, &v).is_ok() {
            settings.insert(k, v);
        }
    }

    Ok(ExportFile {
        app: APP_ID.to_string(),
        version: FORMAT_VERSION,
        exported_at: now,
        library,
        history,
        searches,
        private_servers,
        playtime,
        settings,
    })
}

// ---- preview & apply -------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct SectionPreview {
    /// Rows in the file.
    pub total: usize,
    /// Rows a merge would add (not already present locally).
    pub new: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub file_name: String,
    pub exported_at: i64,
    pub library: SectionPreview,
    pub history: SectionPreview,
    pub searches: SectionPreview,
    pub private_servers: SectionPreview,
    pub playtime: SectionPreview,
    /// `new` = applicable settings whose value differs from the current one.
    pub settings: SectionPreview,
    pub settings_ignored: usize,
}

fn exists(conn: &Connection, sql: &str, p: impl rusqlite::Params) -> Result<bool> {
    Ok(conn.query_row(sql, p, |_| Ok(())).optional()?.is_some())
}

pub fn preview(conn: &Connection, f: &ExportFile, file_name: &str) -> Result<ImportPreview> {
    let mut library = SectionPreview { total: f.library.len(), new: 0 };
    for r in &f.library {
        if library_get(conn, to_db_id(r.place_id)?)?.is_none() {
            library.new += 1;
        }
    }
    let mut history = SectionPreview { total: f.history.len(), new: 0 };
    for r in &f.history {
        if !exists(conn, "SELECT 1 FROM history WHERE place_id = ?1", [to_db_id(r.place_id)?])? {
            history.new += 1;
        }
    }
    let mut searches = SectionPreview { total: f.searches.len(), new: 0 };
    for r in &f.searches {
        if !exists(conn, "SELECT 1 FROM searches WHERE query = ?1", [r.query.trim()])? {
            searches.new += 1;
        }
    }
    let mut private_servers = SectionPreview { total: f.private_servers.len(), new: 0 };
    for r in &f.private_servers {
        if !exists(
            conn,
            "SELECT 1 FROM private_servers WHERE place_id = ?1 AND code = ?2",
            params![to_db_id(r.place_id)?, r.code],
        )? {
            private_servers.new += 1;
        }
    }
    let mut playtime = SectionPreview { total: f.playtime.len(), new: 0 };
    for r in &f.playtime {
        if !exists(
            conn,
            "SELECT 1 FROM playtime_sessions WHERE place_id = ?1 AND started_at = ?2",
            params![to_db_id(r.place_id)?, r.started_at],
        )? {
            playtime.new += 1;
        }
    }
    let applicable = applicable_settings(f);
    let mut settings = SectionPreview { total: applicable.len(), new: 0 };
    for (k, v) in &applicable {
        if db::setting_get(conn, k)?.as_ref() != Some(*v) {
            settings.new += 1;
        }
    }
    Ok(ImportPreview {
        file_name: file_name.to_string(),
        exported_at: f.exported_at,
        library,
        history,
        searches,
        private_servers,
        playtime,
        settings,
        settings_ignored: f.settings.len() - applicable.len(),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportMode {
    /// Keep everything local; add what's missing. Existing rows win.
    Merge,
    /// Delete the sections a file carries and load the file's rows instead.
    Replace,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct SectionResult {
    pub added: usize,
    /// Already present locally (merge) — left as they were.
    pub skipped: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub library: SectionResult,
    pub history: SectionResult,
    pub searches: SectionResult,
    pub private_servers: SectionResult,
    pub playtime: SectionResult,
    pub settings_applied: usize,
}

/// Apply a validated file in ONE transaction: any failure rolls everything back.
pub fn apply_import(
    conn: &mut Connection,
    f: &ExportFile,
    mode: ImportMode,
    now: i64,
) -> Result<ImportResult> {
    let tx = conn.transaction()?;
    let mut out = ImportResult::default();

    if mode == ImportMode::Replace {
        // A playtime session that is running right now is not ours to delete.
        tx.execute_batch(
            "DELETE FROM library;
             DELETE FROM history;
             DELETE FROM searches;
             DELETE FROM private_servers;
             DELETE FROM playtime_sessions WHERE ended_at IS NOT NULL;",
        )?;
    }

    // Library. Merge: existing rows keep their flags/order; new rows are appended in file order.
    let mut library: Vec<&LibRow> = f.library.iter().collect();
    library.sort_by_key(|r| (r.position, r.added_at, r.place_id));
    for r in library {
        if library_get(&tx, to_db_id(r.place_id)?)?.is_some() {
            out.library.skipped += 1;
            continue;
        }
        library_upsert_conn(
            &tx,
            LibraryUpsert {
                place_id: r.place_id,
                universe_id: r.universe_id,
                name: r.name.clone(),
                icon_url: r.icon_url.clone(),
                creator: r.creator.clone(),
                genre: r.genre.clone(),
                favorite: r.favorite,
                pinned: r.pinned,
                added_at: Some(r.added_at),
                // Replace restores the saved order; merge appends after what's there.
                position: (mode == ImportMode::Replace).then_some(r.position),
            },
            now,
        )?;
        out.library.added += 1;
    }

    // History. Idempotent: counts and times take the larger value, so re-importing is harmless.
    for r in &f.history {
        let id = to_db_id(r.place_id)?;
        let existed = exists(&tx, "SELECT 1 FROM history WHERE place_id = ?1", [id])?;
        tx.execute(
            "INSERT INTO history(place_id, universe_id, name, icon_url, genre, last_launched_at, launch_count)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(place_id) DO UPDATE SET
                universe_id = COALESCE(universe_id, excluded.universe_id),
                icon_url = COALESCE(icon_url, excluded.icon_url),
                genre = COALESCE(genre, excluded.genre),
                last_launched_at = MAX(last_launched_at, excluded.last_launched_at),
                launch_count = MAX(launch_count, excluded.launch_count)",
            params![
                id,
                r.universe_id.map(to_db_id).transpose()?,
                clean_name(&r.name)?,
                clean_icon_url(r.icon_url.clone()),
                r.genre.as_ref().map(|g| g.trim().to_string()).filter(|g| !g.is_empty()),
                r.last_launched_at,
                r.launch_count
            ],
        )?;
        if existed {
            out.history.skipped += 1;
        } else {
            out.history.added += 1;
        }
    }

    // Searches: oldest first so the newest end up inside the 20-entry cap.
    let mut searches: Vec<&SearchRow> = f.searches.iter().collect();
    searches.sort_by_key(|r| r.last_at);
    for r in searches {
        let existed = exists(&tx, "SELECT 1 FROM searches WHERE query = ?1", [r.query.trim()])?;
        searches_add_at(&tx, &r.query, r.last_at)?;
        if existed {
            out.searches.skipped += 1;
        } else {
            out.searches.added += 1;
        }
    }

    for r in &f.private_servers {
        let id = to_db_id(r.place_id)?;
        if exists(
            &tx,
            "SELECT 1 FROM private_servers WHERE place_id = ?1 AND code = ?2",
            params![id, r.code],
        )? {
            out.private_servers.skipped += 1;
            continue;
        }
        tx.execute(
            "INSERT INTO private_servers(place_id, label, code, kind, created_at) VALUES(?1, ?2, ?3, ?4, ?5)",
            params![id, r.label.trim(), r.code, r.kind, r.created_at],
        )?;
        out.private_servers.added += 1;
    }

    for r in &f.playtime {
        let id = to_db_id(r.place_id)?;
        if exists(
            &tx,
            "SELECT 1 FROM playtime_sessions WHERE place_id = ?1 AND started_at = ?2",
            params![id, r.started_at],
        )? {
            out.playtime.skipped += 1;
            continue;
        }
        tx.execute(
            "INSERT INTO playtime_sessions(place_id, universe_id, name, started_at, ended_at, duration_ms, last_seen_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?5)",
            params![
                id,
                r.universe_id.map(to_db_id).transpose()?,
                clean_name(&r.name)?,
                r.started_at,
                r.ended_at,
                r.duration_ms
            ],
        )?;
        out.playtime.added += 1;
    }

    for (k, v) in applicable_settings(f) {
        db::setting_set(&tx, k, v)?;
        out.settings_applied += 1;
    }

    tx.commit()?;
    Ok(out)
}

// ---- staging & commands ----------------------------------------------------------------------

struct Staged {
    file: ExportFile,
}

#[derive(Default)]
pub struct TransferState(Mutex<Option<Staged>>);

impl TransferState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Staged>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

pub fn init(app: &AppHandle) {
    app.manage(TransferState::default());
}

/// Days since 1970-01-01 → (year, month, day), proleptic Gregorian (Hinnant's algorithm).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

fn default_file_name(now_ms: i64) -> String {
    let (y, m, d) = civil_from_days(now_ms.div_euclid(86_400_000));
    format!("muffin-export-{y:04}-{m:02}-{d:02}.json")
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub file_name: String,
    pub library: usize,
    pub history: usize,
    pub searches: usize,
    pub private_servers: usize,
    pub playtime: usize,
    pub settings: usize,
}

/// Opens a native save dialog and writes the export. `None` when the user cancels.
#[tauri::command(async)]
pub fn export_data(app: AppHandle, window: WebviewWindow, db: State<'_, Db>) -> Result<Option<ExportResult>> {
    let now = now_ms();
    let file = db.with(|c| build_export(c, now))?;
    let bytes = serde_json::to_vec_pretty(&file)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(AppError::invalid(
            "Your data is larger than 10 MB, which Muffin could not import again. Clear some history or playtime first.",
        ));
    }
    let Some(picked) = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Export Muffin data")
        .set_file_name(default_file_name(now))
        .add_filter("Muffin export (JSON)", &["json"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|_| AppError::invalid("That location can't be written to"))?;
    std::fs::write(&path, &bytes).map_err(|e| AppError::storage(format!("Couldn't write the file: {e}")))?;
    Ok(Some(ExportResult {
        file_name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        library: file.library.len(),
        history: file.history.len(),
        searches: file.searches.len(),
        private_servers: file.private_servers.len(),
        playtime: file.playtime.len(),
        settings: file.settings.len(),
    }))
}

/// Opens a native file dialog, validates the chosen file, stages it and returns a preview.
/// `None` when the user cancels. Nothing is written to the database.
#[tauri::command(async)]
pub fn import_pick(
    app: AppHandle,
    window: WebviewWindow,
    db: State<'_, Db>,
    state: State<'_, TransferState>,
) -> Result<Option<ImportPreview>> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Import Muffin data")
        .add_filter("Muffin export (JSON)", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|_| AppError::invalid("That file can't be read"))?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let read_err = |e: std::io::Error| AppError::storage(format!("Couldn't read the file: {e}"));
    let file = std::fs::File::open(&path).map_err(read_err)?;
    // Read one byte past the cap so an oversized file is detected without loading all of it.
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes).map_err(read_err)?;
    let parsed = parse_export(&bytes)?;
    let prev = db.with(|c| preview(c, &parsed, &name))?;
    *state.lock() = Some(Staged { file: parsed });
    Ok(Some(prev))
}

#[tauri::command(async)]
pub fn import_apply(db: State<'_, Db>, state: State<'_, TransferState>, mode: ImportMode) -> Result<ImportResult> {
    let staged = state.lock().take().ok_or_else(|| AppError::invalid("Choose a file to import first"))?;
    let now = now_ms();
    match db.with(|c| apply_import(c, &staged.file, mode, now)) {
        Ok(result) => Ok(result),
        Err(e) => {
            // Rolled back; keep the file staged so the user can retry.
            *state.lock() = Some(staged);
            Err(e)
        }
    }
}

#[tauri::command(async)]
pub fn import_discard(state: State<'_, TransferState>) {
    *state.lock() = None;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;

    fn conn() -> Connection {
        let c = test_conn();
        crate::playtime::ensure_schema(&c).unwrap();
        c
    }

    fn lib(c: &Connection, id: u64, name: &str, favorite: bool, pinned: bool, added_at: i64) {
        library_upsert_conn(
            c,
            LibraryUpsert {
                place_id: id,
                universe_id: Some(id + 1000),
                name: name.into(),
                icon_url: Some("https://tr.rbxcdn.com/x/256/256/Image/Webp".into()),
                creator: Some("Studio".into()),
                genre: Some("Adventure".into()),
                favorite,
                pinned,
                added_at: Some(added_at),
                position: None,
            },
            9_999,
        )
        .unwrap();
    }

    fn seeded() -> Connection {
        let c = conn();
        lib(&c, 3, "Third", false, false, 300);
        lib(&c, 1, "First", true, true, 100);
        lib(&c, 2, "Second", true, false, 200);
        crate::store::history_record(&c, 1, Some(1001), "First", None, Some("Adventure".into()), 5_000).unwrap();
        crate::store::history_record(&c, 1, Some(1001), "First", None, None, 6_000).unwrap();
        searches_add_at(&c, "obby", 10).unwrap();
        searches_add_at(&c, "tower", 20).unwrap();
        c.execute(
            "INSERT INTO private_servers(place_id, label, code, kind, created_at) VALUES(1, 'Pals', '0123456789abcdef', 'Server', 7)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO playtime_sessions(place_id, universe_id, name, started_at, ended_at, duration_ms, last_seen_at)
             VALUES(1, 1001, 'First', 1000, 4000, 3000, 4000), (2, NULL, 'Second', 9000, NULL, 0, 9500)",
            [],
        )
        .unwrap();
        db::setting_set(&c, "accentHue", &Value::from(340)).unwrap();
        db::setting_set(&c, "globalShortcut", &Value::from(false)).unwrap();
        db::setting_set(&c, "activeAccountId", &Value::from(5)).unwrap();
        c
    }

    fn exported(c: &Connection) -> Vec<u8> {
        serde_json::to_vec(&build_export(c, 1_700_000_000_000).unwrap()).unwrap()
    }

    #[test]
    fn export_has_data_but_no_secrets_or_machine_state() {
        let c = seeded();
        let bytes = exported(&c);
        let text = String::from_utf8(bytes.clone()).unwrap();
        assert!(!text.contains("activeAccountId"));
        assert!(!text.contains("globalShortcut"));
        let f = parse_export(&bytes).unwrap();
        assert_eq!((f.app.as_str(), f.version), ("muffin", 1));
        assert_eq!(f.library.iter().map(|r| r.place_id).collect::<Vec<_>>(), vec![3, 1, 2]);
        assert_eq!(f.history.len(), 1);
        assert_eq!(f.history[0].launch_count, 2);
        assert_eq!(f.searches.len(), 2);
        assert_eq!(f.private_servers.len(), 1);
        // The still-running session is not exported.
        assert_eq!(f.playtime.len(), 1);
        assert_eq!(f.settings.keys().collect::<Vec<_>>(), vec!["accentHue"]);
    }

    #[test]
    fn roundtrip_replace_restores_everything() {
        let src = seeded();
        let f = parse_export(&exported(&src)).unwrap();

        let mut dst = conn();
        lib(&dst, 99, "Local only", true, false, 1);
        let r = apply_import(&mut dst, &f, ImportMode::Replace, 1).unwrap();
        assert_eq!((r.library.added, r.library.skipped), (3, 0));
        assert_eq!(r.settings_applied, 1);

        // Everything the file carries now matches the source, including order and flags.
        let again = build_export(&dst, f.exported_at).unwrap();
        assert_eq!(again.library, f.library);
        assert_eq!(again.history, f.history);
        assert_eq!(again.private_servers, f.private_servers);
        assert_eq!(again.playtime, f.playtime);
        assert_eq!(again.searches, f.searches);
        assert_eq!(again.settings, f.settings);
        assert!(library_get(&dst, 99).unwrap().is_none());
    }

    #[test]
    fn merge_keeps_local_state_and_only_adds_missing() {
        let src = seeded();
        let f = parse_export(&exported(&src)).unwrap();

        let mut dst = conn();
        // Same game, but the local copy has different flags/order: local must win.
        lib(&dst, 1, "First (local)", false, false, 50);
        lib(&dst, 99, "Local only", true, true, 60);
        crate::store::history_record(&dst, 1, None, "First", None, None, 9_000).unwrap();

        let r = apply_import(&mut dst, &f, ImportMode::Merge, 1).unwrap();
        assert_eq!((r.library.added, r.library.skipped), (2, 1));
        let mine = library_get(&dst, 1).unwrap().unwrap();
        assert_eq!((mine.name.as_str(), mine.favorite, mine.pinned, mine.added_at), ("First (local)", false, false, 50));
        assert!(library_get(&dst, 99).unwrap().unwrap().favorite);
        let order: Vec<u64> = library_list_conn(&dst).unwrap().iter().map(|e| e.place_id).collect();
        // Local rows first, imported ones appended in the file's order (3 before 2 by position).
        assert_eq!(order, vec![1, 99, 3, 2]);
        assert_eq!(library_get(&dst, 3).unwrap().unwrap().added_at, 300);

        // History merges idempotently: larger count/time wins, no double counting.
        assert_eq!((r.history.added, r.history.skipped), (0, 1));
        let h = crate::store::history_list_conn(&dst, 10).unwrap();
        assert_eq!((h[0].launch_count, h[0].last_launched_at), (2, 9_000));

        // Importing the same file again changes nothing.
        let r2 = apply_import(&mut dst, &f, ImportMode::Merge, 2).unwrap();
        assert_eq!((r2.library.added, r2.private_servers.added, r2.playtime.added, r2.searches.added), (0, 0, 0, 0));
        assert_eq!(library_list_conn(&dst).unwrap().len(), 4);
    }

    #[test]
    fn replace_keeps_a_running_playtime_session() {
        let mut dst = conn();
        dst.execute(
            "INSERT INTO playtime_sessions(place_id, name, started_at, ended_at, duration_ms, last_seen_at)
             VALUES(5, 'Live', 100, NULL, 0, 100), (6, 'Old', 1, 2, 1, 2)",
            [],
        )
        .unwrap();
        let f = parse_export(&exported(&seeded())).unwrap();
        apply_import(&mut dst, &f, ImportMode::Replace, 1).unwrap();
        let live: i64 = dst
            .query_row("SELECT COUNT(*) FROM playtime_sessions WHERE name = 'Live' AND ended_at IS NULL", [], |r| r.get(0))
            .unwrap();
        let old: i64 = dst
            .query_row("SELECT COUNT(*) FROM playtime_sessions WHERE name = 'Old'", [], |r| r.get(0))
            .unwrap();
        assert_eq!((live, old), (1, 0));
    }

    #[test]
    fn preview_counts_new_rows() {
        let f = parse_export(&exported(&seeded())).unwrap();
        let dst = conn();
        lib(&dst, 1, "First", false, false, 1);
        let p = preview(&dst, &f, "x.json").unwrap();
        assert_eq!(p.library, SectionPreview { total: 3, new: 2 });
        assert_eq!(p.history, SectionPreview { total: 1, new: 1 });
        assert_eq!(p.settings, SectionPreview { total: 1, new: 1 });
        assert_eq!(p.settings_ignored, 0);
        assert_eq!(p.file_name, "x.json");
    }

    #[test]
    fn failure_rolls_back_everything() {
        let mut dst = conn();
        lib(&dst, 99, "Keep me", false, false, 1);
        let mut f = parse_export(&exported(&seeded())).unwrap();
        // Passes `validate` (checked at parse time) but breaks inside the transaction.
        f.playtime[0].name = "   ".into();
        assert!(apply_import(&mut dst, &f, ImportMode::Replace, 1).is_err());
        assert!(library_get(&dst, 99).unwrap().is_some());
        assert!(library_get(&dst, 1).unwrap().is_none());
    }

    #[test]
    fn rejects_garbage_and_wrong_shapes() {
        let good = exported(&seeded());
        assert!(parse_export(&good).is_ok());

        for bad in [
            &b""[..],
            b"not json",
            b"[]",
            b"null",
            b"{}",
            br#"{"app":"other","version":1,"exportedAt":1}"#,
            br#"{"app":"muffin","exportedAt":1}"#,
            br#"{"app":"muffin","version":"1","exportedAt":1}"#,
            br#"{"app":"muffin","version":0,"exportedAt":1}"#,
        ] {
            assert!(parse_export(bad).is_err(), "{}", String::from_utf8_lossy(bad));
        }

        let newer = parse_export(br#"{"app":"muffin","version":2,"exportedAt":1,"somethingNew":true}"#).unwrap_err();
        assert!(newer.message.contains("newer version"));

        // Unknown fields (top level and inside rows) are rejected.
        assert!(parse_export(br#"{"app":"muffin","version":1,"exportedAt":1,"accounts":[]}"#).is_err());
        assert!(parse_export(
            br#"{"app":"muffin","version":1,"exportedAt":1,"searches":[{"query":"a","lastAt":1,"cookie":"x"}]}"#
        )
        .is_err());
    }

    #[test]
    fn rejects_oversized_input() {
        let big = vec![b' '; MAX_FILE_BYTES as usize + 1];
        let e = parse_export(&big).unwrap_err();
        assert!(e.message.contains("10 MB"));
    }

    fn with(mutate: impl FnOnce(&mut ExportFile)) -> Result<ExportFile> {
        let mut f = parse_export(&exported(&seeded())).unwrap();
        mutate(&mut f);
        parse_export(&serde_json::to_vec(&f).unwrap())
    }

    #[test]
    fn enforces_per_field_limits() {
        assert!(with(|_| {}).is_ok());
        assert!(with(|f| f.library[0].place_id = 0).is_err());
        assert!(with(|f| f.library[0].place_id = (1 << 53) + 1).is_err());
        assert!(with(|f| f.library[0].name = "x".repeat(201)).is_err());
        assert!(with(|f| f.library[0].name = "  ".into()).is_err());
        assert!(with(|f| f.library[0].name = "bad\u{0}name".into()).is_err());
        assert!(with(|f| f.library[0].genre = Some("g".repeat(121))).is_err());
        assert!(with(|f| f.library[0].added_at = -1).is_err());
        assert!(with(|f| f.library[0].added_at = MAX_TS + 1).is_err());
        assert!(with(|f| f.library[0].position = -3).is_err());
        assert!(with(|f| {
            let dup = f.library[0].clone();
            f.library.push(dup);
        })
        .is_err());
        assert!(with(|f| f.history[0].launch_count = -1).is_err());
        assert!(with(|f| f.searches[0].query = "q".repeat(101)).is_err());
        assert!(with(|f| f.searches = (0..101).map(|i| SearchRow { query: format!("q{i}"), last_at: 1 }).collect()).is_err());
        assert!(with(|f| f.private_servers[0].code = "short".into()).is_err());
        assert!(with(|f| f.private_servers[0].code = "abcdefgh&x=1".into()).is_err());
        assert!(with(|f| f.private_servers[0].kind = "Other".into()).is_err());
        assert!(with(|f| f.private_servers[0].label = "l".repeat(41)).is_err());
        assert!(with(|f| f.playtime[0].ended_at = f.playtime[0].started_at - 1).is_err());
        assert!(with(|f| f.playtime[0].duration_ms = MAX_SESSION_MS + 1).is_err());
        assert!(with(|f| f.exported_at = -1).is_err());
    }

    #[test]
    fn settings_import_is_allowlisted() {
        let mut f = parse_export(&exported(&seeded())).unwrap();
        f.settings.insert("closeBehavior".into(), Value::from("tray"));
        f.settings.insert("accentHue".into(), Value::from(400)); // out of range
        f.settings.insert("activeAccountId".into(), Value::from(1));
        f.settings.insert("globalShortcut".into(), Value::from(true)); // machine-specific
        f.settings.insert("autoStart".into(), Value::from(true));
        let bytes = serde_json::to_vec(&f).unwrap();
        let f = parse_export(&bytes).unwrap();

        let mut dst = conn();
        let r = apply_import(&mut dst, &f, ImportMode::Merge, 1).unwrap();
        assert_eq!(r.settings_applied, 1);
        assert_eq!(db::setting_get(&dst, "closeBehavior").unwrap(), Some(Value::from("tray")));
        for k in ["accentHue", "activeAccountId", "globalShortcut", "autoStart"] {
            assert_eq!(db::setting_get(&dst, k).unwrap(), None, "{k}");
        }
        let p = preview(&dst, &f, "f").unwrap();
        assert_eq!((p.settings.total, p.settings_ignored), (1, 4));
    }

    #[test]
    fn icon_urls_are_re_sanitised_on_import() {
        let mut f = parse_export(&exported(&seeded())).unwrap();
        f.library[0].icon_url = Some("https://evil.example/x.png".into());
        let mut dst = conn();
        apply_import(&mut dst, &f, ImportMode::Replace, 1).unwrap();
        let id = f.library[0].place_id;
        assert_eq!(library_get(&dst, id as i64).unwrap().unwrap().icon_url, None);
    }

    #[test]
    fn export_file_names() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_000), (2024, 10, 4));
        assert_eq!(civil_from_days(19_782), (2024, 2, 29));
        assert_eq!(civil_from_days(-1), (1969, 12, 31));
        assert_eq!(default_file_name(1_700_000_000_000), "muffin-export-2023-11-14.json");
    }
}
