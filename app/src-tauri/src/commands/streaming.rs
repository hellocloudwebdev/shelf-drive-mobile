use std::sync::Arc;
use tauri::{Manager, State};

/// Holds the streaming config (token manager + port)
pub struct StreamConfig {
    pub manager: Arc<crate::stream_token::StreamTokenManager>,
    pub port: u16,
}

/// Returned to the frontend so it can construct stream URLs dynamically
#[derive(serde::Serialize)]
pub struct StreamInfo {
    pub token: String,
    pub base_url: String,
    /// Decimal string preserves the full opaque u64 across JavaScript's
    /// 53-bit integer boundary.
    pub operation_token: Option<String>,
}

/// Returns the streaming server's base URL and a short-lived, resource-scoped
/// capability token to the frontend.
#[tauri::command]
pub fn cmd_get_stream_info(
    app_handle: tauri::AppHandle,
    file_id: Option<i64>,
    folder_id: Option<String>,
    config: State<'_, StreamConfig>,
    crypto_state: State<'_, crate::crypto::state::CryptoState>,
) -> Result<StreamInfo, String> {
    let host = "localhost";
    let file_id =
        file_id.ok_or_else(|| "A file ID is required to authorize a media stream".to_string())?;
    let folder_id = match folder_id.as_deref() {
        None | Some("home") | Some("me") | Some("null") => None,
        Some(value) => Some(
            value
                .parse::<i64>()
                .map_err(|_| "Invalid folder ID for media stream".to_string())?,
        ),
    };
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let account = crate::workspace::AccountGuard::open(&app_data_dir, None)?;
    let operation_token = crypto_state
        .current_session()
        .and_then(|session| {
            crypto_state
                .create_operation_handle(session, crate::crypto::state::OperationClass::MediaStream)
                .ok()
        })
        .map(|handle| handle.to_string());

    let resource_id = crate::stream_token::resource_key(account.owner, folder_id, file_id);
    account.validate()?;
    let token = config
        .manager
        .issue_token(&resource_id, Some(account.owner));

    Ok(StreamInfo {
        token,
        base_url: format!("http://{}:{}", host, config.port),
        operation_token,
    })
}
