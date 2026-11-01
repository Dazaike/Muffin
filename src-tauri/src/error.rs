use serde::Serialize;
use thiserror::Error;

/// Stable error codes shared with the frontend (see the IPC contract).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidInput,
    NotInstalled,
    LaunchFailed,
    LaunchBusy,
    Network,
    RateLimited,
    HttpStatus,
    Parse,
    Storage,
    AuthDenied,
    AuthExpired,
    AuthFailed,
}

/// Command error. Serializes as `{ code, message }`. Messages never contain secrets.
#[derive(Debug, Error, Serialize)]
#[error("{message}")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
}

pub type Result<T, E = AppError> = std::result::Result<T, E>;

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidInput, message)
    }
    pub fn storage(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Storage, message)
    }
    pub fn auth_failed(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::AuthFailed, message)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        Self::storage(format!("Database error: {e}"))
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        Self::new(ErrorCode::Parse, format!("Unexpected data format: {e}"))
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        // Strip the URL: it may carry query data we do not want surfaced.
        let e = e.without_url();
        if e.is_timeout() {
            Self::new(ErrorCode::Network, "The request timed out")
        } else if e.is_decode() {
            Self::new(ErrorCode::Parse, "Unexpected response from Roblox")
        } else {
            Self::new(ErrorCode::Network, format!("Network error: {e}"))
        }
    }
}
