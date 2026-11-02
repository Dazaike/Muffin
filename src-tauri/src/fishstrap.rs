//! Reads and edits Fishstrap's on-disk data (`%LOCALAPPDATA%\Fishstrap`). Muffin still launches
//! through the registered `roblox://` handler; this module only manages Fishstrap's settings.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::error::{AppError, ErrorCode, Result};
use crate::launch::Handler;

const LATEST_URL: &str = "https://clientsettingscdn.roblox.com/v2/client-version/WindowsPlayer";
const DOWNLOAD_URL: &str = "https://github.com/fishstrap/fishstrap/releases/latest";
const MAX_DEPTH: u32 = 8;

// ---- location + file helpers -----------------------------------------------------------------

fn data_dir() -> Option<PathBuf> {
    let s = crate::launch::protocol_status();
    if s.handler == Handler::Fishstrap && s.exe_exists {
        if let Some(dir) = s.exe_path.as_deref().and_then(|p| Path::new(p).parent()) {
            return Some(dir.to_path_buf());
        }
    }
    let dir = PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("Fishstrap");
    dir.join("Fishstrap.exe").is_file().then_some(dir)
}

fn require_dir() -> Result<PathBuf> {
    data_dir().ok_or_else(|| AppError::new(ErrorCode::NotInstalled, "Fishstrap isn't installed on this PC"))
}

fn file_name(path: &Path) -> String {
    path.file_name().map_or_else(String::new, |n| n.to_string_lossy().into_owned())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)
        .and_then(|()| std::fs::rename(&tmp, path))
        .map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            AppError::storage(format!("Couldn't write {}: {e}", file_name(path)))
        })
}

fn read_json(path: &Path) -> Result<Value> {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Value::Object(Default::default())),
        Err(e) => return Err(AppError::storage(format!("Couldn't read {}: {e}", file_name(path)))),
    };
    // Fishstrap writes UTF-8, possibly with a BOM.
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
    serde_json::from_slice(bytes).map_err(|_| {
        AppError::new(ErrorCode::Parse, format!("Fishstrap's {} isn't valid JSON", file_name(path)))
    })
}

fn ensure_fishstrap_closed() -> Result<()> {
    if crate::playtime::process_running("Fishstrap.exe") {
        return Err(AppError::new(
            ErrorCode::LaunchBusy,
            "Close Fishstrap first; it rewrites its settings when it exits",
        ));
    }
    Ok(())
}

fn settings_path(root: &Path) -> PathBuf {
    root.join("Settings.json")
}
fn flags_dir(root: &Path) -> PathBuf {
    root.join("Modifications").join("ClientSettings")
}
fn flags_path(root: &Path) -> PathBuf {
    flags_dir(root).join("ClientAppSettings.json")
}

// ---- status ----------------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FishstrapStatus {
    pub installed: bool,
    pub dir: Option<String>,
    pub installed_version: Option<String>,
    pub channel: Option<String>,
    pub fishstrap_running: bool,
    pub player_running: bool,
}

fn installed_version(root: &Path) -> Result<Option<String>> {
    let state = read_json(&root.join("RobloxState.json"))?;
    Ok(state
        .pointer("/Player/VersionGuid")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string))
}

fn channel_in(root: &Path) -> Result<String> {
    let settings = read_json(&settings_path(root))?;
    Ok(settings
        .get("Channel")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or("production")
        .to_string())
}

#[tauri::command(async)]
pub fn fishstrap_status() -> Result<FishstrapStatus> {
    let Some(root) = data_dir() else {
        return Ok(FishstrapStatus::default());
    };
    Ok(FishstrapStatus {
        installed: true,
        dir: Some(root.to_string_lossy().into_owned()),
        installed_version: installed_version(&root).unwrap_or(None),
        channel: channel_in(&root).ok(),
        fishstrap_running: crate::playtime::process_running("Fishstrap.exe"),
        player_running: crate::playtime::player_running(),
    })
}

// ---- latest version --------------------------------------------------------------------------

fn valid_channel(channel: &str) -> bool {
    (1..=64).contains(&channel.len())
        && channel.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

#[derive(Deserialize)]
struct RawVersion {
    #[serde(rename = "clientVersionUpload")]
    client_version_upload: String,
}

#[tauri::command]
pub async fn roblox_latest_version(
    client: State<'_, Client>,
    channel: Option<String>,
) -> Result<Option<String>> {
    let url = match channel.as_deref() {
        None | Some("production") => LATEST_URL.to_string(),
        Some(c) if valid_channel(c) => format!("{LATEST_URL}/channel/{c}"),
        Some(_) => {
            return Err(AppError::invalid(
                "Channel names use letters, numbers, dots, dashes and underscores",
            ))
        }
    };
    let resp = client.get(url).send().await?;
    let status = resp.status();
    if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::NOT_FOUND) {
        return Ok(None);
    }
    if !status.is_success() {
        return Err(AppError::new(ErrorCode::HttpStatus, format!("Roblox returned HTTP {}", status.as_u16())));
    }
    let raw: RawVersion = resp.json().await?;
    Ok(Some(raw.client_version_upload))
}

// ---- Fishstrap settings (Settings.json) --------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FishstrapSetting {
    pub key: String,
    pub value: Value,
}

fn settings_get_in(root: &Path) -> Result<Vec<FishstrapSetting>> {
    let doc = read_json(&settings_path(root))?;
    let Some(obj) = doc.as_object() else {
        return Err(AppError::new(ErrorCode::Parse, "Fishstrap's Settings.json isn't valid JSON"));
    };
    // serde_json's map is key-sorted, so the list is alphabetical.
    Ok(obj.iter().map(|(k, v)| FishstrapSetting { key: k.clone(), value: v.clone() }).collect())
}

/// Only keys already in the file can be changed, and only to a value of the same JSON kind, so a
/// bad edit can't make Fishstrap fail to load its settings.
fn setting_set_in(root: &Path, key: &str, value: Value) -> Result<()> {
    let bad = || AppError::invalid(format!("Invalid value for {key}"));
    let path = settings_path(root);
    let mut doc = read_json(&path)?;
    let Some(obj) = doc.as_object_mut() else {
        return Err(AppError::new(ErrorCode::Parse, "Fishstrap's Settings.json isn't valid JSON"));
    };
    let Some(existing) = obj.get(key) else {
        return Err(AppError::invalid(format!("Unknown Fishstrap setting: {key}")));
    };
    let clean_str = |s: &str| s.chars().count() <= 512 && !s.chars().any(char::is_control);
    let ok = match (existing, &value) {
        (Value::Bool(_), Value::Bool(_)) => true,
        (Value::Number(old), Value::Number(new)) => {
            new.as_f64().is_some_and(f64::is_finite) && (!(old.is_i64() || old.is_u64()) || new.is_i64() || new.is_u64())
        }
        (Value::String(_), Value::String(s)) => clean_str(s) && (key != "Channel" || valid_channel(s)),
        (Value::Array(_), Value::Array(items)) if key == "CleanerDirectories" => {
            items.iter().all(|i| i.as_str().is_some_and(|s| !s.trim().is_empty() && clean_str(s)))
        }
        _ => false,
    };
    if !ok {
        return Err(bad());
    }
    obj.insert(key.to_string(), value);
    write_atomic(&path, &serde_json::to_vec_pretty(&doc)?)
}

#[tauri::command(async)]
pub fn fishstrap_settings_get() -> Result<Vec<FishstrapSetting>> {
    match data_dir() {
        Some(root) => settings_get_in(&root),
        None => Ok(Vec::new()),
    }
}

#[tauri::command(async)]
pub fn fishstrap_setting_set(key: String, value: Value) -> Result<()> {
    let root = require_dir()?;
    ensure_fishstrap_closed()?;
    setting_set_in(&root, &key, value)
}

// ---- FastFlags -------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FastFlag {
    pub name: String,
    pub value: String,
}

fn valid_flag_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && name.len() <= 128
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn valid_flag_value(value: &str) -> bool {
    let v = value.trim();
    !v.is_empty() && v.chars().count() <= 256 && !v.chars().any(char::is_control)
}

fn fastflags_get_in(root: &Path) -> Result<Vec<FastFlag>> {
    let doc = read_json(&flags_path(root))?;
    let Some(obj) = doc.as_object() else {
        return Err(AppError::new(ErrorCode::Parse, "Fishstrap's ClientAppSettings.json isn't valid JSON"));
    };
    let mut out: Vec<FastFlag> = obj
        .iter()
        .filter_map(|(k, v)| {
            let value = match v {
                Value::String(s) => s.clone(),
                Value::Bool(_) | Value::Number(_) => v.to_string(),
                _ => return None,
            };
            Some(FastFlag { name: k.clone(), value })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

fn fastflags_set_in(root: &Path, flags: Vec<FastFlag>) -> Result<usize> {
    let mut map: BTreeMap<String, String> = BTreeMap::new();
    for f in flags {
        if !valid_flag_name(&f.name) || !valid_flag_value(&f.value) {
            return Err(AppError::invalid(format!("Invalid FastFlag: {}", f.name)));
        }
        map.insert(f.name, f.value.trim().to_string());
    }
    let dir = flags_dir(root);
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::storage(format!("Couldn't create {}: {e}", file_name(&dir))))?;
    let bytes = serde_json::to_vec_pretty(&map)?;
    write_atomic(&flags_path(root), &bytes)?;
    Ok(map.len())
}

#[tauri::command(async)]
pub fn fastflags_get() -> Result<Vec<FastFlag>> {
    match data_dir() {
        Some(root) => fastflags_get_in(&root),
        None => Ok(Vec::new()),
    }
}

#[tauri::command(async)]
pub fn fastflags_set(flags: Vec<FastFlag>) -> Result<usize> {
    fastflags_set_in(&require_dir()?, flags)
}

// ---- mods ------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModsInfo {
    pub path: String,
    pub entries: Vec<ModEntry>,
}

fn dir_size(path: &Path, depth: u32) -> u64 {
    if depth > MAX_DEPTH {
        return 0;
    }
    let Ok(rd) = std::fs::read_dir(path) else { return 0 };
    rd.flatten()
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => dir_size(&e.path(), depth + 1),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

fn mods_in(root: &Path) -> ModsInfo {
    let dir = root.join("Modifications");
    let mut entries: Vec<ModEntry> = std::fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let meta = e.metadata().ok()?;
            if meta.is_dir() && name == "ClientSettings" {
                return None;
            }
            let size = if meta.is_dir() { dir_size(&e.path(), 1) } else { meta.len() };
            Some(ModEntry { name, is_dir: meta.is_dir(), size })
        })
        .collect();
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
    ModsInfo { path: dir.to_string_lossy().into_owned(), entries }
}

#[tauri::command(async)]
pub fn fishstrap_mods() -> Result<ModsInfo> {
    Ok(mods_in(&require_dir()?))
}

#[tauri::command(async)]
pub fn fishstrap_open_mods() -> Result<()> {
    let dir = require_dir()?.join("Modifications");
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::storage(format!("Couldn't create {}: {e}", file_name(&dir))))?;
    tauri_plugin_opener::open_path(dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|_| AppError::new(ErrorCode::LaunchFailed, "Couldn't open the mods folder"))
}

// ---- cleanup ---------------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupResult {
    pub removed: u32,
    pub freed_bytes: u64,
}

fn remove_entry(path: &Path, is_dir: bool, result: &mut CleanupResult) {
    let size = if is_dir { dir_size(path, 0) } else { std::fs::metadata(path).map_or(0, |m| m.len()) };
    let ok = if is_dir { std::fs::remove_dir_all(path) } else { std::fs::remove_file(path) }.is_ok();
    if ok {
        result.removed += 1;
        result.freed_bytes += size;
    }
}

fn cleanup_in(root: &Path) -> Result<CleanupResult> {
    let mut result = CleanupResult::default();
    if let Some(current) = installed_version(root)? {
        for e in std::fs::read_dir(root.join("Versions")).into_iter().flatten().flatten() {
            let is_dir = e.metadata().is_ok_and(|m| m.is_dir());
            if is_dir && e.file_name().to_string_lossy() != current {
                remove_entry(&e.path(), true, &mut result);
            }
        }
        for e in std::fs::read_dir(root.join("Downloads")).into_iter().flatten().flatten() {
            let is_dir = e.metadata().is_ok_and(|m| m.is_dir());
            remove_entry(&e.path(), is_dir, &mut result);
        }
    }
    Ok(result)
}

#[tauri::command(async)]
pub fn fishstrap_cleanup() -> Result<CleanupResult> {
    let root = require_dir()?;
    ensure_fishstrap_closed()?;
    if crate::playtime::player_running() {
        return Err(AppError::new(ErrorCode::LaunchBusy, "Close Roblox first"));
    }
    cleanup_in(&root)
}

#[tauri::command(async)]
pub fn fishstrap_open_download() -> Result<()> {
    tauri_plugin_opener::open_url(DOWNLOAD_URL, None::<&str>)
        .map_err(|_| AppError::new(ErrorCode::LaunchFailed, "Couldn't open the download page"))
}

// ---- install ---------------------------------------------------------------------------------

const RELEASE_API: &str = "https://api.github.com/repos/fishstrap/fishstrap/releases/latest";
const MAX_INSTALLER_BYTES: usize = 200 * 1024 * 1024;

#[derive(Deserialize)]
struct Release {
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}

/// The release's installer: Fishstrap's own `Fishstrap.exe`, served from a GitHub release download URL.
fn pick_installer(assets: &[Asset]) -> Option<&Asset> {
    assets.iter().find(|a| {
        a.name.eq_ignore_ascii_case("Fishstrap.exe")
            && a.browser_download_url.starts_with("https://github.com/")
            && a.browser_download_url.contains("/releases/download/")
    })
}

/// Downloads the latest Fishstrap release and installs it silently (`-quiet` installs to
/// `%LOCALAPPDATA%\Fishstrap` and registers it for `roblox://` links without showing a window).
/// Called only after the user agrees in Muffin's prompt (or presses Install in settings).
#[tauri::command]
pub async fn fishstrap_install() -> Result<()> {
    if !cfg!(windows) {
        return Err(AppError::new(ErrorCode::NotInstalled, "Fishstrap is only available on Windows"));
    }
    if data_dir().is_some() {
        return Ok(());
    }
    let client = Client::builder()
        .user_agent(concat!("Muffin/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(300))
        .build()?;
    let release: Release = client
        .get(RELEASE_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let asset = pick_installer(&release.assets)
        .ok_or_else(|| AppError::new(ErrorCode::HttpStatus, "The latest Fishstrap release has no installer"))?;
    let bytes = client.get(&asset.browser_download_url).send().await?.error_for_status()?.bytes().await?;
    if bytes.len() < 1024 * 1024 || bytes.len() > MAX_INSTALLER_BYTES {
        return Err(AppError::new(ErrorCode::Parse, "The downloaded Fishstrap installer looks wrong"));
    }

    let dir = std::env::temp_dir().join("Muffin");
    let setup = dir.join("FishstrapSetup.exe");
    tauri::async_runtime::spawn_blocking(move || -> Result<()> {
        std::fs::create_dir_all(&dir).map_err(|e| AppError::storage(format!("Couldn't save the installer: {e}")))?;
        std::fs::write(&setup, &bytes).map_err(|e| AppError::storage(format!("Couldn't save the installer: {e}")))?;
        let started = std::process::Command::new(&setup).arg("-quiet").status();
        let _ = std::fs::remove_file(&setup);
        started.map_err(|e| AppError::new(ErrorCode::LaunchFailed, format!("Couldn't run the Fishstrap installer: {e}")))?;
        // The installer registers Fishstrap for roblox:// links just before it exits; allow a moment.
        for _ in 0..20 {
            let s = crate::launch::protocol_status();
            if data_dir().is_some() && s.handler == Handler::Fishstrap && s.exe_exists {
                return Ok(());
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        Err(AppError::new(ErrorCode::LaunchFailed, "Fishstrap's installer finished but Fishstrap isn't set up"))
    })
    .await
    .map_err(|e| AppError::new(ErrorCode::LaunchFailed, format!("Installer task failed: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("muffin-fishstrap-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn asset(name: &str, url: &str) -> Asset {
        Asset { name: name.into(), browser_download_url: url.into() }
    }

    #[test]
    fn installer_must_be_fishstraps_exe_from_a_github_release() {
        let good = asset("Fishstrap.exe", "https://github.com/fishstrap/fishstrap/releases/download/v3.2.1/Fishstrap.exe");
        assert!(pick_installer(std::slice::from_ref(&good)).is_some());
        for bad in [
            asset("Fishstrap.zip", "https://github.com/fishstrap/fishstrap/releases/download/v3.2.1/Fishstrap.zip"),
            asset("Fishstrap.exe", "https://evil.example/releases/download/v1/Fishstrap.exe"),
            asset("Fishstrap.exe", "https://github.com/fishstrap/fishstrap/raw/main/Fishstrap.exe"),
        ] {
            assert!(pick_installer(&[bad]).is_none());
        }
    }

    fn flag(n: &str, v: &str) -> FastFlag {
        FastFlag { name: n.into(), value: v.into() }
    }

    #[test]
    fn fastflags_round_trip_flat_strings() {
        let root = temp_root("flags");
        let n = fastflags_set_in(&root, vec![flag("FFlagX", "True"), flag("DFIntY", "5")]).unwrap();
        assert_eq!(n, 2);
        let got = fastflags_get_in(&root).unwrap();
        assert_eq!(got, vec![flag("DFIntY", "5"), flag("FFlagX", "True")]);
        let disk: Value = serde_json::from_slice(&std::fs::read(flags_path(&root)).unwrap()).unwrap();
        assert_eq!(disk, serde_json::json!({"FFlagX": "True", "DFIntY": "5"}));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn invalid_flags_rejected_and_file_untouched() {
        let root = temp_root("badflags");
        fastflags_set_in(&root, vec![flag("FFlagX", "True")]).unwrap();
        let before = std::fs::read(flags_path(&root)).unwrap();
        for bad in [vec![flag("bad name", "1")], vec![flag("FFlagZ", "  ")]] {
            let e = fastflags_set_in(&root, bad).unwrap_err();
            assert_eq!(e.code, ErrorCode::InvalidInput);
        }
        assert_eq!(std::fs::read(flags_path(&root)).unwrap(), before);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn channel_edit_preserves_other_keys_and_validates() {
        let root = temp_root("channel");
        std::fs::write(settings_path(&root), r#"{"Channel":"production","CleanerOptions":1}"#).unwrap();
        setting_set_in(&root, "Channel", Value::String("beta-1".into())).unwrap();
        let v = read_json(&settings_path(&root)).unwrap();
        assert_eq!(v["Channel"], "beta-1");
        assert_eq!(v["CleanerOptions"], 1);
        let e = setting_set_in(&root, "Channel", Value::String("a/b".into())).unwrap_err();
        assert_eq!(e.code, ErrorCode::InvalidInput);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn setting_set_updates_same_kind_and_rejects_the_rest() {
        use serde_json::json;
        let root = temp_root("setting");
        let original = r#"{"ConfirmLaunches":true,"AcrylicBackgroundOpacity":165,"Locale":"nil","SelectedCustomTheme":null,"CleanerDirectories":["A"],"CustomIntegrations":[]}"#;
        std::fs::write(settings_path(&root), original).unwrap();

        setting_set_in(&root, "ConfirmLaunches", json!(false)).unwrap();
        setting_set_in(&root, "AcrylicBackgroundOpacity", json!(200)).unwrap();
        setting_set_in(&root, "CleanerDirectories", json!(["A", "B"])).unwrap();
        let got = settings_get_in(&root).unwrap();
        let by = |k: &str| got.iter().find(|s| s.key == k).unwrap().value.clone();
        assert_eq!(by("ConfirmLaunches"), json!(false));
        assert_eq!(by("AcrylicBackgroundOpacity"), json!(200));
        assert_eq!(by("CleanerDirectories"), json!(["A", "B"]));
        assert_eq!(by("Locale"), json!("nil"));

        let before = std::fs::read(settings_path(&root)).unwrap();
        for (k, v) in [
            ("ConfirmLaunches", json!("yes")),
            ("AcrylicBackgroundOpacity", json!(1.5)),
            ("Locale", json!(5)),
            ("SelectedCustomTheme", json!("x")),
            ("CustomIntegrations", json!(["x"])),
            ("Missing", json!(true)),
        ] {
            assert_eq!(setting_set_in(&root, k, v).unwrap_err().code, ErrorCode::InvalidInput, "{k}");
        }
        assert_eq!(std::fs::read(settings_path(&root)).unwrap(), before);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn corrupt_settings_is_parse_error_and_untouched() {
        let root = temp_root("corrupt");
        std::fs::write(settings_path(&root), "{not json").unwrap();
        let e = setting_set_in(&root, "Channel", Value::String("production".into())).unwrap_err();
        assert_eq!(e.code, ErrorCode::Parse);
        assert_eq!(std::fs::read_to_string(settings_path(&root)).unwrap(), "{not json");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn cleanup_keeps_current_and_mods() {
        let root = temp_root("cleanup");
        std::fs::write(root.join("RobloxState.json"), r#"{"Player":{"VersionGuid":"version-cur"}}"#).unwrap();
        for d in ["version-cur", "version-old"] {
            std::fs::create_dir_all(root.join("Versions").join(d)).unwrap();
            std::fs::write(root.join("Versions").join(d).join("a.bin"), [0u8; 10]).unwrap();
        }
        std::fs::create_dir_all(root.join("Downloads")).unwrap();
        std::fs::write(root.join("Downloads").join("x.zip"), [0u8; 5]).unwrap();
        std::fs::create_dir_all(root.join("Modifications").join("content")).unwrap();

        let r = cleanup_in(&root).unwrap();
        assert_eq!(r, CleanupResult { removed: 2, freed_bytes: 15 });
        assert!(root.join("Versions").join("version-cur").is_dir());
        assert!(!root.join("Versions").join("version-old").exists());
        assert!(root.join("Downloads").read_dir().unwrap().next().is_none());
        assert!(root.join("Modifications").join("content").is_dir());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn cleanup_unknown_guid_removes_nothing() {
        let root = temp_root("cleanup-unknown");
        std::fs::create_dir_all(root.join("Versions").join("version-old")).unwrap();
        std::fs::create_dir_all(root.join("Downloads")).unwrap();
        std::fs::write(root.join("Downloads").join("x.zip"), [0u8; 5]).unwrap();
        assert_eq!(cleanup_in(&root).unwrap(), CleanupResult::default());
        assert!(root.join("Versions").join("version-old").is_dir());
        assert!(root.join("Downloads").join("x.zip").is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn mods_exclude_client_settings_and_sum_dirs() {
        let root = temp_root("mods");
        let m = root.join("Modifications");
        std::fs::create_dir_all(m.join("ClientSettings")).unwrap();
        std::fs::create_dir_all(m.join("content").join("sub")).unwrap();
        std::fs::write(m.join("content").join("a"), [0u8; 3]).unwrap();
        std::fs::write(m.join("content").join("sub").join("b"), [0u8; 4]).unwrap();
        std::fs::write(m.join("readme.txt"), [0u8; 2]).unwrap();
        let info = mods_in(&root);
        assert_eq!(
            info.entries,
            vec![
                ModEntry { name: "content".into(), is_dir: true, size: 7 },
                ModEntry { name: "readme.txt".into(), is_dir: false, size: 2 },
            ]
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
