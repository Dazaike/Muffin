//! Friends, presence, follow graph, user search and "join friend". Every call goes through the
//! shared Roblox session (`rbx_session`), so the cookie never leaves Rust and hosts are allowlisted
//! there. Nothing here is persisted: friend data is fetched live and held only in frontend memory.

use std::collections::HashMap;

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::db::Db;
use crate::error::{AppError, ErrorCode, Result};
use crate::launch::{self, LaunchResult, MAX_PLACE_ID};
use crate::rbx_session::{active_user_id, authed_json, public_json};

const PAGE_LIMIT: &str = "50";
const PRESENCE_CHUNK: usize = 50;
const AVATAR_CHUNK: usize = 100;
const STATUS_CHUNK: usize = 50;
const MAX_REFRESH_IDS: usize = 1000;
const MIN_SEARCH_CHARS: usize = 3;
const MAX_SEARCH_CHARS: usize = 50;
const MAX_CURSOR_LEN: usize = 2048;

// ---- types -----------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PresenceStatus {
    Offline,
    Online,
    InGame,
    InStudio,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    pub user_id: u64,
    pub status: PresenceStatus,
    pub last_location: Option<String>,
    pub place_id: Option<u64>,
    pub root_place_id: Option<u64>,
    pub universe_id: Option<u64>,
    pub last_online: Option<String>,
    /// In a game with a place id and a valid server (game) id, i.e. `join_friend` can work.
    pub joinable: bool,
    /// Never sent to the frontend; `join_friend` re-reads it fresh.
    #[serde(skip)]
    pub game_id: Option<String>,
}

impl Presence {
    fn offline(user_id: u64) -> Self {
        Self {
            user_id,
            status: PresenceStatus::Offline,
            last_location: None,
            place_id: None,
            root_place_id: None,
            universe_id: None,
            last_online: None,
            joinable: false,
            game_id: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialUser {
    pub id: u64,
    pub name: String,
    pub display_name: String,
    pub verified: bool,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Relation {
    NotFriends,
    Friends,
    RequestSent,
    RequestReceived,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Friend {
    #[serde(flatten)]
    pub user: SocialUser,
    pub presence: Presence,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendsList {
    pub friends: Vec<Friend>,
    pub total: u64,
    /// Set when presence could not be loaded; friends are then listed as offline.
    pub presence_error: Option<String>,
}

/// A user in the requests / followers / following / search lists.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonRow {
    #[serde(flatten)]
    pub user: SocialUser,
    /// Friendship with the signed-in user; `None` when the status lookup failed.
    pub relation: Option<Relation>,
    /// Whether the signed-in user follows them; `None` when unknown.
    pub following: Option<bool>,
    pub sent_at: Option<String>,
    pub mutual_friends: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonPage {
    pub items: Vec<PersonRow>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FollowKind {
    Followers,
    Following,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FriendAction {
    Send,
    Accept,
    Decline,
    Cancel,
    Unfriend,
    Follow,
    Unfollow,
}

// ---- validation & request building -----------------------------------------------------------

fn validate_user_id(id: u64) -> Result<u64> {
    if id == 0 || id > MAX_PLACE_ID {
        return Err(AppError::invalid("Invalid user id"));
    }
    Ok(id)
}

fn clean_cursor(cursor: Option<String>) -> Result<Option<String>> {
    match cursor.map(|c| c.trim().to_string()).filter(|c| !c.is_empty()) {
        Some(c) if c.len() > MAX_CURSOR_LEN => Err(AppError::invalid("Invalid page cursor")),
        other => Ok(other),
    }
}

/// Trims and checks a user-search keyword (3–50 characters; Roblox rejects shorter ones).
pub fn clean_keyword(keyword: &str) -> Result<String> {
    let k = keyword.trim();
    let n = k.chars().count();
    if n < MIN_SEARCH_CHARS {
        return Err(AppError::invalid(format!("Type at least {MIN_SEARCH_CHARS} characters to search")));
    }
    if n > MAX_SEARCH_CHARS {
        return Err(AppError::invalid(format!("Search is limited to {MAX_SEARCH_CHARS} characters")));
    }
    Ok(k.to_string())
}

/// `path?k=v&…` with percent-encoded values.
fn with_query(path: &str, params: &[(&str, &str)]) -> String {
    let mut s = url::form_urlencoded::Serializer::new(String::new());
    for (k, v) in params {
        s.append_pair(k, v);
    }
    format!("{path}?{}", s.finish())
}

fn join_ids(ids: &[u64]) -> String {
    ids.iter().map(u64::to_string).collect::<Vec<_>>().join(",")
}

/// Method, path and body for a friend/follow action against `target`. All on `friends.roblox.com`.
pub fn action_request(action: FriendAction, target: u64) -> (Method, String, Option<Value>) {
    let (leaf, body) = match action {
        FriendAction::Send => ("request-friendship", Some(json!({ "friendshipOriginSourceType": 0 }))), // UNVERIFIED live
        FriendAction::Accept => ("accept-friend-request", None),                                       // UNVERIFIED live
        FriendAction::Decline => ("decline-friend-request", None),                                     // UNVERIFIED live
        // UNVERIFIED live: Roblox documents no cancel route; withdrawing a pending request is
        // assumed to use the same `unfriend` call the website uses.
        FriendAction::Cancel | FriendAction::Unfriend => ("unfriend", None),
        FriendAction::Follow => ("follow", Some(json!({}))),
        FriendAction::Unfollow => ("unfollow", None),
    };
    (Method::POST, format!("/v1/users/{target}/{leaf}"), body)
}

// ---- response parsing ------------------------------------------------------------------------

fn id_field(v: &Value, key: &str) -> Option<u64> {
    v.get(key).and_then(Value::as_u64).filter(|n| (1..=MAX_PLACE_ID).contains(n))
}

fn text_field(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

pub fn parse_user(v: &Value) -> Option<SocialUser> {
    let id = id_field(v, "id")?;
    let name = text_field(v, "name")?;
    let display_name = text_field(v, "displayName").unwrap_or_else(|| name.clone());
    Some(SocialUser {
        id,
        name,
        display_name,
        verified: v.get("hasVerifiedBadge").and_then(Value::as_bool).unwrap_or(false),
        avatar_url: None,
    })
}

pub fn parse_presence(v: &Value) -> Option<Presence> {
    let user_id = id_field(v, "userId")?;
    let status = match v.get("userPresenceType").and_then(Value::as_u64).unwrap_or(0) {
        1 => PresenceStatus::Online,
        2 => PresenceStatus::InGame,
        3 => PresenceStatus::InStudio,
        _ => PresenceStatus::Offline,
    };
    let place_id = id_field(v, "placeId");
    let game_id = text_field(v, "gameId").and_then(|g| launch::parse_instance_id(&g).ok());
    let in_game = status == PresenceStatus::InGame;
    Some(Presence {
        user_id,
        status,
        last_location: text_field(v, "lastLocation"),
        place_id: if in_game { place_id } else { None },
        root_place_id: if in_game { id_field(v, "rootPlaceId") } else { None },
        universe_id: if in_game { id_field(v, "universeId") } else { None },
        last_online: text_field(v, "lastOnline"),
        joinable: in_game && place_id.is_some() && game_id.is_some(),
        game_id: if in_game { game_id } else { None },
    })
}

fn parse_presence_list(v: &Value) -> Vec<Presence> {
    v.get("userPresences")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(parse_presence).collect())
        .unwrap_or_default()
}

fn relation_from(n: u64) -> Option<Relation> {
    Some(match n {
        0 => Relation::NotFriends,
        1 => Relation::Friends,
        2 => Relation::RequestSent,
        3 => Relation::RequestReceived,
        _ => return None,
    })
}

fn data_array(v: &Value) -> &[Value] {
    v.get("data").and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn next_cursor(v: &Value) -> Option<String> {
    text_field(v, "nextPageCursor")
}

fn parse_person(v: &Value) -> Option<PersonRow> {
    let user = parse_user(v)?;
    let request = v.get("friendRequest");
    Some(PersonRow {
        user,
        relation: request.map(|_| Relation::RequestReceived),
        following: None,
        sent_at: request.and_then(|r| text_field(r, "sentAt")),
        mutual_friends: v.get("mutualFriendsList").and_then(Value::as_array).map_or(0, Vec::len),
    })
}

fn parse_people(v: &Value) -> Vec<PersonRow> {
    data_array(v).iter().filter_map(parse_person).collect()
}

// ---- Roblox calls ----------------------------------------------------------------------------

async fn presences(app: &AppHandle, ids: &[u64]) -> Result<HashMap<u64, Presence>> {
    let mut out = HashMap::with_capacity(ids.len());
    for chunk in ids.chunks(PRESENCE_CHUNK) {
        let body = json!({ "userIds": chunk });
        let res = authed_json(app, Method::POST, "presence", "/v1/presence/users", Some(body)).await?;
        for p in parse_presence_list(&res) {
            out.insert(p.user_id, p);
        }
    }
    Ok(out)
}

/// Headshot URLs; purely cosmetic, so failures just leave users without a picture.
async fn avatars(app: &AppHandle, ids: &[u64]) -> HashMap<u64, String> {
    let mut out = HashMap::new();
    for chunk in ids.chunks(AVATAR_CHUNK) {
        let path = with_query(
            "/v1/users/avatar-headshot",
            &[
                ("userIds", &join_ids(chunk)),
                ("size", "150x150"),
                ("format", "Webp"),
                ("isCircular", "false"),
            ],
        );
        let Ok(res) = public_json(app, "thumbnails", &path).await else { continue };
        for d in data_array(&res) {
            if d.get("state").and_then(Value::as_str) == Some("Completed") {
                if let (Some(id), Some(url)) = (id_field(d, "targetId"), text_field(d, "imageUrl")) {
                    out.insert(id, url);
                }
            }
        }
    }
    out
}

async fn statuses(app: &AppHandle, me: u64, ids: &[u64]) -> HashMap<u64, Relation> {
    let mut out = HashMap::new();
    for chunk in ids.chunks(STATUS_CHUNK) {
        let path = with_query(&format!("/v1/users/{me}/friends/statuses"), &[("userIds", &join_ids(chunk))]);
        let Ok(res) = authed_json(app, Method::GET, "friends", &path, None).await else { continue };
        for d in data_array(&res) {
            if let (Some(id), Some(rel)) = (id_field(d, "id"), d.get("status").and_then(Value::as_u64).and_then(relation_from)) {
                out.insert(id, rel);
            }
        }
    }
    out
}

async fn following_flags(app: &AppHandle, ids: &[u64]) -> HashMap<u64, bool> {
    let mut out = HashMap::new();
    for chunk in ids.chunks(STATUS_CHUNK) {
        let body = json!({ "targetUserIds": chunk });
        let Ok(res) = authed_json(app, Method::POST, "friends", "/v1/user/following-exists", Some(body)).await else {
            continue;
        };
        for d in res.get("followings").and_then(Value::as_array).map_or(&[][..], Vec::as_slice) {
            if let (Some(id), Some(f)) = (id_field(d, "userId"), d.get("isFollowing").and_then(Value::as_bool)) {
                out.insert(id, f);
            }
        }
    }
    out
}

/// Fills in avatars, friendship status and follow state for a page of people.
async fn enrich(app: &AppHandle, me: u64, rows: &mut [PersonRow], known_following: Option<bool>) {
    if rows.is_empty() {
        return;
    }
    let ids: Vec<u64> = rows.iter().map(|r| r.user.id).collect();
    let need_status: Vec<u64> = rows.iter().filter(|r| r.relation.is_none()).map(|r| r.user.id).collect();
    let (pics, rel, follow) = tokio::join!(
        avatars(app, &ids),
        async {
            if need_status.is_empty() { HashMap::new() } else { statuses(app, me, &need_status).await }
        },
        async {
            if known_following.is_some() { HashMap::new() } else { following_flags(app, &ids).await }
        },
    );
    for r in rows {
        r.user.avatar_url = pics.get(&r.user.id).cloned();
        if r.relation.is_none() {
            r.relation = rel.get(&r.user.id).copied();
        }
        r.following = known_following.or_else(|| follow.get(&r.user.id).copied());
    }
}

// ---- commands --------------------------------------------------------------------------------

#[tauri::command]
pub async fn friends_list(app: AppHandle) -> Result<FriendsList> {
    let me = active_user_id(&app)?;
    let res = authed_json(&app, Method::GET, "friends", &format!("/v1/users/{me}/friends"), None).await?;
    // The friends list frequently omits name/displayName, so resolve profiles by id.
    let raw_ids: Vec<u64> = data_array(&res).iter().filter_map(|d| id_field(d, "id")).collect();
    let mut users: Vec<SocialUser> = Vec::new();
    for chunk in raw_ids.chunks(100) {
        let body = serde_json::json!({"userIds": chunk, "excludeBannedUsers": false});
        let profiles = authed_json(&app, Method::POST, "users", "/v1/users", Some(body)).await?;
        users.extend(data_array(&profiles).iter().filter_map(parse_user));
    }
    let ids: Vec<u64> = users.iter().map(|u| u.id).collect();

    let (pres, pics, count) = tokio::join!(
        presences(&app, &ids),
        avatars(&app, &ids),
        authed_json(&app, Method::GET, "friends", "/v1/my/friends/count", None),
    );
    let (pres, presence_error) = match pres {
        Ok(p) => (p, None),
        Err(e) => (HashMap::new(), Some(e.message)),
    };
    for u in &mut users {
        u.avatar_url = pics.get(&u.id).cloned();
    }
    let total = count.ok().and_then(|c| c.get("count").and_then(Value::as_u64)).unwrap_or(users.len() as u64);
    let friends = users
        .into_iter()
        .map(|user| {
            let presence = pres.get(&user.id).cloned().unwrap_or_else(|| Presence::offline(user.id));
            Friend { user, presence }
        })
        .collect();
    Ok(FriendsList { friends, total, presence_error })
}

/// Lightweight refresh used by the 30 s poll: presence only, for ids the frontend already has.
#[tauri::command]
pub async fn friends_presence(app: AppHandle, user_ids: Vec<u64>) -> Result<Vec<Presence>> {
    active_user_id(&app)?;
    let mut ids = user_ids.into_iter().map(validate_user_id).collect::<Result<Vec<_>>>()?;
    ids.sort_unstable();
    ids.dedup();
    if ids.len() > MAX_REFRESH_IDS {
        return Err(AppError::invalid("Too many users"));
    }
    let map = presences(&app, &ids).await?;
    Ok(ids
        .into_iter()
        .map(|id| map.get(&id).cloned().unwrap_or_else(|| Presence::offline(id)))
        .collect())
}

#[tauri::command]
pub async fn friend_requests(app: AppHandle, cursor: Option<String>) -> Result<PersonPage> {
    let me = active_user_id(&app)?;
    let cursor = clean_cursor(cursor)?;
    let mut params = vec![("limit", PAGE_LIMIT), ("friendRequestSort", "1")];
    if let Some(c) = cursor.as_deref() {
        params.push(("cursor", c));
    }
    let res = authed_json(&app, Method::GET, "friends", &with_query("/v1/my/friends/requests", &params), None).await?;
    let mut items = parse_people(&res);
    // Incoming requests always carry `friendRequest`; anything else is treated the same way.
    for r in &mut items {
        r.relation.get_or_insert(Relation::RequestReceived);
    }
    enrich(&app, me, &mut items, None).await;
    Ok(PersonPage { items, next_cursor: next_cursor(&res) })
}

#[tauri::command]
pub async fn friend_requests_count(app: AppHandle) -> Result<u64> {
    active_user_id(&app)?;
    let res = authed_json(&app, Method::GET, "friends", "/v1/user/friend-requests/count", None).await?;
    Ok(res.get("count").and_then(Value::as_u64).unwrap_or(0))
}

#[tauri::command]
pub async fn follow_list(app: AppHandle, kind: FollowKind, cursor: Option<String>) -> Result<PersonPage> {
    let me = active_user_id(&app)?;
    let cursor = clean_cursor(cursor)?;
    let leaf = match kind {
        FollowKind::Followers => "followers",
        FollowKind::Following => "followings",
    };
    let mut params = vec![("limit", PAGE_LIMIT), ("sortOrder", "Desc")];
    if let Some(c) = cursor.as_deref() {
        params.push(("cursor", c));
    }
    let path = with_query(&format!("/v1/users/{me}/{leaf}"), &params);
    let res = authed_json(&app, Method::GET, "friends", &path, None).await?;
    let mut items = parse_people(&res);
    let known = (kind == FollowKind::Following).then_some(true);
    enrich(&app, me, &mut items, known).await;
    Ok(PersonPage { items, next_cursor: next_cursor(&res) })
}

#[tauri::command]
pub async fn user_search(app: AppHandle, keyword: String, cursor: Option<String>) -> Result<PersonPage> {
    let me = active_user_id(&app)?;
    let keyword = clean_keyword(&keyword)?;
    let cursor = clean_cursor(cursor)?;
    let mut params = vec![("keyword", keyword.as_str()), ("limit", "25")];
    if let Some(c) = cursor.as_deref() {
        params.push(("cursor", c));
    }
    let res = authed_json(&app, Method::GET, "users", &with_query("/v1/users/search", &params), None).await?;
    let mut items: Vec<PersonRow> = parse_people(&res).into_iter().filter(|r| r.user.id != me).collect();
    enrich(&app, me, &mut items, None).await;
    Ok(PersonPage { items, next_cursor: next_cursor(&res) })
}

/// Send / accept / decline / cancel / unfriend / follow / unfollow. The frontend refetches
/// afterwards; Roblox is the source of truth for the resulting state.
#[tauri::command]
pub async fn friend_action(app: AppHandle, user_id: u64, action: FriendAction) -> Result<()> {
    let target = validate_user_id(user_id)?;
    if active_user_id(&app)? == target {
        return Err(AppError::invalid("You can't do that to your own account"));
    }
    let (method, path, body) = action_request(action, target);
    let res = authed_json(&app, method, "friends", &path, body).await?;
    check_action_response(&res)
}

/// Some friends endpoints answer 200 with `isCaptchaRequired` / `success:false` instead of an error.
fn check_action_response(res: &Value) -> Result<()> {
    if res.get("isCaptchaRequired").and_then(Value::as_bool) == Some(true) {
        return Err(AppError::new(
            ErrorCode::HttpStatus,
            "Roblox wants a captcha for this action. Complete it on roblox.com, then try again.",
        ));
    }
    if res.get("success").and_then(Value::as_bool) == Some(false) {
        return Err(AppError::new(ErrorCode::HttpStatus, "Roblox didn't accept that action"));
    }
    Ok(())
}

// ---- join friend -----------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JoinTarget {
    pub place_id: u64,
    pub game_id: String,
    pub universe_id: Option<u64>,
    pub name: Option<String>,
}

/// What a joinable presence needs: in a game, with a place id and a valid server id.
pub fn join_target(presence: &Presence) -> Result<JoinTarget> {
    if presence.status != PresenceStatus::InGame {
        return Err(AppError::invalid("They aren't in a game right now"));
    }
    let (Some(place_id), Some(game_id)) = (presence.place_id, presence.game_id.clone()) else {
        return Err(AppError::invalid(
            "Roblox doesn't share which server they're in (their join settings, or a private server)",
        ));
    };
    Ok(JoinTarget { place_id, game_id, universe_id: presence.universe_id, name: presence.last_location.clone() })
}

/// Reads fresh presence, then hands off `roblox://experiences/start?placeId=…&gameInstanceId=…`.
/// The frontend only supplies a user id; the URI is built here from validated values.
#[tauri::command]
pub async fn join_friend(app: AppHandle, db: State<'_, Db>, user_id: u64) -> Result<LaunchResult> {
    let target = validate_user_id(user_id)?;
    active_user_id(&app)?;
    let fresh = presences(&app, &[target]).await?;
    let presence = fresh.get(&target).ok_or_else(|| AppError::invalid("Couldn't read their status"))?;
    let join = join_target(presence)?;
    launch::launch_instance(
        app,
        db,
        join.place_id,
        join.game_id,
        join.universe_id,
        join.name.unwrap_or_default(),
        None,
        None,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const GUID: &str = "3f2b8c6e-1d4a-4e7b-9a52-0c8d6e4f1a77";

    fn pres(v: Value) -> Presence {
        parse_presence(&v).expect("presence parses")
    }

    #[test]
    fn presence_in_game_is_joinable_only_with_valid_game_id() {
        let ok = pres(json!({"userId": 5, "userPresenceType": 2, "lastLocation": "Blox", "placeId": 111, "rootPlaceId": 100, "universeId": 9, "gameId": GUID}));
        assert!(ok.joinable);
        assert_eq!((ok.place_id, ok.root_place_id), (Some(111), Some(100)));

        let no_game = pres(json!({"userId": 5, "userPresenceType": 2, "placeId": 111, "gameId": null}));
        assert!(!no_game.joinable);

        let bad_guid = pres(json!({"userId": 5, "userPresenceType": 2, "placeId": 111, "gameId": "abc&x=1"}));
        assert!(!bad_guid.joinable && bad_guid.game_id.is_none());

        let no_place = pres(json!({"userId": 5, "userPresenceType": 2, "gameId": GUID}));
        assert!(!no_place.joinable);
    }

    #[test]
    fn presence_online_and_offline_never_carry_game_data() {
        let online = pres(json!({"userId": 5, "userPresenceType": 1, "lastLocation": "Website", "placeId": 111, "gameId": GUID}));
        assert_eq!(online.status, PresenceStatus::Online);
        assert!(!online.joinable && online.place_id.is_none() && online.game_id.is_none());
        // 0 offline, 4 invisible and unknown values all read as offline.
        for t in [0, 4, 99] {
            assert_eq!(pres(json!({"userId": 5, "userPresenceType": t})).status, PresenceStatus::Offline);
        }
        assert!(parse_presence(&json!({"userPresenceType": 2})).is_none());
        assert!(parse_presence(&json!({"userId": 0})).is_none());
    }

    #[test]
    fn join_target_requires_in_game_place_and_server() {
        let ok = join_target(&pres(json!({"userId": 5, "userPresenceType": 2, "lastLocation": "Blox", "placeId": 111, "gameId": GUID}))).unwrap();
        assert_eq!(ok, JoinTarget { place_id: 111, game_id: GUID.into(), universe_id: None, name: Some("Blox".into()) });
        assert_eq!(
            launch::instance_uri(ok.place_id, &ok.game_id),
            format!("roblox://experiences/start?placeId=111&gameInstanceId={GUID}")
        );
        for v in [
            json!({"userId": 5, "userPresenceType": 1}),
            json!({"userId": 5, "userPresenceType": 3, "placeId": 111, "gameId": GUID}),
            json!({"userId": 5, "userPresenceType": 2, "placeId": 111}),
            json!({"userId": 5, "userPresenceType": 2, "gameId": GUID}),
        ] {
            assert_eq!(join_target(&pres(v)).unwrap_err().code, ErrorCode::InvalidInput);
        }
    }

    #[test]
    fn presence_rejects_malformed_server_ids_and_lowercases_valid_ones() {
        let upper = pres(json!({"userId": 5, "userPresenceType": 2, "placeId": 1, "gameId": GUID.to_uppercase()}));
        assert_eq!(upper.game_id.as_deref(), Some(GUID));
        for bad in ["", "abc", &GUID[..35], &format!("{GUID}0"), &GUID.replace('-', ""), &format!("{{{GUID}}}"), &format!("{}&x=1", &GUID[..30])] {
            let p = pres(json!({"userId": 5, "userPresenceType": 2, "placeId": 1, "gameId": bad}));
            assert!(p.game_id.is_none() && !p.joinable, "{bad}");
        }
    }

    #[test]
    fn user_ids_are_validated() {
        assert!(validate_user_id(1).is_ok());
        assert!(validate_user_id(MAX_PLACE_ID).is_ok());
        assert!(validate_user_id(0).is_err());
        assert!(validate_user_id(MAX_PLACE_ID + 1).is_err());
    }

    #[test]
    fn keywords_are_trimmed_and_bounded() {
        assert_eq!(clean_keyword("  bob  ").unwrap(), "bob");
        assert!(clean_keyword("ab").is_err());
        assert!(clean_keyword("   a ").is_err());
        assert!(clean_keyword(&"x".repeat(51)).is_err());
        assert!(clean_keyword(&"x".repeat(50)).is_ok());
    }

    #[test]
    fn query_values_are_percent_encoded() {
        assert_eq!(with_query("/p", &[("keyword", "a b&c=d")]), "/p?keyword=a+b%26c%3Dd");
        assert_eq!(with_query("/p", &[("userIds", "1,2")]), "/p?userIds=1%2C2");
    }

    #[test]
    fn actions_map_to_friends_endpoints() {
        let path = |a| action_request(a, 42).1;
        assert_eq!(path(FriendAction::Send), "/v1/users/42/request-friendship");
        assert_eq!(path(FriendAction::Accept), "/v1/users/42/accept-friend-request");
        assert_eq!(path(FriendAction::Decline), "/v1/users/42/decline-friend-request");
        assert_eq!(path(FriendAction::Unfriend), "/v1/users/42/unfriend");
        assert_eq!(path(FriendAction::Cancel), "/v1/users/42/unfriend");
        assert_eq!(path(FriendAction::Follow), "/v1/users/42/follow");
        assert_eq!(path(FriendAction::Unfollow), "/v1/users/42/unfollow");
        assert!(FriendAction::Send != FriendAction::Cancel);
        assert!(matches!(action_request(FriendAction::Accept, 1).0, Method::POST));
    }

    #[test]
    fn captcha_and_unsuccessful_responses_are_errors() {
        assert!(check_action_response(&Value::Null).is_ok());
        assert!(check_action_response(&json!({"success": true})).is_ok());
        assert!(check_action_response(&json!({"success": true, "isCaptchaRequired": false})).is_ok());
        assert!(check_action_response(&json!({"isCaptchaRequired": true})).unwrap_err().message.contains("captcha"));
        assert!(check_action_response(&json!({"success": false})).is_err());
    }

    #[test]
    fn parses_request_and_user_pages() {
        let page = json!({
            "nextPageCursor": "abc==",
            "data": [
                {"id": 7, "name": "bob", "displayName": "Bobby", "hasVerifiedBadge": true,
                 "friendRequest": {"sentAt": "2025-01-01T00:00:00Z", "senderId": 7}, "mutualFriendsList": ["a", "b"]},
                {"id": 0, "name": "bad"},
                {"id": 8, "name": "amy"},
            ]
        });
        let rows = parse_people(&page);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].user.display_name, "Bobby");
        assert!(rows[0].user.verified);
        assert_eq!(rows[0].relation, Some(Relation::RequestReceived));
        assert_eq!((rows[0].mutual_friends, rows[0].sent_at.as_deref()), (2, Some("2025-01-01T00:00:00Z")));
        assert_eq!(rows[1].user.display_name, "amy");
        assert_eq!(rows[1].relation, None);
        assert_eq!(next_cursor(&page).as_deref(), Some("abc=="));
        assert_eq!(next_cursor(&json!({"nextPageCursor": null})), None);
    }

    #[test]
    fn friendship_status_codes_map() {
        assert_eq!(relation_from(0), Some(Relation::NotFriends));
        assert_eq!(relation_from(2), Some(Relation::RequestSent));
        assert_eq!(relation_from(3), Some(Relation::RequestReceived));
        assert_eq!(relation_from(9), None);
    }
}
