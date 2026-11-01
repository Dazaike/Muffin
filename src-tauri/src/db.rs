use std::{
    path::Path,
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::error::{AppError, Result};

const LATEST_VERSION: i64 = 1;

const SCHEMA_V1: &str = "
CREATE TABLE library(
    place_id INTEGER PRIMARY KEY,
    universe_id INTEGER,
    name TEXT NOT NULL,
    icon_url TEXT,
    creator TEXT,
    genre TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER NOT NULL,
    position INTEGER NOT NULL
);
CREATE TABLE history(
    place_id INTEGER PRIMARY KEY,
    universe_id INTEGER,
    name TEXT NOT NULL,
    icon_url TEXT,
    genre TEXT,
    last_launched_at INTEGER NOT NULL,
    launch_count INTEGER NOT NULL
);
CREATE TABLE private_servers(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    code TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_private_servers_place ON private_servers(place_id);
CREATE TABLE searches(
    query TEXT PRIMARY KEY,
    last_at INTEGER NOT NULL
);
CREATE TABLE settings(
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE api_cache(
    key TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
);
";

/// The single SQLite connection, guarded by a mutex. Never hold the guard across an `.await`.
pub struct Db(Mutex<Connection>);

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        let mut conn = Connection::open(path)?;
        conn.pragma_update_and_check(None, "journal_mode", "WAL", |r| r.get::<_, String>(0))?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        migrate(&mut conn)?;
        crate::account::ensure_schema(&conn)?;
        crate::playtime::ensure_schema(&conn)?;
        Ok(Self(Mutex::new(conn)))
    }

    fn lock(&self) -> MutexGuard<'_, Connection> {
        // A poisoned lock only means another command panicked; the connection itself is intact
        // (any open transaction rolls back on drop).
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn with<T>(&self, f: impl FnOnce(&mut Connection) -> Result<T>) -> Result<T> {
        let mut guard = self.lock();
        f(&mut guard)
    }

    /// On-disk size of the main database file in bytes.
    pub fn size_bytes(&self) -> Result<i64> {
        self.with(|c| {
            let pages: i64 = c.pragma_query_value(None, "page_count", |r| r.get(0))?;
            let page_size: i64 = c.pragma_query_value(None, "page_size", |r| r.get(0))?;
            Ok(pages * page_size)
        })
    }
}

/// Bring the schema up to `LATEST_VERSION` using `PRAGMA user_version`.
pub fn migrate(conn: &mut Connection) -> Result<()> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version > LATEST_VERSION {
        return Err(AppError::storage(
            "The Muffin database was created by a newer version of the app",
        ));
    }
    if version < 1 {
        let tx = conn.transaction()?;
        tx.execute_batch(SCHEMA_V1)?;
        tx.pragma_update(None, "user_version", 1)?;
        tx.commit()?;
    }
    Ok(())
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ---- settings --------------------------------------------------------------------------------

pub fn setting_get(conn: &Connection, key: &str) -> Result<Option<Value>> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()?;
    raw.map(|s| serde_json::from_str(&s).map_err(AppError::from))
        .transpose()
}

pub fn setting_set(conn: &Connection, key: &str, value: &Value) -> Result<()> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, serde_json::to_string(value)?],
    )?;
    Ok(())
}

pub fn setting_delete(conn: &Connection, key: &str) -> Result<()> {
    conn.execute("DELETE FROM settings WHERE key = ?1", [key])?;
    Ok(())
}

pub fn setting_bool(conn: &Connection, key: &str, default: bool) -> bool {
    match setting_get(conn, key) {
        Ok(Some(Value::Bool(b))) => b,
        _ => default,
    }
}

// ---- api cache -------------------------------------------------------------------------------

/// Returns `(body, fetched_at_ms)`.
pub fn cache_get(conn: &Connection, key: &str) -> Result<Option<(String, i64)>> {
    Ok(conn
        .query_row(
            "SELECT body, fetched_at FROM api_cache WHERE key = ?1",
            [key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?)
}

pub fn cache_put(conn: &Connection, key: &str, body: &str, now: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO api_cache(key, body, fetched_at) VALUES(?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at",
        params![key, body, now],
    )?;
    Ok(())
}

#[cfg(test)]
pub fn test_conn() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    migrate(&mut conn).unwrap();
    conn
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_creates_schema_and_sets_version() {
        let conn = test_conn();
        let v: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v, LATEST_VERSION);
        for table in [
            "library",
            "history",
            "private_servers",
            "searches",
            "settings",
            "api_cache",
        ] {
            let n: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 1, "missing table {table}");
        }
    }

    #[test]
    fn migrate_is_idempotent_and_keeps_data() {
        let mut conn = test_conn();
        setting_set(&conn, "accentHue", &Value::from(340)).unwrap();
        migrate(&mut conn).unwrap();
        assert_eq!(
            setting_get(&conn, "accentHue").unwrap(),
            Some(Value::from(340))
        );
    }

    #[test]
    fn migrate_rejects_newer_database() {
        let mut conn = test_conn();
        conn.pragma_update(None, "user_version", LATEST_VERSION + 1)
            .unwrap();
        assert!(migrate(&mut conn).is_err());
    }

    #[test]
    fn settings_roundtrip_and_delete() {
        let conn = test_conn();
        assert_eq!(setting_get(&conn, "x").unwrap(), None);
        setting_set(&conn, "x", &serde_json::json!({"a": [1, 2]})).unwrap();
        setting_set(&conn, "x", &serde_json::json!(true)).unwrap();
        assert_eq!(setting_get(&conn, "x").unwrap(), Some(Value::Bool(true)));
        assert!(setting_bool(&conn, "x", false));
        setting_delete(&conn, "x").unwrap();
        assert!(!setting_bool(&conn, "x", false));
    }

    #[test]
    fn cache_roundtrip() {
        let conn = test_conn();
        assert!(cache_get(&conn, "k").unwrap().is_none());
        cache_put(&conn, "k", "{\"a\":1}", 10).unwrap();
        cache_put(&conn, "k", "{\"a\":2}", 20).unwrap();
        assert_eq!(
            cache_get(&conn, "k").unwrap(),
            Some(("{\"a\":2}".to_string(), 20))
        );
    }
}
