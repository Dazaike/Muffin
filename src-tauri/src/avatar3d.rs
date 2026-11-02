//! Downloads the files Roblox renders a user's 3D avatar from (OBJ mesh, MTL, textures) so the webview
//! can draw it without calling Roblox's CDN itself (CORS / CSP). Public data, no cookie involved.

use std::time::Duration;

use base64::Engine;
use reqwest::{Client, Method, StatusCode};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::error::{AppError, ErrorCode, Result};
use crate::rbx_session;

const MAX_MESH_BYTES: usize = 8 * 1024 * 1024;
const MAX_TEXTURE_BYTES: usize = 4 * 1024 * 1024;
/// Layered clothing and accessories can bring dozens of textures; the total size is what is bounded.
const MAX_TEXTURES: usize = 64;
const MAX_TEXTURE_TOTAL: usize = 48 * 1024 * 1024;
const PENDING_RETRIES: u32 = 8;
const PENDING_WAIT: Duration = Duration::from_millis(700);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Texture {
    /// The file name the MTL refers to (the content hash).
    pub name: String,
    pub data_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Avatar3d {
    pub obj: String,
    pub mtl: String,
    pub textures: Vec<Texture>,
    /// Roblox's suggested camera (`position`, `direction`, `fov`) and bounding box, passed through.
    pub camera: Value,
    pub aabb: Value,
}

fn bad_response() -> AppError {
    AppError::new(ErrorCode::Parse, "Unexpected response from Roblox")
}

/// Same, saying which part was wrong (nothing secret goes in `what`).
fn bad(what: &str) -> AppError {
    AppError::new(ErrorCode::Parse, format!("Unexpected response from Roblox ({what})"))
}

/// Roblox content hashes are plain URL-safe characters; anything else never reaches a URL.
fn valid_hash(h: &str) -> bool {
    (8..=64).contains(&h.len()) && h.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Roblox spreads hashes over `t0`..`t7` by an XOR fold of the hash bytes.
fn cdn_url(hash: &str) -> String {
    let n = hash.bytes().fold(31u32, |acc, b| acc ^ u32::from(b)) % 8;
    format!("https://t{n}.rbxcdn.com/{hash}")
}

/// Hash from a `https://tN.rbxcdn.com/<hash>` metadata URL.
fn hash_from_url(url: &str) -> Option<&str> {
    let rest = url.strip_prefix("https://")?;
    let (host, path) = rest.split_once('/')?;
    let hash = path.split(['?', '#']).next()?;
    let host_ok = host.strip_suffix(".rbxcdn.com").is_some_and(|h| !h.is_empty() && h.bytes().all(|b| b.is_ascii_alphanumeric()));
    (host_ok && valid_hash(hash)).then_some(hash)
}

async fn fetch(client: &Client, hash: &str, limit: usize) -> Result<Vec<u8>> {
    if !valid_hash(hash) {
        return Err(bad(&format!("odd file hash {hash}")));
    }
    fetch_url(client, &cdn_url(hash), limit).await
}

/// `url` is always an rbxcdn.com address built or validated in this module.
async fn fetch_url(client: &Client, url: &str, limit: usize) -> Result<Vec<u8>> {
    let res = client.get(url).send().await?;
    if res.status() != StatusCode::OK {
        return Err(AppError::new(ErrorCode::HttpStatus, format!("Roblox's CDN answered {}", res.status().as_u16())));
    }
    if res.content_length().is_some_and(|n| n as usize > limit) {
        return Err(AppError::new(ErrorCode::Parse, "Avatar files are larger than expected"));
    }
    let bytes = res.bytes().await?;
    if bytes.len() > limit {
        return Err(AppError::new(ErrorCode::Parse, "Avatar files are larger than expected"));
    }
    Ok(bytes.to_vec())
}

fn text(bytes: Vec<u8>) -> Result<String> {
    String::from_utf8(bytes).map_err(|_| bad_response())
}

#[tauri::command(async)]
pub async fn avatar_3d(app: AppHandle, client: State<'_, Client>, user_id: u64) -> Result<Avatar3d> {
    // Roblox only serves 3D avatars to a signed-in caller (any user's, once signed in).
    rbx_session::active_user_id(&app)?;
    let path = format!("/v1/users/avatar-3d?userId={user_id}");
    let mut meta_url = None;
    for attempt in 0..PENDING_RETRIES {
        let v = rbx_session::authed_json(&app, Method::GET, "thumbnails", &path, None).await?;
        match v["state"].as_str() {
            Some("Completed") => {
                meta_url = v["imageUrl"].as_str().map(str::to_owned);
                break;
            }
            Some("Pending") | Some("InReview") if attempt + 1 < PENDING_RETRIES => tokio::time::sleep(PENDING_WAIT).await,
            _ => break,
        }
    }
    let meta_url = meta_url.ok_or_else(|| AppError::new(ErrorCode::HttpStatus, "Roblox hasn't rendered this avatar yet"))?;
    hash_from_url(&meta_url).ok_or_else(|| bad(&format!("unrecognised metadata url {meta_url}")))?;
    let raw = fetch_url(&client, &meta_url, 256 * 1024).await?;
    let meta: Value = serde_json::from_slice(&raw).map_err(|e| {
        let head: String = String::from_utf8_lossy(&raw).chars().take(40).collect();
        bad(&format!("metadata isn't JSON: {e}; {} bytes, starts {head:?}", raw.len()))
    })?;

    let obj_hash = meta["obj"].as_str().ok_or_else(|| bad("metadata has no obj"))?;
    let mtl_hash = meta["mtl"].as_str().ok_or_else(|| bad("metadata has no mtl"))?;
    let tex_hashes: Vec<&str> = meta["textures"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    if tex_hashes.len() > MAX_TEXTURES {
        return Err(bad("too many textures"));
    }

    let (obj, mtl) = tokio::try_join!(fetch(&client, obj_hash, MAX_MESH_BYTES), fetch(&client, mtl_hash, 256 * 1024))?;
    let fetched = fetch_all(&client, &tex_hashes).await?;
    let engine = base64::engine::general_purpose::STANDARD;
    let textures = fetched
        .into_iter()
        .zip(&tex_hashes)
        .map(|(bytes, hash)| Texture { name: (*hash).to_owned(), data_url: format!("data:image/png;base64,{}", engine.encode(bytes)) })
        .collect();

    Ok(Avatar3d { obj: text(obj)?, mtl: text(mtl)?, textures, camera: meta["camera"].clone(), aabb: meta["aabb"].clone() })
}

/// Textures a handful at a time (an avatar can have dozens), in order, with the total size bounded.
async fn fetch_all(client: &Client, hashes: &[&str]) -> Result<Vec<Vec<u8>>> {
    let mut out = Vec::with_capacity(hashes.len());
    let mut total = 0usize;
    for chunk in hashes.chunks(6) {
        let mut tasks = tokio::task::JoinSet::new();
        for (i, h) in chunk.iter().enumerate() {
            let client = client.clone();
            let h = (*h).to_owned();
            tasks.spawn(async move { (i, fetch(&client, &h, MAX_TEXTURE_BYTES).await) });
        }
        let mut got: Vec<Option<Vec<u8>>> = vec![None; chunk.len()];
        while let Some(done) = tasks.join_next().await {
            let (i, bytes) = done.map_err(|_| bad("texture download failed"))?;
            let bytes = bytes?;
            total += bytes.len();
            if total > MAX_TEXTURE_TOTAL {
                return Err(bad("textures are too large"));
            }
            got[i] = Some(bytes);
        }
        out.extend(got.into_iter().flatten());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_host_matches_roblox_fold() {
        // 31 ^ every byte, mod 8.
        let h = "abcdef0123456789abcdef0123456789";
        let expected = h.bytes().fold(31u32, |a, b| a ^ u32::from(b)) % 8;
        assert!(cdn_url(h).starts_with(&format!("https://t{expected}.rbxcdn.com/")));
    }

    #[test]
    fn only_rbxcdn_metadata_urls_are_accepted() {
        let h = "abcdef0123456789abcdef0123456789";
        assert_eq!(hash_from_url(&format!("https://t3.rbxcdn.com/{h}")), Some(h));
        assert_eq!(hash_from_url(&format!("https://t3.rbxcdn.com.evil.com/{h}")), None);
        assert_eq!(hash_from_url(&format!("http://t3.rbxcdn.com/{h}")), None);
        assert_eq!(hash_from_url("https://t3.rbxcdn.com/../etc"), None);
    }
}
