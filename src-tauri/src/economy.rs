//! Robux transaction history (read-only) and private-server ("VIP server") management for the
//! ACTIVE account. Every request goes through `rbx_session` (cookie + CSRF never leave Rust).
//!
//! Endpoint status (see the per-section notes):
//! * VERIFIED live (unauthenticated probe this session): `apis.roblox.com/private-servers-api/
//!   Universe-Private-Server-Settings` (returns price/availability), and that every other path
//!   below exists (401 "Authentication token is missing" rather than 404).
//! * UNVERIFIED live (needs a signed-in cookie): all authenticated response shapes and the
//!   request bodies of the PATCH/POST calls. Shapes follow Roblox's published reference
//!   (create.roblox.com/docs/cloud/reference/features/private-servers, economy v2 reference) and
//!   are parsed leniently; anything unexpected surfaces as a `parse`/`http_status` error.
//!
//! Spending Robux is only ever done by [`private_server_purchase`]: it re-reads the live price,
//! refuses when it differs from `expected_price`, refuses when the balance is too low, refuses
//! concurrent purchases and is never retried.

use std::sync::atomic::{AtomicBool, Ordering};

use reqwest::Method;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::error::{AppError, ErrorCode, Result};
use crate::launch::parse_share_link;
use crate::rbx_session::{active_user_id, authed_json, public_json};

/// Largest id that survives a round trip through a JS number.
const MAX_ID: u64 = 1 << 53;
const MAX_CURSOR_CHARS: usize = 2048;
const MAX_SERVER_NAME_CHARS: usize = 50;
/// Upper bound on a Robux price we are willing to send (sanity check, not a Roblox rule).
const MAX_PRICE: u64 = 1_000_000_000;
/// `my-private-servers` is walked at most this many pages when looking for one game's servers.
const MAX_OWNED_PAGES: usize = 6;
const OWNED_PAGE_SIZE: &str = "25";
const TX_LIMITS: [u32; 4] = [10, 25, 50, 100];
const DEFAULT_TX_LIMIT: u32 = 100;

// ---- validation & URL builders ---------------------------------------------------------------

fn id(n: u64, what: &str) -> Result<u64> {
    if n == 0 || n > MAX_ID {
        Err(AppError::invalid(format!("Invalid {what}")))
    } else {
        Ok(n)
    }
}

fn clean_cursor(cursor: Option<String>) -> Result<Option<String>> {
    match cursor {
        None => Ok(None),
        Some(c) if c.is_empty() => Ok(None),
        Some(c) if c.chars().count() > MAX_CURSOR_CHARS || c.chars().any(|ch| ch.is_control() || ch.is_whitespace()) => {
            Err(AppError::invalid("Invalid page cursor"))
        }
        Some(c) => Ok(Some(c)),
    }
}

fn clean_server_name(name: &str) -> Result<String> {
    let name = name.trim();
    let len = name.chars().count();
    if len == 0 || len > MAX_SERVER_NAME_CHARS || name.chars().any(char::is_control) {
        return Err(AppError::invalid(format!(
            "Server name must be 1–{MAX_SERVER_NAME_CHARS} characters"
        )));
    }
    Ok(name.to_owned())
}

/// `path?query` with the query percent-encoded by the `url` crate (no manual string gluing).
fn path_with_query(path: &str, query: &[(&str, &str)]) -> String {
    let mut url = url::Url::parse("https://example.invalid/").expect("static url");
    url.set_path(path);
    if !query.is_empty() {
        url.query_pairs_mut().extend_pairs(query);
    }
    match url.query() {
        Some(q) => format!("{}?{q}", url.path()),
        None => url.path().to_owned(),
    }
}

/// Transaction types the Wallet exposes. Subset of the documented `transactionType` enum
/// (Sale, Purchase, AffiliateSale, DevEx, GroupPayout, AdImpressionPayout, CurrencyPurchase,
/// TradeRobux, PremiumStipend, PendingRobux, EngagementPayout, GroupEngagementPayout, AdSpend,
/// Summary, IndividualToGroup, CSAdjustment). Group/DevEx/ad types are not user-wallet history.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TxKind {
    Purchase,
    Sale,
    CurrencyPurchase,
    PremiumStipend,
    TradeRobux,
    EngagementPayout,
    AffiliateSale,
    PendingRobux,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Direction {
    In,
    Out,
    /// Sign comes from Roblox (trades can go either way).
    Mixed,
}

impl TxKind {
    pub fn parse(s: &str) -> Result<Self> {
        Ok(match s {
            "Purchase" => Self::Purchase,
            "Sale" => Self::Sale,
            "CurrencyPurchase" => Self::CurrencyPurchase,
            "PremiumStipend" => Self::PremiumStipend,
            "TradeRobux" => Self::TradeRobux,
            "EngagementPayout" => Self::EngagementPayout,
            "AffiliateSale" => Self::AffiliateSale,
            "PendingRobux" => Self::PendingRobux,
            _ => return Err(AppError::invalid("Unknown transaction type")),
        })
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Purchase => "Purchase",
            Self::Sale => "Sale",
            Self::CurrencyPurchase => "CurrencyPurchase",
            Self::PremiumStipend => "PremiumStipend",
            Self::TradeRobux => "TradeRobux",
            Self::EngagementPayout => "EngagementPayout",
            Self::AffiliateSale => "AffiliateSale",
            Self::PendingRobux => "PendingRobux",
        }
    }

    fn direction(self) -> Direction {
        match self {
            Self::Purchase => Direction::Out,
            Self::TradeRobux => Direction::Mixed,
            _ => Direction::In,
        }
    }
}

/// Amount with a sign that matches the direction of money for this type, regardless of whether
/// Roblox reports spends as negative or positive numbers.
pub fn signed_amount(kind: TxKind, raw: i64) -> i64 {
    match kind.direction() {
        Direction::Out => -raw.checked_abs().unwrap_or(i64::MAX),
        Direction::In => raw.checked_abs().unwrap_or(i64::MAX),
        Direction::Mixed => raw,
    }
}

fn check_tx_limit(limit: Option<u32>) -> Result<u32> {
    let limit = limit.unwrap_or(DEFAULT_TX_LIMIT);
    if TX_LIMITS.contains(&limit) {
        Ok(limit)
    } else {
        Err(AppError::invalid("Page size must be 10, 25, 50 or 100"))
    }
}

/// `sortOrder=Desc` is explicit: the documented default is `Asc` (oldest first).
fn transactions_path(user_id: u64, kind: TxKind, limit: u32, cursor: Option<&str>) -> Result<String> {
    let user_id = id(user_id, "user id")?;
    let limit = limit.to_string();
    let mut query = vec![
        ("transactionType", kind.as_str()),
        ("limit", limit.as_str()),
        ("sortOrder", "Desc"),
    ];
    if let Some(c) = cursor {
        query.push(("cursor", c));
    }
    Ok(path_with_query(&format!("/v2/users/{user_id}/transactions"), &query))
}

fn my_servers_path(cursor: Option<&str>) -> String {
    let mut query = vec![("itemsPerPage", OWNED_PAGE_SIZE)];
    if let Some(c) = cursor {
        query.push(("cursor", c));
    }
    path_with_query("/v1/private-servers/my-private-servers", &query)
}

fn vip_server_path(server_id: u64) -> Result<String> {
    Ok(format!("/v1/vip-servers/{}", id(server_id, "server id")?))
}

fn vip_subscription_path(server_id: u64) -> Result<String> {
    Ok(format!("/v1/vip-servers/{}/subscription", id(server_id, "server id")?))
}

fn purchase_path(universe_id: u64) -> Result<String> {
    Ok(format!("/v1/games/vip-servers/{}", id(universe_id, "universe id")?))
}

/// Undocumented but live-verified (unauthenticated) price / availability endpoint.
fn settings_path(universe_id: u64) -> Result<String> {
    let universe_id = id(universe_id, "universe id")?.to_string();
    Ok(path_with_query(
        "/private-servers-api/Universe-Private-Server-Settings",
        &[("universeId", &universe_id)],
    ))
}

// ---- PATCH / POST bodies ---------------------------------------------------------------------
// UNVERIFIED live: field names follow Roblox's `UpdateVipServerRequest` (name / newJoinCode /
// active) and the purchase body (name / expectedPrice).

fn rename_body(name: &str) -> Value {
    json!({ "name": name })
}

fn regenerate_body() -> Value {
    json!({ "newJoinCode": true })
}

fn active_body(active: bool) -> Value {
    json!({ "active": active })
}

fn cancel_subscription_body() -> Value {
    json!({ "active": false })
}

fn purchase_body(name: &str, expected_price: u64) -> Value {
    json!({ "name": name, "expectedPrice": expected_price })
}

// ---- JSON helpers ----------------------------------------------------------------------------

fn as_u64(v: &Value) -> Option<u64> {
    v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

fn as_i64(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

fn str_of(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_owned)
}

fn next_cursor(v: &Value) -> Option<String> {
    str_of(v, "nextPageCursor")
}

fn parse_err(what: &str) -> AppError {
    AppError::new(ErrorCode::Parse, format!("Unexpected {what} response from Roblox"))
}

// ---- balance ---------------------------------------------------------------------------------

fn parse_balance(v: &Value) -> Result<u64> {
    v.get("robux").and_then(as_u64).ok_or_else(|| parse_err("balance"))
}

async fn fetch_balance(app: &AppHandle) -> Result<u64> {
    parse_balance(&authed_json(app, Method::GET, "economy", "/v1/user/currency", None).await?)
}

/// Current Robux balance of the active account (`GET economy /v1/user/currency`; UNVERIFIED live).
#[tauri::command]
pub async fn economy_balance(app: AppHandle) -> Result<u64> {
    active_user_id(&app)?;
    fetch_balance(&app).await
}

// ---- transaction history ---------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    pub id: i64,
    /// ISO-8601 timestamp as sent by Roblox.
    pub created: String,
    /// Signed by direction (see [`signed_amount`]); in `currency` units.
    pub amount: i64,
    pub currency: String,
    pub is_pending: bool,
    /// Item / product name from `details.name` when present.
    pub name: Option<String>,
    /// `details.type` (e.g. "Asset", "GamePass", "DeveloperProduct") when present.
    pub item_type: Option<String>,
    /// Game the item belongs to (`details.place.name`) when present.
    pub place: Option<String>,
    /// The other party (`agent.name`).
    pub agent: Option<String>,
    pub agent_kind: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageTotals {
    pub count: usize,
    /// Sum of settled Robux received on this page.
    pub income: i64,
    /// Sum of settled Robux spent on this page (positive number).
    pub spent: i64,
    /// `income - spent`.
    pub net: i64,
    pub pending_count: usize,
    /// Sum of pending Robux (not included above).
    pub pending: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionPage {
    pub kind: String,
    pub items: Vec<Transaction>,
    pub next_cursor: Option<String>,
    pub totals: PageTotals,
}

fn parse_transaction(kind: TxKind, v: &Value) -> Transaction {
    let currency = v.get("currency");
    let details = v.get("details");
    let agent = v.get("agent");
    let raw = currency.and_then(|c| c.get("amount")).and_then(as_i64).unwrap_or(0);
    Transaction {
        id: v.get("id").and_then(as_i64).unwrap_or(0),
        created: str_of(v, "created").unwrap_or_default(),
        amount: signed_amount(kind, raw),
        currency: currency.and_then(|c| str_of(c, "type")).unwrap_or_else(|| "Robux".to_owned()),
        is_pending: v.get("isPending").and_then(Value::as_bool).unwrap_or(false),
        name: details.and_then(|d| str_of(d, "name")),
        item_type: details.and_then(|d| str_of(d, "type")),
        place: details.and_then(|d| d.get("place")).and_then(|p| str_of(p, "name")),
        agent: agent.and_then(|a| str_of(a, "name")),
        agent_kind: agent.and_then(|a| str_of(a, "type")),
    }
}

fn parse_transactions(kind: TxKind, body: &Value) -> Result<(Vec<Transaction>, Option<String>)> {
    let data = body.get("data").and_then(Value::as_array).ok_or_else(|| parse_err("transactions"))?;
    Ok((data.iter().map(|v| parse_transaction(kind, v)).collect(), next_cursor(body)))
}

/// Totals over one page. Only Robux rows count; pending rows are reported separately.
pub fn page_totals(items: &[Transaction]) -> PageTotals {
    let mut t = PageTotals { count: items.len(), ..PageTotals::default() };
    for tx in items.iter().filter(|tx| tx.currency == "Robux") {
        if tx.is_pending {
            t.pending_count += 1;
            t.pending = t.pending.saturating_add(tx.amount);
        } else if tx.amount >= 0 {
            t.income = t.income.saturating_add(tx.amount);
        } else {
            t.spent = t.spent.saturating_add(tx.amount.saturating_neg());
        }
    }
    t.net = t.income.saturating_sub(t.spent);
    t
}

/// One page of Robux transaction history for the active account, newest first.
/// `GET economy /v2/users/{id}/transactions` (UNVERIFIED live; read-only).
#[tauri::command]
pub async fn economy_transactions(
    app: AppHandle,
    kind: String,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<TransactionPage> {
    let kind = TxKind::parse(&kind)?;
    let limit = check_tx_limit(limit)?;
    let cursor = clean_cursor(cursor)?;
    let user_id = active_user_id(&app)?;
    let path = transactions_path(user_id, kind, limit, cursor.as_deref())?;
    let body = authed_json(&app, Method::GET, "economy", &path, None).await?;
    let (items, next_cursor) = parse_transactions(kind, &body)?;
    let totals = page_totals(&items);
    Ok(TransactionPage { kind: kind.as_str().to_owned(), items, next_cursor, totals })
}

// ---- private servers: pricing ----------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSettings {
    pub universe_id: u64,
    pub available: bool,
    /// Robux per month; 0 when free / unavailable.
    pub price: u64,
    /// Roblox lists a discount for this account/game: the effective price is not what `price`
    /// says, so Muffin refuses to purchase in-app.
    pub has_discounts: bool,
}

fn parse_server_settings(universe_id: u64, body: &Value) -> Result<ServerSettings> {
    let data = body.get("privateServerData").ok_or_else(|| parse_err("private server settings"))?;
    Ok(ServerSettings {
        universe_id,
        available: data.get("isAvailable").and_then(Value::as_bool).unwrap_or(false),
        price: data.get("price").and_then(as_u64).unwrap_or(0),
        has_discounts: data.get("discounts").and_then(Value::as_array).is_some_and(|d| !d.is_empty()),
    })
}

async fn fetch_settings(app: &AppHandle, universe_id: u64) -> Result<ServerSettings> {
    let path = settings_path(universe_id)?;
    parse_server_settings(universe_id, &public_json(app, "apis", &path).await?)
}

/// Availability and monthly price of private servers for a game (public; works signed out).
/// `GET apis /private-servers-api/Universe-Private-Server-Settings?universeId=` (VERIFIED live).
#[tauri::command]
pub async fn private_server_settings(app: AppHandle, universe_id: u64) -> Result<ServerSettings> {
    fetch_settings(&app, universe_id).await
}

// ---- private servers: owned list & detail ----------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnedServer {
    /// Needed for management calls. `None` when Roblox's list item carried no recognisable id.
    pub id: Option<u64>,
    pub name: String,
    pub active: bool,
    pub universe_id: u64,
    pub place_id: u64,
    pub owner_id: Option<u64>,
    pub owner_name: Option<String>,
}

fn parse_owned_servers(body: &Value) -> Result<(Vec<OwnedServer>, Option<String>)> {
    let data = body.get("data").and_then(Value::as_array).ok_or_else(|| parse_err("private servers"))?;
    let servers = data
        .iter()
        .map(|v| OwnedServer {
            id: ["id", "vipServerId", "privateServerId"].iter().find_map(|k| v.get(*k).and_then(as_u64)),
            name: str_of(v, "name").unwrap_or_else(|| "Private server".to_owned()),
            active: v.get("active").and_then(Value::as_bool).unwrap_or(false),
            universe_id: v.get("universeId").and_then(as_u64).unwrap_or(0),
            place_id: v.get("placeId").and_then(as_u64).unwrap_or(0),
            owner_id: v.get("ownerId").and_then(as_u64),
            owner_name: str_of(v, "ownerName"),
        })
        .collect();
    Ok((servers, next_cursor(body)))
}

/// Private servers the active account owns for one game (walks `my-private-servers`, at most
/// [`MAX_OWNED_PAGES`] pages, keeping rows whose `universeId` matches).
/// `GET games /v1/private-servers/my-private-servers` (UNVERIFIED live; per-item id field name
/// is inferred, rows without one are listed but cannot be managed).
#[tauri::command]
pub async fn private_servers_owned(app: AppHandle, universe_id: u64) -> Result<Vec<OwnedServer>> {
    let universe_id = id(universe_id, "universe id")?;
    let user_id = active_user_id(&app)?;
    let mut out = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..MAX_OWNED_PAGES {
        let path = my_servers_path(cursor.as_deref());
        let body = authed_json(&app, Method::GET, "games", &path, None).await?;
        let (page, next) = parse_owned_servers(&body)?;
        out.extend(
            page.into_iter()
                .filter(|s| s.universe_id == universe_id && s.owner_id.is_none_or(|o| o == user_id)),
        );
        match next {
            Some(n) => cursor = Some(n),
            None => break,
        }
    }
    Ok(out)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub active: bool,
    pub expired: bool,
    pub expiration_date: Option<String>,
    pub price: Option<u64>,
    pub can_renew: bool,
    pub has_insufficient_funds: bool,
    pub has_price_changed: bool,
    pub has_recurring_profile: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerDetail {
    pub id: u64,
    pub name: String,
    pub active: bool,
    pub game_name: Option<String>,
    pub universe_id: Option<u64>,
    pub place_id: Option<u64>,
    /// Roblox's `link`, only when it is a launchable `roblox.com/share?code=…&type=Server` link
    /// (validated by `launch::parse_share_link`, the same parser the paste flow uses).
    pub share_link: Option<String>,
    /// Roblox returned a link, but in the legacy `?privateServerLinkCode=` form Muffin cannot
    /// launch. The user must copy the share link from roblox.com instead.
    pub link_is_legacy: bool,
    pub subscription: Option<Subscription>,
}

/// `(launchable share link, link present but legacy)`.
fn classify_link(link: Option<&str>) -> (Option<String>, bool) {
    match link.map(str::trim).filter(|l| !l.is_empty()) {
        None => (None, false),
        Some(l) if parse_share_link(l).is_ok() => (Some(l.to_owned()), false),
        Some(_) => (None, true),
    }
}

fn parse_subscription(v: &Value) -> Subscription {
    let flag = |k: &str| v.get(k).and_then(Value::as_bool).unwrap_or(false);
    Subscription {
        active: flag("active"),
        expired: flag("expired"),
        expiration_date: str_of(v, "expirationDate"),
        price: v.get("price").and_then(as_u64),
        can_renew: flag("canRenew"),
        has_insufficient_funds: flag("hasInsufficientFunds"),
        has_price_changed: flag("hasPriceChanged"),
        has_recurring_profile: flag("hasRecurringProfile"),
    }
}

fn parse_server_detail(body: &Value) -> Result<ServerDetail> {
    let server_id = body.get("id").and_then(as_u64).ok_or_else(|| parse_err("private server"))?;
    let game = body.get("game");
    let (share_link, link_is_legacy) = classify_link(body.get("link").and_then(Value::as_str));
    Ok(ServerDetail {
        id: server_id,
        name: str_of(body, "name").unwrap_or_else(|| "Private server".to_owned()),
        active: body.get("active").and_then(Value::as_bool).unwrap_or(false),
        game_name: game.and_then(|g| str_of(g, "name")),
        universe_id: game.and_then(|g| g.get("id")).and_then(as_u64),
        place_id: game.and_then(|g| g.get("rootPlace")).and_then(|p| p.get("id")).and_then(as_u64),
        share_link,
        link_is_legacy,
        subscription: body.get("subscription").filter(|s| s.is_object()).map(parse_subscription),
    })
}

async fn fetch_detail(app: &AppHandle, server_id: u64) -> Result<ServerDetail> {
    let path = vip_server_path(server_id)?;
    parse_server_detail(&authed_json(app, Method::GET, "games", &path, None).await?)
}

/// Settings, subscription and (when launchable) share link of one owned server.
/// `GET games /v1/vip-servers/{id}` (UNVERIFIED live).
#[tauri::command]
pub async fn private_server_detail(app: AppHandle, server_id: u64) -> Result<ServerDetail> {
    active_user_id(&app)?;
    fetch_detail(&app, server_id).await
}

// ---- private servers: management (free, no Robux spent) --------------------------------------

async fn patch_server(app: &AppHandle, server_id: u64, body: Value) -> Result<ServerDetail> {
    active_user_id(app)?;
    let path = vip_server_path(server_id)?;
    authed_json(app, Method::PATCH, "games", &path, Some(body)).await?;
    // Re-read instead of trusting the PATCH echo, so the UI always shows server truth.
    fetch_detail(app, server_id).await
}

/// `PATCH games /v1/vip-servers/{id}` `{name}` (UNVERIFIED live).
#[tauri::command]
pub async fn private_server_rename(app: AppHandle, server_id: u64, name: String) -> Result<ServerDetail> {
    let name = clean_server_name(&name)?;
    patch_server(&app, server_id, rename_body(&name)).await
}

/// Invalidates the old link: anyone holding it can no longer join.
/// `PATCH games /v1/vip-servers/{id}` `{newJoinCode:true}` (UNVERIFIED live).
#[tauri::command]
pub async fn private_server_regenerate_link(app: AppHandle, server_id: u64) -> Result<ServerDetail> {
    patch_server(&app, server_id, regenerate_body()).await
}

/// Enable / disable joining. `PATCH games /v1/vip-servers/{id}` `{active}` (UNVERIFIED live).
#[tauri::command]
pub async fn private_server_set_active(app: AppHandle, server_id: u64, active: bool) -> Result<ServerDetail> {
    patch_server(&app, server_id, active_body(active)).await
}

/// Stops the monthly renewal (the server keeps working until the paid period ends).
/// `PATCH games /v1/vip-servers/{id}/subscription` `{active:false}` (UNVERIFIED live).
#[tauri::command]
pub async fn private_server_cancel_subscription(app: AppHandle, server_id: u64) -> Result<ServerDetail> {
    active_user_id(&app)?;
    let path = vip_subscription_path(server_id)?;
    authed_json(&app, Method::PATCH, "games", &path, Some(cancel_subscription_body())).await?;
    fetch_detail(&app, server_id).await
}

// ---- private servers: purchase (spends Robux) ------------------------------------------------

/// Pure purchase gate. `balance` is `None` only when the price is 0 (no balance lookup needed).
pub fn check_purchase(expected_price: u64, live: &ServerSettings, balance: Option<u64>) -> Result<()> {
    if !live.available {
        return Err(AppError::invalid("Private servers aren't available for this game"));
    }
    if live.has_discounts {
        return Err(AppError::invalid(
            "Roblox applies a discount to this server, so the final price can't be confirmed here. Purchase it on roblox.com instead.",
        ));
    }
    if live.price != expected_price {
        return Err(AppError::invalid(format!(
            "The price changed: you confirmed {expected_price} Robux but it is now {} Robux. Nothing was charged — review the new price and try again.",
            live.price
        )));
    }
    if live.price > 0 {
        let have = balance.ok_or_else(|| AppError::invalid("Couldn't read your Robux balance"))?;
        if have < live.price {
            return Err(AppError::invalid(format!(
                "Not enough Robux: this costs {} and you have {have}.",
                live.price
            )));
        }
    }
    Ok(())
}

static PURCHASE_BUSY: AtomicBool = AtomicBool::new(false);

/// Holds the single in-flight-purchase slot; released on drop.
struct BusyGuard<'a>(&'a AtomicBool);

impl<'a> BusyGuard<'a> {
    fn acquire(flag: &'a AtomicBool) -> Result<Self> {
        if flag.swap(true, Ordering::SeqCst) {
            Err(AppError::invalid("A purchase is already in progress"))
        } else {
            Ok(Self(flag))
        }
    }
}

impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseResult {
    pub server_id: u64,
    pub name: String,
    pub price: u64,
}

fn parse_purchase(body: &Value, fallback_name: &str, price: u64) -> Result<PurchaseResult> {
    let server_id = ["vipServerId", "id"]
        .iter()
        .find_map(|k| body.get(*k).and_then(as_u64))
        .ok_or_else(|| {
            AppError::new(
                ErrorCode::Parse,
                "Roblox accepted the purchase but returned no server id — check My Private Servers on roblox.com",
            )
        })?;
    Ok(PurchaseResult { server_id, name: str_of(body, "name").unwrap_or_else(|| fallback_name.to_owned()), price })
}

/// Buys (or, when the price is 0, creates) a private server for `universe_id`.
///
/// Safety rails: `expected_price` must equal the live price; the balance must cover it; only one
/// purchase can run at a time; the request is sent once and never retried by Muffin.
/// `POST games /v1/games/vip-servers/{universeId}` `{name, expectedPrice}` (UNVERIFIED live).
#[tauri::command]
pub async fn private_server_purchase(
    app: AppHandle,
    universe_id: u64,
    name: String,
    expected_price: u64,
) -> Result<PurchaseResult> {
    let universe_id = id(universe_id, "universe id")?;
    let name = clean_server_name(&name)?;
    if expected_price > MAX_PRICE {
        return Err(AppError::invalid("Invalid price"));
    }
    active_user_id(&app)?;
    let _slot = BusyGuard::acquire(&PURCHASE_BUSY)?;

    let live = fetch_settings(&app, universe_id).await?;
    let balance = if live.price > 0 { Some(fetch_balance(&app).await?) } else { None };
    check_purchase(expected_price, &live, balance)?;

    let path = purchase_path(universe_id)?;
    let body = authed_json(&app, Method::POST, "games", &path, Some(purchase_body(&name, live.price))).await?;
    parse_purchase(&body, &name, live.price)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(available: bool, price: u64, discounts: bool) -> ServerSettings {
        ServerSettings { universe_id: 1, available, price, has_discounts: discounts }
    }

    // -- URL builders / validators

    #[test]
    fn transactions_path_is_desc_and_encodes_cursor() {
        let p = transactions_path(42, TxKind::Purchase, 100, None).unwrap();
        assert_eq!(p, "/v2/users/42/transactions?transactionType=Purchase&limit=100&sortOrder=Desc");
        let p = transactions_path(42, TxKind::Sale, 25, Some("a+b/c=&x=1")).unwrap();
        assert!(p.starts_with("/v2/users/42/transactions?transactionType=Sale&limit=25&sortOrder=Desc&cursor="));
        let cursor = p.split("cursor=").nth(1).unwrap();
        assert!(!cursor.contains('&') && !cursor.contains('/'), "cursor not encoded: {cursor}");
        assert!(transactions_path(0, TxKind::Sale, 10, None).is_err());
    }

    #[test]
    fn tx_kind_is_a_strict_allowlist() {
        for ok in ["Purchase", "Sale", "CurrencyPurchase", "PremiumStipend", "TradeRobux", "EngagementPayout", "AffiliateSale", "PendingRobux"] {
            assert_eq!(TxKind::parse(ok).unwrap().as_str(), ok);
        }
        for bad in ["", "purchase", "Summary", "GroupPayout", "Purchase&x=1", "../Sale"] {
            assert!(TxKind::parse(bad).is_err(), "{bad} accepted");
        }
    }

    #[test]
    fn tx_limit_only_allows_documented_sizes() {
        assert_eq!(check_tx_limit(None).unwrap(), 100);
        assert_eq!(check_tx_limit(Some(25)).unwrap(), 25);
        assert!(check_tx_limit(Some(0)).is_err());
        assert!(check_tx_limit(Some(101)).is_err());
    }

    #[test]
    fn cursor_validation() {
        assert_eq!(clean_cursor(None).unwrap(), None);
        assert_eq!(clean_cursor(Some(String::new())).unwrap(), None);
        assert_eq!(clean_cursor(Some("abc_-=".into())).unwrap().as_deref(), Some("abc_-="));
        assert!(clean_cursor(Some("a b".into())).is_err());
        assert!(clean_cursor(Some("a\nb".into())).is_err());
        assert!(clean_cursor(Some("x".repeat(MAX_CURSOR_CHARS + 1))).is_err());
    }

    #[test]
    fn server_name_validation() {
        assert_eq!(clean_server_name("  My server ").unwrap(), "My server");
        assert!(clean_server_name("   ").is_err());
        assert!(clean_server_name(&"x".repeat(MAX_SERVER_NAME_CHARS + 1)).is_err());
        assert!(clean_server_name("bad\u{0}name").is_err());
        assert!(clean_server_name(&"é".repeat(MAX_SERVER_NAME_CHARS)).is_ok());
    }

    #[test]
    fn server_paths_reject_bad_ids() {
        assert_eq!(vip_server_path(7).unwrap(), "/v1/vip-servers/7");
        assert_eq!(vip_subscription_path(7).unwrap(), "/v1/vip-servers/7/subscription");
        assert_eq!(purchase_path(9).unwrap(), "/v1/games/vip-servers/9");
        assert_eq!(
            settings_path(994732206).unwrap(),
            "/private-servers-api/Universe-Private-Server-Settings?universeId=994732206"
        );
        assert_eq!(my_servers_path(None), "/v1/private-servers/my-private-servers?itemsPerPage=25");
        assert!(my_servers_path(Some("a&b")).ends_with("&cursor=a%26b"));
        for bad in [0, MAX_ID + 1] {
            assert!(vip_server_path(bad).is_err());
            assert!(vip_subscription_path(bad).is_err());
            assert!(purchase_path(bad).is_err());
            assert!(settings_path(bad).is_err());
        }
    }

    #[test]
    fn every_built_path_passes_the_session_allowlist() {
        let cases = [
            ("economy", transactions_path(1, TxKind::Purchase, 10, Some("c")).unwrap()),
            ("economy", "/v1/user/currency".to_owned()),
            ("games", my_servers_path(Some("c"))),
            ("games", vip_server_path(1).unwrap()),
            ("games", vip_subscription_path(1).unwrap()),
            ("games", purchase_path(1).unwrap()),
            ("apis", settings_path(1).unwrap()),
        ];
        for (host, path) in cases {
            crate::rbx_session::resolve(host, &path).unwrap_or_else(|_| panic!("{host}{path} rejected"));
        }
    }

    #[test]
    fn request_bodies() {
        assert_eq!(rename_body("A"), json!({"name":"A"}));
        assert_eq!(regenerate_body(), json!({"newJoinCode":true}));
        assert_eq!(active_body(false), json!({"active":false}));
        assert_eq!(cancel_subscription_body(), json!({"active":false}));
        assert_eq!(purchase_body("S", 200), json!({"name":"S","expectedPrice":200}));
    }

    // -- transactions

    #[test]
    fn signed_amount_follows_direction() {
        assert_eq!(signed_amount(TxKind::Purchase, 50), -50);
        assert_eq!(signed_amount(TxKind::Purchase, -50), -50);
        assert_eq!(signed_amount(TxKind::Sale, -7), 7);
        assert_eq!(signed_amount(TxKind::CurrencyPurchase, 400), 400);
        assert_eq!(signed_amount(TxKind::TradeRobux, -3), -3);
        assert_eq!(signed_amount(TxKind::TradeRobux, 3), 3);
        assert_eq!(signed_amount(TxKind::Purchase, i64::MIN), -i64::MAX);
    }

    #[test]
    fn parses_transactions_page() {
        let body = json!({
            "previousPageCursor": null,
            "nextPageCursor": "NEXT",
            "data": [
                {
                    "id": 11, "created": "2026-10-01T10:00:00Z", "isPending": false,
                    "currency": {"type": "Robux", "amount": 25},
                    "agent": {"id": 5, "type": "User", "name": "creator"},
                    "details": {"id": 9, "name": "Cool Pass", "type": "GamePass", "place": {"placeId": 1, "universeId": 2, "name": "Cool Game"}},
                    "transactionType": "Purchase"
                },
                {"id": 12, "created": "2026-10-02T10:00:00Z", "currency": {"type": "Robux", "amount": 10}}
            ]
        });
        let (items, next) = parse_transactions(TxKind::Purchase, &body).unwrap();
        assert_eq!(next.as_deref(), Some("NEXT"));
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].amount, -25);
        assert_eq!(items[0].name.as_deref(), Some("Cool Pass"));
        assert_eq!(items[0].item_type.as_deref(), Some("GamePass"));
        assert_eq!(items[0].place.as_deref(), Some("Cool Game"));
        assert_eq!(items[0].agent.as_deref(), Some("creator"));
        assert_eq!(items[1].name, None);
        assert!(!items[1].is_pending);
        assert!(parse_transactions(TxKind::Sale, &json!({"nope": 1})).is_err());
    }

    #[test]
    fn totals_split_income_spent_and_pending() {
        let tx = |amount: i64, pending: bool, currency: &str| Transaction {
            id: 0,
            created: String::new(),
            amount,
            currency: currency.into(),
            is_pending: pending,
            name: None,
            item_type: None,
            place: None,
            agent: None,
            agent_kind: None,
        };
        let items = [tx(100, false, "Robux"), tx(-30, false, "Robux"), tx(-5, false, "Robux"), tx(40, true, "Robux"), tx(999, false, "Tickets")];
        let t = page_totals(&items);
        assert_eq!(t.count, 5);
        assert_eq!((t.income, t.spent, t.net), (100, 35, 65));
        assert_eq!((t.pending_count, t.pending), (1, 40));
        assert_eq!(page_totals(&[]), PageTotals::default());
    }

    #[test]
    fn parses_balance() {
        assert_eq!(parse_balance(&json!({"robux": 1234})).unwrap(), 1234);
        assert!(parse_balance(&json!({"robux": "x"})).is_err());
        assert!(parse_balance(&json!({})).is_err());
    }

    // -- private servers

    #[test]
    fn parses_live_settings_payload() {
        // Exact body returned by apis.roblox.com for Blox Fruits (universe 994732206).
        let live = json!({"rootPlaceId":2753915549u64,"privateServerData":{"isAvailable":true,"price":200,"privateServerProductId":452502750,"privateServerLimit":2147483647,"discounts":[]}});
        let s = parse_server_settings(994732206, &live).unwrap();
        assert_eq!(s, settings_for(994732206, true, 200, false));
        let off = json!({"rootPlaceId":134080000,"privateServerData":{"isAvailable":false,"price":0,"privateServerProductId":0,"privateServerLimit":0,"discounts":[]}});
        let s = parse_server_settings(1, &off).unwrap();
        assert!(!s.available && s.price == 0);
        let disc = json!({"privateServerData":{"isAvailable":true,"price":100,"discounts":[{"x":1}]}});
        assert!(parse_server_settings(1, &disc).unwrap().has_discounts);
        assert!(parse_server_settings(1, &json!({})).is_err());
    }

    fn settings_for(universe_id: u64, available: bool, price: u64, discounts: bool) -> ServerSettings {
        ServerSettings { universe_id, available, price, has_discounts: discounts }
    }

    #[test]
    fn purchase_refuses_price_mismatch() {
        let live = settings(true, 200, false);
        assert!(check_purchase(200, &live, Some(500)).is_ok());
        let err = check_purchase(150, &live, Some(500)).unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidInput);
        assert!(err.message.contains("150") && err.message.contains("200") && err.message.contains("Nothing was charged"));
        // A price that dropped is refused too: the user confirmed a different number.
        assert!(check_purchase(300, &live, Some(500)).is_err());
    }

    #[test]
    fn purchase_other_refusals() {
        assert!(check_purchase(0, &settings(false, 0, false), None).is_err());
        assert!(check_purchase(100, &settings(true, 100, true), Some(999)).is_err());
        let err = check_purchase(200, &settings(true, 200, false), Some(199)).unwrap_err();
        assert!(err.message.contains("Not enough Robux"));
        assert!(check_purchase(200, &settings(true, 200, false), None).is_err());
        // Free servers need no balance.
        assert!(check_purchase(0, &settings(true, 0, false), None).is_ok());
        assert!(check_purchase(200, &settings(true, 200, false), Some(200)).is_ok());
    }

    #[test]
    fn purchase_slot_is_exclusive_and_released() {
        let flag = AtomicBool::new(false);
        let first = BusyGuard::acquire(&flag).unwrap();
        assert!(BusyGuard::acquire(&flag).is_err());
        drop(first);
        assert!(BusyGuard::acquire(&flag).is_ok());
    }

    #[test]
    fn parses_purchase_response() {
        let ok = parse_purchase(&json!({"vipServerId": 77, "name": "N", "accessCode": "x"}), "fallback", 200).unwrap();
        assert_eq!((ok.server_id, ok.name.as_str(), ok.price), (77, "N", 200));
        let by_id = parse_purchase(&json!({"id": "78"}), "fallback", 0).unwrap();
        assert_eq!((by_id.server_id, by_id.name.as_str()), (78, "fallback"));
        assert_eq!(parse_purchase(&json!({}), "f", 1).unwrap_err().code, ErrorCode::Parse);
    }

    #[test]
    fn link_classification_reuses_share_link_parser() {
        let good = "https://www.roblox.com/share?code=0123456789abcdef&type=Server";
        assert_eq!(classify_link(Some(good)), (Some(good.to_owned()), false));
        let legacy = "https://www.roblox.com/games/123/Name?privateServerLinkCode=999";
        assert_eq!(classify_link(Some(legacy)), (None, true));
        assert_eq!(classify_link(Some("https://evil.com/share?code=0123456789&type=Server")), (None, true));
        assert_eq!(classify_link(Some("  ")), (None, false));
        assert_eq!(classify_link(None), (None, false));
    }

    #[test]
    fn parses_server_detail() {
        let body = json!({
            "id": 5, "name": "Mine", "joinCode": "abc", "active": true,
            "link": "https://www.roblox.com/share?code=0123456789abcdef&type=Server",
            "game": {"id": 2, "name": "Game", "rootPlace": {"id": 3}},
            "subscription": {"active": true, "expired": false, "expirationDate": "2026-12-01T00:00:00Z", "price": 200, "canRenew": true, "hasInsufficientFunds": false, "hasRecurringProfile": true, "hasPriceChanged": false}
        });
        let d = parse_server_detail(&body).unwrap();
        assert_eq!((d.id, d.universe_id, d.place_id), (5, Some(2), Some(3)));
        assert!(d.active && d.share_link.is_some() && !d.link_is_legacy);
        let sub = d.subscription.unwrap();
        assert!(sub.active && sub.has_recurring_profile);
        assert_eq!(sub.price, Some(200));
        let bare = parse_server_detail(&json!({"id": 6})).unwrap();
        assert!(bare.subscription.is_none() && bare.share_link.is_none());
        assert!(parse_server_detail(&json!({"name": "x"})).is_err());
    }

    #[test]
    fn parses_owned_servers_leniently() {
        let body = json!({"nextPageCursor": "N", "data": [
            {"id": 1, "name": "A", "active": true, "universeId": 10, "placeId": 11, "ownerId": 5, "ownerName": "me"},
            {"vipServerId": 2, "universeId": 10, "placeId": 11},
            {"name": "no id", "universeId": 12}
        ]});
        let (servers, next) = parse_owned_servers(&body).unwrap();
        assert_eq!(next.as_deref(), Some("N"));
        assert_eq!(servers.iter().map(|s| s.id).collect::<Vec<_>>(), vec![Some(1), Some(2), None]);
        assert_eq!(servers[1].name, "Private server");
        assert!(parse_owned_servers(&json!({})).is_err());
    }
}
