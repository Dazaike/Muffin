//! Authenticated Roblox HTTP for the ACTIVE account. All callers go through here: the cookie never
//! leaves Rust, hosts are a fixed allowlist (not a generic proxy), redirects are never followed.
//!
//! `host` arguments accept either the short name (`"users"`) or the full name
//! (`"users.roblox.com"`); `"www"` / `"www.roblox.com"` is allowed for a few fixed path prefixes.
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::Duration;

use reqwest::{header, Client, Method, StatusCode};
use serde_json::Value;
use tauri::AppHandle;

use crate::account;
use crate::error::{AppError, ErrorCode, Result};

/// Subdomains of `roblox.com` callers may reach. `auth` and `premiumfeatures` are deliberately absent.
const HOSTS: &[&str] = &[
    "users", "economy", "friends", "games", "thumbnails", "presence", "chat", "badges", "apis",
    "followings", "groups", "inventory", "avatar",
];
/// `www.roblox.com` is only reachable for these path prefixes (game instance / private-server pages).
const WWW_PATH_PREFIXES: &[&str] = &["/games/", "/game/", "/private-servers/"];

const CSRF_HEADER: &str = "x-csrf-token";

static CLIENT: OnceLock<Client> = OnceLock::new();
/// Per-account CSRF token cache. Std mutex; never held across an `.await`.
static CSRF: LazyLock<Mutex<HashMap<u64, String>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn client() -> Result<&'static Client> {
    if let Some(c) = CLIENT.get() {
        return Ok(c);
    }
    let built = Client::builder()
        .timeout(Duration::from_secs(10))
        // Never forward a cookie to a redirect target, even another Roblox host.
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("Muffin/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| AppError::new(ErrorCode::Network, "Couldn't create the Roblox client"))?;
    Ok(CLIENT.get_or_init(|| built))
}

fn csrf_get(user_id: u64) -> Option<String> {
    CSRF.lock().unwrap_or_else(|e| e.into_inner()).get(&user_id).cloned()
}

fn csrf_set(user_id: u64, token: String) {
    CSRF.lock().unwrap_or_else(|e| e.into_inner()).insert(user_id, token);
}

/// Forget the cached CSRF token (account removed / re-logged in).
pub fn clear_csrf(user_id: u64) {
    CSRF.lock().unwrap_or_else(|e| e.into_inner()).remove(&user_id);
}

/// Validate `host` + `path_and_query` against the allowlist and build the final URL.
pub(crate) fn resolve(host: &str, path_and_query: &str) -> Result<url::Url> {
    let bad = || AppError::invalid("Invalid Roblox endpoint");
    let short = host.strip_suffix(".roblox.com").unwrap_or(host);
    let fqdn = if short == "www" {
        "www.roblox.com".to_owned()
    } else if HOSTS.contains(&short) {
        format!("{short}.roblox.com")
    } else {
        return Err(bad());
    };
    if !path_and_query.starts_with('/')
        || path_and_query.starts_with("//")
        || path_and_query.chars().any(|c| c.is_control() || c.is_whitespace() || c == '\\')
    {
        return Err(bad());
    }
    let url = url::Url::parse(&format!("https://{fqdn}{path_and_query}")).map_err(|_| bad())?;
    if url.scheme() != "https"
        || url.host_str() != Some(fqdn.as_str())
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(bad());
    }
    // Check the parsed path: dot segments are normalised away by the parser.
    if fqdn == "www.roblox.com" && !WWW_PATH_PREFIXES.iter().any(|p| url.path().starts_with(p)) {
        return Err(bad());
    }
    // The inventory host carries the signed-in user's own items too; only another user's public
    // collectibles listing is reachable.
    if fqdn == "inventory.roblox.com" && !(url.path().starts_with("/v1/users/") && url.path().ends_with("/assets/collectibles")) {
        return Err(bad());
    }
    Ok(url)
}

/// If a mutating request was rejected only for a stale CSRF token, return the token to retry with.
/// A 403 that echoes the token we already sent is a real permission error: no retry.
pub(crate) fn csrf_retry_token(
    method: &Method,
    status: StatusCode,
    sent: Option<&str>,
    returned: Option<&str>,
) -> Option<String> {
    if *method == Method::GET || status != StatusCode::FORBIDDEN {
        return None;
    }
    let returned = returned.filter(|t| !t.is_empty())?;
    (sent != Some(returned)).then(|| returned.to_owned())
}

/// Roblox error bodies look like `{"errors":[{"code":..,"message":".."}]}` or `{"message":".."}`.
pub(crate) fn roblox_error_message(body: &Value) -> Option<String> {
    let msg = body["errors"][0]["message"]
        .as_str()
        .or_else(|| body["message"].as_str())
        .or_else(|| body["errors"][0]["userFacingMessage"].as_str())?
        .trim();
    (!msg.is_empty()).then(|| msg.chars().take(200).collect())
}

/// Map a non-success status to the shared error codes. `None` for 2xx.
pub(crate) fn status_error(status: StatusCode, message: Option<String>) -> Option<AppError> {
    if status.is_success() {
        return None;
    }
    Some(match status {
        StatusCode::UNAUTHORIZED => AppError::new(
            ErrorCode::AuthExpired,
            "Your Roblox session expired. Sign in again.",
        ),
        StatusCode::TOO_MANY_REQUESTS => AppError::new(
            ErrorCode::RateLimited,
            "Roblox is limiting requests; try again later",
        ),
        _ => AppError::new(
            ErrorCode::HttpStatus,
            message.unwrap_or_else(|| format!("Roblox returned HTTP {status}")),
        ),
    })
}

async fn send(
    cookie: Option<&str>,
    csrf_key: Option<u64>,
    method: Method,
    url: url::Url,
    body: Option<Value>,
) -> Result<Value> {
    let client = client()?;
    let cookie_header = cookie
        .map(|c| {
            header::HeaderValue::from_str(&format!(".ROBLOSECURITY={c}"))
                .map(|mut v| {
                    v.set_sensitive(true);
                    v
                })
                .map_err(|_| AppError::auth_failed("Invalid Roblox session"))
        })
        .transpose()?;
    let mutating = method != Method::GET;
    let mut token = if mutating { csrf_key.and_then(csrf_get) } else { None };
    let mut retried = false;
    loop {
        let mut req = client.request(method.clone(), url.clone());
        if let Some(c) = &cookie_header {
            req = req.header(header::COOKIE, c.clone());
        }
        if cookie_header.is_some() && mutating {
            if let Some(t) = &token {
                req = req.header(CSRF_HEADER, t);
            }
        }
        if let Some(b) = &body {
            req = req.json(b);
        }
        let response = req.send().await?;
        let status = response.status();
        if !retried && cookie_header.is_some() {
            let returned = response.headers().get(CSRF_HEADER).and_then(|v| v.to_str().ok());
            if let Some(new) = csrf_retry_token(&method, status, token.as_deref(), returned) {
                if let Some(k) = csrf_key {
                    csrf_set(k, new.clone());
                }
                token = Some(new);
                retried = true;
                continue;
            }
        }
        let text = response.text().await?;
        let parsed: Option<Value> = if text.trim().is_empty() { None } else { serde_json::from_str(&text).ok() };
        if let Some(err) = status_error(status, parsed.as_ref().and_then(roblox_error_message)) {
            return Err(err);
        }
        return match parsed {
            Some(v) => Ok(v),
            None if text.trim().is_empty() => Ok(Value::Null),
            None => Err(AppError::new(ErrorCode::Parse, "Unexpected response from Roblox")),
        };
    }
}

/// Signed-in user id of the active account, or `auth_expired` when nobody is signed in.
pub fn active_user_id(app: &AppHandle) -> Result<u64> {
    account::active_account_id(app)?
        .ok_or_else(|| AppError::new(ErrorCode::AuthExpired, "Sign in to Roblox first"))
}

/// Request as the ACTIVE account (cookie + CSRF handled). 401 marks the account expired.
pub async fn authed_json(
    app: &AppHandle,
    method: Method,
    host: &str,
    path_and_query: &str,
    body: Option<Value>,
) -> Result<Value> {
    let url = resolve(host, path_and_query)?;
    let user_id = active_user_id(app)?;
    if account::is_expired(app, user_id)? {
        return Err(AppError::new(
            ErrorCode::AuthExpired,
            "This account's Roblox session expired. Sign in again.",
        ));
    }
    let Some(cookie) = account::cookie_for(user_id)? else {
        account::mark_expired(app, user_id);
        return Err(AppError::new(ErrorCode::AuthExpired, "This account's Roblox session is missing. Sign in again."));
    };
    let result = send(Some(&cookie), Some(user_id), method, url, body).await;
    if matches!(&result, Err(e) if e.code == ErrorCode::AuthExpired) {
        account::mark_expired(app, user_id);
    }
    result
}

/// GET without any cookie, same host allowlist.
pub async fn public_json(app: &AppHandle, host: &str, path_and_query: &str) -> Result<Value> {
    let _ = app;
    send(None, None, Method::GET, resolve(host, path_and_query)?, None).await
}

/// Request with an explicit cookie (login / validating a stored account before it is active).
pub(crate) async fn json_with_cookie(
    cookie: &str,
    method: Method,
    host: &str,
    path_and_query: &str,
    body: Option<Value>,
) -> Result<Value> {
    send(Some(cookie), None, method, resolve(host, path_and_query)?, body).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_accepts_short_and_full_names() {
        assert_eq!(resolve("users", "/v1/users/1").unwrap().as_str(), "https://users.roblox.com/v1/users/1");
        assert_eq!(resolve("apis.roblox.com", "/x?a=b").unwrap().host_str(), Some("apis.roblox.com"));
        for h in HOSTS.iter().filter(|h| **h != "inventory") {
            assert!(resolve(h, "/v1/x").is_ok(), "{h}");
        }
    }

    #[test]
    fn inventory_host_only_serves_the_collectibles_listing() {
        assert!(resolve("inventory", "/v1/users/5/assets/collectibles?limit=50").is_ok());
        assert!(resolve("inventory", "/v2/users/5/inventory/8").is_err());
        assert!(resolve("inventory", "/v1/users/5/categories").is_err());
        assert!(resolve("inventory", "/v1/x").is_err());
    }

    #[test]
    fn allowlist_rejects_foreign_and_sensitive_hosts() {
        for h in [
            "auth", "auth.roblox.com", "premiumfeatures", "evil.com", "roblox.com", "users.roblox.com.evil.com",
            "users@evil.com", "users.roblox.com:8443", "evil.com/users", "", "trades", "catalog", "inventory",
        ] {
            assert!(resolve(h, "/v1/x").is_err(), "{h}");
        }
    }

    #[test]
    fn path_must_be_rooted_and_clean() {
        assert!(resolve("users", "v1/x").is_err());
        assert!(resolve("users", "//evil.com/x").is_err());
        assert!(resolve("users", "/a b").is_err());
        assert!(resolve("users", "/a\\b").is_err());
        assert!(resolve("users", "/a\r\nHost: x").is_err());
        // Whatever the path says, the host stays put.
        assert_eq!(resolve("users", "/@evil.com/x").unwrap().host_str(), Some("users.roblox.com"));
    }

    #[test]
    fn www_only_for_fixed_prefixes() {
        assert!(resolve("www.roblox.com", "/games/getgameinstancesjson?placeId=1").is_ok());
        assert!(resolve("www", "/private-servers/1").is_ok());
        assert!(resolve("www", "/my/account").is_err());
        assert!(resolve("www", "/games/../my/settings").is_err());
        assert!(resolve("www", "/login").is_err());
    }

    #[test]
    fn csrf_retry_only_for_stale_token_on_mutations() {
        let f = StatusCode::FORBIDDEN;
        // First attempt without a token: Roblox returns one -> retry with it.
        assert_eq!(csrf_retry_token(&Method::POST, f, None, Some("abc")).as_deref(), Some("abc"));
        // Stale token replaced.
        assert_eq!(csrf_retry_token(&Method::POST, f, Some("old"), Some("new")).as_deref(), Some("new"));
        // Same token echoed back = real permission error.
        assert_eq!(csrf_retry_token(&Method::POST, f, Some("abc"), Some("abc")), None);
        // No header, wrong status, empty header, GET.
        assert_eq!(csrf_retry_token(&Method::POST, f, None, None), None);
        assert_eq!(csrf_retry_token(&Method::POST, StatusCode::UNAUTHORIZED, None, Some("abc")), None);
        assert_eq!(csrf_retry_token(&Method::POST, f, None, Some("")), None);
        assert_eq!(csrf_retry_token(&Method::GET, f, None, Some("abc")), None);
        assert_eq!(csrf_retry_token(&Method::DELETE, f, None, Some("abc")).as_deref(), Some("abc"));
    }

    #[test]
    fn status_mapping() {
        assert!(status_error(StatusCode::OK, None).is_none());
        assert!(status_error(StatusCode::NO_CONTENT, None).is_none());
        assert_eq!(status_error(StatusCode::UNAUTHORIZED, None).unwrap().code, ErrorCode::AuthExpired);
        assert_eq!(status_error(StatusCode::TOO_MANY_REQUESTS, None).unwrap().code, ErrorCode::RateLimited);
        let e = status_error(StatusCode::BAD_REQUEST, Some("Already friends".into())).unwrap();
        assert_eq!(e.code, ErrorCode::HttpStatus);
        assert_eq!(e.message, "Already friends");
        assert!(status_error(StatusCode::FORBIDDEN, None).unwrap().message.contains("403"));
    }

    #[test]
    fn error_message_extraction() {
        let a = serde_json::json!({"errors":[{"code":5,"message":" Insufficient Robux "}]});
        assert_eq!(roblox_error_message(&a).as_deref(), Some("Insufficient Robux"));
        let b = serde_json::json!({"message":"Nope"});
        assert_eq!(roblox_error_message(&b).as_deref(), Some("Nope"));
        assert_eq!(roblox_error_message(&serde_json::json!({"errors":[]})), None);
        assert_eq!(roblox_error_message(&serde_json::json!({"message":"  "})), None);
    }
}
