//! Game-related actions that need the signed-in Roblox web session (vote state, voting, which badges
//! the user earned, social links) plus the one safe way for the UI to open an external link.
//! All HTTP goes through `rbx_session::authed_json` (fixed host allowlist, active account's cookie).

use reqwest::Method;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::error::{AppError, ErrorCode, Result};
use crate::rbx_session;

const MAX_BADGE_IDS: usize = 100;

/// Hosts the UI may open in the browser (social links and roblox.com pages). A host matches when it
/// equals an entry or is a subdomain of it.
const EXTERNAL_HOSTS: [&str; 9] = [
    "discord.gg",
    "discord.com",
    "twitter.com",
    "x.com",
    "youtube.com",
    "twitch.tv",
    "facebook.com",
    "roblox.com",
    "guilded.gg",
];

fn id(n: u64, what: &str) -> Result<u64> {
    if n == 0 || n > crate::launch::MAX_PLACE_ID {
        Err(AppError::invalid(format!("Invalid {what} id")))
    } else {
        Ok(n)
    }
}

// ---- external links --------------------------------------------------------------------------

fn host_allowed(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    EXTERNAL_HOSTS
        .iter()
        .any(|d| host == *d || host.strip_suffix(d).is_some_and(|rest| rest.ends_with('.')))
}

/// `https` only, no credentials / custom port, host on [`EXTERNAL_HOSTS`].
pub fn check_external_url(input: &str) -> Result<url::Url> {
    let bad = || AppError::invalid("Muffin only opens https links to Roblox and its social sites");
    let url = url::Url::parse(input.trim()).map_err(|_| bad())?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !url.host_str().is_some_and(host_allowed)
    {
        return Err(bad());
    }
    Ok(url)
}

/// Opens an allowlisted https link in the default browser.
#[tauri::command(async)]
pub fn open_external(url: String) -> Result<()> {
    let url = check_external_url(&url)?;
    tauri_plugin_opener::open_url(url.as_str(), None::<&str>)
        .map_err(|e| AppError::new(ErrorCode::LaunchFailed, format!("Couldn't open the link: {e}")))
}

// ---- votes -----------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoteState {
    pub can_vote: bool,
    /// `Some(true)` = thumbs up, `Some(false)` = thumbs down, `None` = no vote.
    pub user_vote: Option<bool>,
    /// Why voting is unavailable (e.g. "PlayGame": play the game first), when Roblox says so.
    pub reason: Option<String>,
}

pub fn parse_vote_state(v: &Value) -> VoteState {
    VoteState {
        can_vote: v.get("canVote").and_then(Value::as_bool).unwrap_or(false),
        user_vote: v.get("userVote").and_then(Value::as_bool),
        reason: v
            .get("reasonForNotVoteable")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_owned),
    }
}

/// The signed-in user's vote on a universe. // UNVERIFIED live (needs a session)
#[tauri::command]
pub async fn game_vote_state(app: AppHandle, universe_id: u64) -> Result<VoteState> {
    let universe_id = id(universe_id, "game")?;
    let v = rbx_session::authed_json(
        &app,
        Method::GET,
        "games.roblox.com",
        &format!("/v1/games/{universe_id}/votes/user"),
        None,
    )
    .await?;
    Ok(parse_vote_state(&v))
}

/// Casts an up (`true`) or down (`false`) vote. Returns the new state. // UNVERIFIED live
#[tauri::command]
pub async fn game_vote(app: AppHandle, universe_id: u64, up: bool) -> Result<VoteState> {
    let universe_id = id(universe_id, "game")?;
    rbx_session::authed_json(
        &app,
        Method::PATCH,
        "games.roblox.com",
        &format!("/v1/games/{universe_id}/user-votes"),
        Some(json!({ "vote": up })),
    )
    .await?;
    Ok(VoteState { can_vote: true, user_vote: Some(up), reason: None })
}

// ---- badges ----------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AwardedBadge {
    pub badge_id: u64,
    pub awarded_date: Option<String>,
}

fn badge_ids_csv(ids: &[u64]) -> Result<String> {
    if ids.is_empty() || ids.len() > MAX_BADGE_IDS {
        return Err(AppError::invalid("Provide between 1 and 100 badge ids"));
    }
    let parts = ids
        .iter()
        .map(|&n| id(n, "badge").map(|n| n.to_string()))
        .collect::<Result<Vec<_>>>()?;
    Ok(parts.join(","))
}

pub fn parse_awarded(v: &Value) -> Vec<AwardedBadge> {
    v.get("data")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|r| {
                    Some(AwardedBadge {
                        badge_id: r.get("badgeId")?.as_u64()?,
                        awarded_date: r.get("awardedDate").and_then(Value::as_str).map(str::to_owned),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Which of `badge_ids` the signed-in user has earned. // UNVERIFIED live (needs a session)
#[tauri::command]
pub async fn badges_awarded(app: AppHandle, badge_ids: Vec<u64>) -> Result<Vec<AwardedBadge>> {
    let csv = badge_ids_csv(&badge_ids)?;
    let user_id = rbx_session::active_user_id(&app)?;
    let v = rbx_session::authed_json(
        &app,
        Method::GET,
        "badges.roblox.com",
        &format!("/v1/users/{user_id}/badges/awarded-dates?badgeIds={csv}"),
        None,
    )
    .await?;
    Ok(parse_awarded(&v))
}

// ---- social links ----------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SocialLink {
    pub title: String,
    /// Roblox's type name (Facebook, Twitter, YouTube, Twitch, Discord, Guilded, RobloxGroup, Amazon).
    pub kind: String,
    pub url: String,
}

/// Keeps only links `open_external` would accept, so every returned link is openable.
pub fn parse_social_links(v: &Value) -> Vec<SocialLink> {
    v.get("data")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|r| {
                    let url = check_external_url(r.get("url")?.as_str()?).ok()?;
                    let kind = r.get("type").and_then(Value::as_str).unwrap_or("Link").to_owned();
                    let title = r
                        .get("title")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|t| !t.is_empty())
                        .unwrap_or(&kind)
                        .to_owned();
                    Some(SocialLink { title, kind, url: url.into() })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Social links of a universe (Roblox requires a session for this list). // UNVERIFIED live
#[tauri::command]
pub async fn game_social_links(app: AppHandle, universe_id: u64) -> Result<Vec<SocialLink>> {
    let universe_id = id(universe_id, "game")?;
    let v = rbx_session::authed_json(
        &app,
        Method::GET,
        "games.roblox.com",
        &format!("/v1/games/{universe_id}/social-links/list"),
        None,
    )
    .await?;
    Ok(parse_social_links(&v))
}

// ---- recommendations -------------------------------------------------------------------------

const MAX_RECOMMENDED: usize = 24;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendedGame {
    pub universe_id: u64,
    pub place_id: u64,
    pub name: String,
    pub player_count: Option<u64>,
    pub up_votes: Option<u64>,
    pub down_votes: Option<u64>,
    pub creator: Option<String>,
}

/// `GET games.roblox.com/v1/games/recommendations/game/{universeId}?maxRows&isTruncated` →
/// `{games:[{universeId, placeId, name, playerCount, totalUpVotes, totalDownVotes, creatorName,
/// creatorId, creatorType, creatorHasVerifiedBadge, isSponsored, imageToken, …}], nextPaginationKey}`.
/// Verified live only for the guest shape (`{"games":[],"nextPaginationKey":null}`); the row fields
/// above are Roblox's documented shape. // UNVERIFIED live (rows need a session)
/// Sponsored rows (ads) and rows missing an id or name are dropped.
pub fn parse_recommendations(v: &Value) -> Vec<RecommendedGame> {
    v.get("games")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter(|r| r.get("isSponsored").and_then(Value::as_bool) != Some(true))
                .filter_map(|r| {
                    let name = r.get("name")?.as_str()?.trim();
                    let (universe_id, place_id) = (r.get("universeId")?.as_u64()?, r.get("placeId")?.as_u64()?);
                    if name.is_empty() || universe_id == 0 || place_id == 0 || place_id > crate::launch::MAX_PLACE_ID {
                        return None;
                    }
                    Some(RecommendedGame {
                        universe_id,
                        place_id,
                        name: name.to_owned(),
                        player_count: r.get("playerCount").and_then(Value::as_u64),
                        up_votes: r.get("totalUpVotes").and_then(Value::as_u64),
                        down_votes: r.get("totalDownVotes").and_then(Value::as_u64),
                        creator: r
                            .get("creatorName")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(str::to_owned),
                    })
                })
                .take(MAX_RECOMMENDED)
                .collect()
        })
        .unwrap_or_default()
}

/// Roblox's "recommended / more like this" games for a universe. Roblox returns an empty list to
/// guests, so this uses the active account's session. // UNVERIFIED live
#[tauri::command]
pub async fn game_recommendations(app: AppHandle, universe_id: u64) -> Result<Vec<RecommendedGame>> {
    let universe_id = id(universe_id, "game")?;
    let v = rbx_session::authed_json(
        &app,
        Method::GET,
        "games.roblox.com",
        &format!("/v1/games/recommendations/game/{universe_id}?maxRows={MAX_RECOMMENDED}&isTruncated=false"),
        None,
    )
    .await?;
    Ok(parse_recommendations(&v))
}

// ---- game passes (as the signed-in user) -----------------------------------------------------

/// `/game-passes/v1/universes/{id}/game-passes` path + query. Same endpoint the public list uses
/// (`RbxRequest::GamePasses`); with a session each pass carries the real `isOwned` flag
/// (guests always get `isOwned:false`, verified live).
fn passes_path(universe_id: u64, page_token: Option<&str>) -> Result<String> {
    let mut path = format!("/game-passes/v1/universes/{universe_id}/game-passes?passView=Full&pageSize=25");
    if let Some(t) = page_token {
        if !crate::roblox_api::valid_cursor(t) {
            return Err(AppError::invalid("Invalid paging cursor"));
        }
        path.push_str("&pageToken=");
        path.push_str(t);
    }
    Ok(path)
}

/// One page of a universe's game passes with ownership for the active account (raw Roblox JSON,
/// parsed by the UI exactly like the public list). // UNVERIFIED live (needs a session)
#[tauri::command]
pub async fn game_passes_session(app: AppHandle, universe_id: u64, page_token: Option<String>) -> Result<Value> {
    let universe_id = id(universe_id, "game")?;
    let path = passes_path(universe_id, page_token.as_deref())?;
    rbx_session::authed_json(&app, Method::GET, "apis.roblox.com", &path, None).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_urls_allow_only_https_on_listed_hosts() {
        for ok in [
            "https://discord.gg/abc123",
            "https://discord.com/invite/abc",
            "https://www.youtube.com/@channel",
            "https://twitter.com/roblox",
            "https://x.com/roblox",
            "https://www.twitch.tv/roblox",
            "https://www.facebook.com/roblox",
            "https://www.roblox.com/games/920587237",
            "https://guilded.gg/x",
            "  https://WWW.ROBLOX.COM/groups/1  ",
        ] {
            assert!(check_external_url(ok).is_ok(), "{ok}");
        }
        for bad in [
            "",
            "discord.gg/abc",
            "http://discord.gg/abc",
            "javascript:alert(1)",
            "file:///C:/Windows/System32/calc.exe",
            "roblox://experiences/start?placeId=1",
            "https://evil.com/?u=roblox.com",
            "https://roblox.com.evil.com/",
            "https://evilroblox.com/",
            "https://notx.com/",
            "https://roblox.com@evil.com/",
            "https://user:pw@roblox.com/",
            "https://roblox.com:8443/",
            "https://amazon.com/x",
        ] {
            assert!(check_external_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn vote_state_parsing() {
        let s = parse_vote_state(&json!({"canVote": true, "userVote": true, "reasonForNotVoteable": null}));
        assert_eq!(s, VoteState { can_vote: true, user_vote: Some(true), reason: None });
        let s = parse_vote_state(&json!({"canVote": false, "userVote": null, "reasonForNotVoteable": "PlayGame"}));
        assert_eq!(s, VoteState { can_vote: false, user_vote: None, reason: Some("PlayGame".into()) });
        let s = parse_vote_state(&json!({"canVote": true, "userVote": false, "reasonForNotVoteable": ""}));
        assert_eq!(s.user_vote, Some(false));
        assert_eq!(s.reason, None);
        assert_eq!(parse_vote_state(&json!({})).can_vote, false);
    }

    #[test]
    fn awarded_parsing_and_id_validation() {
        let v = json!({"data": [
            {"badgeId": 2124439922u64, "awardedDate": "2024-01-02T03:04:05Z"},
            {"badgeId": "nope"},
            {"awardedDate": "x"},
            {"badgeId": 7}
        ]});
        assert_eq!(
            parse_awarded(&v),
            vec![
                AwardedBadge { badge_id: 2124439922, awarded_date: Some("2024-01-02T03:04:05Z".into()) },
                AwardedBadge { badge_id: 7, awarded_date: None },
            ]
        );
        assert!(parse_awarded(&json!({})).is_empty());
        assert_eq!(badge_ids_csv(&[1, 2]).unwrap(), "1,2");
        assert!(badge_ids_csv(&[]).is_err());
        assert!(badge_ids_csv(&[1, 0]).is_err());
        assert!(badge_ids_csv(&(1..=101).collect::<Vec<_>>()).is_err());
        assert!(badge_ids_csv(&(1..=100).collect::<Vec<_>>()).is_ok());
    }

    #[test]
    fn social_links_drop_unopenable_urls_and_default_titles() {
        let v = json!({"data": [
            {"id": 1, "type": "Discord", "url": "https://discord.gg/abc", "title": " Our server "},
            {"id": 2, "type": "YouTube", "url": "https://www.youtube.com/@x", "title": ""},
            {"id": 3, "type": "Amazon", "url": "https://amazon.com/x", "title": "Shop"},
            {"id": 4, "type": "Twitter", "url": "javascript:alert(1)", "title": "Bad"}
        ]});
        assert_eq!(
            parse_social_links(&v),
            vec![
                SocialLink { title: "Our server".into(), kind: "Discord".into(), url: "https://discord.gg/abc".into() },
                SocialLink { title: "YouTube".into(), kind: "YouTube".into(), url: "https://www.youtube.com/@x".into() },
            ]
        );
    }

    #[test]
    fn recommendations_drop_ads_and_malformed_rows() {
        let v = json!({"games": [
            {"universeId": 1, "placeId": 10, "name": " Alpha ", "playerCount": 5, "totalUpVotes": 9,
             "totalDownVotes": 1, "creatorName": "Dev", "isSponsored": false},
            {"universeId": 2, "placeId": 20, "name": "Ad", "isSponsored": true},
            {"universeId": 3, "placeId": 0, "name": "No place"},
            {"universeId": 4, "name": "Missing place"},
            {"universeId": 5, "placeId": 50, "name": "  "},
            {"universeId": 6, "placeId": 60, "name": "Bare"}
        ], "nextPaginationKey": null});
        assert_eq!(
            parse_recommendations(&v),
            vec![
                RecommendedGame {
                    universe_id: 1,
                    place_id: 10,
                    name: "Alpha".into(),
                    player_count: Some(5),
                    up_votes: Some(9),
                    down_votes: Some(1),
                    creator: Some("Dev".into()),
                },
                RecommendedGame {
                    universe_id: 6,
                    place_id: 60,
                    name: "Bare".into(),
                    player_count: None,
                    up_votes: None,
                    down_votes: None,
                    creator: None,
                },
            ]
        );
        // The guest response shape verified against the live API.
        assert!(parse_recommendations(&json!({"games": [], "nextPaginationKey": null})).is_empty());
        assert!(parse_recommendations(&json!({})).is_empty());
    }

    #[test]
    fn recommendations_are_capped() {
        let rows: Vec<Value> = (1..=40u64).map(|i| json!({"universeId": i, "placeId": i, "name": "g"})).collect();
        assert_eq!(parse_recommendations(&json!({ "games": rows })).len(), MAX_RECOMMENDED);
    }

    #[test]
    fn passes_path_validates_the_page_token() {
        assert_eq!(
            passes_path(9, None).unwrap(),
            "/game-passes/v1/universes/9/game-passes?passView=Full&pageSize=25"
        );
        assert!(passes_path(9, Some("id_ab+/=-9")).unwrap().ends_with("&pageToken=id_ab+/=-9"));
        for bad in ["", "a&b=1", "a b", "../x", "a#b"] {
            assert!(passes_path(9, Some(bad)).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn ids_must_be_non_zero_and_js_safe() {
        assert!(id(0, "game").is_err());
        assert!(id(crate::launch::MAX_PLACE_ID + 1, "game").is_err());
        assert_eq!(id(5, "game").unwrap(), 5);
    }
}
