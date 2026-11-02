//! Playtime tracking by process detection.
//!
//! Honest scope: Muffin only hands the launch to Roblox (`roblox://`), so it cannot know which
//! game a player process is running. A session is attributed to the *last place launched from
//! Muffin* when the player process (named per OS) appears within [`PENDING_WINDOW_MS`] of that launch.
//! Player processes that appear without a recent Muffin launch are ignored, and nothing is recorded
//! while Muffin is not running. No timer exists until the first launch; the watcher stops itself
//! when nothing is pending or running.
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::{now_ms, Db};
use crate::error::{AppError, Result};
use crate::store::to_db_id;

/// Process names of the Roblox player, per OS. Fishstrap/Bloxstrap bootstrap the same
/// `RobloxPlayerBeta.exe` on Windows (verified in `%LOCALAPPDATA%\Fishstrap\Versions\*`).
#[cfg(windows)]
const PLAYER_EXES: &[&str] = &["robloxplayerbeta.exe"];
#[cfg(target_os = "macos")]
const PLAYER_EXES: &[&str] = &["robloxplayer"];
#[cfg(target_os = "linux")]
const PLAYER_EXES: &[&str] = &["sober"];

/// How long after a Muffin launch a player process may appear and still be attributed to it.
const PENDING_WINDOW_MS: i64 = 90_000;
const WAIT_POLL: Duration = Duration::from_secs(2);
const RUN_POLL: Duration = Duration::from_secs(5);
const DAY_MS: i64 = 86_400_000;

/// Case-insensitive match of a process name (with extension on Windows).
pub fn is_player_process(exe_name: &str) -> bool {
    PLAYER_EXES.iter().any(|p| exe_name.eq_ignore_ascii_case(p))
}

// ---- pure state machine ----------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct Launch {
    pub place_id: u64,
    pub universe_id: Option<u64>,
    pub name: String,
    pub at_ms: i64,
}

#[derive(Debug)]
struct Running {
    pids: HashSet<u32>,
    place_id: u64,
}

#[derive(Debug, PartialEq)]
pub enum Action {
    Start(Launch),
    End,
}

/// Decides when sessions start/end from successive process snapshots. No I/O.
#[derive(Debug, Default)]
pub struct Tracker {
    pending: Option<Launch>,
    running: Option<Running>,
}

impl Tracker {
    pub fn launch(&mut self, launch: Launch) {
        self.pending = Some(launch);
    }

    pub fn expire_pending(&mut self, now: i64) {
        if self.pending.as_ref().is_some_and(|p| now - p.at_ms > PENDING_WINDOW_MS) {
            self.pending = None;
        }
    }

    pub fn observe(&mut self, pids: &HashSet<u32>, now: i64) -> Vec<Action> {
        self.expire_pending(now);
        let mut actions = Vec::new();

        if let Some(run) = &mut self.running {
            let fresh: HashSet<u32> = pids.difference(&run.pids).copied().collect();
            if !fresh.is_empty() && self.pending.is_some() {
                // A new player process after a newer Muffin launch: the old game is over.
                let launch = self.pending.take().expect("checked above");
                actions.push(Action::End);
                run.place_id = launch.place_id;
                run.pids = fresh;
                actions.push(Action::Start(launch));
                return actions;
            }
            run.pids.retain(|p| pids.contains(p));
            if run.pids.is_empty() {
                self.running = None;
                actions.push(Action::End);
            }
        }

        if self.running.is_none() && !pids.is_empty() {
            if let Some(launch) = self.pending.take() {
                self.running = Some(Running {
                    pids: pids.clone(),
                    place_id: launch.place_id,
                });
                actions.push(Action::Start(launch));
            }
        }
        actions
    }

    /// Time until the next poll, or `None` when the watcher can stop.
    pub fn next_delay(&self) -> Option<Duration> {
        if self.pending.is_some() {
            Some(WAIT_POLL)
        } else if self.running.is_some() {
            Some(RUN_POLL)
        } else {
            None
        }
    }

    pub fn state(&self) -> PlayerState {
        PlayerState {
            running: self.running.is_some(),
            place_id: self.running.as_ref().map(|r| r.place_id),
        }
    }
}

// ---- process snapshot ------------------------------------------------------------------------

/// Process ids of every running Roblox player.
fn player_pids() -> std::io::Result<HashSet<u32>> {
    process_pids(is_player_process)
}

/// Process ids of every running process whose name satisfies `matches`.
pub fn process_pids(matches: impl Fn(&str) -> bool) -> std::io::Result<HashSet<u32>> {
    let mut sys = sysinfo::System::new();
    sys.refresh_processes_specifics(sysinfo::ProcessesToUpdate::All, true, sysinfo::ProcessRefreshKind::nothing());
    Ok(sys
        .processes()
        .iter()
        .filter(|(_, p)| matches(&p.name().to_string_lossy()))
        .map(|(pid, _)| pid.as_u32())
        .collect())
}

/// True while any Roblox player process is running (best effort: a failed snapshot counts as no).
pub fn player_running() -> bool {
    player_pids().is_ok_and(|p| !p.is_empty())
}

/// True while a process with this exe name (case-insensitive) is running.
pub fn process_running(exe_name: &str) -> bool {
    process_pids(|n| n.eq_ignore_ascii_case(exe_name)).is_ok_and(|p| !p.is_empty())
}

// ---- storage ---------------------------------------------------------------------------------

/// Create this module's table. Called from `Db::open`.
pub fn ensure_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS playtime_sessions(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            place_id INTEGER NOT NULL,
            universe_id INTEGER,
            name TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            ended_at INTEGER,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            last_seen_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_playtime_started ON playtime_sessions(started_at);
        CREATE INDEX IF NOT EXISTS idx_playtime_place ON playtime_sessions(place_id);",
    )?;
    Ok(())
}

fn session_start(conn: &Connection, l: &Launch, now: i64) -> Result<i64> {
    conn.execute(
        "INSERT INTO playtime_sessions(place_id, universe_id, name, started_at, ended_at, duration_ms, last_seen_at)
         VALUES(?1, ?2, ?3, ?4, NULL, 0, ?4)",
        params![
            to_db_id(l.place_id)?,
            l.universe_id.map(to_db_id).transpose()?,
            l.name,
            now
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Heartbeat: keeps `duration_ms` valid while running and records when Muffin last saw the player.
fn session_touch(conn: &Connection, id: i64, now: i64) -> Result<()> {
    conn.execute(
        "UPDATE playtime_sessions SET last_seen_at = ?2, duration_ms = MAX(0, ?2 - started_at)
         WHERE id = ?1 AND ended_at IS NULL",
        params![id, now],
    )?;
    Ok(())
}

fn session_end(conn: &Connection, id: i64, now: i64) -> Result<()> {
    conn.execute(
        "UPDATE playtime_sessions SET ended_at = ?2, last_seen_at = ?2, duration_ms = MAX(0, ?2 - started_at)
         WHERE id = ?1 AND ended_at IS NULL",
        params![id, now],
    )?;
    Ok(())
}

/// Close sessions left open by a crash or quit: they end when Muffin last saw the player.
pub fn recover_dangling(conn: &Connection) -> Result<usize> {
    Ok(conn.execute(
        "UPDATE playtime_sessions SET ended_at = last_seen_at, duration_ms = MAX(0, last_seen_at - started_at)
         WHERE ended_at IS NULL",
        [],
    )?)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GamePlaytime {
    pub place_id: u64,
    pub universe_id: Option<u64>,
    pub name: String,
    pub icon_url: Option<String>,
    pub total_ms: i64,
    pub sessions: i64,
    pub last_played_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlaytimeSummary {
    pub total_ms: i64,
    pub session_count: i64,
    pub games: Vec<GamePlaytime>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlaytimeSession {
    pub id: i64,
    pub place_id: u64,
    pub universe_id: Option<u64>,
    pub name: String,
    pub started_at: i64,
    /// `None` while the session is still running.
    pub ended_at: Option<i64>,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
    pub running: bool,
    pub place_id: Option<u64>,
}

/// Start of `range` in unix ms (`None` = all time). "today" is local midnight, derived from the
/// caller's UTC offset; "week" is a rolling 7 days.
pub fn range_start(range: &str, now: i64, utc_offset_minutes: i32) -> Result<Option<i64>> {
    match range {
        "all" => Ok(None),
        "week" => Ok(Some(now - 7 * DAY_MS)),
        "today" => {
            if !(-840..=840).contains(&utc_offset_minutes) {
                return Err(AppError::invalid("Invalid time zone offset"));
            }
            let off = i64::from(utc_offset_minutes) * 60_000;
            let local = now + off;
            Ok(Some(local - local.rem_euclid(DAY_MS) - off))
        }
        _ => Err(AppError::invalid("Range must be today, week or all")),
    }
}

pub fn summary_conn(conn: &Connection, since: Option<i64>) -> Result<PlaytimeSummary> {
    let mut stmt = conn.prepare(
        "SELECT s.place_id,
                (SELECT universe_id FROM playtime_sessions x WHERE x.place_id = s.place_id AND x.universe_id IS NOT NULL ORDER BY x.started_at DESC LIMIT 1),
                (SELECT name FROM playtime_sessions x WHERE x.place_id = s.place_id ORDER BY x.started_at DESC LIMIT 1),
                COALESCE((SELECT icon_url FROM library WHERE place_id = s.place_id),
                         (SELECT icon_url FROM history WHERE place_id = s.place_id)),
                SUM(s.duration_ms), COUNT(*), MAX(s.started_at)
         FROM playtime_sessions s
         WHERE s.started_at >= ?1
         GROUP BY s.place_id
         ORDER BY SUM(s.duration_ms) DESC, MAX(s.started_at) DESC
         LIMIT 200",
    )?;
    let games = stmt
        .query_map([since.unwrap_or(0)], |r| {
            Ok(GamePlaytime {
                place_id: r.get::<_, i64>(0)? as u64,
                universe_id: r.get::<_, Option<i64>>(1)?.map(|v| v as u64),
                name: r.get(2)?,
                icon_url: r.get(3)?,
                total_ms: r.get(4)?,
                sessions: r.get(5)?,
                last_played_at: r.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let (total_ms, session_count) = conn.query_row(
        "SELECT COALESCE(SUM(duration_ms), 0), COUNT(*) FROM playtime_sessions WHERE started_at >= ?1",
        [since.unwrap_or(0)],
        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
    )?;
    Ok(PlaytimeSummary {
        total_ms,
        session_count,
        games,
    })
}

pub fn sessions_conn(conn: &Connection, limit: u32) -> Result<Vec<PlaytimeSession>> {
    let mut stmt = conn.prepare(
        "SELECT id, place_id, universe_id, name, started_at, ended_at, duration_ms
         FROM playtime_sessions ORDER BY started_at DESC, id DESC LIMIT ?1",
    )?;
    let rows = stmt
        .query_map([limit.clamp(1, 500)], |r| {
            Ok(PlaytimeSession {
                id: r.get(0)?,
                place_id: r.get::<_, i64>(1)? as u64,
                universe_id: r.get::<_, Option<i64>>(2)?.map(|v| v as u64),
                name: r.get(3)?,
                started_at: r.get(4)?,
                ended_at: r.get(5)?,
                duration_ms: r.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

// ---- watcher ---------------------------------------------------------------------------------

#[derive(Default)]
struct Inner {
    tracker: Tracker,
    watching: bool,
}

#[derive(Default)]
pub struct PlaytimeState(Mutex<Inner>);

impl PlaytimeState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

static APP: OnceLock<AppHandle> = OnceLock::new();

/// `on_launch` for callers without an `AppHandle` (the shared launch bookkeeping in `launch.rs`).
pub fn track(place_id: u64, universe_id: Option<u64>, name: &str) {
    if let Some(app) = APP.get() {
        on_launch(app, place_id, universe_id, name);
    }
}

/// Manage the tracker state and close sessions a previous run left open. Call once from `setup`.
pub fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
    app.manage(PlaytimeState::default());
    if let Some(db) = app.try_state::<Db>() {
        match db.with(|c| recover_dangling(c)) {
            Ok(0) => {}
            Ok(n) => eprintln!("muffin: closed {n} dangling playtime session(s)"),
            Err(e) => eprintln!("muffin: playtime recovery failed: {e}"),
        }
    }
}

/// Called by `launch.rs` after a successful hand-off. Starts the watcher if it is not running.
pub fn on_launch(app: &AppHandle, place_id: u64, universe_id: Option<u64>, name: &str) {
    let Some(state) = app.try_state::<PlaytimeState>() else {
        return;
    };
    let spawn = {
        let mut g = state.lock();
        g.tracker.launch(Launch {
            place_id,
            universe_id,
            name: name.to_string(),
            at_ms: now_ms(),
        });
        !std::mem::replace(&mut g.watching, true)
    };
    if spawn {
        tauri::async_runtime::spawn(watch(app.clone()));
    }
}

fn emit_state(app: &AppHandle, s: PlayerState) {
    let _ = app.emit("player-state", json!({ "running": s.running, "placeId": s.place_id }));
}

async fn watch(app: AppHandle) {
    let mut session: Option<i64> = None;
    let mut last_emitted = PlayerState {
        running: false,
        place_id: None,
    };
    loop {
        let delay = {
            let state = app.state::<PlaytimeState>();
            let mut g = state.lock();
            match g.tracker.next_delay() {
                Some(d) => d,
                None => {
                    // Decided under the same lock `on_launch` takes, so a launch can't be lost.
                    g.watching = false;
                    return;
                }
            }
        };
        tokio::time::sleep(delay).await;

        let snapshot = tauri::async_runtime::spawn_blocking(player_pids).await;
        let now = now_ms();
        let (actions, state_now) = {
            let state = app.state::<PlaytimeState>();
            let mut g = state.lock();
            let actions = match snapshot {
                Ok(Ok(pids)) => g.tracker.observe(&pids, now),
                other => {
                    // Don't poll forever if snapshots keep failing.
                    if let Ok(Err(e)) = other {
                        eprintln!("muffin: process snapshot failed: {e}");
                    }
                    g.tracker.expire_pending(now);
                    Vec::new()
                }
            };
            (actions, g.tracker.state())
        };

        if let Some(db) = app.try_state::<Db>() {
            for action in &actions {
                let res = db.with(|c| match action {
                    Action::End => {
                        if let Some(id) = session.take() {
                            session_end(c, id, now)?;
                        }
                        Ok(())
                    }
                    Action::Start(l) => {
                        session = Some(session_start(c, l, now)?);
                        Ok(())
                    }
                });
                if let Err(e) = res {
                    eprintln!("muffin: could not record playtime: {e}");
                }
            }
            if let (Some(id), true) = (session, state_now.running) {
                if let Err(e) = db.with(|c| session_touch(c, id, now)) {
                    eprintln!("muffin: could not update playtime: {e}");
                }
            }
        }

        if state_now != last_emitted {
            last_emitted = state_now;
            emit_state(&app, state_now);
        }
    }
}

// ---- commands --------------------------------------------------------------------------------

#[tauri::command(async)]
pub fn playtime_summary(
    db: State<'_, Db>,
    range: String,
    utc_offset_minutes: Option<i32>,
) -> Result<PlaytimeSummary> {
    let now = now_ms();
    let since = range_start(&range, now, utc_offset_minutes.unwrap_or(0))?;
    db.with(|c| summary_conn(c, since))
}

#[tauri::command(async)]
pub fn playtime_sessions(db: State<'_, Db>, limit: u32) -> Result<Vec<PlaytimeSession>> {
    db.with(|c| sessions_conn(c, limit))
}

/// Deletes finished sessions; a session that is running right now is kept.
#[tauri::command(async)]
pub fn playtime_clear(db: State<'_, Db>) -> Result<()> {
    db.with(|c| {
        c.execute("DELETE FROM playtime_sessions WHERE ended_at IS NOT NULL", [])?;
        Ok(())
    })
}

#[tauri::command(async)]
pub fn playtime_state(state: State<'_, PlaytimeState>) -> PlayerState {
    state.lock().tracker.state()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn launch(place_id: u64, at_ms: i64) -> Launch {
        Launch {
            place_id,
            universe_id: None,
            name: format!("Game {place_id}"),
            at_ms,
        }
    }
    fn set(ids: &[u32]) -> HashSet<u32> {
        ids.iter().copied().collect()
    }

    #[cfg(windows)]
    #[test]
    fn process_name_matching() {
        assert!(is_player_process("RobloxPlayerBeta.exe"));
        assert!(is_player_process("robloxplayerbeta.EXE"));
        for bad in [
            "",
            "RobloxPlayerBeta",
            "RobloxPlayerBeta.exe.WebView2",
            "RobloxCrashHandler.exe",
            "Fishstrap.exe",
            "RobloxStudioBeta.exe",
            "xRobloxPlayerBeta.exe",
            "RobloxPlayerBeta.exe ",
        ] {
            assert!(!is_player_process(bad), "{bad:?}");
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn process_name_matching_macos() {
        assert!(is_player_process("RobloxPlayer"));
        assert!(is_player_process("robloxplayer"));
        for bad in ["RobloxPlayerInstaller", "Roblox", "RobloxPlayer ", ""] {
            assert!(!is_player_process(bad), "{bad:?}");
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn process_name_matching_linux() {
        assert!(is_player_process("sober"));
        for bad in ["sober_services", "flatpak", ""] {
            assert!(!is_player_process(bad), "{bad:?}");
        }
    }

    #[test]
    fn idle_tracker_never_polls() {
        let mut t = Tracker::default();
        assert_eq!(t.next_delay(), None);
        // A player appearing with no Muffin launch is ignored.
        assert!(t.observe(&set(&[10]), 1000).is_empty());
        assert_eq!(t.next_delay(), None);
        assert!(!t.state().running);
    }

    #[test]
    fn start_then_end() {
        let mut t = Tracker::default();
        t.launch(launch(7, 0));
        assert_eq!(t.next_delay(), Some(WAIT_POLL));
        assert!(t.observe(&set(&[]), 2000).is_empty());
        let a = t.observe(&set(&[42]), 4000);
        assert_eq!(a, vec![Action::Start(launch(7, 0))]);
        assert_eq!(t.state(), PlayerState { running: true, place_id: Some(7) });
        assert_eq!(t.next_delay(), Some(RUN_POLL));
        assert!(t.observe(&set(&[42]), 9000).is_empty());
        assert_eq!(t.observe(&set(&[]), 14_000), vec![Action::End]);
        assert!(!t.state().running);
        assert_eq!(t.next_delay(), None);
    }

    #[test]
    fn pending_expires_without_a_player() {
        let mut t = Tracker::default();
        t.launch(launch(7, 0));
        assert!(t.observe(&set(&[]), PENDING_WINDOW_MS).is_empty());
        assert_eq!(t.next_delay(), Some(WAIT_POLL));
        assert!(t.observe(&set(&[]), PENDING_WINDOW_MS + 1).is_empty());
        assert_eq!(t.next_delay(), None);
        // A late player is no longer attributed.
        assert!(t.observe(&set(&[5]), PENDING_WINDOW_MS + 2000).is_empty());
    }

    #[test]
    fn relaunch_into_a_new_process_switches_session() {
        let mut t = Tracker::default();
        t.launch(launch(1, 0));
        t.observe(&set(&[10]), 3000);
        t.launch(launch(2, 20_000));
        // Old process still alive, nothing new yet: stay on game 1.
        assert!(t.observe(&set(&[10]), 22_000).is_empty());
        let a = t.observe(&set(&[10, 11]), 24_000);
        assert_eq!(a, vec![Action::End, Action::Start(launch(2, 20_000))]);
        assert_eq!(t.state().place_id, Some(2));
        // Old process exiting afterwards doesn't end the new session.
        assert!(t.observe(&set(&[11]), 29_000).is_empty());
        assert_eq!(t.observe(&set(&[]), 34_000), vec![Action::End]);
    }

    #[test]
    fn old_process_exit_with_pending_waits_for_the_new_one() {
        let mut t = Tracker::default();
        t.launch(launch(1, 0));
        t.observe(&set(&[10]), 3000);
        t.launch(launch(2, 20_000));
        assert_eq!(t.observe(&set(&[]), 22_000), vec![Action::End]);
        assert_eq!(t.next_delay(), Some(WAIT_POLL));
        assert_eq!(t.observe(&set(&[12]), 24_000), vec![Action::Start(launch(2, 20_000))]);
    }

    #[test]
    fn unattributed_process_appearing_mid_session_is_not_adopted() {
        let mut t = Tracker::default();
        t.launch(launch(1, 0));
        t.observe(&set(&[10]), 3000);
        assert!(t.observe(&set(&[10, 99]), 8000).is_empty());
        // Original exits; the stranger's pid never joined the session.
        assert_eq!(t.observe(&set(&[99]), 13_000), vec![Action::End]);
        assert!(!t.state().running);
    }

    #[test]
    fn range_boundaries() {
        let now = 1_700_000_000_000; // 2023-11-14T22:13:20Z
        assert_eq!(range_start("all", now, 0).unwrap(), None);
        assert_eq!(range_start("week", now, 0).unwrap(), Some(now - 7 * DAY_MS));
        let utc_midnight = now - now.rem_euclid(DAY_MS);
        assert_eq!(range_start("today", now, 0).unwrap(), Some(utc_midnight));
        // UTC-5 (offset -300): local time is 17:13, so local midnight is 05:00Z.
        assert_eq!(range_start("today", now, -300).unwrap(), Some(utc_midnight + 5 * 3_600_000));
        // UTC+10: local time is already Nov 15 08:13, midnight was 14:00Z the previous day.
        assert_eq!(range_start("today", now, 600).unwrap(), Some(utc_midnight + DAY_MS - 10 * 3_600_000));
        assert!(range_start("month", now, 0).is_err());
        assert!(range_start("today", now, 5000).is_err());
    }

    fn conn() -> Connection {
        let c = crate::db::test_conn();
        ensure_schema(&c).unwrap();
        c
    }

    #[test]
    fn session_lifecycle_and_summary() {
        let c = conn();
        let a = session_start(&c, &launch(1, 0), 1_000).unwrap();
        session_touch(&c, a, 61_000).unwrap();
        assert_eq!(sessions_conn(&c, 10).unwrap()[0].duration_ms, 60_000);
        session_end(&c, a, 121_000).unwrap();
        let b = session_start(&c, &launch(2, 0), 200_000).unwrap();
        session_end(&c, b, 210_000).unwrap();
        let a2 = session_start(&c, &launch(1, 0), 300_000).unwrap();
        session_end(&c, a2, 330_000).unwrap();

        let s = summary_conn(&c, None).unwrap();
        assert_eq!((s.total_ms, s.session_count), (120_000 + 10_000 + 30_000, 3));
        assert_eq!(s.games[0].place_id, 1);
        assert_eq!((s.games[0].total_ms, s.games[0].sessions), (150_000, 2));
        assert_eq!(s.games[0].last_played_at, 300_000);
        assert_eq!(s.games[1].place_id, 2);

        let recent = summary_conn(&c, Some(250_000)).unwrap();
        assert_eq!((recent.total_ms, recent.session_count), (30_000, 1));
    }

    #[test]
    fn dangling_sessions_close_at_last_seen_and_clear_keeps_running() {
        let c = conn();
        let id = session_start(&c, &launch(1, 0), 1_000).unwrap();
        session_touch(&c, id, 31_000).unwrap();
        assert_eq!(recover_dangling(&c).unwrap(), 1);
        let s = &sessions_conn(&c, 10).unwrap()[0];
        assert_eq!((s.ended_at, s.duration_ms), (Some(31_000), 30_000));
        assert_eq!(recover_dangling(&c).unwrap(), 0);

        session_start(&c, &launch(2, 0), 50_000).unwrap(); // still running
        c.execute("DELETE FROM playtime_sessions WHERE ended_at IS NOT NULL", []).unwrap();
        let left = sessions_conn(&c, 10).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].ended_at, None);
    }
}
