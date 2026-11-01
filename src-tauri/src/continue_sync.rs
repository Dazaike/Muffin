//! Read-only mirror of the signed-in Roblox account's "Continue" / recently played row.
//!
//! Roblox has no documented endpoint for it, so two undocumented ones are tried in order:
//!
//! 1. `GET apis/search-landing-page-api/v1?sessionId=…` (the search bar's landing page). Its
//!    `RecentlyVisited` sort is the fully chronological list (the Home "Continue" row is only
//!    partly chronological). Used by RoValra ("accurateContinue") and Froststrap.
//!    Sort/item shape: `{ sorts: [{ sortId, sortDisplayName, games: [{ universeId, rootPlaceId,
//!    name, playerCount, totalUpVotes, totalDownVotes, genreL1 }] }] }`.
//! 2. `POST apis/discovery-api/omni-recommendation` `{ pageType: "Home", sessionId }` (the
//!    roblox.com Home feed). The Continue sort has `topicId` 100000003 and
//!    `recommendationList: [{ contentType: "Game", contentId: <universeId> }]`; per-game details
//!    live in `contentMetadata.Game[<universeId>]`.
//!
//! UNVERIFIED live: both need the account's cookie (anonymous calls: the landing page answers 200
//! with no games, omni-recommendation answers 401 "Authentication token is missing"), so the
//! authed response was not observed here. The sort/item shapes above come from the sources named
//! and from the anonymous landing page (sort keys) and the sibling explore-api (game item keys).
//!
//! Never writes to Roblox and never touches the local database. There is no API to write play
//! history to Roblox: Roblox records a play itself once the game really starts.
use std::collections::{HashMap, HashSet};

use reqwest::Method;
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::error::{AppError, ErrorCode, Result};
use crate::launch::validate_place_id;
use crate::rbx_session::{active_user_id, authed_json, public_json};
use crate::store::{clean_icon_url, clean_name};

/// Games returned, in Roblox's order.
const MAX_ITEMS: usize = 24;
/// `topicId` of the Continue sort in the Home feed.
const HOME_CONTINUE_TOPIC_ID: u64 = 100_000_003;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinueGame {
    pub place_id: u64,
    pub universe_id: u64,
    pub name: String,
    pub icon_url: Option<String>,
    pub genre: Option<String>,
    pub player_count: Option<u64>,
    pub up_votes: Option<u64>,
    pub down_votes: Option<u64>,
}

fn no_sort() -> AppError {
    AppError::new(ErrorCode::Parse, "Roblox didn't return a Continue list")
}

/// Lowercase alphanumerics only, so `RecentlyVisited`, `recently-visited` and `Recently visited` agree.
fn normalize(label: &str) -> String {
    label.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// Sort ids / topic names that mean "the games this account played last". Display names are
/// localized by Roblox, so ids are the reliable signal; the name match is a best-effort extra.
fn is_continue_label(label: &str) -> bool {
    let n = normalize(label);
    ["continue", "recentlyvisited", "recentlyplayed"].iter().any(|p| n.starts_with(p))
}

fn text(v: &Value) -> Option<String> {
    v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

/// One game from a sort/metadata object. Rows without a valid root place, universe or name are dropped.
fn game_from(v: &Value, fallback_universe: Option<u64>) -> Option<ContinueGame> {
    let universe_id = v["universeId"].as_u64().or(fallback_universe).filter(|id| *id > 0)?;
    let place_id = validate_place_id(v["rootPlaceId"].as_u64()?).ok()?;
    let name = clean_name(v["name"].as_str()?).ok()?;
    Some(ContinueGame {
        place_id,
        universe_id,
        name,
        icon_url: None,
        genre: text(&v["genreL1"]).filter(|g| g != "All"),
        player_count: v["playerCount"].as_u64(),
        up_votes: v["totalUpVotes"].as_u64(),
        down_votes: v["totalDownVotes"].as_u64(),
    })
}

/// First wins; capped at `MAX_ITEMS`.
fn dedupe_cap(games: impl Iterator<Item = ContinueGame>) -> Vec<ContinueGame> {
    let mut seen = HashSet::new();
    games.filter(|g| seen.insert(g.place_id)).take(MAX_ITEMS).collect()
}

/// Search landing page → the `RecentlyVisited` sort. `parse` error when no such sort exists; an
/// existing sort without games is an empty list.
fn parse_landing(v: &Value) -> Result<Vec<ContinueGame>> {
    let sorts = v["sorts"].as_array().ok_or_else(no_sort)?;
    let sort = sorts
        .iter()
        .find(|s| {
            s["sortId"].as_str().is_some_and(is_continue_label)
                || s["sortDisplayName"].as_str().is_some_and(is_continue_label)
        })
        .ok_or_else(no_sort)?;
    let games = sort["games"].as_array().into_iter().flatten();
    Ok(dedupe_cap(games.filter_map(|g| game_from(g, None))))
}

/// Home feed → the Continue sort (by `topicId`, else by topic name) joined with `contentMetadata.Game`.
fn parse_home(v: &Value) -> Result<Vec<ContinueGame>> {
    let sorts = v["sorts"].as_array().ok_or_else(no_sort)?;
    let sort = sorts
        .iter()
        .find(|s| s["topicId"].as_u64() == Some(HOME_CONTINUE_TOPIC_ID))
        .or_else(|| sorts.iter().find(|s| s["topic"].as_str().is_some_and(is_continue_label)))
        .ok_or_else(no_sort)?;
    let meta = &v["contentMetadata"]["Game"];
    let games = sort["recommendationList"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|r| r["contentType"].as_str() == Some("Game"))
        .filter_map(|r| {
            let universe_id = r["contentId"].as_u64().filter(|id| *id > 0)?;
            game_from(&meta[universe_id.to_string()], Some(universe_id))
        });
    Ok(dedupe_cap(games))
}

async fn fetch_landing(app: &AppHandle) -> Result<Vec<ContinueGame>> {
    let path = format!("/search-landing-page-api/v1?sessionId={}", uuid::Uuid::new_v4());
    parse_landing(&authed_json(app, Method::GET, "apis", &path, None).await?)
}

async fn fetch_home(app: &AppHandle) -> Result<Vec<ContinueGame>> {
    let body = serde_json::json!({ "pageType": "Home", "sessionId": uuid::Uuid::new_v4().to_string() });
    parse_home(
        &authed_json(app, Method::POST, "apis", "/discovery-api/omni-recommendation", Some(body)).await?,
    )
}

/// Best-effort icons from the public thumbnails API; failures just leave `icon_url` empty.
async fn icons_for(app: &AppHandle, games: &[ContinueGame]) -> HashMap<u64, String> {
    let mut icons = HashMap::new();
    let ids = games.iter().map(|g| g.universe_id.to_string()).collect::<Vec<_>>().join(",");
    if ids.is_empty() {
        return icons;
    }
    let path = format!("/v1/games/icons?universeIds={ids}&size=256x256&format=Webp&returnPolicy=PlaceHolder");
    if let Ok(v) = public_json(app, "thumbnails", &path).await {
        for t in v["data"].as_array().into_iter().flatten() {
            if t["state"].as_str() == Some("Completed") {
                if let (Some(id), Some(url)) = (t["targetId"].as_u64(), t["imageUrl"].as_str()) {
                    icons.insert(id, url.to_string());
                }
            }
        }
    }
    icons
}

/// The active account's Continue / recently played games (≤ 24) in Roblox's order. No timestamps
/// exist in either source, so none are returned. `auth_expired` when nobody is signed in.
#[tauri::command]
pub async fn roblox_continue(app: AppHandle) -> Result<Vec<ContinueGame>> {
    let user_id = active_user_id(&app)?;
    let mut games = match fetch_landing(&app).await {
        Ok(g) => g,
        Err(e) if e.code == ErrorCode::AuthExpired => return Err(e),
        Err(landing_err) => match fetch_home(&app).await {
            Ok(g) => g,
            Err(e) if e.code == ErrorCode::AuthExpired => return Err(e),
            Err(_) => return Err(landing_err),
        },
    };
    if active_user_id(&app).ok() != Some(user_id) {
        return Err(AppError::new(ErrorCode::Network, "The active account changed while loading"));
    }
    let icons = icons_for(&app, &games).await;
    for g in &mut games {
        g.icon_url = clean_icon_url(icons.get(&g.universe_id).cloned());
    }
    Ok(games)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Sort keys as returned by the anonymous landing page; game keys as returned by the sibling
    /// explore-api (`DONT SPLASH` is a real item from it). The Continue sort itself is UNVERIFIED live.
    fn landing() -> Value {
        json!({
            "sorts": [
                {
                    "contentType": "TrendingSearches", "sortId": "Genres", "sortDisplayName": "Try searching for",
                    "treatmentType": "SearchPillCarousel", "nextPageToken": "", "games": [],
                    "queries": [{"query": "Tycoon", "contentType": "Text", "contentId": null}]
                },
                {
                    "contentType": "Games", "sortId": "RecentlyVisited", "sortDisplayName": "Continuar",
                    "treatmentType": "Carousel", "nextPageToken": "",
                    "games": [
                        {"universeId": 10771421858u64, "rootPlaceId": 119958473240233u64, "name": "DONT SPLASH",
                         "playerCount": 150879, "totalUpVotes": 81604, "totalDownVotes": 11918,
                         "isSponsored": false, "genreL1": "Obby & Platformer"},
                        {"universeId": 2, "rootPlaceId": 22, "name": "  Second  ", "genreL1": "All"},
                        {"universeId": 3, "rootPlaceId": 22, "name": "Duplicate place"},
                        {"universeId": 4, "rootPlaceId": 0, "name": "Zero place"},
                        {"universeId": 5, "name": "No place"},
                        {"universeId": 0, "rootPlaceId": 55, "name": "Zero universe"},
                        {"universeId": 6, "rootPlaceId": 66, "name": "   "},
                        {"universeId": 7, "rootPlaceId": 77, "name": "Last"}
                    ]
                }
            ]
        })
    }

    #[test]
    fn landing_takes_the_recently_visited_sort_in_order() {
        let got = parse_landing(&landing()).unwrap();
        let ids: Vec<_> = got.iter().map(|g| (g.place_id, g.universe_id, g.name.as_str())).collect();
        assert_eq!(
            ids,
            vec![(119958473240233, 10771421858, "DONT SPLASH"), (22, 2, "Second"), (77, 7, "Last")]
        );
        let first = &got[0];
        assert_eq!(first.genre.as_deref(), Some("Obby & Platformer"));
        assert_eq!((first.player_count, first.up_votes, first.down_votes), (Some(150879), Some(81604), Some(11918)));
        // "All" is not a genre; missing stats stay None rather than becoming 0.
        assert_eq!(got[1].genre, None);
        assert_eq!(got[1].player_count, None);
        assert!(got.iter().all(|g| g.icon_url.is_none()));
    }

    #[test]
    fn landing_without_the_sort_is_a_parse_error() {
        let only_search = json!({"sorts": [{"sortId": "Genres", "sortDisplayName": "Try searching for", "games": []}]});
        assert_eq!(parse_landing(&only_search).unwrap_err().code, ErrorCode::Parse);
        assert_eq!(parse_landing(&json!({"sorts": []})).unwrap_err().code, ErrorCode::Parse);
        assert_eq!(parse_landing(&json!({})).unwrap_err().code, ErrorCode::Parse);
        assert_eq!(parse_landing(&json!({"sorts": null})).unwrap_err().code, ErrorCode::Parse);
    }

    #[test]
    fn landing_sort_without_games_is_empty_not_an_error() {
        let v = json!({"sorts": [{"sortId": "RecentlyVisited", "games": []}]});
        assert!(parse_landing(&v).unwrap().is_empty());
        let v = json!({"sorts": [{"sortId": "RecentlyVisited"}]});
        assert!(parse_landing(&v).unwrap().is_empty());
    }

    #[test]
    fn sort_matching_is_case_and_punctuation_insensitive() {
        for id in ["RecentlyVisited", "recently-visited", "Recently visited", "continue", "Continue Playing", "RecentlyPlayed"] {
            assert!(is_continue_label(id), "{id}");
        }
        for id in ["Genres", "top-trending", "Discontinued", "", "Try searching for"] {
            assert!(!is_continue_label(id), "{id}");
        }
        // Falls back to the display name when the id is unknown.
        let v = json!({"sorts": [{"sortId": "x1", "sortDisplayName": "Continue", "games": [{"universeId": 1, "rootPlaceId": 2, "name": "A"}]}]});
        assert_eq!(parse_landing(&v).unwrap().len(), 1);
    }

    #[test]
    fn landing_is_capped_at_24() {
        let games: Vec<Value> = (1..=40u64).map(|i| json!({"universeId": i, "rootPlaceId": i + 1000, "name": format!("G{i}")})).collect();
        let got = parse_landing(&json!({"sorts": [{"sortId": "RecentlyVisited", "games": games}]})).unwrap();
        assert_eq!(got.len(), MAX_ITEMS);
        assert_eq!(got[0].name, "G1");
        assert_eq!(got[23].name, "G24");
    }

    fn home() -> Value {
        json!({
            "sorts": [
                {"topic": "Recommended For You", "topicId": 100000000, "recommendationList": [
                    {"contentType": "Game", "contentId": 1}
                ]},
                {"topic": "Continuar", "topicId": 100000003, "recommendationList": [
                    {"contentType": "Game", "contentId": 30},
                    {"contentType": "CatalogAsset", "contentId": 99},
                    {"contentType": "Game", "contentId": 10},
                    {"contentType": "Game", "contentId": 30},
                    {"contentType": "Game", "contentId": 11}
                ]}
            ],
            "contentMetadata": {"Game": {
                "1": {"universeId": 1, "rootPlaceId": 100, "name": "Not continue"},
                "30": {"universeId": 30, "rootPlaceId": 300, "name": "Thirty", "playerCount": 12, "totalUpVotes": 9, "totalDownVotes": 1},
                "10": {"rootPlaceId": 101, "name": "Ten"}
            }}
        })
    }

    #[test]
    fn home_feed_uses_topic_id_and_metadata() {
        let got = parse_home(&home()).unwrap();
        let ids: Vec<_> = got.iter().map(|g| (g.place_id, g.universe_id, g.name.as_str())).collect();
        // 99 is not a game, the second 30 is a duplicate, 11 has no metadata.
        assert_eq!(ids, vec![(300, 30, "Thirty"), (101, 10, "Ten")]);
        assert_eq!(got[0].player_count, Some(12));
        assert_eq!(got[1].player_count, None);
    }

    #[test]
    fn home_feed_without_the_sort_is_a_parse_error() {
        let v = json!({"sorts": [{"topic": "Recommended", "topicId": 100000000, "recommendationList": []}]});
        assert_eq!(parse_home(&v).unwrap_err().code, ErrorCode::Parse);
        assert_eq!(parse_home(&json!({})).unwrap_err().code, ErrorCode::Parse);
    }

    #[test]
    fn serializes_camel_case() {
        let g = game_from(&json!({"universeId": 1, "rootPlaceId": 2, "name": "A"}), None).unwrap();
        let v = serde_json::to_value(&g).unwrap();
        assert_eq!(v["placeId"], 2);
        assert_eq!(v["universeId"], 1);
        assert!(v["iconUrl"].is_null());
        assert!(v.get("playerCount").is_some());
    }
}
