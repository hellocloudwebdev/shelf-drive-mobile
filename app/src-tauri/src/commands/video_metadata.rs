use crate::commands::utils::resolve_peer;
use crate::mp4_utils;
use crate::workspace::AccountGuard;
use crate::TelegramState;
use grammers_client::media::Media;
use tauri::{Manager, State};

#[derive(serde::Serialize)]
pub struct VideoMetadata {
    pub duration_secs: Option<f64>,
    pub video_codec: Option<String>,
    pub has_audio: bool,
    pub track_count: usize,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(serde::Deserialize)]
pub struct BatchMetadataRequest {
    pub message_id: i32,
    pub file_name: String,
}

#[derive(serde::Serialize)]
pub struct BatchMetadataEntry {
    pub message_id: i32,
    pub duration_secs: Option<f64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[tauri::command]
pub async fn cmd_get_video_metadata(
    message_id: i32,
    folder_id: Option<i64>,
    state: State<'_, TelegramState>,
    app: tauri::AppHandle,
) -> Result<VideoMetadata, String> {
    let account = active_account(&app)?;
    let client = { state.client.lock().await.clone() };
    account.validate()?;
    let client = client.ok_or_else(|| "Not connected to Telegram".to_string())?;
    let client_validation = account.validate_client(&client).await;
    account.validate()?;
    client_validation?;

    let buffer = download_moov_chunk(&client, message_id, folder_id, &state, &account).await?;
    account.validate()?;
    let meta = parse_mp4_metadata(&buffer)?;
    let (width, height) = mp4_utils::scan_video_tkhd_dimensions(&buffer);

    account.validate()?;
    Ok(VideoMetadata {
        duration_secs: meta.duration_secs,
        video_codec: meta.video_codec,
        has_audio: meta.has_audio,
        track_count: meta.track_count,
        width,
        height,
    })
}

#[tauri::command]
pub async fn cmd_get_video_metadata_batch(
    requests: Vec<BatchMetadataRequest>,
    folder_id: Option<i64>,
    state: State<'_, TelegramState>,
    app: tauri::AppHandle,
) -> Result<Vec<BatchMetadataEntry>, String> {
    let account = active_account(&app)?;
    let client = { state.client.lock().await.clone() };
    account.validate()?;
    let client = client.ok_or_else(|| "Not connected to Telegram".to_string())?;
    let client_validation = account.validate_client(&client).await;
    account.validate()?;
    client_validation?;
    let peer = resolve_peer(&client, folder_id, &state.peer_cache).await?;
    account.validate()?;

    let mut results: Vec<BatchMetadataEntry> = Vec::with_capacity(requests.len());

    for req in &requests {
        if !req.file_name.to_lowercase().ends_with(".mp4") {
            continue;
        }
        let download_result = download_and_process(&client, &peer, req, &account).await;
        account.validate()?;
        match download_result {
            Ok(e) => results.push(e),
            Err(_) => results.push(BatchMetadataEntry {
                message_id: req.message_id,
                duration_secs: None,
                width: None,
                height: None,
            }),
        }
    }

    account.validate()?;
    Ok(results)
}

// ── Internal helpers ─────────────────────────────────────────────────

struct ParsedMetadata {
    duration_secs: Option<f64>,
    video_codec: Option<String>,
    has_audio: bool,
    track_count: usize,
}

/// Download the first 2 MB of a file and parse metadata + scan tkhd.
async fn download_and_process(
    client: &grammers_client::Client,
    peer: &grammers_client::peer::Peer,
    req: &BatchMetadataRequest,
    account: &AccountGuard,
) -> Result<BatchMetadataEntry, String> {
    let peer_ref_result = crate::commands::utils::peer_to_ref(peer).await;
    account.validate()?;
    let peer_ref = peer_ref_result?;
    let messages_result = client.get_messages_by_id(peer_ref, &[req.message_id]).await;
    account.validate()?;
    let messages = messages_result.map_err(|e| e.to_string())?;
    let msg = messages
        .into_iter()
        .flatten()
        .next()
        .ok_or_else(|| format!("Message {} not found", req.message_id))?;
    let media = msg.media().ok_or_else(|| "No media".to_string())?;

    let size = match &media {
        Media::Document(d) => d.size().map_or(0, |s| s as u64),
        _ => return Err("Not a document".to_string()),
    };

    let buffer = download_bytes(client, &media, size, account).await?;
    account.validate()?;
    let meta = parse_mp4_metadata(&buffer)?;
    let (width, height) = mp4_utils::scan_video_tkhd_dimensions(&buffer);

    Ok(BatchMetadataEntry {
        message_id: req.message_id,
        duration_secs: meta.duration_secs,
        width,
        height,
    })
}

async fn download_moov_chunk(
    client: &grammers_client::Client,
    message_id: i32,
    folder_id: Option<i64>,
    state: &TelegramState,
    account: &AccountGuard,
) -> Result<Vec<u8>, String> {
    let peer_result = resolve_peer(client, folder_id, &state.peer_cache).await;
    account.validate()?;
    let peer = peer_result?;
    let peer_ref_result = crate::commands::utils::peer_to_ref(&peer).await;
    account.validate()?;
    let peer_ref = peer_ref_result?;
    let messages_result = client.get_messages_by_id(peer_ref, &[message_id]).await;
    account.validate()?;
    let messages = messages_result.map_err(|e| e.to_string())?;
    let msg = messages
        .into_iter()
        .flatten()
        .next()
        .ok_or_else(|| format!("Message {message_id} not found"))?;
    let media = msg.media().ok_or_else(|| "No media".to_string())?;
    let size = match &media {
        Media::Document(d) => d.size().map_or(0, |s| s as u64),
        _ => return Err("Not a document".to_string()),
    };
    download_bytes(client, &media, size, account).await
}

/// Download at most the first 2 MB from a Telegram document.
async fn download_bytes(
    client: &grammers_client::Client,
    media: &Media,
    file_size: u64,
    account: &AccountGuard,
) -> Result<Vec<u8>, String> {
    let max_bytes = std::cmp::min(2 * 1024 * 1024, file_size) as usize;
    let mut buffer: Vec<u8> = Vec::with_capacity(max_bytes);
    let mut download_iter = client.iter_download(media);
    download_iter = download_iter.chunk_size(65536);

    while buffer.len() < max_bytes {
        let next = download_iter.next().await;
        account.validate()?;
        match map_download_chunk(next)? {
            Some(chunk) => {
                let remaining = max_bytes.saturating_sub(buffer.len());
                let take = std::cmp::min(chunk.len(), remaining);
                buffer.extend_from_slice(&chunk[..take]);
            }
            None => break,
        }
    }
    if buffer.is_empty() {
        return Err("Downloaded zero bytes".to_string());
    }
    account.validate()?;
    Ok(buffer)
}

fn map_download_chunk<E: std::fmt::Display>(
    result: Result<Option<Vec<u8>>, E>,
) -> Result<Option<Vec<u8>>, String> {
    result.map_err(|error| format!("Download error: {error}"))
}

fn active_account(app: &tauri::AppHandle) -> Result<AccountGuard, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    AccountGuard::open(&root, None)
}

fn parse_mp4_metadata(buffer: &[u8]) -> Result<ParsedMetadata, String> {
    let mut cursor = std::io::Cursor::new(buffer);
    let context = mp4parse::read_mp4(&mut cursor).map_err(|e| format!("MP4 parse error: {e}"))?;

    let video_track = context
        .tracks
        .iter()
        .find(|t| t.track_type == mp4parse::TrackType::Video);

    let has_audio = context
        .tracks
        .iter()
        .any(|t| t.track_type == mp4parse::TrackType::Audio);

    let duration_secs = video_track.and_then(|t| {
        let d = t.duration.as_ref()?;
        let ts = t.timescale.as_ref()?;
        Some((d.0 as f64) / (ts.0 as f64))
    });

    Ok(ParsedMetadata {
        duration_secs,
        video_codec: None,
        has_audio,
        track_count: context.tracks.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use grammers_session::{storages::SqliteSession, types::PeerInfo, Session};

    #[test]
    fn iterator_errors_are_not_treated_as_eof_after_a_chunk() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(
            &map_download_chunk::<&str>(Ok(Some(vec![1, 2, 3])))
                .unwrap()
                .unwrap(),
        );
        let error = map_download_chunk::<&str>(Err("injected Telegram failure")).unwrap_err();
        assert!(error.contains("injected Telegram failure"));
        assert_eq!(bytes, vec![1, 2, 3]);
    }

    #[test]
    fn captured_account_guard_rejects_a_replacement_account() {
        let root =
            std::env::temp_dir().join(format!("video-metadata-owner-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        sign_in(&root, 101);
        let account = AccountGuard::open(&root, Some("101")).unwrap();
        sign_in(&root, 202);
        assert!(account.validate().unwrap_err().contains("ACCOUNT_CHANGED"));
        std::fs::remove_dir_all(root).unwrap();
    }

    fn sign_in(root: &std::path::Path, owner: i64) {
        for name in [
            "telegram.session",
            "telegram.session-wal",
            "telegram.session-shm",
        ] {
            let _ = std::fs::remove_file(root.join(name));
        }
        let session =
            crate::test_block_on(SqliteSession::open(root.join("telegram.session"))).unwrap();
        crate::test_block_on(session.cache_peer(PeerInfo::User {
            id: owner,
            auth: None,
            bot: Some(false),
            is_self: Some(true),
        }))
        .unwrap();
    }
}
