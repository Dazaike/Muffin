//! Public profile of any Roblox user (shown when you open a friend inside Muffin): about text, join
//! date, friend / follower counts and their public experiences. All of it is public data.

use std::collections::HashMap;

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::error::{AppError, ErrorCode, Result};
use crate::rbx_session::{authed_json, public_json};

const GAME_LIMIT: u32 = 12;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileGame {
    pub universe_id: u64,
    pub place_id: u64,
    pub name: String,
    pub visits: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub id: u64,
    pub name: String,
    pub display_name: String,
    pub description: String,
    /// ISO timestamp.
    pub created: Option<String>,
    pub verified: bool,
    pub banned: bool,
    pub friends: Option<u64>,
    pub followers: Option<u64>,
    pub following: Option<u64>,
    pub games: Vec<ProfileGame>,
}

fn count(v: Result<Value>) -> Option<u64> {
    v.ok()?["count"].as_u64()
}

fn parse_games(v: &Value) -> Vec<ProfileGame> {
    v["data"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|g| {
                    Some(ProfileGame {
                        universe_id: g["id"].as_u64()?,
                        place_id: g["rootPlace"]["id"].as_u64()?,
                        name: g["name"].as_str()?.to_owned(),
                        visits: g["placeVisits"].as_u64().unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command(async)]
pub async fn user_profile(app: AppHandle, user_id: u64) -> Result<UserProfile> {
    if user_id == 0 {
        return Err(AppError::invalid("Ids must be non-zero"));
    }
    let info_path = format!("/v1/users/{user_id}");
    let friends_path = format!("/v1/users/{user_id}/friends/count");
    let followers_path = format!("/v1/users/{user_id}/followers/count");
    let following_path = format!("/v1/users/{user_id}/followings/count");
    let games_path = format!("/v2/users/{user_id}/games?accessFilter=Public&limit={GAME_LIMIT}&sortOrder=Desc");

    let (info, friends, followers, following, games) = tokio::join!(
        public_json(&app, "users", &info_path),
        public_json(&app, "friends", &friends_path),
        public_json(&app, "friends", &followers_path),
        public_json(&app, "friends", &following_path),
        public_json(&app, "games", &games_path),
    );
    // The basic info decides whether the profile exists; everything else is optional decoration.
    let info = info?;
    let bad = || AppError::new(ErrorCode::Parse, "Unexpected response from Roblox");
    Ok(UserProfile {
        id: info["id"].as_u64().ok_or_else(bad)?,
        name: info["name"].as_str().ok_or_else(bad)?.to_owned(),
        display_name: info["displayName"].as_str().unwrap_or_else(|| info["name"].as_str().unwrap_or("")).to_owned(),
        description: info["description"].as_str().unwrap_or("").to_owned(),
        created: info["created"].as_str().map(str::to_owned),
        verified: info["hasVerifiedBadge"].as_bool().unwrap_or(false),
        banned: info["isBanned"].as_bool().unwrap_or(false),
        friends: count(friends),
        followers: count(followers),
        following: count(following),
        games: games.map(|g| parse_games(&g)).unwrap_or_default(),
    })
}

// ---- sections (loaded lazily, one tab at a time) ---------------------------------------------------

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Section {
    Friends,
    Favorites,
    Badges,
    Groups,
    Collectibles,
    Wearing,
}

/// One tile on a profile tab. Which fields are set depends on the section.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: u64,
    pub name: String,
    pub subtitle: Option<String>,
    pub image_url: Option<String>,
    /// Set for experiences, so the tile can open the game page.
    pub place_id: Option<u64>,
    pub universe_id: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionData {
    pub items: Vec<Item>,
    /// Roblox refused because the user keeps this section private.
    pub private: bool,
}

const SECTION_LIMIT: usize = 60;

async fn get(app: &AppHandle, host: &str, path: &str) -> Result<Value> {
    authed_json(app, Method::GET, host, path, None).await
}

fn data(v: &Value) -> &[Value] {
    v["data"].as_array().map(Vec::as_slice).unwrap_or(&[])
}

fn id_csv(ids: &[u64]) -> String {
    ids.iter().map(u64::to_string).collect::<Vec<_>>().join(",")
}

/// `targetId → imageUrl` for a thumbnails endpoint taking `?{key}=1,2,3`. Pictures are decoration: any
/// failure just leaves the tiles without one.
async fn thumbs(app: &AppHandle, path: &str, key: &str, ids: &[u64]) -> HashMap<u64, String> {
    let mut out = HashMap::new();
    if ids.is_empty() {
        return out;
    }
    let sep = if path.contains('?') { '&' } else { '?' };
    let full = format!("{path}{sep}{key}={}&size=150x150&format=Webp", id_csv(ids));
    if let Ok(v) = get(app, "thumbnails", &full).await {
        for d in data(&v) {
            if let (Some(id), Some(url), Some("Completed")) = (d["targetId"].as_u64(), d["imageUrl"].as_str(), d["state"].as_str()) {
                out.insert(id, url.to_owned());
            }
        }
    }
    out
}

fn short(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        s.to_owned()
    } else {
        format!("{}…", s.chars().take(max).collect::<String>().trim_end())
    }
}

fn parse_favorites(v: &Value) -> Vec<Item> {
    data(v)
        .iter()
        .filter_map(|g| {
            let universe = g["id"].as_u64()?;
            Some(Item {
                id: universe,
                name: g["name"].as_str()?.to_owned(),
                subtitle: None,
                image_url: None,
                place_id: Some(g["rootPlace"]["id"].as_u64()?),
                universe_id: Some(universe),
            })
        })
        .collect()
}

fn plain(id: u64, name: &str) -> Item {
    Item { id, name: name.to_owned(), subtitle: None, image_url: None, place_id: None, universe_id: None }
}

async fn friends(app: &AppHandle, user_id: u64) -> Result<Vec<Item>> {
    let list = get(app, "friends", &format!("/v1/users/{user_id}/friends")).await?;
    let ids: Vec<u64> = data(&list).iter().filter_map(|f| f["id"].as_u64()).take(SECTION_LIMIT).collect();
    if ids.is_empty() {
        return Ok(vec![]);
    }
    // The friends endpoint often omits names; resolve them by id.
    let body = serde_json::json!({ "userIds": ids, "excludeBannedUsers": false });
    let users = authed_json(app, Method::POST, "users", "/v1/users", Some(body)).await?;
    let images = thumbs(app, "/v1/users/avatar-headshot", "userIds", &ids).await;
    Ok(data(&users)
        .iter()
        .filter_map(|u| {
            let id = u["id"].as_u64()?;
            let name = u["name"].as_str()?;
            let mut item = plain(id, u["displayName"].as_str().unwrap_or(name));
            item.subtitle = Some(format!("@{name}"));
            item.image_url = images.get(&id).cloned();
            Some(item)
        })
        .collect())
}

async fn badges(app: &AppHandle, user_id: u64) -> Result<Vec<Item>> {
    let v = get(app, "badges", &format!("/v1/users/{user_id}/badges?limit=30&sortOrder=Desc")).await?;
    let mut items: Vec<Item> = data(&v)
        .iter()
        .filter_map(|b| {
            let mut item = plain(b["id"].as_u64()?, b["name"].as_str()?);
            item.subtitle = b["description"].as_str().filter(|d| !d.trim().is_empty()).map(|d| short(d, 90));
            Some(item)
        })
        .collect();
    let images = thumbs(app, "/v1/badges/icons", "badgeIds", &items.iter().map(|i| i.id).collect::<Vec<_>>()).await;
    for i in &mut items {
        i.image_url = images.get(&i.id).cloned();
    }
    Ok(items)
}

async fn groups(app: &AppHandle, user_id: u64) -> Result<Vec<Item>> {
    let v = get(app, "groups", &format!("/v2/users/{user_id}/groups/roles")).await?;
    let mut items: Vec<Item> = data(&v)
        .iter()
        .filter_map(|r| {
            let g = &r["group"];
            let mut item = plain(g["id"].as_u64()?, g["name"].as_str()?);
            item.subtitle = r["role"]["name"].as_str().map(str::to_owned);
            Some(item)
        })
        .take(SECTION_LIMIT)
        .collect();
    let images = thumbs(app, "/v1/groups/icons", "groupIds", &items.iter().map(|i| i.id).collect::<Vec<_>>()).await;
    for i in &mut items {
        i.image_url = images.get(&i.id).cloned();
    }
    Ok(items)
}

async fn collectibles(app: &AppHandle, user_id: u64) -> Result<Vec<Item>> {
    let v = get(app, "inventory", &format!("/v1/users/{user_id}/assets/collectibles?limit=50&sortOrder=Desc")).await?;
    let mut items: Vec<Item> = data(&v)
        .iter()
        .filter_map(|a| {
            let mut item = plain(a["assetId"].as_u64()?, a["name"].as_str()?);
            item.subtitle = a["recentAveragePrice"].as_u64().map(|p| format!("RAP {p} R$"));
            Some(item)
        })
        .collect();
    let images = thumbs(app, "/v1/assets", "assetIds", &items.iter().map(|i| i.id).collect::<Vec<_>>()).await;
    for i in &mut items {
        i.image_url = images.get(&i.id).cloned();
    }
    Ok(items)
}

async fn wearing(app: &AppHandle, user_id: u64) -> Result<Vec<Item>> {
    let v = get(app, "avatar", &format!("/v1/users/{user_id}/currently-wearing")).await?;
    let ids: Vec<u64> = v["assetIds"].as_array().map(|a| a.iter().filter_map(Value::as_u64).take(20).collect()).unwrap_or_default();
    let images = thumbs(app, "/v1/assets", "assetIds", &ids).await;
    let mut items = Vec::with_capacity(ids.len());
    for id in ids {
        // Names aren't in the wearing list; one small call per item (at most 20).
        let name = get(app, "economy", &format!("/v2/assets/{id}/details")).await.ok().and_then(|d| d["Name"].as_str().map(str::to_owned));
        let mut item = plain(id, name.as_deref().unwrap_or("Item"));
        item.image_url = images.get(&id).cloned();
        items.push(item);
    }
    Ok(items)
}

#[tauri::command(async)]
pub async fn user_section(app: AppHandle, user_id: u64, section: Section) -> Result<SectionData> {
    if user_id == 0 {
        return Err(AppError::invalid("Ids must be non-zero"));
    }
    let result = match section {
        Section::Friends => friends(&app, user_id).await,
        Section::Favorites => get(&app, "games", &format!("/v2/users/{user_id}/favorite/games?limit=50&sortOrder=Desc")).await.map(|v| parse_favorites(&v)),
        Section::Badges => badges(&app, user_id).await,
        Section::Groups => groups(&app, user_id).await,
        Section::Collectibles => collectibles(&app, user_id).await,
        Section::Wearing => wearing(&app, user_id).await,
    };
    match result {
        Ok(items) => Ok(SectionData { items, private: false }),
        // Roblox answers 400/403 when the owner hides a section; a dead session is a different problem.
        Err(e) if e.code == ErrorCode::HttpStatus => Ok(SectionData { items: vec![], private: true }),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn games_without_a_root_place_are_skipped() {
        let v = json!({ "data": [
            { "id": 1, "name": "A", "rootPlace": { "id": 10 }, "placeVisits": 5 },
            { "id": 2, "name": "B" },
        ]});
        let games = parse_games(&v);
        assert_eq!(games.len(), 1);
        assert_eq!((games[0].universe_id, games[0].place_id, games[0].visits), (1, 10, 5));
    }

    #[test]
    fn favourites_keep_the_place_to_open_and_skip_incomplete_entries() {
        let v = json!({ "data": [
            { "id": 7, "name": "Fav", "rootPlace": { "id": 70 } },
            { "name": "no id", "rootPlace": { "id": 1 } },
        ]});
        let items = parse_favorites(&v);
        assert_eq!(items.len(), 1);
        assert_eq!((items[0].universe_id, items[0].place_id), (Some(7), Some(70)));
    }

    #[test]
    fn long_descriptions_are_cut_on_a_character_boundary() {
        assert_eq!(short("  hello  ", 10), "hello");
        assert_eq!(short("ééééé", 3), "ééé…");
    }
}
