//! Background notifications for the ACTIVE Roblox account: unread chat messages, pending friend
//! requests and (optionally) friends coming online.
//!
//! A single tokio task, started from `setup`, polls while the process is alive, i.e. also while the
//! window is hidden in the tray with `closeBehavior = "tray"`. It stops when Muffin quits.
//!
//! Privacy: notification text only ever contains counts and (for "friend online") the friend's own
//! name. Message text is never requested or shown.
//!
//! Endpoints (all via `rbx_session::authed_json`, i.e. the active account's cookie):
//! - `apis.roblox.com/platform-chat-api/v1/get-user-conversations` — UNVERIFIED live (authed; only
//!   verified unauthenticated: 401 "Authentication token is missing", so the route exists). The old
//!   `chat.roblox.com/v2/get-unread-conversation-count` answers 404 "No Service Found" for every
//!   path today and is NOT used. Response shape `{ conversations: [{ unread_message_count }] }` is
//!   taken from community documentation (BTRoblox).
//! - `friends.roblox.com/v1/user/friend-requests/count` → `{ count }` — shape verified from Roblox's
//!   swagger (`PendingFriendRequestCountModel`); live authed call UNVERIFIED.
//! - `friends.roblox.com/v1/users/{id}/friends/online` → `{ data: [{ id, name, displayName }] }` —
//!   shape verified from Roblox's swagger; live authed call UNVERIFIED.

use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use reqwest::Method;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Listener, Manager, State};
use tauri_plugin_notification::NotificationExt;

use crate::db::{self, Db};
use crate::error::{AppError, ErrorCode, Result};
use crate::{rbx_session, tray};

const POLL_INTERVAL: Duration = Duration::from_secs(45);
/// Re-check cadence while nothing can be polled (no account, all types off). No network involved.
const IDLE_INTERVAL: Duration = Duration::from_secs(30);
const STOPPED_INTERVAL: Duration = Duration::from_secs(60);
const STARTUP_DELAY: Duration = Duration::from_secs(5);
const BACKOFF_CAP: Duration = Duration::from_secs(15 * 60);
const RATE_LIMIT_FLOOR: Duration = Duration::from_secs(5 * 60);

const API_HOST: &str = "apis.roblox.com";
const FRIENDS_HOST: &str = "friends.roblox.com";
const CHAT_PATH: &str = "/platform-chat-api/v1/get-user-conversations?include_user_data=false&pageSize=30";
const REQUESTS_PATH: &str = "/v1/user/friend-requests/count";

// ---- pure logic ------------------------------------------------------------------------------

/// Tracks a monotonically-changing count. The first observation only sets the baseline, so a
/// fresh start / account switch never produces a burst of notifications for pre-existing items.
#[derive(Debug, Default)]
pub struct CountTracker {
    last: Option<u64>,
}

impl CountTracker {
    /// Records `now`; returns how many items arrived since the previous observation.
    /// Decreases (items read/answered) lower the baseline so the next arrival is detected.
    pub fn observe(&mut self, now: u64) -> u64 {
        self.last.replace(now).map_or(0, |prev| now.saturating_sub(prev))
    }
}

/// Tracks the set of online friends; the first observation is the silent baseline.
#[derive(Debug, Default)]
pub struct PresenceTracker {
    seen: Option<HashSet<u64>>,
}

impl PresenceTracker {
    /// Records the current online set; returns display names of friends that were not online at
    /// the previous observation.
    pub fn observe(&mut self, online: &[(u64, String)]) -> Vec<String> {
        let current: HashSet<u64> = online.iter().map(|(id, _)| *id).collect();
        let previous = self.seen.replace(current);
        let Some(previous) = previous else {
            return Vec::new();
        };
        online
            .iter()
            .filter(|(id, _)| !previous.contains(id))
            .map(|(_, name)| name.clone())
            .collect()
    }
}

/// Delay before retrying a failed category (`failures >= 1`): 90 s, 3 min, 6 min, 12 min, then
/// capped at 15 min. Rate limiting waits at least 5 minutes.
pub fn backoff_delay(failures: u32, rate_limited: bool) -> Duration {
    let exp = failures.clamp(1, 5);
    let mut delay = (POLL_INTERVAL * 2u32.pow(exp)).min(BACKOFF_CAP);
    if rate_limited {
        delay = delay.max(RATE_LIMIT_FLOOR);
    }
    delay
}

/// ±15 % jitter; `unit` is a uniform sample in `[0, 1)`.
pub fn jittered(base: Duration, unit: f64) -> Duration {
    base.mul_f64(0.85 + 0.30 * unit.clamp(0.0, 1.0))
}

#[derive(Debug, Default)]
struct Backoff {
    failures: u32,
    retry_at: Option<Instant>,
}

impl Backoff {
    fn ready(&self, now: Instant) -> bool {
        self.retry_at.is_none_or(|t| now >= t)
    }
    fn failed(&mut self, now: Instant, rate_limited: bool) {
        self.failures = self.failures.saturating_add(1);
        self.retry_at = Some(now + backoff_delay(self.failures, rate_limited));
    }
    fn succeeded(&mut self) {
        *self = Self::default();
    }
}

/// Per-category poll state.
#[derive(Debug, Default)]
struct Chan<T> {
    tracker: T,
    backoff: Backoff,
    error: Option<String>,
    /// Latest value reported by Roblox (unread messages / pending requests / friends online).
    latest: Option<u64>,
}

/// Everything that belongs to one signed-in account's poll run. Dropped on switch / sign-out.
#[derive(Debug, Default)]
struct Session {
    user_id: Option<u64>,
    stopped: Option<String>,
    last_poll_at: Option<i64>,
    messages: Chan<CountTracker>,
    requests: Chan<CountTracker>,
    online: Chan<PresenceTracker>,
}

impl Session {
    /// Binds the session to `user_id`; a different account discards every baseline.
    /// Returns true if state was reset.
    fn bind_user(&mut self, user_id: u64) -> bool {
        if self.user_id == Some(user_id) {
            return false;
        }
        *self = Self {
            user_id: Some(user_id),
            ..Self::default()
        };
        true
    }

    fn errors(&self) -> Option<String> {
        let all: Vec<&str> = [&self.messages.error, &self.requests.error, &self.online.error]
            .into_iter()
            .flatten()
            .map(String::as_str)
            .collect();
        (!all.is_empty()).then(|| all.join(" · "))
    }
}

fn plural(n: u64, one: &str, many: &str) -> String {
    (if n == 1 { one } else { many }).to_owned()
}

/// `(title, body)` for new unread messages. Counts only, never message text.
pub fn message_text(new: u64, total: u64) -> (String, String) {
    (
        (if new == 1 { "New Roblox message" } else { "New Roblox messages" }).to_owned(),
        format!("You have {total} unread {}.", plural(total, "message", "messages")),
    )
}

pub fn request_text(new: u64, total: u64) -> (String, String) {
    (
        (if new == 1 { "New friend request" } else { "New friend requests" }).to_owned(),
        format!("You have {total} pending friend {}.", plural(total, "request", "requests")),
    )
}

/// `names` must be non-empty.
pub fn online_text(names: &[String]) -> (String, String) {
    match names {
        [] => (String::new(), String::new()),
        [a] => ("Friend online".into(), format!("{a} is now online.")),
        [a, b] => ("Friends online".into(), format!("{a} and {b} are now online.")),
        [a, b, rest @ ..] => (
            "Friends online".into(),
            format!("{a}, {b} and {} more are now online.", rest.len()),
        ),
    }
}

fn parse_count(v: &Value) -> Option<u64> {
    v.get("count")?.as_u64()
}

/// Sum of `unread_message_count` over the returned conversations. Summing messages (rather than
/// counting unread conversations) makes every new message in an already-unread chat an increase.
fn parse_unread_messages(v: &Value) -> Option<u64> {
    let conversations = v.get("conversations")?.as_array()?;
    Some(
        conversations
            .iter()
            .filter_map(|c| c.get("unread_message_count")?.as_u64())
            .fold(0u64, u64::saturating_add),
    )
}

fn parse_online(v: &Value) -> Option<Vec<(u64, String)>> {
    let data = v.get("data")?.as_array()?;
    Some(
        data.iter()
            .filter_map(|f| {
                let id = f.get("id")?.as_u64()?;
                let name = ["displayName", "name"]
                    .iter()
                    .find_map(|k| f.get(*k)?.as_str().filter(|s| !s.is_empty()))?;
                Some((id, name.to_owned()))
            })
            .collect(),
    )
}

// ---- state & command -------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Starting,
    /// Every notification type is switched off; nothing is requested.
    Disabled,
    NoAccount,
    Running,
    /// The session cookie was rejected; polling resumes after the account changes / signs in again.
    Stopped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifierStatus {
    pub state: RunState,
    pub user_id: Option<u64>,
    /// Unix ms of the last attempt that reached at least one endpoint.
    pub last_poll_at: Option<i64>,
    pub last_error: Option<String>,
    pub stopped_reason: Option<String>,
    pub unread_messages: Option<u64>,
    pub friend_requests: Option<u64>,
    pub friends_online: Option<u64>,
}

impl NotifierStatus {
    fn of(state: RunState, s: &Session) -> Self {
        Self {
            state,
            user_id: s.user_id,
            last_poll_at: s.last_poll_at,
            last_error: s.errors(),
            stopped_reason: s.stopped.clone(),
            unread_messages: s.messages.latest,
            friend_requests: s.requests.latest,
            friends_online: s.online.latest,
        }
    }
}

pub struct NotifierState {
    status: Mutex<NotifierStatus>,
    /// Bumped by `account-changed`; the loop re-baselines when it sees a new value.
    generation: AtomicU64,
    wake: tokio::sync::Notify,
}

impl Default for NotifierState {
    fn default() -> Self {
        Self {
            status: Mutex::new(NotifierStatus::of(RunState::Starting, &Session::default())),
            generation: AtomicU64::new(0),
            wake: tokio::sync::Notify::new(),
        }
    }
}

impl NotifierState {
    fn publish(&self, status: NotifierStatus) {
        *self.status.lock().unwrap_or_else(|e| e.into_inner()) = status;
    }
}

#[tauri::command]
pub fn notifier_status(state: State<'_, NotifierState>) -> NotifierStatus {
    state.status.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[derive(Clone, Serialize)]
struct Notice {
    kind: &'static str,
    message: String,
}

// ---- poller ----------------------------------------------------------------------------------

#[derive(Clone, Copy)]
struct Config {
    messages: bool,
    requests: bool,
    online: bool,
    only_when_not_in_front: bool,
}

const DEFAULT_CONFIG: Config = Config {
    messages: true,
    requests: true,
    online: false,
    only_when_not_in_front: true,
};

fn read_config(app: &AppHandle) -> Config {
    let db = app.state::<Db>();
    db.with(|c| {
        Ok(Config {
            messages: db::setting_bool(c, "notifyMessages", DEFAULT_CONFIG.messages),
            requests: db::setting_bool(c, "notifyFriendRequests", DEFAULT_CONFIG.requests),
            online: db::setting_bool(c, "notifyFriendsOnline", DEFAULT_CONFIG.online),
            only_when_not_in_front: db::setting_bool(
                c,
                "notifyOnlyWhenHidden",
                DEFAULT_CONFIG.only_when_not_in_front,
            ),
        })
    })
    .unwrap_or(DEFAULT_CONFIG)
}

/// The main window is visible, not minimized and focused, i.e. the user is looking at Muffin.
fn window_in_front(app: &AppHandle) -> bool {
    app.get_webview_window("main").is_some_and(|w| {
        w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false) && w.is_focused().unwrap_or(false)
    })
}

fn show(app: &AppHandle, title: &str, body: &str) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        eprintln!("muffin: couldn't show a notification: {e}");
    }
}

async fn fetch(app: &AppHandle, host: &str, path: &str) -> Result<Value> {
    rbx_session::authed_json(app, Method::GET, host, path, None).await
}

fn parse_error(what: &str) -> AppError {
    AppError::new(ErrorCode::Parse, format!("Unexpected {what} response from Roblox"))
}

/// Records a failed fetch. Returns true when the session itself was rejected.
fn record_failure<T>(chan: &mut Chan<T>, label: &str, e: &AppError, now: Instant) -> bool {
    if e.code == ErrorCode::AuthExpired {
        return true;
    }
    chan.backoff.failed(now, e.code == ErrorCode::RateLimited);
    chan.error = Some(format!("{label}: {}", e.message));
    false
}

/// One pass. Returns how long to wait before the next one.
async fn tick(app: &AppHandle, st: &NotifierState, session: &mut Session, seen_generation: &mut u64) -> Duration {
    let generation = st.generation.load(Ordering::SeqCst);
    if generation != *seen_generation {
        *seen_generation = generation;
        *session = Session::default();
    }

    let cfg = read_config(app);
    if !(cfg.messages || cfg.requests || cfg.online) {
        *session = Session {
            user_id: session.user_id,
            ..Session::default()
        };
        st.publish(NotifierStatus::of(RunState::Disabled, session));
        return IDLE_INTERVAL;
    }

    // Not signed in (or no usable account) → pause; nothing is requested.
    let Ok(user_id) = rbx_session::active_user_id(app) else {
        *session = Session::default();
        st.publish(NotifierStatus::of(RunState::NoAccount, session));
        return IDLE_INTERVAL;
    };
    session.bind_user(user_id);

    if session.stopped.is_some() {
        st.publish(NotifierStatus::of(RunState::Stopped, session));
        return STOPPED_INTERVAL;
    }

    let now = Instant::now();
    let mut expired = false;
    let mut polled = false;
    let mut pending: Vec<(String, String)> = Vec::new();

    if cfg.messages {
        if session.messages.backoff.ready(now) {
            polled = true;
            let result = fetch(app, API_HOST, CHAT_PATH)
                .await
                .and_then(|v| parse_unread_messages(&v).ok_or_else(|| parse_error("chat")));
            let chan = &mut session.messages;
            match result {
                Ok(total) => {
                    chan.backoff.succeeded();
                    chan.error = None;
                    chan.latest = Some(total);
                    let new = chan.tracker.observe(total);
                    if new > 0 {
                        pending.push(message_text(new, total));
                    }
                }
                Err(e) => expired = record_failure(chan, "Messages", &e, now),
            }
        }
    } else {
        session.messages = Chan::default();
    }

    if cfg.requests {
        if !expired && session.requests.backoff.ready(now) {
            polled = true;
            let result = fetch(app, FRIENDS_HOST, REQUESTS_PATH)
                .await
                .and_then(|v| parse_count(&v).ok_or_else(|| parse_error("friend request")));
            let chan = &mut session.requests;
            match result {
                Ok(total) => {
                    chan.backoff.succeeded();
                    chan.error = None;
                    chan.latest = Some(total);
                    let new = chan.tracker.observe(total);
                    if new > 0 {
                        pending.push(request_text(new, total));
                    }
                }
                Err(e) => expired = record_failure(chan, "Friend requests", &e, now),
            }
        }
    } else {
        session.requests = Chan::default();
    }

    if cfg.online {
        if !expired && session.online.backoff.ready(now) {
            polled = true;
            let path = format!("/v1/users/{user_id}/friends/online");
            let result = fetch(app, FRIENDS_HOST, &path)
                .await
                .and_then(|v| parse_online(&v).ok_or_else(|| parse_error("friends online")));
            let chan = &mut session.online;
            match result {
                Ok(list) => {
                    chan.backoff.succeeded();
                    chan.error = None;
                    chan.latest = Some(list.len() as u64);
                    let names = chan.tracker.observe(&list);
                    if !names.is_empty() {
                        pending.push(online_text(&names));
                    }
                }
                Err(e) => expired = record_failure(chan, "Friends online", &e, now),
            }
        }
    } else {
        session.online = Chan::default();
    }

    if polled {
        session.last_poll_at = Some(db::now_ms());
    }

    if expired {
        // Single notice: the stopped state suppresses further polling until the account changes.
        let reason = "Your Roblox session expired. Sign in again to resume notifications.";
        session.stopped = Some(reason.to_owned());
        let _ = app.emit(
            "notifier-notice",
            Notice {
                kind: "auth_expired",
                message: reason.to_owned(),
            },
        );
        if !window_in_front(app) {
            show(app, "Muffin notifications paused", reason);
        }
        st.publish(NotifierStatus::of(RunState::Stopped, session));
        return STOPPED_INTERVAL;
    }

    if !pending.is_empty() && !(cfg.only_when_not_in_front && window_in_front(app)) {
        for (title, body) in &pending {
            show(app, title, body);
        }
    }

    st.publish(NotifierStatus::of(RunState::Running, session));
    jittered(POLL_INTERVAL, rand::random::<f64>())
}

async fn run(app: AppHandle) {
    tokio::time::sleep(STARTUP_DELAY).await;
    let st = app.state::<NotifierState>();
    let mut session = Session::default();
    let mut seen_generation = st.generation.load(Ordering::SeqCst);
    loop {
        let delay = tick(&app, &st, &mut session, &mut seen_generation).await;
        tokio::select! {
            _ = tokio::time::sleep(delay) => {}
            _ = st.wake.notified() => {}
        }
    }
}

/// Registers state, the `account-changed` listener and the notification-click handler, then
/// starts the poller. Call once from `setup`, after `Db` and the account state are managed.
pub fn start(app: &AppHandle) {
    app.manage(NotifierState::default());

    let handle = app.clone();
    app.listen("account-changed", move |_| {
        let st = handle.state::<NotifierState>();
        st.generation.fetch_add(1, Ordering::SeqCst);
        st.wake.notify_one();
    });

    // Clicking a toast brings Muffin forward. Must be registered before the first toast is shown.
    let handle = app.clone();
    if let Err(e) = app.notification().on_action(move |action| {
        if action.action_id() == "tap" {
            tray::show_main_window(&handle);
        }
    }) {
        eprintln!("muffin: notification click handler unavailable: {e}");
    }

    tauri::async_runtime::spawn(run(app.clone()));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn first_observation_is_a_silent_baseline() {
        let mut t = CountTracker::default();
        assert_eq!(t.observe(7), 0);
        assert_eq!(t.observe(7), 0);
    }

    #[test]
    fn increase_reports_only_the_delta() {
        let mut t = CountTracker::default();
        t.observe(2);
        assert_eq!(t.observe(5), 3);
        assert_eq!(t.observe(5), 0);
    }

    #[test]
    fn decrease_lowers_baseline_so_next_arrival_fires() {
        let mut t = CountTracker::default();
        t.observe(4);
        assert_eq!(t.observe(1), 0); // read some
        assert_eq!(t.observe(2), 1); // one new
        assert_eq!(t.observe(0), 0);
        assert_eq!(t.observe(1), 1);
    }

    #[test]
    fn presence_baseline_then_new_arrivals_only() {
        let mut p = PresenceTracker::default();
        let a = (1, "Ann".to_owned());
        let b = (2, "Bob".to_owned());
        let c = (3, "Cy".to_owned());
        assert!(p.observe(&[a.clone(), b.clone()]).is_empty());
        assert!(p.observe(&[a.clone(), b.clone()]).is_empty());
        assert_eq!(p.observe(&[a.clone(), b.clone(), c.clone()]), vec!["Cy"]);
        // Bob leaves and returns: he counts as newly online again.
        assert!(p.observe(&[a.clone(), c.clone()]).is_empty());
        assert_eq!(p.observe(&[a, b, c]), vec!["Bob"]);
    }

    #[test]
    fn switching_account_rebaselines() {
        let mut s = Session::default();
        assert!(s.bind_user(1));
        s.messages.tracker.observe(3);
        assert!(!s.bind_user(1));
        assert_eq!(s.messages.tracker.observe(5), 2);
        assert!(s.bind_user(2));
        assert_eq!(s.messages.tracker.observe(9), 0, "other account: baseline only");
        assert_eq!(s.messages.tracker.observe(10), 1);
    }

    #[test]
    fn switching_account_clears_stopped_state_and_errors() {
        let mut s = Session::default();
        s.bind_user(1);
        s.stopped = Some("x".into());
        s.requests.error = Some("e".into());
        s.bind_user(2);
        assert!(s.stopped.is_none());
        assert!(s.errors().is_none());
    }

    #[test]
    fn backoff_grows_and_is_capped() {
        let secs = |f, rl| backoff_delay(f, rl).as_secs();
        assert_eq!(secs(1, false), 90);
        assert_eq!(secs(2, false), 180);
        assert_eq!(secs(4, false), 720);
        assert_eq!(secs(5, false), 900);
        assert_eq!(secs(50, false), 900);
        assert_eq!(secs(0, false), 90, "never shorter than the first backoff step");
    }

    #[test]
    fn rate_limit_waits_at_least_five_minutes() {
        assert_eq!(backoff_delay(1, true), RATE_LIMIT_FLOOR);
        assert_eq!(backoff_delay(5, true), BACKOFF_CAP);
    }

    #[test]
    fn backoff_gates_polling_until_deadline_and_resets_on_success() {
        let mut b = Backoff::default();
        let t0 = Instant::now();
        assert!(b.ready(t0));
        b.failed(t0, false);
        assert!(!b.ready(t0 + Duration::from_secs(89)));
        assert!(b.ready(t0 + Duration::from_secs(90)));
        b.succeeded();
        assert!(b.ready(t0));
        assert_eq!(b.failures, 0);
    }

    #[test]
    fn jitter_stays_within_fifteen_percent() {
        assert_eq!(jittered(Duration::from_secs(100), 0.0), Duration::from_secs(85));
        assert_eq!(jittered(Duration::from_secs(100), 1.0), Duration::from_secs(115));
        assert_eq!(jittered(Duration::from_secs(100), 7.0), Duration::from_secs(115));
        assert_eq!(jittered(Duration::from_secs(100), -3.0), Duration::from_secs(85));
    }

    #[test]
    fn parses_friend_request_count() {
        assert_eq!(parse_count(&json!({"count": 3})), Some(3));
        assert_eq!(parse_count(&json!({"count": "3"})), None);
        assert_eq!(parse_count(&json!({})), None);
    }

    #[test]
    fn sums_unread_messages_across_conversations() {
        let v = json!({"conversations": [
            {"id": "1", "unread_message_count": 2},
            {"id": "2", "unread_message_count": 0},
            {"id": "3"},
            {"id": "4", "unread_message_count": 5}
        ]});
        assert_eq!(parse_unread_messages(&v), Some(7));
        assert_eq!(parse_unread_messages(&json!({"conversations": []})), Some(0));
        assert_eq!(parse_unread_messages(&json!({"errors": []})), None, "unknown shape is not 'zero unread'");
    }

    #[test]
    fn parses_online_friends_preferring_display_name() {
        let v = json!({"data": [
            {"id": 1, "name": "ann", "displayName": "Ann"},
            {"id": 2, "name": "bob", "displayName": ""},
            {"name": "no-id"}
        ]});
        assert_eq!(parse_online(&v), Some(vec![(1, "Ann".into()), (2, "bob".into())]));
        assert_eq!(parse_online(&json!({})), None);
    }

    #[test]
    fn notification_text_has_counts_and_correct_plurals() {
        assert_eq!(
            message_text(1, 1),
            ("New Roblox message".into(), "You have 1 unread message.".into())
        );
        assert_eq!(
            message_text(2, 5),
            ("New Roblox messages".into(), "You have 5 unread messages.".into())
        );
        assert_eq!(
            request_text(1, 1),
            ("New friend request".into(), "You have 1 pending friend request.".into())
        );
        assert_eq!(request_text(3, 4).1, "You have 4 pending friend requests.");
        let n = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(online_text(&n(&["A"])).1, "A is now online.");
        assert_eq!(online_text(&n(&["A", "B"])).1, "A and B are now online.");
        assert_eq!(online_text(&n(&["A", "B", "C", "D"])).1, "A, B and 2 more are now online.");
    }
}
