//! Allowlisted access to Roblox's public web APIs. The webview cannot call these hosts (CORS), so
//! every request is described by an [`RbxRequest`], turned into a hard-coded URL here, cached in
//! SQLite and fetched with retry/backoff. This is deliberately not a generic proxy.

use std::future::Future;
use std::sync::LazyLock;
use std::time::Duration;

use rand::Rng;
use reqwest::{redirect, Client, StatusCode, Url};
use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::db::{cache_get, cache_put, now_ms, Db};
use crate::error::{AppError, ErrorCode, Result};

pub const ALLOWED_HOSTS: [&str; 7] = [
    "apis.roblox.com",
    "games.roblox.com",
    "thumbnails.roblox.com",
    "badges.roblox.com",
    "develop.roblox.com",
    "users.roblox.com",
    "groups.roblox.com",
];

const MAX_IDS: usize = 50;
const MAX_QUERY_CHARS: usize = 100;
const MAX_ATTEMPTS: u32 = 3;
const RETRY_AFTER_CAP: Duration = Duration::from_secs(5);
const USER_AGENT: &str = concat!("Muffin/", env!("CARGO_PKG_VERSION"));

const TTL_LIST: Duration = Duration::from_secs(120);
const TTL_DETAILS: Duration = Duration::from_secs(300);
const TTL_MEDIA: Duration = Duration::from_secs(3600);
/// Public server lists change every few seconds and are strictly rate limited.
const TTL_SERVERS: Duration = Duration::from_secs(20);
const TTL_VOTES: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum RbxRequest {
    Search { query: String },
    Sorts,
    SortContent { sort_id: String },
    UniverseForPlace { place_id: u64 },
    GameDetails { universe_ids: Vec<u64> },
    GameMedia { universe_id: u64 },
    GameIcons { universe_ids: Vec<u64> },
    GameThumbnails { universe_ids: Vec<u64> },
    Headshots { user_ids: Vec<u64> },
    // -- game details extras (all public, unauthenticated)
    PublicServers { place_id: u64, cursor: Option<String> },
    GameVotes { universe_ids: Vec<u64> },
    UniverseBadges { universe_id: u64, cursor: Option<String> },
    BadgeIcons { badge_ids: Vec<u64> },
    GamePasses { universe_id: u64, page_token: Option<String> },
    GamePassIcons { pass_ids: Vec<u64> },
    UniversePlaces { universe_id: u64, cursor: Option<String> },
    PlaceIcons { place_ids: Vec<u64> },
    // -- creator section
    /// `GET groups.roblox.com/v1/groups/{id}` → `{id, name, memberCount, hasVerifiedBadge, owner{…}, …}`.
    GroupInfo { group_id: u64 },
    /// `GET thumbnails.roblox.com/v1/groups/icons` → `data[].{targetId, imageUrl, state}`.
    GroupIcons { group_ids: Vec<u64> },
    // -- search extras
    Autocomplete { prefix: String },
    UserSearch { keyword: String },
}

/// Random id generated once per process; Roblox's search/explore endpoints expect a `sessionId`.
fn session_id() -> &'static str {
    static SESSION: LazyLock<String> = LazyLock::new(|| uuid::Uuid::new_v4().to_string());
    &SESSION
}

fn id(n: u64) -> Result<u64> {
    if n == 0 {
        Err(AppError::invalid("Ids must be non-zero"))
    } else {
        Ok(n)
    }
}

fn id_list(ids: &[u64]) -> Result<String> {
    if ids.is_empty() || ids.len() > MAX_IDS {
        return Err(AppError::invalid("Provide between 1 and 50 ids"));
    }
    let parts = ids
        .iter()
        .map(|&n| id(n).map(|n| n.to_string()))
        .collect::<Result<Vec<_>>>()?;
    Ok(parts.join(","))
}

/// `^[a-z0-9-]{1,40}$`
fn valid_sort_id(s: &str) -> bool {
    (1..=40).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn build(base: &str, pairs: &[(&str, &str)]) -> Result<Url> {
    let mut url = Url::parse(base).map_err(|e| AppError::invalid(format!("Bad URL: {e}")))?;
    if !pairs.is_empty() {
        url.query_pairs_mut().extend_pairs(pairs.iter().copied());
    }
    Ok(url)
}

/// Paging cursor / token as Roblox returns them: base64-ish, bounded.
pub(crate) fn valid_cursor(s: &str) -> bool {
    (1..=1024).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'=' | b'_' | b'-'))
}

/// Optional cursor → `(key, value)` pair, validated.
fn cursor_pair<'a>(key: &'a str, cursor: &'a Option<String>) -> Result<Option<(&'a str, &'a str)>> {
    match cursor.as_deref() {
        None => Ok(None),
        Some(c) if valid_cursor(c) => Ok(Some((key, c))),
        Some(_) => Err(AppError::invalid("Invalid paging cursor")),
    }
}

fn trimmed_text(s: &str, what: &str) -> Result<String> {
    let t = s.trim();
    if t.is_empty() || t.chars().count() > MAX_QUERY_CHARS {
        return Err(AppError::invalid(format!("{what} must be 1–100 characters")));
    }
    Ok(t.to_string())
}

impl RbxRequest {
    /// Canonical URL (used as the cache key). Never includes the per-process session id.
    pub fn url(&self) -> Result<Url> {
        const IMG: [(&str, &str); 2] = [("format", "Webp"), ("returnPolicy", "PlaceHolder")];
        match self {
            Self::Search { query } => {
                let q = query.trim();
                if q.is_empty() || q.chars().count() > MAX_QUERY_CHARS {
                    return Err(AppError::invalid("Search must be 1–100 characters"));
                }
                build(
                    "https://apis.roblox.com/search-api/omni-search",
                    &[("searchQuery", q)],
                )
            }
            Self::Sorts => build(
                "https://apis.roblox.com/explore-api/v1/get-sorts",
                &[("device", "computer"), ("country", "all")],
            ),
            Self::SortContent { sort_id } => {
                if !valid_sort_id(sort_id) {
                    return Err(AppError::invalid("Invalid sort id"));
                }
                build(
                    "https://apis.roblox.com/explore-api/v1/get-sort-content",
                    &[("sortId", sort_id), ("device", "computer"), ("country", "all")],
                )
            }
            Self::UniverseForPlace { place_id } => build(
                &format!(
                    "https://apis.roblox.com/universes/v1/places/{}/universe",
                    id(*place_id)?
                ),
                &[],
            ),
            Self::GameDetails { universe_ids } => build(
                "https://games.roblox.com/v1/games",
                &[("universeIds", &id_list(universe_ids)?)],
            ),
            Self::GameMedia { universe_id } => build(
                &format!("https://games.roblox.com/v2/games/{}/media", id(*universe_id)?),
                &[],
            ),
            Self::GameIcons { universe_ids } => build(
                "https://thumbnails.roblox.com/v1/games/icons",
                &[
                    ("universeIds", &id_list(universe_ids)?),
                    ("size", "256x256"),
                    IMG[0],
                    IMG[1],
                ],
            ),
            Self::GameThumbnails { universe_ids } => build(
                "https://thumbnails.roblox.com/v1/games/multiget/thumbnails",
                &[
                    ("universeIds", &id_list(universe_ids)?),
                    ("countPerUniverse", "6"),
                    ("size", "768x432"),
                    IMG[0],
                    IMG[1],
                    ("isCircular", "false"),
                ],
            ),
            Self::Headshots { user_ids } => build(
                "https://thumbnails.roblox.com/v1/users/avatar-headshot",
                &[
                    ("userIds", &id_list(user_ids)?),
                    ("size", "150x150"),
                    ("format", "Webp"),
                    ("isCircular", "false"),
                ],
            ),
            Self::PublicServers { place_id, cursor } => {
                let mut q = vec![("sortOrder", "Desc"), ("limit", "25")];
                q.extend(cursor_pair("cursor", cursor)?);
                build(
                    &format!(
                        "https://games.roblox.com/v1/games/{}/servers/Public",
                        id(*place_id)?
                    ),
                    &q,
                )
            }
            Self::GameVotes { universe_ids } => build(
                "https://games.roblox.com/v1/games/votes",
                &[("universeIds", &id_list(universe_ids)?)],
            ),
            Self::UniverseBadges { universe_id, cursor } => {
                let mut q = vec![("limit", "25"), ("sortOrder", "Asc")];
                q.extend(cursor_pair("cursor", cursor)?);
                build(
                    &format!(
                        "https://badges.roblox.com/v1/universes/{}/badges",
                        id(*universe_id)?
                    ),
                    &q,
                )
            }
            Self::BadgeIcons { badge_ids } => build(
                "https://thumbnails.roblox.com/v1/badges/icons",
                &[
                    ("badgeIds", &id_list(badge_ids)?),
                    ("size", "150x150"),
                    ("format", "Webp"),
                ],
            ),
            Self::GamePasses { universe_id, page_token } => {
                let mut q = vec![("passView", "Full"), ("pageSize", "25")];
                q.extend(cursor_pair("pageToken", page_token)?);
                build(
                    &format!(
                        "https://apis.roblox.com/game-passes/v1/universes/{}/game-passes",
                        id(*universe_id)?
                    ),
                    &q,
                )
            }
            Self::GamePassIcons { pass_ids } => build(
                "https://thumbnails.roblox.com/v1/game-passes",
                &[
                    ("gamePassIds", &id_list(pass_ids)?),
                    ("size", "150x150"),
                    ("format", "Webp"),
                ],
            ),
            Self::UniversePlaces { universe_id, cursor } => {
                let mut q = vec![("limit", "50"), ("sortOrder", "Asc")];
                q.extend(cursor_pair("cursor", cursor)?);
                build(
                    &format!(
                        "https://develop.roblox.com/v1/universes/{}/places",
                        id(*universe_id)?
                    ),
                    &q,
                )
            }
            Self::PlaceIcons { place_ids } => build(
                "https://thumbnails.roblox.com/v1/places/gameicons",
                &[
                    ("placeIds", &id_list(place_ids)?),
                    ("size", "150x150"),
                    IMG[0],
                    IMG[1],
                ],
            ),
            Self::Autocomplete { prefix } => {
                let p = trimmed_text(prefix, "Search")?;
                if p.trim_matches('.').is_empty() {
                    return Err(AppError::invalid("Invalid search text"));
                }
                let mut url = build("https://apis.roblox.com/games-autocomplete/v1/get-suggestion", &[])?;
                // The prefix is a single, percent-encoded path segment (a `/` cannot escape it).
                url.path_segments_mut()
                    .map_err(|_| AppError::invalid("Bad URL"))?
                    .push(&p);
                Ok(url)
            }
            Self::UserSearch { keyword } => build(
                "https://users.roblox.com/v1/users/search",
                &[("keyword", &trimmed_text(keyword, "Search")?), ("limit", "10")],
            ),
            Self::GroupInfo { group_id } => build(
                &format!("https://groups.roblox.com/v1/groups/{}", id(*group_id)?),
                &[],
            ),
            Self::GroupIcons { group_ids } => build(
                "https://thumbnails.roblox.com/v1/groups/icons",
                &[
                    ("groupIds", &id_list(group_ids)?),
                    ("size", "150x150"),
                    ("format", "Webp"),
                ],
            ),
        }
    }

    fn needs_session(&self) -> bool {
        matches!(
            self,
            Self::Search { .. } | Self::Sorts | Self::SortContent { .. }
        )
    }

    /// The URL actually requested: canonical URL plus `sessionId` where Roblox expects it.
    pub fn fetch_url(&self) -> Result<Url> {
        let mut url = self.url()?;
        if self.needs_session() {
            url.query_pairs_mut().append_pair("sessionId", session_id());
        }
        Ok(url)
    }

    fn ttl(&self) -> Duration {
        match self {
            Self::Search { .. } | Self::Sorts | Self::SortContent { .. } => TTL_LIST,
            Self::UniverseForPlace { .. } | Self::GameDetails { .. } => TTL_DETAILS,
            Self::GameMedia { .. }
            | Self::GameIcons { .. }
            | Self::GameThumbnails { .. }
            | Self::Headshots { .. } => TTL_MEDIA,
            Self::PublicServers { .. } => TTL_SERVERS,
            Self::GameVotes { .. } => TTL_VOTES,
            Self::UniverseBadges { .. }
            | Self::GamePasses { .. }
            | Self::UniversePlaces { .. }
            | Self::GroupInfo { .. } => TTL_DETAILS,
            Self::BadgeIcons { .. }
            | Self::GamePassIcons { .. }
            | Self::PlaceIcons { .. }
            | Self::GroupIcons { .. } => TTL_MEDIA,
            Self::Autocomplete { .. } | Self::UserSearch { .. } => TTL_LIST,
        }
    }
}

/// Shared HTTP client: 10 s timeout, Muffin UA, redirects only within the allowlist.
pub fn build_client() -> Result<Client> {
    let policy = redirect::Policy::custom(|attempt| {
        let allowed = attempt
            .url()
            .host_str()
            .is_some_and(|h| ALLOWED_HOSTS.contains(&h));
        if allowed && attempt.url().scheme() == "https" && attempt.previous().len() < 3 {
            attempt.follow()
        } else {
            attempt.stop()
        }
    });
    Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(5))
        .redirect(policy)
        .build()
        .map_err(|e| AppError::new(ErrorCode::Network, format!("Couldn't create HTTP client: {e}")))
}

fn backoff(attempt: u32) -> Duration {
    let jitter = rand::thread_rng().gen_range(0..200u64);
    Duration::from_millis(400 * (1u64 << attempt) + jitter)
}

fn retry_after(resp: &reqwest::Response) -> Duration {
    resp.headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
        .map(Duration::from_secs)
        .unwrap_or(Duration::from_secs(1))
        .min(RETRY_AFTER_CAP)
}

async fn fetch_text(client: &Client, url: Url) -> Result<String> {
    let mut attempt = 0;
    loop {
        let last = attempt + 1 >= MAX_ATTEMPTS;
        match client.get(url.clone()).send().await {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    return Ok(resp.text().await?);
                }
                if status == StatusCode::TOO_MANY_REQUESTS {
                    if last {
                        return Err(AppError::new(
                            ErrorCode::RateLimited,
                            "Roblox is rate limiting requests — try again in a moment",
                        ));
                    }
                    tokio::time::sleep(retry_after(&resp)).await;
                } else if status.is_server_error() && !last {
                    tokio::time::sleep(backoff(attempt)).await;
                } else {
                    return Err(AppError::new(
                        ErrorCode::HttpStatus,
                        format!("Roblox returned HTTP {}", status.as_u16()),
                    ));
                }
            }
            Err(e) => {
                if last {
                    return Err(e.into());
                }
                tokio::time::sleep(backoff(attempt)).await;
            }
        }
        attempt += 1;
    }
}

/// Searches run as the active signed-in account when there is one: Roblox only returns age-restricted
/// (17+/18+) experiences and personalised ranking to a session. Returns `None` for guests/expired
/// accounts and for every non-search request.
fn search_user(app: &AppHandle, req: &RbxRequest) -> Option<u64> {
    if !matches!(req, RbxRequest::Search { .. }) {
        return None;
    }
    let id = crate::account::active_account_id(app).ok().flatten()?;
    (!crate::account::is_expired(app, id).unwrap_or(true)).then_some(id)
}

/// Cached fetch. `fetch` produces the fresh body; `key` is the cache key (account-scoped for signed-in searches).
async fn get_cached<F>(db: &Db, key: String, ttl: Duration, fetch: F) -> Result<Value>
where
    F: Future<Output = Result<(Value, String)>>,
{
    let ttl_ms = ttl.as_millis() as i64;
    let cached = db.with(|c| cache_get(c, &key)).unwrap_or_else(|e| {
        eprintln!("muffin: api cache read failed: {e}");
        None
    });
    if let Some((body, fetched_at)) = &cached {
        if now_ms() - fetched_at < ttl_ms {
            if let Ok(v) = serde_json::from_str::<Value>(body) {
                return Ok(v);
            }
        }
    }
    match fetch.await {
        Ok((value, text)) => {
            if let Err(e) = db.with(|c| cache_put(c, &key, &text, now_ms())) {
                eprintln!("muffin: api cache write failed: {e}");
            }
            Ok(value)
        }
        // Stale data beats an error (offline start-up, flaky network).
        Err(err) => match cached.and_then(|(body, _)| serde_json::from_str(&body).ok()) {
            Some(stale) => Ok(stale),
            None => Err(err),
        },
    }
}

async fn guest_fetch(client: &Client, req: &RbxRequest) -> Result<(Value, String)> {
    let text = fetch_text(client, req.fetch_url()?).await?;
    let value: Value = serde_json::from_str(&text)?;
    Ok((value, text))
}

#[tauri::command]
pub async fn rbx_get(
    app: AppHandle,
    db: State<'_, Db>,
    client: State<'_, Client>,
    req: RbxRequest,
) -> Result<Value> {
    let base = req.url()?;
    if let Some(user_id) = search_user(&app, &req) {
        let key = format!("{base}#u{user_id}");
        let signed_in = async {
            let url = req.fetch_url()?;
            let pq = format!("{}?{}", url.path(), url.query().unwrap_or_default());
            let value = crate::rbx_session::authed_json(&app, reqwest::Method::GET, "apis.roblox.com", &pq, None).await?;
            let text = value.to_string();
            Ok((value, text))
        };
        // A failing session (expired, offline) falls back to the guest search instead of an error.
        return match get_cached(&db, key, req.ttl(), signed_in).await {
            Ok(v) => Ok(v),
            Err(_) => get_cached(&db, base.to_string(), req.ttl(), guest_fetch(&client, &req)).await,
        };
    }
    get_cached(&db, base.to_string(), req.ttl(), guest_fetch(&client, &req)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> RbxRequest {
        serde_json::from_str(json).unwrap()
    }

    fn pairs(url: &Url) -> Vec<(String, String)> {
        url.query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect()
    }

    fn get(url: &Url, key: &str) -> Option<String> {
        pairs(url).into_iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    #[test]
    fn deserializes_contract_shapes() {
        assert!(matches!(parse(r#"{"kind":"sorts"}"#), RbxRequest::Sorts));
        assert!(matches!(
            parse(r#"{"kind":"sortContent","sortId":"top-trending"}"#),
            RbxRequest::SortContent { .. }
        ));
        assert!(matches!(
            parse(r#"{"kind":"universeForPlace","placeId":5}"#),
            RbxRequest::UniverseForPlace { place_id: 5 }
        ));
        assert!(matches!(
            parse(r#"{"kind":"gameDetails","universeIds":[1,2]}"#),
            RbxRequest::GameDetails { .. }
        ));
        assert!(matches!(
            parse(r#"{"kind":"headshots","userIds":[1]}"#),
            RbxRequest::Headshots { .. }
        ));
        assert!(serde_json::from_str::<RbxRequest>(r#"{"kind":"other"}"#).is_err());
    }

    #[test]
    fn every_url_stays_on_allowlisted_https_hosts() {
        let reqs = [
            RbxRequest::Search { query: "blox".into() },
            RbxRequest::Sorts,
            RbxRequest::SortContent { sort_id: "top-trending".into() },
            RbxRequest::UniverseForPlace { place_id: 1 },
            RbxRequest::GameDetails { universe_ids: vec![1, 2] },
            RbxRequest::GameMedia { universe_id: 1 },
            RbxRequest::GameIcons { universe_ids: vec![1] },
            RbxRequest::GameThumbnails { universe_ids: vec![1] },
            RbxRequest::Headshots { user_ids: vec![1] },
        ];
        for r in reqs {
            let u = r.fetch_url().unwrap();
            assert_eq!(u.scheme(), "https", "{u}");
            assert!(ALLOWED_HOSTS.contains(&u.host_str().unwrap()), "{u}");
            assert_eq!(u.port(), None);
        }
    }

    #[test]
    fn search_url_encodes_and_trims_query() {
        let u = RbxRequest::Search { query: "  a&b=c d ".into() }.url().unwrap();
        assert_eq!(u.path(), "/search-api/omni-search");
        assert_eq!(pairs(&u).len(), 1);
        assert_eq!(get(&u, "searchQuery").as_deref(), Some("a&b=c d"));
        assert!(!u.query().unwrap().contains("a&b"));
    }

    #[test]
    fn search_rejects_empty_and_overlong() {
        assert!(RbxRequest::Search { query: "   ".into() }.url().is_err());
        assert!(RbxRequest::Search { query: String::new() }.url().is_err());
        assert!(RbxRequest::Search { query: "x".repeat(101) }.url().is_err());
        assert!(RbxRequest::Search { query: "x".repeat(100) }.url().is_ok());
        // 100 multi-byte chars are fine: the limit counts characters.
        assert!(RbxRequest::Search { query: "é".repeat(100) }.url().is_ok());
    }

    #[test]
    fn sort_id_validation() {
        for ok in ["top-trending", "a", "up-and-coming", "x9-0"] {
            assert!(RbxRequest::SortContent { sort_id: ok.into() }.url().is_ok(), "{ok}");
        }
        for bad in ["", "Top", "a b", "a_b", "../x", "a/b", "a?b=1", "a&b", &"a".repeat(41)] {
            assert!(
                RbxRequest::SortContent { sort_id: bad.into() }.url().is_err(),
                "{bad}"
            );
        }
    }

    #[test]
    fn id_validation() {
        assert!(RbxRequest::UniverseForPlace { place_id: 0 }.url().is_err());
        assert!(RbxRequest::GameMedia { universe_id: 0 }.url().is_err());
        assert!(RbxRequest::GameDetails { universe_ids: vec![] }.url().is_err());
        assert!(RbxRequest::GameDetails { universe_ids: vec![1, 0] }.url().is_err());
        assert!(RbxRequest::Headshots { user_ids: vec![0] }.url().is_err());
        assert!(RbxRequest::GameIcons { universe_ids: (1..=50).collect() }.url().is_ok());
        assert!(RbxRequest::GameIcons { universe_ids: (1..=51).collect() }.url().is_err());
    }

    #[test]
    fn fixed_sizes_and_params() {
        let icons = RbxRequest::GameIcons { universe_ids: vec![7, 8] }.url().unwrap();
        assert_eq!(get(&icons, "universeIds").as_deref(), Some("7,8"));
        assert_eq!(get(&icons, "size").as_deref(), Some("256x256"));
        assert_eq!(get(&icons, "format").as_deref(), Some("Webp"));
        assert_eq!(get(&icons, "returnPolicy").as_deref(), Some("PlaceHolder"));

        let thumbs = RbxRequest::GameThumbnails { universe_ids: vec![7] }.url().unwrap();
        assert_eq!(thumbs.path(), "/v1/games/multiget/thumbnails");
        assert_eq!(get(&thumbs, "size").as_deref(), Some("768x432"));
        assert_eq!(get(&thumbs, "countPerUniverse").as_deref(), Some("6"));
        assert_eq!(get(&thumbs, "isCircular").as_deref(), Some("false"));

        let head = RbxRequest::Headshots { user_ids: vec![3] }.url().unwrap();
        assert_eq!(head.path(), "/v1/users/avatar-headshot");
        assert_eq!(get(&head, "size").as_deref(), Some("150x150"));

        let sort = RbxRequest::SortContent { sort_id: "top-trending".into() }.url().unwrap();
        assert_eq!(get(&sort, "device").as_deref(), Some("computer"));
        assert_eq!(get(&sort, "country").as_deref(), Some("all"));

        let uni = RbxRequest::UniverseForPlace { place_id: 920587237 }.url().unwrap();
        assert_eq!(uni.path(), "/universes/v1/places/920587237/universe");
        let media = RbxRequest::GameMedia { universe_id: 12 }.url().unwrap();
        assert_eq!(media.path(), "/v2/games/12/media");
    }

    #[test]
    fn session_id_only_on_search_and_explore_and_not_in_cache_key() {
        let search = RbxRequest::Search { query: "x".into() };
        assert_eq!(get(&search.fetch_url().unwrap(), "sessionId").as_deref(), Some(session_id()));
        assert!(get(&search.url().unwrap(), "sessionId").is_none());
        assert!(get(&RbxRequest::Sorts.fetch_url().unwrap(), "sessionId").is_some());
        assert!(get(
            &RbxRequest::GameDetails { universe_ids: vec![1] }.fetch_url().unwrap(),
            "sessionId"
        )
        .is_none());
        // Session id is a UUID and stable within the process.
        assert!(uuid::Uuid::parse_str(session_id()).is_ok());
        assert_eq!(session_id(), session_id());
    }

    #[test]
    fn ttl_buckets() {
        assert_eq!(RbxRequest::Sorts.ttl(), Duration::from_secs(120));
        assert_eq!(RbxRequest::Search { query: "x".into() }.ttl(), Duration::from_secs(120));
        assert_eq!(RbxRequest::UniverseForPlace { place_id: 1 }.ttl(), Duration::from_secs(300));
        assert_eq!(RbxRequest::GameDetails { universe_ids: vec![1] }.ttl(), Duration::from_secs(300));
        assert_eq!(RbxRequest::GameMedia { universe_id: 1 }.ttl(), Duration::from_secs(3600));
        assert_eq!(RbxRequest::Headshots { user_ids: vec![1] }.ttl(), Duration::from_secs(3600));
    }

    #[test]
    fn game_extras_deserialize_with_optional_cursor() {
        assert!(matches!(
            parse(r#"{"kind":"publicServers","placeId":5}"#),
            RbxRequest::PublicServers { place_id: 5, cursor: None }
        ));
        assert!(matches!(
            parse(r#"{"kind":"publicServers","placeId":5,"cursor":null}"#),
            RbxRequest::PublicServers { cursor: None, .. }
        ));
        assert!(matches!(
            parse(r#"{"kind":"gamePasses","universeId":5,"pageToken":"id_abc"}"#),
            RbxRequest::GamePasses { page_token: Some(_), .. }
        ));
        assert!(matches!(
            parse(r#"{"kind":"autocomplete","prefix":"blox"}"#),
            RbxRequest::Autocomplete { .. }
        ));
    }

    #[test]
    fn game_extra_urls_match_verified_public_endpoints() {
        let u = RbxRequest::PublicServers { place_id: 920587237, cursor: None }.url().unwrap();
        assert_eq!(u.host_str(), Some("games.roblox.com"));
        assert_eq!(u.path(), "/v1/games/920587237/servers/Public");
        assert_eq!(get(&u, "sortOrder").as_deref(), Some("Desc"));
        assert_eq!(get(&u, "limit").as_deref(), Some("25"));
        assert_eq!(get(&u, "cursor"), None);

        let u = RbxRequest::PublicServers { place_id: 1, cursor: Some("ab+/=_-9".into()) }.url().unwrap();
        assert_eq!(get(&u, "cursor").as_deref(), Some("ab+/=_-9"));

        let u = RbxRequest::GameVotes { universe_ids: vec![383310974, 994732206] }.url().unwrap();
        assert_eq!(u.path(), "/v1/games/votes");
        assert_eq!(get(&u, "universeIds").as_deref(), Some("383310974,994732206"));

        let u = RbxRequest::UniverseBadges { universe_id: 9, cursor: None }.url().unwrap();
        assert_eq!(u.host_str(), Some("badges.roblox.com"));
        assert_eq!(u.path(), "/v1/universes/9/badges");
        // Roblox only accepts limit ∈ {10, 25, 50, 100}.
        assert_eq!(get(&u, "limit").as_deref(), Some("25"));

        let u = RbxRequest::BadgeIcons { badge_ids: vec![1, 2] }.url().unwrap();
        assert_eq!(u.path(), "/v1/badges/icons");
        assert_eq!(get(&u, "size").as_deref(), Some("150x150"));

        let u = RbxRequest::GamePasses { universe_id: 9, page_token: None }.url().unwrap();
        assert_eq!(u.host_str(), Some("apis.roblox.com"));
        assert_eq!(u.path(), "/game-passes/v1/universes/9/game-passes");
        assert_eq!(get(&u, "pageSize").as_deref(), Some("25"));

        let u = RbxRequest::GamePassIcons { pass_ids: vec![3] }.url().unwrap();
        assert_eq!(u.path(), "/v1/game-passes");
        assert_eq!(get(&u, "gamePassIds").as_deref(), Some("3"));

        let u = RbxRequest::UniversePlaces { universe_id: 9, cursor: None }.url().unwrap();
        assert_eq!(u.host_str(), Some("develop.roblox.com"));
        assert_eq!(u.path(), "/v1/universes/9/places");

        let u = RbxRequest::PlaceIcons { place_ids: vec![4, 5] }.url().unwrap();
        assert_eq!(u.path(), "/v1/places/gameicons");
        assert_eq!(get(&u, "placeIds").as_deref(), Some("4,5"));

        let u = RbxRequest::UserSearch { keyword: " builderman ".into() }.url().unwrap();
        assert_eq!(u.host_str(), Some("users.roblox.com"));
        assert_eq!(u.path(), "/v1/users/search");
        assert_eq!(get(&u, "keyword").as_deref(), Some("builderman"));
        assert_eq!(get(&u, "limit").as_deref(), Some("10"));
    }

    #[test]
    fn game_extras_stay_on_allowlisted_https_hosts() {
        let reqs = [
            RbxRequest::PublicServers { place_id: 1, cursor: None },
            RbxRequest::GameVotes { universe_ids: vec![1] },
            RbxRequest::UniverseBadges { universe_id: 1, cursor: None },
            RbxRequest::BadgeIcons { badge_ids: vec![1] },
            RbxRequest::GamePasses { universe_id: 1, page_token: None },
            RbxRequest::GamePassIcons { pass_ids: vec![1] },
            RbxRequest::UniversePlaces { universe_id: 1, cursor: None },
            RbxRequest::PlaceIcons { place_ids: vec![1] },
            RbxRequest::Autocomplete { prefix: "blox".into() },
            RbxRequest::UserSearch { keyword: "bob".into() },
        ];
        for r in reqs {
            let u = r.fetch_url().unwrap();
            assert_eq!(u.scheme(), "https", "{u}");
            assert!(ALLOWED_HOSTS.contains(&u.host_str().unwrap()), "{u}");
            assert_eq!(u.port(), None);
        }
    }

    #[test]
    fn game_extras_reject_bad_ids_and_cursors() {
        assert!(RbxRequest::PublicServers { place_id: 0, cursor: None }.url().is_err());
        assert!(RbxRequest::UniverseBadges { universe_id: 0, cursor: None }.url().is_err());
        assert!(RbxRequest::GamePasses { universe_id: 0, page_token: None }.url().is_err());
        assert!(RbxRequest::BadgeIcons { badge_ids: vec![] }.url().is_err());
        assert!(RbxRequest::PlaceIcons { place_ids: vec![1, 0] }.url().is_err());
        for bad in ["", "a b", "a&limit=1", "../x", "a\nb", &"a".repeat(1025)] {
            assert!(
                RbxRequest::PublicServers { place_id: 1, cursor: Some(bad.into()) }.url().is_err(),
                "{bad:?}"
            );
            assert!(
                RbxRequest::GamePasses { universe_id: 1, page_token: Some(bad.into()) }.url().is_err(),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn autocomplete_prefix_is_one_encoded_path_segment() {
        let u = RbxRequest::Autocomplete { prefix: " blox fruits ".into() }.url().unwrap();
        assert_eq!(u.path(), "/games-autocomplete/v1/get-suggestion/blox%20fruits");
        let u = RbxRequest::Autocomplete { prefix: "a/b?c#d".into() }.url().unwrap();
        assert_eq!(u.path_segments().unwrap().count(), 4, "{u}");
        assert!(u.query().is_none() && u.fragment().is_none(), "{u}");
        for bad in ["", "   ", ".", "..", "...", &"x".repeat(101)] {
            assert!(RbxRequest::Autocomplete { prefix: bad.into() }.url().is_err(), "{bad:?}");
        }
        assert!(RbxRequest::UserSearch { keyword: "  ".into() }.url().is_err());
    }

    #[test]
    fn creator_section_urls_use_groups_host_and_stay_allowlisted() {
        assert!(ALLOWED_HOSTS.contains(&"groups.roblox.com"));
        let u = RbxRequest::GroupInfo { group_id: 295182 }.fetch_url().unwrap();
        assert_eq!(u.scheme(), "https");
        assert_eq!(u.host_str(), Some("groups.roblox.com"));
        assert_eq!(u.path(), "/v1/groups/295182");
        assert!(u.query().is_none());

        let u = RbxRequest::GroupIcons { group_ids: vec![295182] }.fetch_url().unwrap();
        assert_eq!(u.host_str(), Some("thumbnails.roblox.com"));
        assert_eq!(u.path(), "/v1/groups/icons");
        assert_eq!(get(&u, "groupIds").as_deref(), Some("295182"));
        assert_eq!(get(&u, "size").as_deref(), Some("150x150"));

        assert!(RbxRequest::GroupInfo { group_id: 0 }.url().is_err());
        assert!(RbxRequest::GroupIcons { group_ids: vec![] }.url().is_err());
        assert!(matches!(
            parse(r#"{"kind":"groupInfo","groupId":5}"#),
            RbxRequest::GroupInfo { group_id: 5 }
        ));
        assert_eq!(RbxRequest::GroupInfo { group_id: 1 }.ttl(), Duration::from_secs(300));
        assert_eq!(RbxRequest::GroupIcons { group_ids: vec![1] }.ttl(), Duration::from_secs(3600));
    }

    #[test]
    fn game_extras_ttls() {
        assert_eq!(RbxRequest::PublicServers { place_id: 1, cursor: None }.ttl(), Duration::from_secs(20));
        assert_eq!(RbxRequest::GameVotes { universe_ids: vec![1] }.ttl(), Duration::from_secs(60));
        assert_eq!(
            RbxRequest::UniverseBadges { universe_id: 1, cursor: None }.ttl(),
            Duration::from_secs(300)
        );
        assert_eq!(RbxRequest::BadgeIcons { badge_ids: vec![1] }.ttl(), Duration::from_secs(3600));
    }

    #[test]
    fn backoff_grows_exponentially_with_bounded_jitter() {
        let b0 = backoff(0).as_millis();
        let b1 = backoff(1).as_millis();
        assert!((400..600).contains(&b0), "{b0}");
        assert!((800..1000).contains(&b1), "{b1}");
    }
}
