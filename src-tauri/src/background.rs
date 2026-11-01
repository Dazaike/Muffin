//! User-chosen custom app background image, stored only on this device.
//!
//! Same boundary rules as `transfer.rs`: the native dialog is opened from Rust and file paths never
//! cross IPC. The picked file is validated by size and by magic bytes (the extension is never
//! trusted), then copied to `<app_data_dir>/background.<ext>`. The frontend only ever receives
//! metadata or the raw bytes (turned into a `blob:` URL), so the CSP and the asset protocol stay
//! untouched.
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::error::{AppError, Result};

pub const MAX_BYTES: u64 = 12 * 1024 * 1024;
const STEM: &str = "background";
const TMP_NAME: &str = "background.tmp";

/// Serializes pick / clear so two commands never interleave their file operations.
static FILE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageKind {
    Png,
    Jpeg,
    Webp,
    Gif,
}

const ALL_KINDS: [ImageKind; 4] = [ImageKind::Png, ImageKind::Jpeg, ImageKind::Webp, ImageKind::Gif];

impl ImageKind {
    pub fn ext(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
            Self::Webp => "webp",
            Self::Gif => "gif",
        }
    }

    pub fn mime(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Webp => "image/webp",
            Self::Gif => "image/gif",
        }
    }
}

/// Identifies an image by its leading bytes. `None` for anything that isn't an allowed type.
pub fn sniff(bytes: &[u8]) -> Option<ImageKind> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some(ImageKind::Png)
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(ImageKind::Jpeg)
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(ImageKind::Gif)
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(ImageKind::Webp)
    } else {
        None
    }
}

/// Pure validation: non-empty, within the size cap, and an allowed image type by content.
pub fn validate_image(bytes: &[u8]) -> Result<ImageKind> {
    if bytes.is_empty() {
        return Err(AppError::invalid("That file is empty"));
    }
    if bytes.len() as u64 > MAX_BYTES {
        return Err(AppError::invalid("That image is larger than 12 MB. Choose a smaller one."));
    }
    sniff(bytes).ok_or_else(|| AppError::invalid("Unsupported image. Choose a PNG, JPG, WebP or GIF file."))
}

fn data_dir(app: &AppHandle) -> Result<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::storage(format!("Couldn't locate the app data folder: {e}")))
}

fn path_for(dir: &Path, kind: ImageKind) -> PathBuf {
    dir.join(format!("{STEM}.{}", kind.ext()))
}

/// The stored background, if any.
fn find(dir: &Path) -> Option<(PathBuf, ImageKind)> {
    ALL_KINDS.into_iter().map(|k| (path_for(dir, k), k)).find(|(p, _)| p.is_file())
}

/// Removes every stored background except `keep`, plus any leftover temp file.
fn remove_others(dir: &Path, keep: Option<ImageKind>) {
    for k in ALL_KINDS {
        if Some(k) != keep {
            let _ = std::fs::remove_file(path_for(dir, k));
        }
    }
    let _ = std::fs::remove_file(dir.join(TMP_NAME));
}

/// Writes the image atomically (temp file + rename) and drops any previous background.
fn store(dir: &Path, bytes: &[u8], kind: ImageKind) -> Result<()> {
    let write_err = |e: std::io::Error| AppError::storage(format!("Couldn't save the background image: {e}"));
    std::fs::create_dir_all(dir).map_err(write_err)?;
    let tmp = dir.join(TMP_NAME);
    std::fs::write(&tmp, bytes).map_err(write_err)?;
    if let Err(e) = std::fs::rename(&tmp, path_for(dir, kind)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(write_err(e));
    }
    remove_others(dir, Some(kind));
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct BackgroundMeta {
    pub ext: &'static str,
    pub bytes: usize,
}

#[derive(Debug, Serialize)]
pub struct BackgroundInfo {
    pub present: bool,
    pub mime: Option<&'static str>,
}

/// Opens a native file dialog, validates and stores the chosen image. `None` when cancelled.
#[tauri::command(async)]
pub fn background_pick(app: AppHandle, window: WebviewWindow) -> Result<Option<BackgroundMeta>> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Choose a background image")
        .add_filter("Images", &["png", "jpg", "jpeg", "webp", "gif"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|_| AppError::invalid("That file can't be read"))?;
    let read_err = |e: std::io::Error| AppError::storage(format!("Couldn't read the file: {e}"));
    let file = std::fs::File::open(&path).map_err(read_err)?;
    // Read one byte past the cap so an oversized file is detected without loading all of it.
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(read_err)?;
    let kind = validate_image(&bytes)?;

    let dir = data_dir(&app)?;
    let _guard = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    store(&dir, &bytes, kind)?;
    Ok(Some(BackgroundMeta { ext: kind.ext(), bytes: bytes.len() }))
}

#[tauri::command(async)]
pub fn background_info(app: AppHandle) -> Result<BackgroundInfo> {
    let dir = data_dir(&app)?;
    Ok(match find(&dir) {
        Some((_, kind)) => BackgroundInfo { present: true, mime: Some(kind.mime()) },
        None => BackgroundInfo { present: false, mime: None },
    })
}

/// Raw image bytes as a binary IPC response (not a JSON number array).
#[tauri::command(async)]
pub fn background_read(app: AppHandle) -> Result<Response> {
    let dir = data_dir(&app)?;
    let _guard = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let (path, _) = find(&dir).ok_or_else(|| AppError::invalid("No background image is set"))?;
    let bytes = std::fs::read(&path).map_err(|e| AppError::storage(format!("Couldn't read the background image: {e}")))?;
    // The file lives in a user-writable folder: re-validate rather than trusting what's on disk.
    validate_image(&bytes)?;
    Ok(Response::new(bytes))
}

#[tauri::command(async)]
pub fn background_clear(app: AppHandle) -> Result<()> {
    let dir = data_dir(&app)?;
    let _guard = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    remove_others(&dir, None);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    fn with_header(header: &[u8], total: usize) -> Vec<u8> {
        let mut v = header.to_vec();
        v.resize(total.max(header.len()), 0);
        v
    }

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

    #[test]
    fn sniffs_allowed_types() {
        assert_eq!(sniff(PNG), Some(ImageKind::Png));
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10]), Some(ImageKind::Jpeg));
        assert_eq!(sniff(b"GIF89a\x01\x00"), Some(ImageKind::Gif));
        assert_eq!(sniff(b"GIF87a\x01\x00"), Some(ImageKind::Gif));
        assert_eq!(sniff(b"RIFF\x24\x00\x00\x00WEBPVP8 "), Some(ImageKind::Webp));
    }

    #[test]
    fn sniff_rejects_everything_else() {
        assert_eq!(sniff(b""), None);
        assert_eq!(sniff(b"BM\x36\x00\x00\x00"), None, "bmp");
        assert_eq!(sniff(b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"), None, "svg");
        assert_eq!(sniff(b"<!doctype html><html></html>"), None, "html");
        assert_eq!(sniff(b"RIFF\x24\x00\x00\x00WAVEfmt "), None, "riff but not webp");
        assert_eq!(sniff(b"RIFF\x24\x00\x00\x00WEB"), None, "truncated webp header");
        assert_eq!(sniff(&PNG[..7]), None, "truncated png signature");
        assert_eq!(sniff(b"GIF90a"), None);
        assert_eq!(sniff(&[0xFF, 0xD8]), None, "truncated jpeg");
    }

    #[test]
    fn validate_checks_type_by_content_and_size() {
        assert_eq!(validate_image(&with_header(PNG, 100)).unwrap(), ImageKind::Png);
        // Exactly at the cap is accepted, one byte over is not.
        assert!(validate_image(&with_header(PNG, MAX_BYTES as usize)).is_ok());
        let over = validate_image(&with_header(PNG, MAX_BYTES as usize + 1)).unwrap_err();
        assert_eq!(over.code, ErrorCode::InvalidInput);
        assert!(over.message.contains("12 MB"));

        let empty = validate_image(&[]).unwrap_err();
        assert_eq!(empty.code, ErrorCode::InvalidInput);
        let text = validate_image(b"just some text, named photo.png").unwrap_err();
        assert_eq!(text.code, ErrorCode::InvalidInput);
        assert!(text.message.contains("PNG, JPG, WebP or GIF"));
    }

    #[test]
    fn mime_and_ext_match_kind() {
        for k in ALL_KINDS {
            assert!(k.mime().starts_with("image/"));
            assert!(!k.ext().is_empty());
        }
        assert_eq!(ImageKind::Jpeg.ext(), "jpg");
    }

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("muffin-bg-test-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn store_replaces_previous_image_of_any_type() {
        let dir = temp_dir();
        assert!(find(&dir).is_none());

        store(&dir, &with_header(PNG, 50), ImageKind::Png).unwrap();
        assert_eq!(find(&dir).unwrap().1, ImageKind::Png);

        // A different type must remove the old file rather than leave two backgrounds.
        store(&dir, &with_header(&[0xFF, 0xD8, 0xFF], 40), ImageKind::Jpeg).unwrap();
        assert_eq!(find(&dir).unwrap().1, ImageKind::Jpeg);
        assert!(!path_for(&dir, ImageKind::Png).exists());
        assert!(!dir.join(TMP_NAME).exists());

        // Same type overwrites in place.
        store(&dir, &with_header(&[0xFF, 0xD8, 0xFF], 60), ImageKind::Jpeg).unwrap();
        assert_eq!(std::fs::read(path_for(&dir, ImageKind::Jpeg)).unwrap().len(), 60);

        remove_others(&dir, None);
        assert!(find(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
