//! "After launch" behavior: once Roblox is detected running after a launch from Muffin, keep the
//! window, hide it to the tray, or quit Muffin (`afterLaunch` setting).
//!
//! Runs in Rust so it works while the window is hidden. The setting is read at detection time, so
//! changing it right after a launch still applies. Quitting ends playtime tracking, which lives in
//! this process; a session that was already open is closed by `playtime::recover_dangling` on the
//! next start (at the last moment Muffin saw the player).

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::db::{self, Db};

const POLL: Duration = Duration::from_millis(500);
const TIMEOUT: Duration = Duration::from_secs(60);

/// Bumped by every launch; a watcher exits as soon as it is no longer the newest one.
static GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AfterLaunch {
    Nothing,
    Tray,
    Quit,
}

impl AfterLaunch {
    fn from_setting(v: Option<&Value>) -> Self {
        match v.and_then(Value::as_str) {
            Some("tray") => Self::Tray,
            Some("quit") => Self::Quit,
            _ => Self::Nothing,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Keep,
    HideToTray,
    Quit,
}

/// What to do for the setting once the player process was (or was not) seen.
pub fn decide(after_launch: AfterLaunch, detected: bool) -> Decision {
    match (after_launch, detected) {
        (AfterLaunch::Tray, true) => Decision::HideToTray,
        (AfterLaunch::Quit, true) => Decision::Quit,
        _ => Decision::Keep,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Outcome {
    Detected,
    TimedOut,
    Superseded,
}

/// Calls `detect` every `interval` (first call immediately) until it returns true, `timeout`
/// elapses, or `generation` no longer equals `id`.
async fn poll(
    mut detect: impl FnMut() -> bool,
    generation: &AtomicU64,
    id: u64,
    interval: Duration,
    timeout: Duration,
) -> Outcome {
    let started = Instant::now();
    loop {
        if generation.load(Ordering::SeqCst) != id {
            return Outcome::Superseded;
        }
        if detect() {
            return Outcome::Detected;
        }
        if started.elapsed() >= timeout {
            return Outcome::TimedOut;
        }
        tokio::time::sleep(interval).await;
    }
}

fn current(app: &AppHandle) -> AfterLaunch {
    let value = app
        .try_state::<Db>()
        .and_then(|db| db.with(|c| db::setting_get(c, "afterLaunch")).ok().flatten());
    AfterLaunch::from_setting(value.as_ref())
}

/// Call after a successful hand-off to Roblox. Replaces any watcher from an earlier launch.
pub fn start(app: &AppHandle) {
    let id = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // The process snapshot is only taken while the setting asks for an action.
        let detect = || current(&app) != AfterLaunch::Nothing && crate::playtime::player_running();
        if poll(detect, &GENERATION, id, POLL, TIMEOUT).await != Outcome::Detected {
            return;
        }
        match decide(current(&app), true) {
            Decision::Keep => {}
            Decision::HideToTray => crate::tray::hide_main_window(&app),
            Decision::Quit => app.exit(0),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn decide_matrix() {
        use AfterLaunch::*;
        assert_eq!(decide(Nothing, true), Decision::Keep);
        assert_eq!(decide(Nothing, false), Decision::Keep);
        assert_eq!(decide(Tray, false), Decision::Keep);
        assert_eq!(decide(Quit, false), Decision::Keep);
        assert_eq!(decide(Tray, true), Decision::HideToTray);
        assert_eq!(decide(Quit, true), Decision::Quit);
    }

    #[test]
    fn setting_parsing_defaults_to_nothing() {
        assert_eq!(AfterLaunch::from_setting(Some(&json!("tray"))), AfterLaunch::Tray);
        assert_eq!(AfterLaunch::from_setting(Some(&json!("quit"))), AfterLaunch::Quit);
        for v in [None, Some(json!("nothing")), Some(json!("bogus")), Some(json!(true))] {
            assert_eq!(AfterLaunch::from_setting(v.as_ref()), AfterLaunch::Nothing);
        }
    }

    const FAST: Duration = Duration::from_millis(2);

    #[tokio::test]
    async fn poll_returns_when_detected() {
        let gen = AtomicU64::new(1);
        let mut calls = 0;
        let out = poll(
            || {
                calls += 1;
                calls == 3
            },
            &gen,
            1,
            FAST,
            Duration::from_secs(5),
        )
        .await;
        assert_eq!(out, Outcome::Detected);
        assert_eq!(calls, 3);
    }

    #[tokio::test]
    async fn poll_times_out_when_never_detected() {
        let gen = AtomicU64::new(1);
        let out = poll(|| false, &gen, 1, FAST, Duration::from_millis(20)).await;
        assert_eq!(out, Outcome::TimedOut);
    }

    #[tokio::test]
    async fn poll_stops_when_a_newer_launch_replaced_it() {
        let gen = AtomicU64::new(2);
        let mut called = false;
        let out = poll(
            || {
                called = true;
                true
            },
            &gen,
            1,
            FAST,
            Duration::from_secs(5),
        )
        .await;
        assert_eq!(out, Outcome::Superseded);
        assert!(!called);
    }
}
