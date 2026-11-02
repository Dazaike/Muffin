//! Per-friend and per-game notification watches (the bell buttons).
//!
//! A tiny dedicated table keyed by `(kind, id)`: `friend` rows hold Roblox user ids, `game` rows
//! hold universe ids. The notifier (`notifier.rs`) reads the list on every pass, so a toggle takes
//! effect without a restart. Watches are local, per Muffin install, not per Roblox account.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::{now_ms, Db};
use crate::error::{AppError, Result};
use crate::launch::MAX_PLACE_ID;

/// One `games.roblox.com/v1/games?universeIds=` request covers every watched game.
pub const MAX_WATCHED_GAMES: usize = 50;
pub const MAX_WATCHED_FRIENDS: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WatchKind {
    Friend,
    Game,
}

impl WatchKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Friend => "friend",
            Self::Game => "game",
        }
    }

    fn cap(self) -> usize {
        match self {
            Self::Friend => MAX_WATCHED_FRIENDS,
            Self::Game => MAX_WATCHED_GAMES,
        }
    }

    fn noun(self) -> &'static str {
        match self {
            Self::Friend => "friends",
            Self::Game => "games",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchList {
    pub friends: Vec<u64>,
    pub games: Vec<u64>,
}

/// Create this module's table. Called from `Db::open`.
pub fn ensure_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS watches(
            kind TEXT NOT NULL,
            id INTEGER NOT NULL,
            added_at INTEGER NOT NULL,
            PRIMARY KEY(kind, id)
        );",
    )?;
    Ok(())
}

pub fn list_conn(conn: &Connection) -> Result<WatchList> {
    let mut stmt = conn.prepare("SELECT kind, id FROM watches ORDER BY added_at, id")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
    let mut out = WatchList::default();
    for row in rows {
        let (kind, id) = row?;
        let id = id as u64;
        match kind.as_str() {
            "friend" => out.friends.push(id),
            "game" => out.games.push(id),
            _ => {}
        }
    }
    Ok(out)
}

pub fn set_conn(conn: &Connection, kind: WatchKind, id: u64, on: bool, now: i64) -> Result<()> {
    if id == 0 || id > MAX_PLACE_ID {
        return Err(AppError::invalid("Invalid id"));
    }
    if on {
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM watches WHERE kind = ?1", [kind.as_str()], |r| r.get(0))?;
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM watches WHERE kind = ?1 AND id = ?2)",
            params![kind.as_str(), id as i64],
            |r| r.get(0),
        )?;
        if !exists && count as usize >= kind.cap() {
            return Err(AppError::invalid(format!(
                "You can watch up to {} {}",
                kind.cap(),
                kind.noun()
            )));
        }
        conn.execute(
            "INSERT OR IGNORE INTO watches(kind, id, added_at) VALUES(?1, ?2, ?3)",
            params![kind.as_str(), id as i64, now],
        )?;
    } else {
        conn.execute(
            "DELETE FROM watches WHERE kind = ?1 AND id = ?2",
            params![kind.as_str(), id as i64],
        )?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn watch_list(db: State<'_, Db>) -> Result<WatchList> {
    db.with(|c| list_conn(c))
}

#[tauri::command(async)]
pub fn watch_set(db: State<'_, Db>, kind: WatchKind, id: u64, on: bool) -> Result<()> {
    db.with(|c| set_conn(c, kind, id, on, now_ms()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let c = crate::db::test_conn();
        ensure_schema(&c).unwrap();
        c
    }

    #[test]
    fn friends_and_games_are_separate_lists() {
        let c = conn();
        set_conn(&c, WatchKind::Friend, 7, true, 1).unwrap();
        set_conn(&c, WatchKind::Game, 7, true, 2).unwrap();
        set_conn(&c, WatchKind::Friend, 3, true, 3).unwrap();
        let l = list_conn(&c).unwrap();
        assert_eq!(l.friends, vec![7, 3]);
        assert_eq!(l.games, vec![7]);
    }

    #[test]
    fn set_is_idempotent_and_off_removes() {
        let c = conn();
        set_conn(&c, WatchKind::Game, 9, true, 1).unwrap();
        set_conn(&c, WatchKind::Game, 9, true, 2).unwrap();
        assert_eq!(list_conn(&c).unwrap().games, vec![9]);
        set_conn(&c, WatchKind::Game, 9, false, 3).unwrap();
        set_conn(&c, WatchKind::Game, 9, false, 4).unwrap();
        assert!(list_conn(&c).unwrap().games.is_empty());
    }

    #[test]
    fn rejects_bad_ids() {
        let c = conn();
        assert!(set_conn(&c, WatchKind::Friend, 0, true, 1).is_err());
        assert!(set_conn(&c, WatchKind::Friend, MAX_PLACE_ID + 1, true, 1).is_err());
        assert!(set_conn(&c, WatchKind::Friend, MAX_PLACE_ID, true, 1).is_ok());
    }

    #[test]
    fn game_watch_list_is_capped_but_existing_entries_stay_togglable() {
        let c = conn();
        for id in 1..=MAX_WATCHED_GAMES as u64 {
            set_conn(&c, WatchKind::Game, id, true, id as i64).unwrap();
        }
        assert!(set_conn(&c, WatchKind::Game, 999, true, 100).is_err());
        assert!(set_conn(&c, WatchKind::Game, 1, true, 100).is_ok(), "already watched");
        set_conn(&c, WatchKind::Game, 1, false, 101).unwrap();
        assert!(set_conn(&c, WatchKind::Game, 999, true, 102).is_ok());
    }
}
