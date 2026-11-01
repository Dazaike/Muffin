//! One-way import of the signed-in Roblox account's favorite (saved) games into the Muffin library.
//! Never writes to Roblox. Two steps so the user can preview: `sync_roblox_favorites` fetches and
//! diffs against the library and stages the result; `apply_roblox_favorites` applies it from the
//! staged copy (the frontend never sends game data back).
use std::collections::HashSet;
use std::sync::Mutex;

use reqwest::Method;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::db::{now_ms, Db};
use crate::error::{AppError, ErrorCode, Result};
use crate::launch::validate_place_id;
use crate::rbx_session::{active_user_id, authed_json, public_json};
use crate::store::{clean_icon_url, clean_name, library_get, library_list_conn, library_upsert_conn, to_db_id, LibraryUpsert};

/// Hard cap on games pulled in one sync.
const MAX_ITEMS: usize = 500;
const PAGE_SIZE: usize = 50;
/// Page-count guard so a misbehaving cursor can't loop forever.
const MAX_PAGES: usize = 30;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavGame {
    pub place_id: u64,
    pub universe_id: u64,
    pub name: String,
    pub creator: Option<String>,
    pub genre: Option<String>,
    pub icon_url: Option<String>,
    pub in_library: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoritesDiff {
    pub items: Vec<FavGame>,
    pub total: usize,
    pub new_count: usize,
    pub existing_count: usize,
    /// Games with no resolvable start place; they cannot be launched, so they are left out.
    pub skipped: usize,
    /// More favorites exist than the 500-game cap.
    pub truncated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub added: usize,
    pub already_present: usize,
}

#[derive(Default)]
pub struct FavoritesState(Mutex<Option<Vec<FavGame>>>);

impl FavoritesState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Vec<FavGame>>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

pub fn init(app: &AppHandle) {
    app.manage(FavoritesState::default());
}

// ---- parsing ---------------------------------------------------------------------------------

struct Row {
    universe_id: u64,
    name: String,
    place_id: Option<u64>,
    creator: Option<String>,
}

struct Page {
    rows: Vec<Row>,
    next: Option<String>,
}

fn bad_response() -> AppError {
    AppError::new(ErrorCode::Parse, "Unexpected response from Roblox")
}

/// `GET games/v2/users/{id}/favorite/games` → `{ nextPageCursor, data: [{ id (universe), name,
/// rootPlace: { id }, creator: { name } }] }`. Rows without an id or name are dropped.
fn parse_page(v: &Value) -> Result<Page> {
    let data = v["data"].as_array().ok_or_else(bad_response)?;
    let rows = data
        .iter()
        .filter_map(|r| {
            Some(Row {
                universe_id: r["id"].as_u64().filter(|id| *id > 0)?,
                name: r["name"].as_str()?.to_string(),
                place_id: r["rootPlace"]["id"]
                    .as_u64()
                    .or_else(|| r["rootPlaceId"].as_u64())
                    .filter(|id| *id > 0),
                creator: r["creator"]["name"].as_str().map(str::to_string),
            })
        })
        .collect();
    let next = v["nextPageCursor"].as_str().filter(|c| !c.is_empty()).map(str::to_string);
    Ok(Page { rows, next })
}

fn page_path(user_id: u64, cursor: Option<&str>) -> String {
    let mut path = format!("/v2/users/{user_id}/favorite/games?limit={PAGE_SIZE}&sortOrder=Desc");
    if let Some(c) = cursor {
        path.push_str("&cursor=");
        path.extend(url::form_urlencoded::byte_serialize(c.as_bytes()));
    }
    path
}

/// Turn fetched rows into diff entries: drops rows without a valid place, dedupes by place id
/// (first wins) and marks games already in the library.
fn build_diff(
    rows: Vec<Row>,
    in_library: &HashSet<u64>,
    icons: &std::collections::HashMap<u64, String>,
    genres: &std::collections::HashMap<u64, String>,
    truncated: bool,
) -> FavoritesDiff {
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    let mut skipped = 0;
    for r in rows {
        let place_id = match r.place_id.map(validate_place_id) {
            Some(Ok(p)) => p,
            _ => {
                skipped += 1;
                continue;
            }
        };
        if !seen.insert(place_id) {
            continue;
        }
        let Ok(name) = clean_name(&r.name) else {
            skipped += 1;
            continue;
        };
        items.push(FavGame {
            place_id,
            universe_id: r.universe_id,
            name,
            creator: r.creator,
            genre: genres.get(&r.universe_id).cloned(),
            icon_url: clean_icon_url(icons.get(&r.universe_id).cloned()),
            in_library: in_library.contains(&place_id),
        });
    }
    let existing_count = items.iter().filter(|i| i.in_library).count();
    FavoritesDiff {
        total: items.len(),
        new_count: items.len() - existing_count,
        existing_count,
        skipped,
        truncated,
        items,
    }
}

// ---- apply -----------------------------------------------------------------------------------

/// Insert games not already in the library (re-checked here, in one transaction). Existing rows
/// are never touched, so local flags and order are kept.
pub fn apply_items(
    conn: &mut Connection,
    items: &[FavGame],
    favorite: bool,
    now: i64,
) -> Result<ApplyResult> {
    let tx = conn.transaction()?;
    let (mut added, mut already_present) = (0, 0);
    for g in items {
        if library_get(&tx, to_db_id(g.place_id)?)?.is_some() {
            already_present += 1;
            continue;
        }
        library_upsert_conn(
            &tx,
            LibraryUpsert {
                place_id: g.place_id,
                universe_id: Some(g.universe_id),
                name: g.name.clone(),
                icon_url: g.icon_url.clone(),
                creator: g.creator.clone(),
                genre: g.genre.clone(),
                favorite,
                pinned: false,
                added_at: None,
                position: None,
            },
            now,
        )?;
        added += 1;
    }
    tx.commit()?;
    Ok(ApplyResult { added, already_present })
}

// ---- commands --------------------------------------------------------------------------------

/// Best-effort extras (genre, icons, fallback start place) for up to 50 universes at a time.
/// Failures are ignored: the favorites themselves are already in hand.
async fn enrich(
    app: &AppHandle,
    rows: &mut [Row],
) -> (std::collections::HashMap<u64, String>, std::collections::HashMap<u64, String>) {
    let mut icons = std::collections::HashMap::new();
    let mut genres = std::collections::HashMap::new();
    let ids: Vec<u64> = rows.iter().map(|r| r.universe_id).collect();
    for chunk in ids.chunks(PAGE_SIZE) {
        let list = chunk.iter().map(u64::to_string).collect::<Vec<_>>().join(",");
        if let Ok(v) = public_json(app, "games", &format!("/v1/games?universeIds={list}")).await {
            for g in v["data"].as_array().into_iter().flatten() {
                let Some(uid) = g["id"].as_u64() else { continue };
                if let Some(genre) = g["genre"].as_str().filter(|s| !s.is_empty() && *s != "All") {
                    genres.insert(uid, genre.to_string());
                }
                if let Some(row) = rows.iter_mut().find(|r| r.universe_id == uid) {
                    if row.place_id.is_none() {
                        row.place_id = g["rootPlaceId"].as_u64().filter(|id| *id > 0);
                    }
                    if row.creator.is_none() {
                        row.creator = g["creator"]["name"].as_str().map(str::to_string);
                    }
                }
            }
        }
        let path = format!(
            "/v1/games/icons?universeIds={list}&size=256x256&format=Webp&returnPolicy=PlaceHolder"
        );
        if let Ok(v) = public_json(app, "thumbnails", &path).await {
            for t in v["data"].as_array().into_iter().flatten() {
                if t["state"].as_str() == Some("Completed") {
                    if let (Some(id), Some(url)) = (t["targetId"].as_u64(), t["imageUrl"].as_str()) {
                        icons.insert(id, url.to_string());
                    }
                }
            }
        }
    }
    (icons, genres)
}

/// Fetch every saved game of the active Roblox account (≤ 500) and diff it against the library.
/// `auth_expired` when nobody is signed in. Read-only on both sides; stages the result.
#[tauri::command]
pub async fn sync_roblox_favorites(
    app: AppHandle,
    db: State<'_, Db>,
    state: State<'_, FavoritesState>,
) -> Result<FavoritesDiff> {
    let user_id = active_user_id(&app)?;
    let mut rows: Vec<Row> = Vec::new();
    let mut cursor: Option<String> = None;
    let mut truncated = false;
    let mut pages = 0;
    loop {
        pages += 1;
        let path = page_path(user_id, cursor.as_deref());
        let page = parse_page(&authed_json(&app, Method::GET, "games", &path, None).await?)?;
        rows.extend(page.rows);
        cursor = page.next;
        if rows.len() > MAX_ITEMS {
            rows.truncate(MAX_ITEMS);
            truncated = true;
            break;
        }
        match &cursor {
            None => break,
            Some(_) if rows.len() == MAX_ITEMS => {
                truncated = true;
                break;
            }
            Some(c) if c.len() > 2048 => return Err(bad_response()),
            Some(_) if pages >= MAX_PAGES => {
                truncated = true;
                break;
            }
            Some(_) => {}
        }
    }

    let (icons, genres) = enrich(&app, &mut rows).await;
    let owned: HashSet<u64> = db
        .with(|c| library_list_conn(c))?
        .into_iter()
        .map(|e| e.place_id)
        .collect();
    let diff = build_diff(rows, &owned, &icons, &genres, truncated);
    *state.lock() = Some(diff.items.clone());
    Ok(diff)
}

/// Add the staged games that aren't in the library yet. `add_to_library` and `mark_favorite` are
/// the user's two choices; marking a favorite implies adding the game. Existing entries are
/// left exactly as they are.
#[tauri::command(async)]
pub fn apply_roblox_favorites(
    db: State<'_, Db>,
    state: State<'_, FavoritesState>,
    add_to_library: bool,
    mark_favorite: bool,
) -> Result<ApplyResult> {
    if !add_to_library && !mark_favorite {
        return Err(AppError::invalid("Choose at least one option"));
    }
    let items = state
        .lock()
        .clone()
        .ok_or_else(|| AppError::invalid("Check your Roblox favorites first"))?;
    let result = db.with(|c| apply_items(c, &items, mark_favorite, now_ms()))?;
    *state.lock() = None;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn parses_a_page() {
        let v = json!({
            "previousPageCursor": null,
            "nextPageCursor": "abc_1==",
            "data": [
                {"id": 11, "name": "A", "creator": {"id": 1, "type": "User", "name": "Dev"}, "rootPlace": {"id": 111, "type": "Place"}},
                {"id": 12, "name": "No place"},
                {"id": 0, "name": "Zero universe", "rootPlace": {"id": 5}},
                {"name": "No id", "rootPlace": {"id": 5}},
                {"id": 13, "rootPlace": {"id": 5}},
                {"id": 14, "name": "Flat", "rootPlaceId": 144}
            ]
        });
        let p = parse_page(&v).unwrap();
        assert_eq!(p.next.as_deref(), Some("abc_1=="));
        let got: Vec<_> = p.rows.iter().map(|r| (r.universe_id, r.place_id, r.creator.clone())).collect();
        assert_eq!(got, vec![(11, Some(111), Some("Dev".into())), (12, None, None), (14, Some(144), None)]);

        assert!(parse_page(&json!({"data": null})).is_err());
        assert!(parse_page(&json!({})).is_err());
        assert!(parse_page(&json!({"data": [], "nextPageCursor": ""})).unwrap().next.is_none());
    }

    #[test]
    fn cursor_is_url_encoded_in_the_path() {
        assert_eq!(
            page_path(7, None),
            "/v2/users/7/favorite/games?limit=50&sortOrder=Desc"
        );
        let p = page_path(7, Some("a b&c=d/+"));
        assert!(p.ends_with("&cursor=a+b%26c%3Dd%2F%2B"), "{p}");
        // Whatever the cursor holds, the result is still a valid endpoint for the allowlist.
        assert!(crate::rbx_session::resolve("games", &p).is_ok());
    }

    fn row(universe_id: u64, place_id: Option<u64>, name: &str) -> Row {
        Row {
            universe_id,
            name: name.into(),
            place_id,
            creator: None,
        }
    }

    #[test]
    fn diff_dedupes_marks_existing_and_drops_unlaunchable() {
        let rows = vec![
            row(1, Some(10), "Ten"),
            row(2, Some(20), "Twenty"),
            row(3, None, "No place"),
            row(4, Some(10), "Ten again"),
            row(5, Some(50), "   "),
            row(6, Some(0), "Zero"),
        ];
        let owned: HashSet<u64> = [20].into();
        let icons = HashMap::from([
            (1, "https://tr.rbxcdn.com/a.webp".to_string()),
            (2, "https://evil.example/b.webp".to_string()),
        ]);
        let genres = HashMap::from([(1, "Adventure".to_string())]);
        let d = build_diff(rows, &owned, &icons, &genres, true);
        assert_eq!(d.items.iter().map(|i| i.place_id).collect::<Vec<_>>(), vec![10, 20]);
        assert_eq!((d.total, d.new_count, d.existing_count, d.skipped, d.truncated), (2, 1, 1, 3, true));
        assert_eq!(d.items[0].icon_url.as_deref(), Some("https://tr.rbxcdn.com/a.webp"));
        assert_eq!(d.items[0].genre.as_deref(), Some("Adventure"));
        assert_eq!(d.items[1].icon_url, None, "non-rbxcdn icons are dropped");
        assert!(!d.items[0].in_library && d.items[1].in_library);
    }

    fn game(place_id: u64, name: &str) -> FavGame {
        FavGame {
            place_id,
            universe_id: place_id + 1000,
            name: name.into(),
            creator: Some("Dev".into()),
            genre: Some("Obby".into()),
            icon_url: None,
            in_library: false,
        }
    }

    #[test]
    fn apply_adds_only_missing_and_keeps_local_state() {
        let mut c = test_conn();
        library_upsert_conn(
            &c,
            LibraryUpsert {
                place_id: 2,
                universe_id: None,
                name: "Mine".into(),
                icon_url: None,
                creator: None,
                genre: None,
                favorite: false,
                pinned: true,
                added_at: Some(5),
                position: Some(0),
            },
            5,
        )
        .unwrap();

        let items = [game(1, "One"), game(2, "Two (roblox name)"), game(3, "Three")];
        let r = apply_items(&mut c, &items, true, 100).unwrap();
        assert_eq!(r, ApplyResult { added: 2, already_present: 1 });

        let two = library_get(&c, 2).unwrap().unwrap();
        assert_eq!((two.name.as_str(), two.favorite, two.pinned, two.position), ("Mine", false, true, 0));
        let one = library_get(&c, 1).unwrap().unwrap();
        assert!(one.favorite && !one.pinned);
        assert_eq!((one.universe_id, one.genre.as_deref(), one.added_at), (Some(1001), Some("Obby"), 100));
        let order: Vec<u64> = library_list_conn(&c).unwrap().iter().map(|e| e.place_id).collect();
        assert_eq!(order, vec![2, 1, 3]);

        // Library-only mode: not favorited. Re-running adds nothing.
        let mut c2 = test_conn();
        apply_items(&mut c2, &items, false, 1).unwrap();
        assert!(!library_get(&c2, 1).unwrap().unwrap().favorite);
        assert_eq!(apply_items(&mut c2, &items, false, 2).unwrap(), ApplyResult { added: 0, already_present: 3 });
    }
}
