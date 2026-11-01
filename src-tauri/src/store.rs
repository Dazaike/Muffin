//! Thin SQL-backed commands: library, history, searches, settings, cache, data summary.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, State, WebviewWindow};

use crate::db::{self, now_ms, Db};
use crate::error::{AppError, Result};
use crate::launch::{validate_place_id, MAX_PLACE_ID};

const MAX_NAME_CHARS: usize = 200;
const MAX_FIELD_CHARS: usize = 120;
const MAX_QUERY_CHARS: usize = 100;
const SEARCH_CAP: i64 = 20;

// ---- types -----------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    pub place_id: u64,
    pub universe_id: Option<u64>,
    pub name: String,
    pub icon_url: Option<String>,
    pub creator: Option<String>,
    pub genre: Option<String>,
    pub favorite: bool,
    pub pinned: bool,
    pub added_at: i64,
    pub position: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryUpsert {
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
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub added_at: Option<i64>,
    #[serde(default)]
    pub position: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub place_id: u64,
    pub universe_id: Option<u64>,
    pub name: String,
    pub icon_url: Option<String>,
    pub genre: Option<String>,
    pub last_launched_at: i64,
    pub launch_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataSummary {
    pub library_count: i64,
    pub history_count: i64,
    pub search_count: i64,
    pub cache_rows: i64,
    pub db_bytes: i64,
}

// ---- validation helpers ----------------------------------------------------------------------

/// Only keep icon URLs the webview CSP can actually render (https on rbxcdn.com).
pub fn clean_icon_url(url: Option<String>) -> Option<String> {
    let url = url?;
    let parsed = url::Url::parse(url.trim()).ok()?;
    let host = parsed.host_str()?;
    if parsed.scheme() == "https" && (host == "rbxcdn.com" || host.ends_with(".rbxcdn.com")) {
        Some(parsed.to_string())
    } else {
        None
    }
}

pub fn clean_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::invalid("Name must not be empty"));
    }
    Ok(name.chars().take(MAX_NAME_CHARS).collect())
}

fn clean_opt_text(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().chars().take(MAX_FIELD_CHARS).collect::<String>())
        .filter(|s| !s.is_empty())
}

pub fn to_db_id(id: u64) -> Result<i64> {
    if id > MAX_PLACE_ID {
        return Err(AppError::invalid("Id out of range"));
    }
    Ok(id as i64)
}

fn clean_query(q: &str) -> Result<String> {
    let q = q.trim();
    if q.is_empty() || q.chars().count() > MAX_QUERY_CHARS {
        return Err(AppError::invalid("Search must be 1–100 characters"));
    }
    Ok(q.to_string())
}

// ---- library ---------------------------------------------------------------------------------

const LIB_COLS: &str =
    "place_id, universe_id, name, icon_url, creator, genre, favorite, pinned, added_at, position";

fn map_library(r: &Row) -> rusqlite::Result<LibraryEntry> {
    Ok(LibraryEntry {
        place_id: r.get::<_, i64>(0)? as u64,
        universe_id: r.get::<_, Option<i64>>(1)?.map(|v| v as u64),
        name: r.get(2)?,
        icon_url: r.get(3)?,
        creator: r.get(4)?,
        genre: r.get(5)?,
        favorite: r.get::<_, i64>(6)? != 0,
        pinned: r.get::<_, i64>(7)? != 0,
        added_at: r.get(8)?,
        position: r.get(9)?,
    })
}

pub fn library_list_conn(conn: &Connection) -> Result<Vec<LibraryEntry>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {LIB_COLS} FROM library ORDER BY position ASC, added_at ASC, place_id ASC"
    ))?;
    let rows = stmt.query_map([], map_library)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn library_get(conn: &Connection, place_id: i64) -> Result<Option<LibraryEntry>> {
    Ok(conn
        .query_row(
            &format!("SELECT {LIB_COLS} FROM library WHERE place_id = ?1"),
            [place_id],
            map_library,
        )
        .optional()?)
}

pub fn library_upsert_conn(
    conn: &Connection,
    entry: LibraryUpsert,
    now: i64,
) -> Result<LibraryEntry> {
    let place_id = to_db_id(validate_place_id(entry.place_id)?)?;
    let universe_id = entry.universe_id.map(to_db_id).transpose()?;
    let name = clean_name(&entry.name)?;
    let existing = library_get(conn, place_id)?;
    let added_at = entry
        .added_at
        .or(existing.as_ref().map(|e| e.added_at))
        .unwrap_or(now);
    let position = match entry.position.or(existing.as_ref().map(|e| e.position)) {
        Some(p) => p,
        None => conn.query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM library",
            [],
            |r| r.get(0),
        )?,
    };
    conn.execute(
        "INSERT INTO library(place_id, universe_id, name, icon_url, creator, genre, favorite, pinned, added_at, position)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(place_id) DO UPDATE SET
            universe_id = COALESCE(excluded.universe_id, universe_id),
            name = excluded.name,
            icon_url = COALESCE(excluded.icon_url, icon_url),
            creator = COALESCE(excluded.creator, creator),
            genre = COALESCE(excluded.genre, genre),
            favorite = excluded.favorite,
            pinned = excluded.pinned,
            added_at = excluded.added_at,
            position = excluded.position",
        params![
            place_id,
            universe_id,
            name,
            clean_icon_url(entry.icon_url),
            clean_opt_text(entry.creator),
            clean_opt_text(entry.genre),
            entry.favorite as i64,
            entry.pinned as i64,
            added_at,
            position
        ],
    )?;
    library_get(conn, place_id)?.ok_or_else(|| AppError::storage("Library row missing after save"))
}

pub fn library_set_flags_conn(
    conn: &Connection,
    place_id: u64,
    favorite: Option<bool>,
    pinned: Option<bool>,
) -> Result<()> {
    let place_id = to_db_id(validate_place_id(place_id)?)?;
    let changed = conn.execute(
        "UPDATE library SET favorite = COALESCE(?2, favorite), pinned = COALESCE(?3, pinned)
         WHERE place_id = ?1",
        params![place_id, favorite.map(i64::from), pinned.map(i64::from)],
    )?;
    if changed == 0 {
        return Err(AppError::invalid("That game is not in your library"));
    }
    Ok(())
}

/// Rewrites `position` to 0..n following `place_ids`; library rows not listed keep their relative
/// order after the listed ones so positions stay unique.
pub fn library_reorder_conn(conn: &mut Connection, place_ids: &[u64]) -> Result<()> {
    let tx = conn.transaction()?;
    let mut next: i64 = 0;
    let mut seen = std::collections::HashSet::with_capacity(place_ids.len());
    {
        let mut set = tx.prepare("UPDATE library SET position = ?2 WHERE place_id = ?1")?;
        for &id in place_ids {
            let id = to_db_id(id)?;
            if !seen.insert(id) {
                continue;
            }
            if set.execute(params![id, next])? > 0 {
                next += 1;
            }
        }
        let rest: Vec<i64> = {
            let mut stmt = tx.prepare(
                "SELECT place_id FROM library ORDER BY position ASC, added_at ASC, place_id ASC",
            )?;
            let ids = stmt
                .query_map([], |r| r.get(0))?
                .collect::<rusqlite::Result<Vec<i64>>>()?;
            ids.into_iter().filter(|id| !seen.contains(id)).collect()
        };
        for id in rest {
            set.execute(params![id, next])?;
            next += 1;
        }
    }
    tx.commit()?;
    Ok(())
}

#[tauri::command(async)]
pub fn library_list(db: State<'_, Db>) -> Result<Vec<LibraryEntry>> {
    db.with(|c| library_list_conn(c))
}

#[tauri::command(async)]
pub fn library_upsert(db: State<'_, Db>, entry: LibraryUpsert) -> Result<LibraryEntry> {
    db.with(|c| library_upsert_conn(c, entry, now_ms()))
}

#[tauri::command(async)]
pub fn library_remove(db: State<'_, Db>, place_id: u64) -> Result<()> {
    let id = to_db_id(validate_place_id(place_id)?)?;
    db.with(|c| {
        c.execute("DELETE FROM library WHERE place_id = ?1", [id])?;
        Ok(())
    })
}

#[tauri::command(async)]
pub fn library_set_flags(
    db: State<'_, Db>,
    place_id: u64,
    favorite: Option<bool>,
    pinned: Option<bool>,
) -> Result<()> {
    db.with(|c| library_set_flags_conn(c, place_id, favorite, pinned))
}

#[tauri::command(async)]
pub fn library_reorder(db: State<'_, Db>, place_ids: Vec<u64>) -> Result<()> {
    db.with(|c| library_reorder_conn(c, &place_ids))
}

// ---- history ---------------------------------------------------------------------------------

fn map_history(r: &Row) -> rusqlite::Result<HistoryEntry> {
    Ok(HistoryEntry {
        place_id: r.get::<_, i64>(0)? as u64,
        universe_id: r.get::<_, Option<i64>>(1)?.map(|v| v as u64),
        name: r.get(2)?,
        icon_url: r.get(3)?,
        genre: r.get(4)?,
        last_launched_at: r.get(5)?,
        launch_count: r.get(6)?,
    })
}

pub fn history_list_conn(conn: &Connection, limit: u32) -> Result<Vec<HistoryEntry>> {
    let mut stmt = conn.prepare(
        "SELECT place_id, universe_id, name, icon_url, genre, last_launched_at, launch_count
         FROM history ORDER BY last_launched_at DESC, place_id DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map([limit.clamp(1, 500)], map_history)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Records one launch: inserts the row or increments `launch_count`.
pub fn history_record(
    conn: &Connection,
    place_id: u64,
    universe_id: Option<u64>,
    name: &str,
    icon_url: Option<String>,
    genre: Option<String>,
    now: i64,
) -> Result<()> {
    conn.execute(
        "INSERT INTO history(place_id, universe_id, name, icon_url, genre, last_launched_at, launch_count)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, 1)
         ON CONFLICT(place_id) DO UPDATE SET
            universe_id = COALESCE(excluded.universe_id, universe_id),
            name = excluded.name,
            icon_url = COALESCE(excluded.icon_url, icon_url),
            genre = COALESCE(excluded.genre, genre),
            last_launched_at = excluded.last_launched_at,
            launch_count = launch_count + 1",
        params![
            to_db_id(place_id)?,
            universe_id.map(to_db_id).transpose()?,
            name,
            icon_url,
            genre,
            now
        ],
    )?;
    Ok(())
}

/// Best known name for a place from library, then history.
pub fn known_place_name(conn: &Connection, place_id: i64) -> Option<String> {
    let from = |sql: &str| -> Option<String> {
        conn.query_row(sql, [place_id], |r| r.get(0)).optional().ok().flatten()
    };
    from("SELECT name FROM library WHERE place_id = ?1")
        .or_else(|| from("SELECT name FROM history WHERE place_id = ?1"))
}

#[tauri::command(async)]
pub fn history_list(db: State<'_, Db>, limit: u32) -> Result<Vec<HistoryEntry>> {
    db.with(|c| history_list_conn(c, limit))
}

#[tauri::command(async)]
pub fn history_clear(db: State<'_, Db>) -> Result<()> {
    db.with(|c| {
        c.execute("DELETE FROM history", [])?;
        Ok(())
    })
}

// ---- searches --------------------------------------------------------------------------------

pub fn searches_add_at(conn: &Connection, q: &str, now: i64) -> Result<()> {
    let q = clean_query(q)?;
    conn.execute(
        "INSERT INTO searches(query, last_at) VALUES(?1, ?2)
         ON CONFLICT(query) DO UPDATE SET last_at = excluded.last_at",
        params![q, now],
    )?;
    conn.execute(
        "DELETE FROM searches WHERE rowid NOT IN
            (SELECT rowid FROM searches ORDER BY last_at DESC, rowid DESC LIMIT ?1)",
        [SEARCH_CAP],
    )?;
    Ok(())
}

pub fn searches_list_conn(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT query FROM searches ORDER BY last_at DESC, rowid DESC")?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

#[tauri::command(async)]
pub fn searches_list(db: State<'_, Db>) -> Result<Vec<String>> {
    db.with(|c| searches_list_conn(c))
}

#[tauri::command(async)]
pub fn searches_add(db: State<'_, Db>, q: String) -> Result<()> {
    db.with(|c| searches_add_at(c, &q, now_ms()))
}

#[tauri::command(async)]
pub fn searches_remove(db: State<'_, Db>, q: String) -> Result<()> {
    db.with(|c| {
        c.execute("DELETE FROM searches WHERE query = ?1", [q.trim()])?;
        Ok(())
    })
}

#[tauri::command(async)]
pub fn searches_clear(db: State<'_, Db>) -> Result<()> {
    db.with(|c| {
        c.execute("DELETE FROM searches", [])?;
        Ok(())
    })
}

// ---- settings --------------------------------------------------------------------------------

enum Kind {
    Bool,
    OneOf(&'static [&'static str]),
    /// Whole number within the inclusive range.
    Int(i64, i64),
}

/// The `settings_set` allowlist (`activeAccountId` is intentionally absent: Rust writes it).
const SETTINGS: &[(&str, Kind)] = &[
    ("accentHue", Kind::Int(0, 359)),
    ("density", Kind::OneOf(&["comfortable", "compact"])),
    ("animationIntensity", Kind::OneOf(&["full", "reduced", "off"])),
    ("reduceMotion", Kind::Bool),
    ("lightweightMode", Kind::Bool),
    ("startMinimized", Kind::Bool),
    ("autoStart", Kind::Bool),
    ("closeBehavior", Kind::OneOf(&["quit", "tray"])),
    ("afterLaunch", Kind::OneOf(&["nothing", "tray", "quit"])),
    ("showRobux", Kind::Bool),
    ("notifications", Kind::Bool),
    ("continueFromRoblox", Kind::Bool),
    // background notifier (notifier.rs)
    ("notifyMessages", Kind::Bool),
    ("notifyFriendRequests", Kind::Bool),
    ("notifyFriendsOnline", Kind::Bool),
    ("notifyOnlyWhenHidden", Kind::Bool),
    ("globalShortcut", Kind::Bool),
    ("libraryView", Kind::OneOf(&["grid", "list"])),
    ("friendsView", Kind::OneOf(&["grid", "list"])),
    ("searchView", Kind::OneOf(&["grid", "list"])),
    ("cardShape", Kind::OneOf(&["portrait", "square"])),
    ("discoverView", Kind::OneOf(&["grid", "list"])),
    ("discoverCards", Kind::OneOf(&["vertical", "horizontal"])),
    ("favoritesView", Kind::OneOf(&["grid", "list"])),
    ("recentView", Kind::OneOf(&["grid", "list"])),
    ("playtimeView", Kind::OneOf(&["grid", "list"])),
    ("walletView", Kind::OneOf(&["grid", "list"])),
    ("profileView", Kind::OneOf(&["grid", "list"])),
    ("peopleView", Kind::OneOf(&["grid", "list"])),
    ("serversView", Kind::OneOf(&["grid", "list"])),
    ("badgesView", Kind::OneOf(&["grid", "list"])),
    ("passesView", Kind::OneOf(&["grid", "list"])),
    ("placesView", Kind::OneOf(&["grid", "list"])),
    (
        "librarySort",
        Kind::OneOf(&["name", "lastPlayed", "added", "custom"]),
    ),
    ("onboarded", Kind::Bool),
    // custom app background image (background.rs)
    ("backgroundImage", Kind::Bool),
    ("backgroundDim", Kind::Int(0, 90)),
    ("backgroundBlur", Kind::Int(0, 24)),
];

pub fn validate_setting(key: &str, value: &Value) -> Result<()> {
    let Some((_, kind)) = SETTINGS.iter().find(|(k, _)| *k == key) else {
        return Err(AppError::invalid(format!("Unknown setting: {key}")));
    };
    let ok = match kind {
        Kind::Bool => value.is_boolean(),
        Kind::OneOf(allowed) => value.as_str().is_some_and(|s| allowed.contains(&s)),
        // `as_i64` is None for floats, so 5.5 and 1e2 are rejected, not truncated.
        Kind::Int(min, max) => value.as_i64().is_some_and(|n| (*min..=*max).contains(&n)),
    };
    if ok {
        Ok(())
    } else {
        Err(AppError::invalid(format!("Invalid value for {key}")))
    }
}

#[tauri::command(async)]
pub fn settings_get_all(db: State<'_, Db>) -> Result<HashMap<String, Value>> {
    db.with(|c| {
        let mut stmt = c.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut out = HashMap::new();
        for row in rows {
            let (k, v) = row?;
            if let Ok(v) = serde_json::from_str::<Value>(&v) {
                out.insert(k, v);
            }
        }
        Ok(out)
    })
}

#[tauri::command(async)]
pub fn settings_set(app: AppHandle, db: State<'_, Db>, key: String, value: Value) -> Result<()> {
    validate_setting(&key, &value)?;
    if key == "globalShortcut" {
        // Apply first: if the OS refuses the registration the stored value must not claim it worked.
        crate::shortcut::set_enabled(&app, value.as_bool().unwrap_or(false))?;
    }
    db.with(|c| db::setting_set(c, &key, &value))
}

// ---- cache & summary -------------------------------------------------------------------------

#[tauri::command(async)]
pub fn cache_clear(window: WebviewWindow, db: State<'_, Db>) -> Result<()> {
    db.with(|c| {
        c.execute("DELETE FROM api_cache", [])?;
        Ok(())
    })?;
    window
        .clear_all_browsing_data()
        .map_err(|e| AppError::storage(format!("Couldn't clear the image cache: {e}")))
}

#[tauri::command(async)]
pub fn data_summary(db: State<'_, Db>) -> Result<DataSummary> {
    let (library_count, history_count, search_count, cache_rows) = db.with(|c| {
        let count = |t: &str| -> Result<i64> {
            Ok(c.query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get(0))?)
        };
        Ok((
            count("library")?,
            count("history")?,
            count("searches")?,
            count("api_cache")?,
        ))
    })?;
    Ok(DataSummary {
        library_count,
        history_count,
        search_count,
        cache_rows,
        db_bytes: db.size_bytes()?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;

    fn up(place_id: u64, name: &str) -> LibraryUpsert {
        LibraryUpsert {
            place_id,
            universe_id: None,
            name: name.into(),
            icon_url: None,
            creator: None,
            genre: None,
            favorite: false,
            pinned: false,
            added_at: None,
            position: None,
        }
    }

    fn order(conn: &Connection) -> Vec<u64> {
        library_list_conn(conn)
            .unwrap()
            .into_iter()
            .map(|e| e.place_id)
            .collect()
    }

    #[test]
    fn searches_cap_at_20_keeping_newest() {
        let conn = test_conn();
        for i in 0..25 {
            searches_add_at(&conn, &format!("q{i}"), 1000 + i).unwrap();
        }
        let list = searches_list_conn(&conn).unwrap();
        assert_eq!(list.len(), 20);
        assert_eq!(list.first().unwrap(), "q24");
        assert_eq!(list.last().unwrap(), "q5");
    }

    #[test]
    fn searches_readd_moves_to_front_without_duplicate() {
        let conn = test_conn();
        searches_add_at(&conn, "a", 1).unwrap();
        searches_add_at(&conn, "b", 2).unwrap();
        searches_add_at(&conn, "  a ", 3).unwrap();
        assert_eq!(searches_list_conn(&conn).unwrap(), vec!["a", "b"]);
        assert!(searches_add_at(&conn, "   ", 4).is_err());
    }

    #[test]
    fn library_reorder_rewrites_positions() {
        let mut conn = test_conn();
        for (i, id) in [10u64, 20, 30, 40].into_iter().enumerate() {
            library_upsert_conn(&conn, up(id, "g"), 100 + i as i64).unwrap();
        }
        assert_eq!(order(&conn), vec![10, 20, 30, 40]);
        library_reorder_conn(&mut conn, &[40, 20, 10, 30]).unwrap();
        assert_eq!(order(&conn), vec![40, 20, 10, 30]);
        let positions: Vec<i64> = library_list_conn(&conn)
            .unwrap()
            .iter()
            .map(|e| e.position)
            .collect();
        assert_eq!(positions, vec![0, 1, 2, 3]);
    }

    #[test]
    fn library_reorder_partial_list_keeps_rest_after() {
        let mut conn = test_conn();
        for id in [1u64, 2, 3] {
            library_upsert_conn(&conn, up(id, "g"), 5).unwrap();
        }
        library_reorder_conn(&mut conn, &[3, 999, 3]).unwrap();
        assert_eq!(order(&conn), vec![3, 1, 2]);
        let positions: Vec<i64> = library_list_conn(&conn)
            .unwrap()
            .iter()
            .map(|e| e.position)
            .collect();
        assert_eq!(positions, vec![0, 1, 2]);
    }

    #[test]
    fn upsert_keeps_added_at_and_position_unless_provided() {
        let conn = test_conn();
        let first = library_upsert_conn(&conn, up(7, "A"), 111).unwrap();
        assert_eq!((first.added_at, first.position), (111, 0));
        let mut again = up(7, "A2");
        again.favorite = true;
        let second = library_upsert_conn(&conn, again, 999).unwrap();
        assert_eq!((second.added_at, second.position), (111, 0));
        assert!(second.favorite);
        assert_eq!(second.name, "A2");

        let mut restore = up(7, "A2");
        restore.added_at = Some(5);
        restore.position = Some(9);
        let third = library_upsert_conn(&conn, restore, 1000).unwrap();
        assert_eq!((third.added_at, third.position), (5, 9));
    }

    #[test]
    fn upsert_metadata_not_erased_by_missing_fields() {
        let conn = test_conn();
        let mut full = up(7, "A");
        full.creator = Some("Someone".into());
        full.genre = Some("Action".into());
        full.universe_id = Some(70);
        library_upsert_conn(&conn, full, 1).unwrap();
        let e = library_upsert_conn(&conn, up(7, "A"), 2).unwrap();
        assert_eq!(e.creator.as_deref(), Some("Someone"));
        assert_eq!(e.genre.as_deref(), Some("Action"));
        assert_eq!(e.universe_id, Some(70));
    }

    #[test]
    fn upsert_rejects_bad_input() {
        let conn = test_conn();
        assert!(library_upsert_conn(&conn, up(0, "x"), 1).is_err());
        assert!(library_upsert_conn(&conn, up(5, "   "), 1).is_err());
        assert!(library_upsert_conn(&conn, up(MAX_PLACE_ID + 1, "x"), 1).is_err());
    }

    #[test]
    fn set_flags_requires_existing_row() {
        let conn = test_conn();
        assert!(library_set_flags_conn(&conn, 5, Some(true), None).is_err());
        library_upsert_conn(&conn, up(5, "x"), 1).unwrap();
        library_set_flags_conn(&conn, 5, Some(true), None).unwrap();
        library_set_flags_conn(&conn, 5, None, Some(true)).unwrap();
        let e = library_get(&conn, 5).unwrap().unwrap();
        assert!(e.favorite && e.pinned);
        library_set_flags_conn(&conn, 5, Some(false), None).unwrap();
        let e = library_get(&conn, 5).unwrap().unwrap();
        assert!(!e.favorite && e.pinned);
    }

    #[test]
    fn history_record_increments_and_orders() {
        let conn = test_conn();
        history_record(&conn, 1, Some(10), "One", None, None, 100).unwrap();
        history_record(&conn, 2, None, "Two", None, Some("RPG".into()), 200).unwrap();
        history_record(&conn, 1, None, "One", None, None, 300).unwrap();
        let list = history_list_conn(&conn, 10).unwrap();
        assert_eq!(list.iter().map(|h| h.place_id).collect::<Vec<_>>(), vec![1, 2]);
        assert_eq!(list[0].launch_count, 2);
        assert_eq!(list[0].last_launched_at, 300);
        assert_eq!(list[0].universe_id, Some(10));
        assert_eq!(list[1].genre.as_deref(), Some("RPG"));
        assert_eq!(history_list_conn(&conn, 1).unwrap().len(), 1);
    }

    #[test]
    fn setting_validation() {
        assert!(validate_setting("accentHue", &Value::from(0)).is_ok());
        assert!(validate_setting("accentHue", &Value::from(359)).is_ok());
        assert!(validate_setting("accentHue", &Value::from(360)).is_err());
        assert!(validate_setting("accentHue", &Value::from(-1)).is_err());
        assert!(validate_setting("accentHue", &Value::from(265.5)).is_err());
        assert!(validate_setting("accentHue", &Value::from("265")).is_err());
        assert!(validate_setting("accent", &Value::from("rose")).is_err());
        assert!(validate_setting("discoverCards", &Value::from("vertical")).is_ok());
        assert!(validate_setting("discoverCards", &Value::from("horizontal")).is_ok());
        assert!(validate_setting("discoverCards", &Value::from("wide")).is_err());
        assert!(validate_setting("discoverCards", &Value::from(true)).is_err());
        assert!(validate_setting("closeBehavior", &Value::from("tray")).is_ok());
        assert!(validate_setting("onboarded", &Value::from(true)).is_ok());
        assert!(validate_setting("onboarded", &Value::from("yes")).is_err());
        assert!(validate_setting("nope", &Value::from(true)).is_err());
        assert!(validate_setting("backgroundImage", &Value::from(true)).is_ok());
        assert!(validate_setting("backgroundImage", &Value::from(1)).is_err());
        assert!(validate_setting("backgroundDim", &Value::from(0)).is_ok());
        assert!(validate_setting("backgroundDim", &Value::from(90)).is_ok());
        assert!(validate_setting("backgroundDim", &Value::from(91)).is_err());
        assert!(validate_setting("backgroundDim", &Value::from(-1)).is_err());
        assert!(validate_setting("backgroundDim", &Value::from(55.5)).is_err());
        assert!(validate_setting("backgroundDim", &Value::from("55")).is_err());
        assert!(validate_setting("backgroundBlur", &Value::from(24)).is_ok());
        assert!(validate_setting("backgroundBlur", &Value::from(25)).is_err());
        assert!(validate_setting("backgroundBlur", &Value::Null).is_err());
    }

    #[test]
    fn icon_url_filter() {
        assert!(clean_icon_url(Some("https://tr.rbxcdn.com/a/b.webp".into())).is_some());
        assert!(clean_icon_url(Some("http://tr.rbxcdn.com/a".into())).is_none());
        assert!(clean_icon_url(Some("https://evil.com/rbxcdn.com".into())).is_none());
        assert!(clean_icon_url(Some("https://rbxcdn.com.evil.com/a".into())).is_none());
        assert!(clean_icon_url(None).is_none());
    }
}
