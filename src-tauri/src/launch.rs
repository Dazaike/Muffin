//! Launching Roblox through the `roblox://` protocol, protocol-handler detection and private
//! server links. URIs are always built here from validated ids / stored codes; the frontend never
//! supplies a URI.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, State};
#[cfg(windows)]
use winreg::{enums::HKEY_CLASSES_ROOT, RegKey};

use crate::db::{now_ms, Db};
use crate::error::{AppError, ErrorCode, Result};
use crate::store::{
    clean_icon_url, clean_name, history_record, known_place_name, to_db_id,
};

/// Largest id that survives a round trip through a JS number.
pub const MAX_PLACE_ID: u64 = 1 << 53;
const LAUNCH_DEBOUNCE: Duration = Duration::from_secs(3);
const DEFAULT_PRIVATE_LABEL: &str = "Private Server";
const MAX_LABEL_CHARS: usize = 40;
const SHARE_LINK_HELP: &str =
    "Paste the Roblox private server share link (roblox.com/share?code=…&type=Server)";

/// `^[A-Za-z0-9]{8,64}$`
pub(crate) fn is_share_code(s: &str) -> bool {
    (8..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric())
}

// ---- ids & URIs ------------------------------------------------------------------------------

pub fn validate_place_id(id: u64) -> Result<u64> {
    if id == 0 || id > MAX_PLACE_ID {
        return Err(AppError::invalid("Invalid game id"));
    }
    Ok(id)
}

#[allow(dead_code)] // String form of `validate_place_id`; kept tested, no command takes string ids yet.
/// Digits only, 1..=2^53, non-zero.
pub fn parse_place_id(s: &str) -> Result<u64> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return Err(AppError::invalid("Invalid game id"));
    }
    let id: u64 = s
        .parse()
        .map_err(|_| AppError::invalid("Invalid game id"))?;
    validate_place_id(id)
}

pub fn experience_uri(place_id: u64) -> String {
    format!("roblox://experiences/start?placeId={place_id}")
}

pub fn private_server_uri(code: &str, kind: &str) -> String {
    format!("roblox://navigation/share_links?code={code}&type={kind}")
}

/// Canonical (lowercase, hyphenated) form of a server instance GUID, else `invalid_input`.
/// Only the 36-char `8-4-4-4-12` form Roblox returns is accepted (no braces/urn/simple forms).
pub fn parse_instance_id(s: &str) -> Result<String> {
    let s = s.trim();
    let bad = || AppError::invalid("Invalid server id");
    if s.len() != 36 {
        return Err(bad());
    }
    uuid::Uuid::parse_str(s)
        .map(|u| u.hyphenated().to_string())
        .map_err(|_| bad())
}

pub fn instance_uri(place_id: u64, instance_id: &str) -> String {
    format!("roblox://experiences/start?placeId={place_id}&gameInstanceId={instance_id}")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShareLink {
    pub code: String,
    pub kind: String,
}

/// Accepts only `https://[www.]roblox.com/share?code=<alnum 8–64>&type=Server`.
pub fn parse_share_link(input: &str) -> Result<ShareLink> {
    let bad = || AppError::invalid(SHARE_LINK_HELP);
    let url = url::Url::parse(input.trim()).map_err(|_| bad())?;
    if url.scheme() != "https"
        || !matches!(url.host_str(), Some("roblox.com" | "www.roblox.com"))
        || url.path() != "/share"
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(bad());
    }
    let mut code = None;
    let mut kind = None;
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "code" if code.is_none() => code = Some(v.into_owned()),
            "type" if kind.is_none() => kind = Some(v.into_owned()),
            "code" | "type" => return Err(bad()),
            _ => {}
        }
    }
    let (Some(code), Some(kind)) = (code, kind) else {
        return Err(bad());
    };
    if !is_share_code(&code) || kind != "Server" {
        return Err(bad());
    }
    Ok(ShareLink { code, kind })
}

// ---- protocol handler detection --------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Handler {
    Roblox,
    Bloxstrap,
    Fishstrap,
    Other,
    None,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolStatus {
    pub registered: bool,
    pub command: Option<String>,
    pub exe_path: Option<String>,
    pub exe_exists: bool,
    pub handler: Handler,
}

/// Executable part of a shell command: the quoted prefix, else up to the first `.exe`, else up to
/// the first whitespace.
#[cfg(windows)]
pub fn extract_exe_path(command: &str) -> Option<String> {
    let c = command.trim();
    if c.is_empty() {
        return None;
    }
    if let Some(rest) = c.strip_prefix('"') {
        let end = rest.find('"')?;
        let path = &rest[..end];
        return (!path.is_empty()).then(|| path.to_string());
    }
    let lower = c.to_ascii_lowercase();
    if let Some(i) = lower.find(".exe") {
        return Some(c[..i + 4].to_string());
    }
    c.split_whitespace().next().map(str::to_string)
}

#[cfg(windows)]
pub fn classify_handler(exe_path: &str) -> Handler {
    let stem = exe_path
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(exe_path)
        .to_ascii_lowercase();
    let stem = stem.strip_suffix(".exe").unwrap_or(&stem);
    if stem.contains("bloxstrap") {
        Handler::Bloxstrap
    } else if stem.contains("fishstrap") {
        Handler::Fishstrap
    } else if stem.contains("robloxplayerlauncher") || stem.contains("robloxplayerbeta") {
        Handler::Roblox
    } else {
        Handler::Other
    }
}

#[cfg(windows)]
pub fn status_from_command(
    command: Option<String>,
    exists: impl Fn(&str) -> bool,
) -> ProtocolStatus {
    let command = command.map(|c| c.trim().to_string()).filter(|c| !c.is_empty());
    let Some(cmd) = command else {
        return ProtocolStatus {
            registered: false,
            command: None,
            exe_path: None,
            exe_exists: false,
            handler: Handler::None,
        };
    };
    let exe_path = extract_exe_path(&cmd);
    let exe_exists = exe_path.as_deref().is_some_and(&exists);
    let handler = exe_path.as_deref().map_or(Handler::Other, classify_handler);
    ProtocolStatus {
        registered: true,
        command: Some(cmd),
        exe_path,
        exe_exists,
        handler,
    }
}

#[cfg(windows)]
fn read_registered_command() -> Option<String> {
    RegKey::predef(HKEY_CLASSES_ROOT)
        .open_subkey(r"roblox\shell\open\command")
        .ok()?
        .get_value::<String, _>("")
        .ok()
}

#[cfg(windows)]
pub fn protocol_status() -> ProtocolStatus {
    status_from_command(read_registered_command(), |p| {
        std::path::Path::new(p).is_file()
    })
}

#[cfg(not(windows))]
fn unregistered() -> ProtocolStatus {
    ProtocolStatus { registered: false, command: None, exe_path: None, exe_exists: false, handler: Handler::None }
}

#[cfg(target_os = "macos")]
fn macos_status_from(found: Option<String>) -> ProtocolStatus {
    match found {
        Some(p) => ProtocolStatus {
            registered: true,
            command: Some(p.clone()),
            exe_path: Some(p),
            exe_exists: true,
            handler: Handler::Roblox,
        },
        None => unregistered(),
    }
}

/// Roblox.app lives in /Applications (or the per-user Applications/Library folders).
#[cfg(target_os = "macos")]
pub fn protocol_status() -> ProtocolStatus {
    let mut candidates = vec!["/Applications/Roblox.app".to_string(), "/Applications/RobloxPlayer.app".to_string()];
    if let Some(home) = std::env::var_os("HOME") {
        let home = std::path::PathBuf::from(home);
        for rel in ["Applications/Roblox.app", "Library/Roblox/UnzippedBundle/RobloxPlayer.app"] {
            candidates.push(home.join(rel).to_string_lossy().into_owned());
        }
    }
    macos_status_from(candidates.into_iter().find(|p| std::path::Path::new(p).is_dir()))
}

#[cfg(target_os = "linux")]
const SOBER_APP_ID: &str = "org.vinegarhq.Sober";

#[cfg(target_os = "linux")]
fn sober_installed() -> bool {
    use std::process::{Command, Stdio};
    Command::new("flatpak")
        .args(["info", SOBER_APP_ID])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

#[cfg(target_os = "linux")]
fn linux_status_from(sober: bool, xdg_default: Option<&str>) -> ProtocolStatus {
    if sober {
        let cmd = format!("flatpak run {SOBER_APP_ID}");
        return ProtocolStatus { registered: true, command: Some(cmd), exe_path: None, exe_exists: true, handler: Handler::Roblox };
    }
    match xdg_default.map(str::trim).filter(|d| !d.is_empty()) {
        Some(d) => {
            let l = d.to_lowercase();
            let handler = if l.contains("sober") || l.contains("roblox") { Handler::Roblox } else { Handler::Other };
            ProtocolStatus { registered: true, command: Some(d.to_string()), exe_path: None, exe_exists: true, handler }
        }
        None => unregistered(),
    }
}

#[cfg(target_os = "linux")]
pub fn protocol_status() -> ProtocolStatus {
    let xdg = std::process::Command::new("xdg-mime")
        .args(["query", "default", "x-scheme-handler/roblox"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned());
    linux_status_from(sober_installed(), xdg.as_deref())
}

#[cfg(windows)]
fn open_uri(_status: &ProtocolStatus, uri: &str) -> std::result::Result<(), String> {
    tauri_plugin_opener::open_url(uri, None::<&str>).map_err(|e| e.to_string())
}

/// `open -a <Roblox.app> <uri>` delivers the URL to Roblox regardless of which app owns the scheme.
#[cfg(target_os = "macos")]
fn open_uri(status: &ProtocolStatus, uri: &str) -> std::result::Result<(), String> {
    tauri_plugin_opener::open_url(uri, status.exe_path.as_deref()).map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn open_uri(_status: &ProtocolStatus, uri: &str) -> std::result::Result<(), String> {
    if sober_installed() {
        std::process::Command::new("flatpak")
            .args(["run", SOBER_APP_ID, "--", uri])
            .spawn()
            .map(drop)
            .map_err(|e| e.to_string())
    } else {
        tauri_plugin_opener::open_url(uri, None::<&str>).map_err(|e| e.to_string())
    }
}

pub fn ensure_installed(status: &ProtocolStatus) -> Result<()> {
    if !status.registered {
        return Err(AppError::new(
            ErrorCode::NotInstalled,
            "Roblox isn't installed or registered on this PC",
        ));
    }
    if !status.exe_exists {
        return Err(AppError::new(
            ErrorCode::NotInstalled,
            match &status.exe_path {
                Some(p) => format!("The registered Roblox launcher no longer exists: {p}"),
                None => "The registered Roblox launcher could not be read".to_string(),
            },
        ));
    }
    Ok(())
}

#[tauri::command(async)]
pub fn roblox_status() -> ProtocolStatus {
    protocol_status()
}

// ---- launching -------------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    pub handed_off: bool,
}

static LAST_LAUNCH: Mutex<Option<Instant>> = Mutex::new(None);

/// Accepts the launch unless another was accepted within `LAUNCH_DEBOUNCE`.
fn debounce(last: &Mutex<Option<Instant>>, now: Instant) -> Result<()> {
    let mut guard = last.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(prev) = *guard {
        if now.saturating_duration_since(prev) < LAUNCH_DEBOUNCE {
            return Err(AppError::new(
                ErrorCode::LaunchBusy,
                "A launch is already in progress",
            ));
        }
    }
    *guard = Some(now);
    Ok(())
}

fn hand_off(app: &AppHandle, db: &Db, uri: &str) -> Result<()> {
    let status = protocol_status();
    ensure_installed(&status)?;
    debounce(&LAST_LAUNCH, Instant::now())?;
    // "Hide Fishstrap": start Fishstrap without its window and report its progress inside Muffin.
    let hidden_exe = status
        .exe_path
        .as_deref()
        .filter(|_| status.handler == Handler::Fishstrap && status.exe_exists)
        .filter(|_| db.with(|c| Ok(crate::db::setting_bool(c, "hideFishstrap", true))).unwrap_or(true));
    let result = match hidden_exe {
        Some(exe) => crate::fishstrap_launch::start_hidden(app, std::path::Path::new(exe), uri).map_err(|e| e.to_string()),
        None => open_uri(&status, uri),
    };
    result.map_err(|e| {
        // The launch never happened, so let the user retry immediately.
        *LAST_LAUNCH.lock().unwrap_or_else(|e| e.into_inner()) = None;
        AppError::new(
            ErrorCode::LaunchFailed,
            format!("Couldn't open Roblox: {e}"),
        )
    })
}

#[tauri::command(async)]
pub fn launch_experience(
    app: AppHandle,
    db: State<'_, Db>,
    place_id: u64,
    universe_id: Option<u64>,
    name: String,
    icon_url: Option<String>,
    genre: Option<String>,
) -> Result<LaunchResult> {
    let place_id = validate_place_id(place_id)?;
    let universe_id = universe_id.map(to_db_id).transpose()?.map(|v| v as u64);
    let name = clean_name(&name).unwrap_or_else(|_| "Roblox experience".to_string());
    hand_off(&app, &db, &experience_uri(place_id))?;
    record_launch(&db, place_id, universe_id, &name, clean_icon_url(icon_url), genre);
    crate::after_launch::start(&app);
    Ok(LaunchResult { handed_off: true })
}

fn record_launch(
    db: &Db,
    place_id: u64,
    universe_id: Option<u64>,
    name: &str,
    icon_url: Option<String>,
    genre: Option<String>,
) {
    let genre = genre
        .map(|g| g.trim().chars().take(120).collect::<String>())
        .filter(|g| !g.is_empty());
    // The launch already happened; a bookkeeping failure must not turn it into an error.
    if let Err(e) = db.with(|c| history_record(c, place_id, universe_id, name, icon_url, genre, now_ms()))
    {
        eprintln!("muffin: could not record launch history: {e}");
    }
    crate::playtime::track(place_id, universe_id, name);
}

/// Joins one specific public server (from the server browser) of `place_id`.
#[tauri::command(async)]
pub fn launch_instance(
    app: AppHandle,
    db: State<'_, Db>,
    place_id: u64,
    instance_id: String,
    universe_id: Option<u64>,
    name: String,
    icon_url: Option<String>,
    genre: Option<String>,
) -> Result<LaunchResult> {
    let place_id = validate_place_id(place_id)?;
    let instance_id = parse_instance_id(&instance_id)?;
    let universe_id = universe_id.map(to_db_id).transpose()?.map(|v| v as u64);
    let name = clean_name(&name).unwrap_or_else(|_| "Roblox experience".to_string());
    hand_off(&app, &db, &instance_uri(place_id, &instance_id))?;
    record_launch(&db, place_id, universe_id, &name, clean_icon_url(icon_url), genre);
    crate::after_launch::start(&app);
    Ok(LaunchResult { handed_off: true })
}

#[tauri::command(async)]
pub fn launch_private_server(app: AppHandle, db: State<'_, Db>, server_id: i64) -> Result<LaunchResult> {
    let server = db
        .with(|c| get_private_server(c, server_id))?
        .ok_or_else(|| AppError::invalid("That private server no longer exists"))?;
    hand_off(&app, &db, &private_server_uri(&server.code, &server.kind))?;
    let name = db
        .with(|c| Ok(known_place_name(c, server.place_id as i64)))?
        .unwrap_or_else(|| "Roblox experience".to_string());
    record_launch(&db, server.place_id, None, &name, None, None);
    crate::after_launch::start(&app);
    Ok(LaunchResult { handed_off: true })
}

// ---- private servers -------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateServer {
    pub id: i64,
    pub place_id: u64,
    pub label: String,
    pub code: String,
    pub kind: String,
    pub created_at: i64,
}

fn map_server(r: &rusqlite::Row) -> rusqlite::Result<PrivateServer> {
    Ok(PrivateServer {
        id: r.get(0)?,
        place_id: r.get::<_, i64>(1)? as u64,
        label: r.get(2)?,
        code: r.get(3)?,
        kind: r.get(4)?,
        created_at: r.get(5)?,
    })
}

const SERVER_COLS: &str = "id, place_id, label, code, kind, created_at";

fn get_private_server(conn: &rusqlite::Connection, id: i64) -> Result<Option<PrivateServer>> {
    Ok(conn
        .query_row(
            &format!("SELECT {SERVER_COLS} FROM private_servers WHERE id = ?1"),
            [id],
            map_server,
        )
        .optional()?)
}

fn clean_label(label: Option<&str>) -> Result<String> {
    let label = label.map(str::trim).unwrap_or("");
    if label.is_empty() {
        return Ok(DEFAULT_PRIVATE_LABEL.to_string());
    }
    if label.chars().count() > MAX_LABEL_CHARS {
        return Err(AppError::invalid("Label must be 1–40 characters"));
    }
    Ok(label.to_string())
}

pub fn add_private_server_conn(
    conn: &rusqlite::Connection,
    place_id: u64,
    label: Option<&str>,
    link: &str,
    now: i64,
) -> Result<PrivateServer> {
    let place_id = to_db_id(validate_place_id(place_id)?)?;
    let label = clean_label(label)?;
    let share = parse_share_link(link)?;
    let duplicate: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM private_servers WHERE place_id = ?1 AND code = ?2)",
        params![place_id, share.code],
        |r| r.get(0),
    )?;
    if duplicate {
        return Err(AppError::invalid("Already saved"));
    }
    conn.execute(
        "INSERT INTO private_servers(place_id, label, code, kind, created_at)
         VALUES(?1, ?2, ?3, ?4, ?5)",
        params![place_id, label, share.code, share.kind, now],
    )?;
    let id = conn.last_insert_rowid();
    get_private_server(conn, id)?.ok_or_else(|| AppError::storage("Saved server went missing"))
}

#[tauri::command(async)]
pub fn add_private_server(
    db: State<'_, Db>,
    place_id: u64,
    label: Option<String>,
    link: String,
) -> Result<PrivateServer> {
    db.with(|c| add_private_server_conn(c, place_id, label.as_deref(), &link, now_ms()))
}

#[tauri::command(async)]
pub fn list_private_servers(db: State<'_, Db>, place_id: u64) -> Result<Vec<PrivateServer>> {
    let place_id = to_db_id(validate_place_id(place_id)?)?;
    db.with(|c| {
        let mut stmt = c.prepare(&format!(
            "SELECT {SERVER_COLS} FROM private_servers WHERE place_id = ?1 ORDER BY created_at ASC, id ASC"
        ))?;
        let rows = stmt.query_map([place_id], map_server)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    })
}

#[tauri::command(async)]
pub fn rename_private_server(db: State<'_, Db>, id: i64, label: String) -> Result<PrivateServer> {
    let label = clean_label(Some(&label))?;
    db.with(|c| {
        let changed = c.execute(
            "UPDATE private_servers SET label = ?2 WHERE id = ?1",
            params![id, label],
        )?;
        if changed == 0 {
            return Err(AppError::invalid("That private server no longer exists"));
        }
        get_private_server(c, id)?.ok_or_else(|| AppError::storage("Server went missing"))
    })
}

#[tauri::command(async)]
pub fn remove_private_server(db: State<'_, Db>, id: i64) -> Result<()> {
    db.with(|c| {
        c.execute("DELETE FROM private_servers WHERE id = ?1", [id])?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;

    #[cfg(windows)]
    const FISHSTRAP: &str =
        r#""C:\Users\Example\AppData\Local\Fishstrap\Fishstrap.exe" -player "%1""#;
    #[cfg(windows)]
    const ROBLOX: &str =
        r#""C:\Program Files\Roblox\Versions\x\RobloxPlayerLauncher.exe" %1"#;

    #[test]
    fn place_id_parsing() {
        assert_eq!(parse_place_id("1234").unwrap(), 1234);
        assert_eq!(parse_place_id("9007199254740992").unwrap(), MAX_PLACE_ID);
        for bad in [
            "0",
            "-5",
            "abc",
            "",
            "12 34",
            " 12",
            "+12",
            "9007199254740993",
            "99999999999999999999999999",
        ] {
            let e = parse_place_id(bad).expect_err(bad);
            assert_eq!(e.code, ErrorCode::InvalidInput, "{bad}");
        }
        assert!(validate_place_id(0).is_err());
        assert!(validate_place_id(MAX_PLACE_ID + 1).is_err());
    }

    #[test]
    fn uris() {
        assert_eq!(
            experience_uri(920587237),
            "roblox://experiences/start?placeId=920587237"
        );
        assert_eq!(
            private_server_uri("abcdEFGH1234", "Server"),
            "roblox://navigation/share_links?code=abcdEFGH1234&type=Server"
        );
    }

    #[test]
    fn instance_id_accepts_only_hyphenated_guids_and_canonicalizes() {
        let g = "826a0a53-76c5-4798-ba96-8d6f6dbe9d71";
        assert_eq!(parse_instance_id(g).unwrap(), g);
        assert_eq!(parse_instance_id(&format!("  {} ", g.to_uppercase())).unwrap(), g);
        for bad in [
            "",
            "abc",
            "826a0a5376c54798ba966d6dbe9d71",
            "826a0a5376c54798ba96-8d6f6dbe9d71ab",
            "{826a0a53-76c5-4798-ba96-8d6f6dbe9d71}",
            "826a0a53-76c5-4798-ba96-8d6f6dbe9d7z",
            "826a0a53-76c5-4798-ba96-8d6f6dbe9d71&x=1",
            "826a0a53-76c5-4798-ba96-8d6f6dbe9d71 &placeId=2",
            "../826a0a53-76c5-4798-ba96-8d6f6dbe9d7",
        ] {
            assert!(parse_instance_id(bad).is_err(), "{bad}");
        }
        assert_eq!(
            instance_uri(920587237, g),
            "roblox://experiences/start?placeId=920587237&gameInstanceId=826a0a53-76c5-4798-ba96-8d6f6dbe9d71"
        );
    }

    #[test]
    fn share_link_accepts_valid() {
        let l = parse_share_link("https://www.roblox.com/share?code=0123456789abcdef0123456789abcdef&type=Server")
            .unwrap();
        assert_eq!(l.code, "0123456789abcdef0123456789abcdef");
        assert_eq!(l.kind, "Server");
        let l = parse_share_link("  https://roblox.com/share?type=Server&code=ABCDEFGH ").unwrap();
        assert_eq!(l.code, "ABCDEFGH");
    }

    #[test]
    fn share_link_rejects_everything_else() {
        for bad in [
            "http://www.roblox.com/share?code=abcdefgh&type=Server",
            "https://roblox.com.evil.com/share?code=abcdefgh&type=Server",
            "https://evil.com/share?code=abcdefgh&type=Server",
            "https://evil.com/?x=roblox.com",
            "https://evil.com/share?code=abcdefgh&type=Server#roblox.com",
            "https://user@roblox.com/share?code=abcdefgh&type=Server",
            "https://roblox.com:8443/share?code=abcdefgh&type=Server",
            "https://www.roblox.com/share?type=Server",
            "https://www.roblox.com/share?code=abcdefgh",
            "https://www.roblox.com/share?code=abcdefgh&type=Other",
            "https://www.roblox.com/share?code=abc&type=Server",
            "https://www.roblox.com/share?code=abc%26x%3D1defgh&type=Server",
            "https://www.roblox.com/share?code=abcdefgh%26x%3D1&type=Server",
            "https://www.roblox.com/share?code=abcdefgh&code=ijklmnop&type=Server",
            "https://www.roblox.com/games/123/Game?privateServerLinkCode=1234567890",
            "https://www.roblox.com/share/?code=abcdefgh&type=Server",
            "roblox://navigation/share_links?code=abcdefgh&type=Server",
            "not a url",
            "",
        ] {
            let e = parse_share_link(bad).expect_err(bad);
            assert_eq!(e.code, ErrorCode::InvalidInput, "{bad}");
            assert!(e.message.starts_with("Paste the Roblox private server share link"));
        }
        // Overlong code
        let long = format!("https://www.roblox.com/share?code={}&type=Server", "a".repeat(65));
        assert!(parse_share_link(&long).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn handler_fishstrap() {
        let s = status_from_command(Some(FISHSTRAP.into()), |_| true);
        assert!(s.registered && s.exe_exists);
        assert_eq!(s.handler, Handler::Fishstrap);
        assert_eq!(
            s.exe_path.as_deref(),
            Some(r"C:\Users\Example\AppData\Local\Fishstrap\Fishstrap.exe")
        );
    }

    #[cfg(windows)]
    #[test]
    fn handler_roblox_with_spaces_in_quoted_path() {
        let s = status_from_command(Some(ROBLOX.into()), |_| false);
        assert_eq!(s.handler, Handler::Roblox);
        assert_eq!(
            s.exe_path.as_deref(),
            Some(r"C:\Program Files\Roblox\Versions\x\RobloxPlayerLauncher.exe")
        );
        assert!(s.registered && !s.exe_exists);
    }

    #[cfg(windows)]
    #[test]
    fn handler_unquoted_and_other() {
        let s = status_from_command(
            Some(r"C:\Tools\Bloxstrap.exe -player %1".into()),
            |p| p == r"C:\Tools\Bloxstrap.exe",
        );
        assert_eq!(s.handler, Handler::Bloxstrap);
        assert!(s.exe_exists);
        assert_eq!(s.exe_path.as_deref(), Some(r"C:\Tools\Bloxstrap.exe"));

        let s = status_from_command(Some(r"C:\Program Files\Foo\foo.exe %1".into()), |_| true);
        assert_eq!(s.handler, Handler::Other);
        assert_eq!(s.exe_path.as_deref(), Some(r"C:\Program Files\Foo\foo.exe"));

        let s = status_from_command(Some(r"notepad %1".into()), |_| false);
        assert_eq!(s.exe_path.as_deref(), Some("notepad"));
        assert_eq!(s.handler, Handler::Other);

        let s = status_from_command(
            Some(r"C:\x\RobloxPlayerBeta.exe --play".into()),
            |_| true,
        );
        assert_eq!(s.handler, Handler::Roblox);
    }

    #[cfg(windows)]
    #[test]
    fn handler_none_when_unregistered() {
        for cmd in [None, Some("   ".to_string())] {
            let s = status_from_command(cmd, |_| true);
            assert!(!s.registered && !s.exe_exists);
            assert_eq!(s.handler, Handler::None);
            assert!(s.command.is_none() && s.exe_path.is_none());
        }
    }

    #[cfg(windows)]
    #[test]
    fn not_installed_is_driven_by_status() {
        let none = status_from_command(None, |_| true);
        assert_eq!(ensure_installed(&none).unwrap_err().code, ErrorCode::NotInstalled);
        let missing = status_from_command(Some(FISHSTRAP.into()), |_| false);
        let e = ensure_installed(&missing).unwrap_err();
        assert_eq!(e.code, ErrorCode::NotInstalled);
        assert!(e.message.contains("Fishstrap.exe"));
        let ok = status_from_command(Some(FISHSTRAP.into()), |_| true);
        assert!(ensure_installed(&ok).is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn status_serializes_per_contract() {
        let s = status_from_command(Some(FISHSTRAP.into()), |_| true);
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["handler"], "fishstrap");
        assert_eq!(v["exeExists"], true);
        assert!(v["exePath"].is_string());
        let none = serde_json::to_value(status_from_command(None, |_| true)).unwrap();
        assert_eq!(none["handler"], "none");
        assert!(none["command"].is_null());
    }

    #[test]
    fn ensure_installed_rejects_unregistered_and_missing_exe() {
        let st = |registered, exe_path: Option<&str>, exe_exists| ProtocolStatus {
            registered,
            command: None,
            exe_path: exe_path.map(str::to_string),
            exe_exists,
            handler: Handler::Roblox,
        };
        assert_eq!(ensure_installed(&st(false, None, false)).unwrap_err().code, ErrorCode::NotInstalled);
        let e = ensure_installed(&st(true, Some("/x"), false)).unwrap_err();
        assert_eq!(e.code, ErrorCode::NotInstalled);
        assert!(e.message.contains("/x"));
        assert!(ensure_installed(&st(true, Some("/x"), true)).is_ok());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_status_maps_found_app() {
        let s = macos_status_from(Some("/Applications/Roblox.app".into()));
        assert!(s.registered && s.exe_exists);
        assert_eq!(s.handler, Handler::Roblox);
        assert_eq!(s.exe_path.as_deref(), Some("/Applications/Roblox.app"));
        let none = macos_status_from(None);
        assert!(!none.registered && !none.exe_exists);
        assert_eq!(none.handler, Handler::None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_status_maps_sober_and_xdg() {
        assert_eq!(linux_status_from(true, None).handler, Handler::Roblox);
        assert_eq!(linux_status_from(false, Some("org.vinegarhq.Sober.desktop")).handler, Handler::Roblox);
        let other = linux_status_from(false, Some("firefox.desktop"));
        assert!(other.registered);
        assert_eq!(other.handler, Handler::Other);
        for none in [None, Some(""), Some("  ")] {
            let s = linux_status_from(false, none);
            assert!(!s.registered && !s.exe_exists);
            assert_eq!(s.handler, Handler::None);
        }
    }

    #[test]
    fn debounce_blocks_within_window() {
        let last = Mutex::new(None);
        let t0 = Instant::now();
        debounce(&last, t0).unwrap();
        let e = debounce(&last, t0 + Duration::from_secs(1)).unwrap_err();
        assert_eq!(e.code, ErrorCode::LaunchBusy);
        debounce(&last, t0 + Duration::from_secs(4)).unwrap();
    }

    #[test]
    fn private_server_crud_rules() {
        let conn = test_conn();
        let link = "https://www.roblox.com/share?code=0123456789abcdef&type=Server";
        let s = add_private_server_conn(&conn, 42, None, link, 5).unwrap();
        assert_eq!(s.label, "Private Server");
        assert_eq!((s.place_id, s.kind.as_str(), s.created_at), (42, "Server", 5));

        let dup = add_private_server_conn(&conn, 42, Some("x"), link, 6).unwrap_err();
        assert_eq!((dup.code, dup.message.as_str()), (ErrorCode::InvalidInput, "Already saved"));
        // Same code under another place is a different saved server.
        add_private_server_conn(&conn, 43, Some("  Mine "), link, 7).unwrap();

        let long = "x".repeat(41);
        assert!(add_private_server_conn(&conn, 44, Some(&long), link, 8).is_err());
        assert!(add_private_server_conn(&conn, 44, None, "https://evil.com/share?code=abcdefgh&type=Server", 8).is_err());
        assert!(add_private_server_conn(&conn, 0, None, link, 8).is_err());
        assert_eq!(get_private_server(&conn, s.id).unwrap().unwrap(), s);
    }
}
