//! Roblox website sessions (multiple accounts). Cookies live only in Windows Credential Manager
//! (`roblox-web-session:<user_id>`) and never cross the IPC boundary; non-secret rows live in the
//! SQLite `accounts` table, the active one in settings key `activeAccountId`.
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use reqwest::Method;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::db::{self, Db};
use crate::error::{AppError, ErrorCode, Result};
use crate::rbx_session;

const LOGIN_WINDOW: &str = "roblox-login";
const SERVICE: &str = "app.muffin.launcher";
/// Pre-multi-account single-session entry; migrated once, then deleted.
const LEGACY_ACCOUNT: &str = "roblox-web-session";
const ACTIVE_KEY: &str = "activeAccountId";
/// Emitted after the active account changed. Payload `{ userId: number | null }`.
const EVENT_CHANGED: &str = "account-changed";
/// Emitted when an account's session was found invalid. Payload `{ userId }`.
const EVENT_EXPIRED: &str = "account-expired";

#[derive(Default)]
pub struct AccountState {
    generation: AtomicU64,
    changes: tokio::sync::Mutex<()>,
    migrated: tokio::sync::Mutex<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountUser {
    id: u64,
    username: String,
    display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar_url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    signed_in: bool,
    /// The active account exists but Roblox rejected its session: re-login needed.
    expired: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    user: Option<AccountUser>,
}

impl AccountStatus {
    fn out(expired: bool) -> Self {
        Self { signed_in: false, expired, user: None }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountSummary {
    user_id: u64,
    username: String,
    display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar_url: Option<String>,
    added_at: i64,
    expired: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountsList {
    accounts: Vec<AccountSummary>,
    active_user_id: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountItem {
    id: u64,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    place_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    universe_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon_url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountData {
    items: Vec<AccountItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    robux: Option<u64>,
    next_cursor: Option<String>,
}

// ---- SQLite rows ------------------------------------------------------------------------------

pub fn ensure_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS accounts(
            user_id INTEGER PRIMARY KEY,
            username TEXT NOT NULL,
            display_name TEXT NOT NULL,
            avatar_url TEXT,
            added_at INTEGER NOT NULL,
            expired INTEGER NOT NULL DEFAULT 0
        );",
    )?;
    Ok(())
}

fn rows(conn: &Connection) -> Result<Vec<AccountSummary>> {
    let mut stmt = conn.prepare(
        "SELECT user_id, username, display_name, avatar_url, added_at, expired
         FROM accounts ORDER BY added_at, user_id",
    )?;
    let out = stmt
        .query_map([], |r| {
            Ok(AccountSummary {
                user_id: r.get::<_, i64>(0)? as u64,
                username: r.get(1)?,
                display_name: r.get(2)?,
                avatar_url: r.get(3)?,
                added_at: r.get(4)?,
                expired: r.get::<_, i64>(5)? != 0,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(out)
}

/// Insert or refresh an account. Clears `expired` (a fresh login/validation proves the session).
fn upsert_row(conn: &Connection, user_id: u64, username: &str, display_name: &str, avatar: Option<&str>, now: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO accounts(user_id, username, display_name, avatar_url, added_at, expired)
         VALUES(?1, ?2, ?3, ?4, ?5, 0)
         ON CONFLICT(user_id) DO UPDATE SET
           username = excluded.username,
           display_name = excluded.display_name,
           avatar_url = COALESCE(excluded.avatar_url, avatar_url),
           expired = 0",
        params![user_id as i64, username, display_name, avatar, now],
    )?;
    Ok(())
}

fn set_expired_row(conn: &Connection, user_id: u64, expired: bool) -> Result<bool> {
    let n = conn.execute(
        "UPDATE accounts SET expired = ?2 WHERE user_id = ?1 AND expired != ?2",
        params![user_id as i64, expired as i64],
    )?;
    Ok(n > 0)
}

fn row_exists(conn: &Connection, user_id: u64) -> Result<bool> {
    Ok(conn
        .query_row("SELECT 1 FROM accounts WHERE user_id = ?1", [user_id as i64], |_| Ok(()))
        .optional()?
        .is_some())
}

/// Active account id; `None` if unset or pointing at a row that no longer exists.
fn active_id(conn: &Connection) -> Result<Option<u64>> {
    let Some(id) = db::setting_get(conn, ACTIVE_KEY)?.and_then(|v| v.as_u64()) else { return Ok(None) };
    Ok(row_exists(conn, id)?.then_some(id))
}

fn set_active(conn: &Connection, id: Option<u64>) -> Result<()> {
    match id {
        Some(id) => db::setting_set(conn, ACTIVE_KEY, &json!(id)),
        None => db::setting_delete(conn, ACTIVE_KEY),
    }
}

/// Delete a row; when it was the active one, activate the first usable remaining account
/// (prefers a non-expired one). Returns the active id after removal.
fn remove_row(conn: &mut Connection, user_id: u64) -> Result<Option<u64>> {
    let tx = conn.transaction()?;
    let was_active = active_id(&tx)? == Some(user_id);
    tx.execute("DELETE FROM accounts WHERE user_id = ?1", [user_id as i64])?;
    let mut active = active_id(&tx)?;
    if was_active || active.is_none() {
        let remaining = rows(&tx)?;
        active = remaining.iter().find(|a| !a.expired).or(remaining.first()).map(|a| a.user_id);
        set_active(&tx, active)?;
    }
    tx.commit()?;
    Ok(active)
}

// ---- helpers used by rbx_session --------------------------------------------------------------

pub(crate) fn active_account_id(app: &AppHandle) -> Result<Option<u64>> {
    app.state::<Db>().with(|c| active_id(c))
}

pub(crate) fn is_expired(app: &AppHandle, user_id: u64) -> Result<bool> {
    app.state::<Db>().with(|c| {
        Ok(rows(c)?.iter().any(|a| a.user_id == user_id && a.expired))
    })
}

/// Flag the account expired (no-op if already) and tell the frontend.
pub(crate) fn mark_expired(app: &AppHandle, user_id: u64) {
    let changed = app.state::<Db>().with(|c| set_expired_row(c, user_id, true)).unwrap_or(false);
    if changed {
        let _ = app.emit(EVENT_EXPIRED, json!({ "userId": user_id }));
    }
}

// ---- keyring ----------------------------------------------------------------------------------

fn entry(name: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, name)
        .map_err(|_| AppError::storage("Windows Credential Manager is unavailable"))
}

fn session_name(user_id: u64) -> String {
    format!("{LEGACY_ACCOUNT}:{user_id}")
}

pub(crate) fn cookie_for(user_id: u64) -> Result<Option<String>> {
    match entry(&session_name(user_id))?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(AppError::storage("Couldn't read the Roblox session")),
    }
}

fn delete_cookie(name: &str) -> Result<()> {
    match entry(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(AppError::storage("Couldn't remove the Roblox session")),
    }
}

// ---- Roblox lookups ---------------------------------------------------------------------------

fn bad_response() -> AppError {
    AppError::new(ErrorCode::Parse, "Unexpected response from Roblox")
}

/// `(id, username, display_name)` of the cookie's owner.
async fn fetch_user(cookie: &str) -> Result<(u64, String, String)> {
    let v = rbx_session::json_with_cookie(cookie, Method::GET, "users", "/v1/users/authenticated", None).await?;
    Ok((
        v["id"].as_u64().filter(|id| *id > 0).ok_or_else(bad_response)?,
        v["name"].as_str().ok_or_else(bad_response)?.to_owned(),
        v["displayName"].as_str().ok_or_else(bad_response)?.to_owned(),
    ))
}

/// Best-effort headshot URL; avatars are decoration, never a reason to fail.
async fn fetch_avatar(app: &AppHandle, user_id: u64) -> Option<String> {
    let path = format!("/v1/users/avatar-headshot?userIds={user_id}&size=150x150&format=Webp&returnPolicy=PlaceHolder");
    let v = rbx_session::public_json(app, "thumbnails", &path).await.ok()?;
    v["data"].as_array()?.iter()
        .find(|d| d["targetId"].as_u64() == Some(user_id) && d["state"].as_str() == Some("Completed"))
        .and_then(|d| d["imageUrl"].as_str()).map(str::to_owned)
}

fn list(app: &AppHandle) -> Result<AccountsList> {
    app.state::<Db>().with(|c| {
        Ok(AccountsList { accounts: rows(c)?, active_user_id: active_id(c)? })
    })
}

fn emit_changed(app: &AppHandle, user_id: Option<u64>) {
    let _ = app.emit(EVENT_CHANGED, json!({ "userId": user_id }));
}

fn login_navigation(url: &url::Url) -> bool {
    url.scheme() == "https" && url.port().is_none() && url.username().is_empty() && url.password().is_none()
        && url.host_str().is_some_and(|host| host == "roblox.com" || host.ends_with(".roblox.com"))
}

// ---- legacy migration -------------------------------------------------------------------------

/// Move the pre-multi-account session into `accounts` + `roblox-web-session:<id>`. Runs once per
/// process; if the network is down the legacy entry is kept for the next start.
async fn ensure_migrated(app: &AppHandle, state: &AccountState) {
    let mut done = state.migrated.lock().await;
    if *done {
        return;
    }
    *done = true;
    let Ok(legacy) = entry(LEGACY_ACCOUNT) else { return };
    let Ok(cookie) = legacy.get_password() else { return };
    match fetch_user(&cookie).await {
        Ok((id, username, display_name)) => {
            let avatar = fetch_avatar(app, id).await;
            if entry(&session_name(id)).and_then(|e| e.set_password(&cookie).map_err(|_| AppError::storage("keyring"))).is_err() {
                return;
            }
            let stored = app.state::<Db>().with(|c| {
                upsert_row(c, id, &username, &display_name, avatar.as_deref(), db::now_ms())?;
                if active_id(c)?.is_none() {
                    set_active(c, Some(id))?;
                }
                Ok(())
            });
            if stored.is_ok() {
                let _ = delete_cookie(LEGACY_ACCOUNT);
            }
        }
        // The old session is dead and there is nothing to attach it to.
        Err(e) if e.code == ErrorCode::AuthExpired => {
            let _ = delete_cookie(LEGACY_ACCOUNT);
        }
        Err(_) => {}
    }
}

pub fn spawn_migration(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AccountState>();
        ensure_migrated(&app, &state).await;
    });
}

// ---- commands ---------------------------------------------------------------------------------

#[tauri::command]
pub async fn accounts_list(app: AppHandle, state: State<'_, AccountState>) -> Result<AccountsList> {
    ensure_migrated(&app, &state).await;
    list(&app)
}

/// Opens the isolated Roblox login window and ADDS the account that signs in (or refreshes the
/// session of one already present, clearing its expired flag). The new account becomes active.
#[tauri::command]
pub async fn account_add(app: AppHandle, state: State<'_, AccountState>) -> Result<AccountsList> {
    ensure_migrated(&app, &state).await;
    if app.get_webview_window(LOGIN_WINDOW).is_some() {
        return Err(AppError::auth_failed("A Roblox sign-in window is already open"));
    }
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let login = WebviewWindowBuilder::new(&app, LOGIN_WINDOW, WebviewUrl::External(
        url::Url::parse("https://www.roblox.com/login").map_err(|_| AppError::auth_failed("Invalid login URL"))?,
    ))
    .title("Sign in to Roblox")
    .inner_size(1000.0, 760.0)
    .incognito(true)
    .on_navigation(login_navigation)
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
    .build()
    .map_err(|_| AppError::auth_failed("Couldn't open the Roblox sign-in window"))?;
    loop {
        tokio::time::sleep(Duration::from_secs(2)).await;
        if state.generation.load(Ordering::SeqCst) != generation || app.get_webview_window(LOGIN_WINDOW).is_none() {
            return Err(AppError::new(ErrorCode::AuthDenied, "Roblox sign-in was cancelled"));
        }
        // Cookie access must not run in a WebView2 event handler or synchronous command.
        let window = login.clone();
        let cookies = tokio::task::spawn_blocking(move || window.cookies_for_url(
            url::Url::parse("https://www.roblox.com/").expect("static URL"),
        )).await.map_err(|_| AppError::auth_failed("Couldn't read the Roblox session"))?
            .map_err(|_| AppError::auth_failed("Couldn't read the Roblox session"))?;
        let Some(cookie) = cookies.iter().find(|c| c.name() == ".ROBLOSECURITY" && !c.value().is_empty()) else { continue };
        let cookie = cookie.value().to_owned();
        match fetch_user(&cookie).await {
            Ok((id, username, display_name)) => {
                let avatar = fetch_avatar(&app, id).await;
                let _guard = state.changes.lock().await;
                if state.generation.load(Ordering::SeqCst) != generation || app.get_webview_window(LOGIN_WINDOW).is_none() {
                    return Err(AppError::new(ErrorCode::AuthDenied, "Roblox sign-in was cancelled"));
                }
                entry(&session_name(id))?.set_password(&cookie).map_err(|_| AppError::storage("Couldn't save the Roblox session"))?;
                app.state::<Db>().with(|c| {
                    upsert_row(c, id, &username, &display_name, avatar.as_deref(), db::now_ms())?;
                    set_active(c, Some(id))
                })?;
                rbx_session::clear_csrf(id);
                let _ = login.destroy();
                emit_changed(&app, Some(id));
                return list(&app);
            }
            Err(e) if e.code == ErrorCode::AuthExpired => continue,
            Err(e) => { let _ = login.destroy(); return Err(e); }
        }
    }
}

/// Make `user_id` the active account after proving its stored session still works. A dead session
/// marks the account expired and fails with `auth_expired` (the active account is left unchanged).
#[tauri::command]
pub async fn account_switch(app: AppHandle, state: State<'_, AccountState>, user_id: u64) -> Result<AccountsList> {
    ensure_migrated(&app, &state).await;
    let _guard = state.changes.lock().await;
    let account = app.state::<Db>().with(|c| Ok(rows(c)?.into_iter().find(|a| a.user_id == user_id)))?
        .ok_or_else(|| AppError::invalid("Unknown account"))?;
    let expired_err = || AppError::new(
        ErrorCode::AuthExpired,
        format!("{}'s Roblox session expired. Sign in again.", account.display_name),
    );
    let Some(cookie) = cookie_for(user_id)? else {
        mark_expired(&app, user_id);
        return Err(expired_err());
    };
    match fetch_user(&cookie).await {
        Ok((id, username, display_name)) if id == user_id => {
            let avatar = fetch_avatar(&app, id).await;
            app.state::<Db>().with(|c| {
                upsert_row(c, id, &username, &display_name, avatar.as_deref(), db::now_ms())?;
                set_active(c, Some(id))
            })?;
            emit_changed(&app, Some(id));
            list(&app)
        }
        // The credential now belongs to a different user (or Roblox rejected it).
        Ok(_) => {
            mark_expired(&app, user_id);
            Err(expired_err())
        }
        Err(e) if e.code == ErrorCode::AuthExpired => {
            mark_expired(&app, user_id);
            Err(expired_err())
        }
        Err(e) => Err(e),
    }
}

/// Remove an account: delete its cookie, its row, and fall back to another account if it was active.
fn remove_inner(app: &AppHandle, user_id: u64) -> Result<()> {
    delete_cookie(&session_name(user_id))?;
    let (was_active, now_active) = app.state::<Db>().with(|c| {
        let was = active_id(c)? == Some(user_id);
        Ok((was, remove_row(c, user_id)?))
    })?;
    rbx_session::clear_csrf(user_id);
    if was_active {
        emit_changed(app, now_active);
    }
    Ok(())
}

#[tauri::command]
pub async fn account_remove(app: AppHandle, state: State<'_, AccountState>, user_id: u64) -> Result<AccountsList> {
    ensure_migrated(&app, &state).await;
    let _guard = state.changes.lock().await;
    remove_inner(&app, user_id)?;
    list(&app)
}

/// Sign out the ACTIVE account only (other accounts stay). Also cancels a pending login window.
#[tauri::command]
pub async fn account_sign_out(app: AppHandle, state: State<'_, AccountState>) -> Result<AccountsList> {
    ensure_migrated(&app, &state).await;
    let _guard = state.changes.lock().await;
    state.generation.fetch_add(1, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window(LOGIN_WINDOW) { let _ = window.destroy(); }
    if let Some(id) = active_account_id(&app)? {
        remove_inner(&app, id)?;
    }
    list(&app)
}

/// Active account's identity, validated against Roblox. An invalid session is marked expired.
#[tauri::command]
pub async fn account_status(app: AppHandle, state: State<'_, AccountState>) -> Result<AccountStatus> {
    ensure_migrated(&app, &state).await;
    let Some(user_id) = active_account_id(&app)? else { return Ok(AccountStatus::out(false)) };
    if is_expired(&app, user_id)? {
        return Ok(AccountStatus::out(true));
    }
    let Some(cookie) = cookie_for(user_id)? else {
        mark_expired(&app, user_id);
        return Ok(AccountStatus::out(true));
    };
    match fetch_user(&cookie).await {
        Ok((id, username, display_name)) if id == user_id => {
            let avatar = fetch_avatar(&app, id).await;
            app.state::<Db>().with(|c| upsert_row(c, id, &username, &display_name, avatar.as_deref(), db::now_ms()))?;
            let avatar_url = app.state::<Db>().with(|c| {
                Ok(rows(c)?.into_iter().find(|a| a.user_id == id).and_then(|a| a.avatar_url))
            })?;
            Ok(AccountStatus {
                signed_in: true,
                expired: false,
                user: Some(AccountUser { id, username, display_name, avatar_url }),
            })
        }
        Ok(_) => {
            mark_expired(&app, user_id);
            Ok(AccountStatus::out(true))
        }
        Err(e) if e.code == ErrorCode::AuthExpired => {
            mark_expired(&app, user_id);
            Ok(AccountStatus::out(true))
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn account_data(app: AppHandle, section: String, cursor: Option<String>) -> Result<AccountData> {
    if cursor.as_ref().is_some_and(|c| c.len() > 2048 || c.chars().any(char::is_control)) {
        return Err(AppError::invalid("Invalid page cursor"));
    }
    let user_id = rbx_session::active_user_id(&app)?;
    let (host, path) = match section.as_str() {
        "robux" => ("economy", "/v1/user/currency".to_owned()),
        "friends" => ("friends", format!("/v1/users/{user_id}/friends/find")),
        "created" => ("games", format!("/v2/users/{user_id}/games")),
        "saved" => ("games", format!("/v2/users/{user_id}/favorite/games")),
        _ => return Err(AppError::invalid("Invalid account section")),
    };
    let path = {
        let mut query = url::form_urlencoded::Serializer::new(String::new());
        if section == "friends" { query.append_pair("userSort", "FriendScore"); }
        if section == "created" || section == "saved" { query.append_pair("limit", "50").append_pair("sortOrder", "Desc"); }
        if let Some(cursor) = cursor.as_deref().filter(|c| !c.is_empty()) { query.append_pair("cursor", cursor); }
        let query = query.finish();
        if query.is_empty() { path } else { format!("{path}?{query}") }
    };
    let data = rbx_session::authed_json(&app, Method::GET, host, &path, None).await?;
    if section == "robux" {
        return Ok(AccountData { robux: Some(data["robux"].as_u64().ok_or_else(bad_response)?), items: vec![], next_cursor: None });
    }
    let friend = section == "friends";
    let rows = data[if friend { "PageItems" } else { "data" }].as_array().ok_or_else(bad_response)?;
    let next_cursor = data[if friend { "NextCursor" } else { "nextPageCursor" }].as_str().map(str::to_owned);
    let mut items = Vec::with_capacity(rows.len());
    if friend {
        let ids: Vec<u64> = rows.iter().map(|v| v["id"].as_u64().filter(|id| *id > 0).ok_or_else(bad_response)).collect::<Result<_>>()?;
        // The paginated friends endpoint returns IDs only. Resolve names through the users API.
        for chunk in ids.chunks(100) {
            let profiles = rbx_session::authed_json(&app, Method::POST, "users", "/v1/users", Some(json!({"userIds":chunk,"excludeBannedUsers":false}))).await?;
            let profiles = profiles["data"].as_array().ok_or_else(bad_response)?;
            for id in chunk {
                let profile = profiles.iter().find(|p| p["id"].as_u64() == Some(*id)).ok_or_else(bad_response)?;
                items.push(AccountItem { id: *id, name: profile["name"].as_str().ok_or_else(bad_response)?.to_owned(), display_name: profile["displayName"].as_str().map(str::to_owned), place_id: None, universe_id: None, icon_url: None });
            }
        }
    } else {
        for row in rows {
            let id = row["id"].as_u64().filter(|id| *id > 0).ok_or_else(bad_response)?;
            items.push(AccountItem { id, name: row["name"].as_str().ok_or_else(bad_response)?.to_owned(), display_name: None, place_id: row["rootPlace"]["id"].as_u64().filter(|id| *id > 0), universe_id: Some(id), icon_url: None });
        }
    }
    if !items.is_empty() {
        let ids = items.iter().map(|v| v.id.to_string()).collect::<Vec<_>>().join(",");
        let path = format!(
            "{}?{}={ids}&size={}&format=Webp&returnPolicy=PlaceHolder",
            if friend { "/v1/users/avatar-headshot" } else { "/v1/games/icons" },
            if friend { "userIds" } else { "universeIds" },
            if friend { "150x150" } else { "256x256" },
        );
        // Images are optional; the underlying account data remains useful if thumbnails fail.
        if let Ok(images) = rbx_session::public_json(&app, "thumbnails", &path).await {
            if let Some(images) = images["data"].as_array() {
                for item in &mut items {
                    item.icon_url = images.iter().find(|v| v["targetId"].as_u64() == Some(item.id) && v["state"].as_str() == Some("Completed"))
                        .and_then(|v| v["imageUrl"].as_str()).map(str::to_owned);
                }
            }
        }
    }
    Ok(AccountData { items, robux: None, next_cursor })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let c = db::test_conn();
        ensure_schema(&c).unwrap();
        c
    }

    #[test]
    fn navigation_only_allows_https_roblox_hosts() {
        assert!(login_navigation(&url::Url::parse("https://www.roblox.com/login").unwrap()));
        assert!(login_navigation(&url::Url::parse("https://apis.roblox.com/path").unwrap()));
        assert!(!login_navigation(&url::Url::parse("https://roblox.com.evil.test/login").unwrap()));
        assert!(!login_navigation(&url::Url::parse("http://www.roblox.com/login").unwrap()));
        assert!(!login_navigation(&url::Url::parse("https://www.roblox.com:8443/login").unwrap()));
    }

    #[test]
    fn upsert_keeps_added_at_and_clears_expired() {
        let c = conn();
        upsert_row(&c, 1, "a", "A", Some("http://x/1"), 100).unwrap();
        assert!(set_expired_row(&c, 1, true).unwrap());
        assert!(!set_expired_row(&c, 1, true).unwrap(), "no-op when already expired");
        upsert_row(&c, 1, "a2", "A2", None, 999).unwrap();
        let r = rows(&c).unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!((r[0].added_at, r[0].expired, r[0].username.as_str()), (100, false, "a2"));
        assert_eq!(r[0].avatar_url.as_deref(), Some("http://x/1"), "missing avatar keeps the old one");
    }

    #[test]
    fn active_ignores_dangling_id() {
        let c = conn();
        assert_eq!(active_id(&c).unwrap(), None);
        set_active(&c, Some(7)).unwrap();
        assert_eq!(active_id(&c).unwrap(), None);
        upsert_row(&c, 7, "g", "G", None, 1).unwrap();
        assert_eq!(active_id(&c).unwrap(), Some(7));
    }

    #[test]
    fn removing_active_falls_back_to_usable_account() {
        let mut c = conn();
        upsert_row(&c, 1, "a", "A", None, 1).unwrap();
        upsert_row(&c, 2, "b", "B", None, 2).unwrap();
        upsert_row(&c, 3, "c", "C", None, 3).unwrap();
        set_expired_row(&c, 2, true).unwrap();
        set_active(&c, Some(1)).unwrap();
        // Removing a non-active account leaves the active one alone.
        assert_eq!(remove_row(&mut c, 3).unwrap(), Some(1));
        upsert_row(&c, 3, "c", "C", None, 3).unwrap();
        // Removing the active one prefers a non-expired account over an earlier expired one.
        assert_eq!(remove_row(&mut c, 1).unwrap(), Some(3));
        assert_eq!(active_id(&c).unwrap(), Some(3));
        assert_eq!(remove_row(&mut c, 3).unwrap(), Some(2), "only an expired account left is still chosen");
        assert_eq!(remove_row(&mut c, 2).unwrap(), None);
        assert_eq!(active_id(&c).unwrap(), None);
        assert!(rows(&c).unwrap().is_empty());
    }
}
