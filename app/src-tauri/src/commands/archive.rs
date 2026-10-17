use crate::commands::utils::resolve_peer;
use crate::commands::TelegramState;
use crate::vpn_optimizer::NetworkConfig;
use crate::workspace::AccountGuard;
use grammers_client::media::Media;
use serde::Serialize;
use std::io::{Cursor, Read};
use std::sync::Arc;
use tauri::Manager;
use tauri::State;
use tokio::io::AsyncWriteExt;

const MAX_ARCHIVE_ENTRIES: usize = 10_000;
const MAX_ARCHIVE_ENTRY_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_TOTAL_UNCOMPRESSED_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_COMPRESSION_RATIO: u64 = 1_000;

#[derive(Debug, Clone, Serialize)]
pub struct ArchiveEntry {
    pub filename: String,
    pub size: u64,
    pub compressed_size: u64,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExtractedFile {
    pub temp_path: String,
    pub filename: String,
    pub size: u64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum ArchiveType {
    Zip,
    Rar,
    SevenZ,
}

fn detect_archive_type(filename: &str) -> ArchiveType {
    let lower = filename.to_lowercase();
    if lower.ends_with(".rar") {
        ArchiveType::Rar
    } else if lower.ends_with(".7z") {
        ArchiveType::SevenZ
    } else {
        ArchiveType::Zip
    }
}

fn generate_unique_temp_prefix(label: &str) -> String {
    format!(
        "archive_{}_{}_{}",
        label,
        std::process::id(),
        rand::random::<u64>()
    )
}

/// Download a zip, rar, or 7z file from Telegram and return its directory listing.
#[tauri::command]
pub async fn cmd_list_archive_contents(
    message_id: i32,
    folder_id: Option<i64>,
    state: State<'_, TelegramState>,
    net_config: State<'_, Arc<NetworkConfig>>,
    app: tauri::AppHandle,
) -> Result<Vec<ArchiveEntry>, String> {
    let account = active_account(&app)?;
    let (client, media, filename, max_bytes) =
        prepare_archive_operation(message_id, folder_id, &state, &net_config, &account).await?;
    let archive_type = detect_archive_type(&filename);

    let result = match archive_type {
        ArchiveType::Zip => {
            list_zip_contents(&client, &media, max_bytes, &filename, &account).await
        }
        #[cfg(not(target_os = "android"))]
        ArchiveType::Rar => {
            list_rar_contents(&client, &media, max_bytes, &filename, &account).await
        }
        #[cfg(target_os = "android")]
        ArchiveType::Rar => Err("RAR archives are not supported on Android".to_string()),
        ArchiveType::SevenZ => {
            list_sevenz_contents(&client, &media, max_bytes, &filename, &account).await
        }
    }?;
    account.validate()?;
    Ok(result)
}

/// Extract a single file from an archive and return its temp path for
/// subsequent upload.
#[tauri::command]
pub async fn cmd_extract_archive_entry(
    message_id: i32,
    folder_id: Option<i64>,
    entry_index: usize,
    state: State<'_, TelegramState>,
    net_config: State<'_, Arc<NetworkConfig>>,
    app: tauri::AppHandle,
) -> Result<ExtractedFile, String> {
    let account = active_account(&app)?;
    let (client, media, filename, max_bytes) =
        prepare_archive_operation(message_id, folder_id, &state, &net_config, &account).await?;
    let archive_type = detect_archive_type(&filename);

    let extracted = match archive_type {
        ArchiveType::Zip => {
            extract_zip_entry(&client, &media, max_bytes, entry_index, &account).await
        }
        #[cfg(not(target_os = "android"))]
        ArchiveType::Rar => {
            extract_rar_entry(&client, &media, max_bytes, entry_index, &account).await
        }
        #[cfg(target_os = "android")]
        ArchiveType::Rar => Err("RAR archives are not supported on Android".to_string()),
        ArchiveType::SevenZ => {
            extract_sevenz_entry(&client, &media, max_bytes, entry_index, &account).await
        }
    }?;
    if let Err(error) = account.validate() {
        let _ = tokio::fs::remove_file(&extracted.temp_path).await;
        return Err(error);
    }
    if let Err(error) = crate::temp_artifacts::register(std::path::Path::new(&extracted.temp_path))
    {
        let _ = tokio::fs::remove_file(&extracted.temp_path).await;
        return Err(error);
    }
    if let Err(error) = account.validate() {
        let _ =
            crate::temp_artifacts::delete_registered(std::path::Path::new(&extracted.temp_path));
        return Err(error);
    }
    Ok(extracted)
}

// ── Shared preparation ──────────────────────────────────────────────────

async fn prepare_archive_operation(
    message_id: i32,
    folder_id: Option<i64>,
    state: &TelegramState,
    net_config: &Arc<NetworkConfig>,
    account: &AccountGuard,
) -> Result<(grammers_client::Client, Media, String, u64), String> {
    account.validate()?;
    let client_opt = { state.client.lock().await.clone() };
    let client = match client_opt {
        Some(c) => c,
        None => return Err("Telegram client is not connected".to_string()),
    };

    let client_validation = account.validate_client(&client).await;
    account.validate()?;
    client_validation?;
    let peer_result = resolve_peer(&client, folder_id, &state.peer_cache).await;
    account.validate()?;
    let peer = peer_result.map_err(|e| format!("Failed to resolve peer: {}", e))?;
    let peer_ref_result = crate::commands::utils::peer_to_ref(&peer).await;
    account.validate()?;
    let peer_ref = peer_ref_result?;
    let messages_result = client.get_messages_by_id(peer_ref, &[message_id]).await;
    account.validate()?;
    let messages = messages_result.map_err(|e| format!("Failed to fetch message: {}", e))?;

    let msg = messages
        .into_iter()
        .flatten()
        .next()
        .ok_or("File not found")?;

    let media = msg.media().ok_or("Message has no media")?;

    let filename = match &media {
        Media::Document(d) => d.name().unwrap_or("unknown").to_string(),
        _ => "unknown".to_string(),
    };

    let file_size = match &media {
        Media::Document(d) => d.size().map_or(0, |size| size as u64),
        _ => 0,
    };

    let max_bytes = net_config.archive_max_bytes();
    if max_bytes > 0 && file_size > max_bytes {
        return Err(format!(
            "Archive file ({} MiB) exceeds the {} MiB archive size limit",
            file_size / (1024 * 1024),
            max_bytes / (1024 * 1024),
        ));
    }

    account.validate()?;
    Ok((client, media, filename, max_bytes))
}

fn active_account(app: &tauri::AppHandle) -> Result<AccountGuard, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    AccountGuard::open(&root, None)
}

fn map_download_chunk<E: std::fmt::Display>(
    result: Result<Option<Vec<u8>>, E>,
) -> Result<Option<Vec<u8>>, String> {
    result.map_err(|error| format!("Download error: {error}"))
}

fn zip_entry_name(
    name: Result<std::borrow::Cow<'_, str>, zip::result::ZipError>,
    index: usize,
) -> Result<String, String> {
    name.map(|name| name.into_owned()).map_err(|error| {
        format!(
            "Failed to read ZIP entry name at index {}: {}",
            index, error
        )
    })
}

// ── ZIP helpers ─────────────────────────────────────────────────────────

async fn download_to_memory(
    client: &grammers_client::Client,
    media: &Media,
    max_bytes: u64,
    label: &str,
    account: &AccountGuard,
) -> Result<Vec<u8>, String> {
    let mut data = Vec::new();
    let mut download_iter = client.iter_download(media);
    let mut total_bytes: u64 = 0;

    loop {
        let next = download_iter.next().await;
        account.validate()?;
        let Some(chunk) = map_download_chunk(next)? else {
            break;
        };
        total_bytes += chunk.len() as u64;
        if max_bytes > 0 && total_bytes > max_bytes {
            return Err(format!(
                "{} download exceeded the {} MiB limit",
                label,
                max_bytes / (1024 * 1024),
            ));
        }
        data.extend_from_slice(&chunk);
    }
    account.validate()?;
    Ok(data)
}

async fn list_zip_contents(
    client: &grammers_client::Client,
    media: &Media,
    max_bytes: u64,
    filename: &str,
    account: &AccountGuard,
) -> Result<Vec<ArchiveEntry>, String> {
    let data = download_to_memory(client, media, max_bytes, "ZIP", account).await?;
    let cursor = Cursor::new(data);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to parse ZIP file: {}", e))?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(format!(
            "Archive contains more than {MAX_ARCHIVE_ENTRIES} entries"
        ));
    }

    let mut entries = Vec::new();
    for i in 0..archive.len() {
        let file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry at index {}: {}", i, e))?;
        entries.push(ArchiveEntry {
            filename: zip_entry_name(file.name(), i)?,
            size: file.size(),
            compressed_size: file.compressed_size(),
            is_dir: file.is_dir(),
        });
    }
    validate_archive_entries(&entries)?;
    check_non_empty(&entries, filename, "ZIP")?;
    Ok(entries)
}

async fn extract_zip_entry(
    client: &grammers_client::Client,
    media: &Media,
    max_bytes: u64,
    entry_index: usize,
    account: &AccountGuard,
) -> Result<ExtractedFile, String> {
    let data = download_to_memory(client, media, max_bytes, "ZIP", account).await?;

    let (buf, safe_name, entry_size, temp_path) = {
        let cursor = Cursor::new(data);
        let mut archive =
            zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to parse ZIP file: {}", e))?;
        let file = archive
            .by_index(entry_index)
            .map_err(|e| format!("Failed to read ZIP entry at index {}: {}", entry_index, e))?;
        if file.is_dir() {
            return Err("Cannot extract a directory entry".to_string());
        }
        let entry_name = zip_entry_name(file.name(), entry_index)?;
        validate_archive_entries(&[ArchiveEntry {
            filename: entry_name.clone(),
            size: file.size(),
            compressed_size: file.compressed_size(),
            is_dir: false,
        }])?;
        let entry_size = file.size();
        let safe_name = sanitise_entry_name(&entry_name, entry_index);
        let temp_path = std::env::temp_dir().join(format!(
            "{}_{}",
            generate_unique_temp_prefix("extract"),
            safe_name
        ));
        let mut buf = Vec::with_capacity(entry_size.min(64 * 1024 * 1024) as usize);
        file.take(MAX_ARCHIVE_ENTRY_BYTES + 1)
            .read_to_end(&mut buf)
            .map_err(|e| format!("Failed to read ZIP entry bytes: {}", e))?;
        if buf.len() as u64 > MAX_ARCHIVE_ENTRY_BYTES {
            return Err("Archive entry exceeds the extraction size limit".to_string());
        }
        Ok::<_, String>((buf, safe_name, entry_size, temp_path))
    }?;

    if let Err(error) = tokio::fs::write(&temp_path, &buf).await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(format!("Failed to write extracted file: {}", error));
    }

    Ok(ExtractedFile {
        temp_path: temp_path.to_string_lossy().to_string(),
        filename: safe_name,
        size: entry_size,
    })
}

// ── RAR helpers ─────────────────────────────────────────────────────────

async fn download_to_temp_file(
    client: &grammers_client::Client,
    media: &Media,
    max_bytes: u64,
    label: &str,
    extension: &str,
    account: &AccountGuard,
) -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    let unique_id = generate_unique_temp_prefix("viewer");
    let archive_path = std::env::temp_dir().join(format!("{}.{}", unique_id, extension));
    let extract_dir = std::env::temp_dir().join(format!("{}_extract", unique_id));

    let download_result: Result<(), String> = async {
        tokio::fs::create_dir_all(&extract_dir)
            .await
            .map_err(|e| format!("Failed to create temp extract directory: {}", e))?;

        let mut file = tokio::fs::File::create(&archive_path)
            .await
            .map_err(|e| format!("Failed to create temp file: {}", e))?;
        let mut download_iter = client.iter_download(media);
        let mut total_bytes: u64 = 0;

        loop {
            let next = download_iter.next().await;
            account.validate()?;
            let Some(chunk) = map_download_chunk(next)? else {
                break;
            };
            total_bytes += chunk.len() as u64;
            if max_bytes > 0 && total_bytes > max_bytes {
                return Err(format!(
                    "{} download exceeded the {} MiB limit",
                    label,
                    max_bytes / (1024 * 1024),
                ));
            }
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Failed to write temp file: {}", e))?;
            account.validate()?;
        }
        file.flush()
            .await
            .map_err(|e| format!("Failed to flush temp file: {}", e))?;
        account.validate()?;
        Ok(())
    }
    .await;

    if let Err(error) = download_result {
        let _ = tokio::fs::remove_file(&archive_path).await;
        let _ = tokio::fs::remove_dir_all(&extract_dir).await;
        return Err(error);
    }
    Ok((archive_path, extract_dir))
}

#[cfg(not(target_os = "android"))]
async fn list_rar_contents(
    client: &grammers_client::Client,
    media: &Media,
    max_bytes: u64,
    filename: &str,
    account: &AccountGuard,
) -> Result<Vec<ArchiveEntry>, String> {
    let (archive_path, extract_dir) =
        download_to_temp_file(client, media, max_bytes, "RAR", "rar", account).await?;
    let rar_path = archive_path.clone();

    // List-only mode: reads headers WITHOUT extracting (zero disk writes)
    let entries_result: Result<Vec<ArchiveEntry>, String> =
        tokio::task::spawn_blocking(move || {
            let archive = unrar::Archive::new(rar_path.to_str().unwrap_or(""))
                .open_for_listing()
                .map_err(|e| format!("Failed to open RAR file for listing: {}", e))?;

            let mut entries = Vec::new();
            for result in archive {
                if entries.len() >= MAX_ARCHIVE_ENTRIES {
                    return Err(format!(
                        "Archive contains more than {MAX_ARCHIVE_ENTRIES} entries"
                    ));
                }
                let header: unrar::FileHeader =
                    result.map_err(|e| format!("Failed to read RAR header: {}", e))?;
                let name = header.filename.to_string_lossy().to_string();
                entries.push(ArchiveEntry {
                    filename: name,
                    size: header.unpacked_size,
                    compressed_size: header.unpacked_size,
                    is_dir: header.is_directory(),
                });
            }
            Ok(entries)
        })
        .await
        .map_err(|e| format!("RAR listing task panicked: {:?}", e))?;

    let _ = tokio::fs::remove_file(&archive_path).await;
    let _ = tokio::fs::remove_dir_all(&extract_dir).await;

    let entries = entries_result?;
    validate_archive_entries(&entries)?;
    check_non_empty(&entries, filename, "RAR")?;
    Ok(entries)
}

#[cfg(not(target_os = "android"))]
async fn extract_rar_entry(
    client: &grammers_client::Client,
    media: &Media,
    max_bytes: u64,
    entry_index: usize,
    account: &AccountGuard,
) -> Result<ExtractedFile, String> {
    let (archive_path, extract_dir) =
        download_to_temp_file(client, media, max_bytes, "RAR", "rar", account).await?;
    let rar_path = archive_path.clone();
    let extract_dir_cleanup = extract_dir.clone();
    let extraction_result: Result<ExtractedFile, String> = tokio::task::spawn_blocking(move || {
        use path_clean::PathClean;

        let rar_str = rar_path.to_str().unwrap_or("").to_string();
        let mut archive = unrar::Archive::new(&rar_str)
            .open_for_processing()
            .map_err(|e| format!("Failed to open RAR file for processing: {}", e))?;

        let mut current_index: usize = 0;
        while let Some(header) = archive
            .read_header()
            .map_err(|e| format!("Failed to read RAR header: {}", e))?
        {
            if current_index >= MAX_ARCHIVE_ENTRIES {
                return Err(format!(
                    "Archive contains more than {MAX_ARCHIVE_ENTRIES} entries"
                ));
            }
            let is_target = current_index == entry_index;
            current_index += 1;

            if !is_target {
                archive = header
                    .skip()
                    .map_err(|e| format!("Failed to skip RAR entry: {}", e))?;
                continue;
            }

            if header.entry().is_directory() {
                return Err("Cannot extract a directory entry".to_string());
            }

            if header.entry().unpacked_size > MAX_ARCHIVE_ENTRY_BYTES {
                return Err("Archive entry exceeds the extraction size limit".to_string());
            }

            let entry_name = header.entry().filename.to_string_lossy().to_string();

            // Path traversal check: validate the entry name would stay within extract_dir
            let raw_dest = extract_dir.join(&entry_name);
            let clean_dest = raw_dest.clean();
            let clean_base = extract_dir.clean();
            if !clean_dest.starts_with(&clean_base) {
                log::error!("Path traversal attempt blocked in RAR: {}", entry_name);
                return Err(format!(
                    "Blocked path traversal in RAR entry: {}",
                    entry_name
                ));
            }

            // Read decompressed bytes into memory (no disk write in uncontrolled location)
            let (data, _next_archive) = header
                .read()
                .map_err(|e| format!("Failed to read RAR entry bytes: {}", e))?;
            if data.len() as u64 > MAX_ARCHIVE_ENTRY_BYTES {
                return Err("Archive entry exceeds the extraction size limit".to_string());
            }

            let safe_name = sanitise_entry_name(&entry_name, entry_index);
            let temp_path = std::env::temp_dir().join(format!(
                "{}_{}",
                generate_unique_temp_prefix("extract"),
                safe_name
            ));
            let data_len = data.len() as u64;
            if let Err(error) = std::fs::write(&temp_path, data) {
                let _ = std::fs::remove_file(&temp_path);
                return Err(format!("Failed to write extracted RAR entry: {}", error));
            }

            return Ok(ExtractedFile {
                temp_path: temp_path.to_string_lossy().to_string(),
                filename: safe_name,
                size: data_len,
            });
        }

        Err(format!(
            "Entry index {} not found in RAR archive ({} entries scanned)",
            entry_index, current_index
        ))
    })
    .await
    .map_err(|e| format!("RAR extraction task panicked: {:?}", e))?;

    let _ = tokio::fs::remove_file(&archive_path).await;
    let _ = tokio::fs::remove_dir_all(&extract_dir_cleanup).await;

    extraction_result
}

// ── 7z helpers ──────────────────────────────────────────────────────────

async fn list_sevenz_contents(
    client: &grammers_client::Client,
    media: &Media,
    max_bytes: u64,
    filename: &str,
    account: &AccountGuard,
) -> Result<Vec<ArchiveEntry>, String> {
    let (archive_path, extract_dir) =
        download_to_temp_file(client, media, max_bytes, "7z", "7z", account).await?;
    let path = archive_path.clone();

    let entries_result: Result<Vec<ArchiveEntry>, String> =
        tokio::task::spawn_blocking(move || {
            let archive = sevenz_rust2::Archive::open(&path)
                .map_err(|e| format!("Failed to open 7z file: {}", e))?;
            if archive.files.len() > MAX_ARCHIVE_ENTRIES {
                return Err(format!(
                    "Archive contains more than {MAX_ARCHIVE_ENTRIES} entries"
                ));
            }
            let entries = archive
                .files
                .iter()
                .map(|e| ArchiveEntry {
                    filename: e.name().to_string(),
                    size: e.size,
                    compressed_size: e.compressed_size,
                    is_dir: e.is_directory,
                })
                .collect::<Vec<_>>();
            drop(archive);
            Ok(entries)
        })
        .await
        .map_err(|e| format!("7z listing task panicked: {:?}", e))?;

    let _ = tokio::fs::remove_file(&archive_path).await;
    // 7z listing doesn't extract, so extract_dir is empty — clean it up.
    let _ = tokio::fs::remove_dir_all(&extract_dir).await;

    let entries = entries_result?;
    validate_archive_entries(&entries)?;
    check_non_empty(&entries, filename, "7z")?;
    Ok(entries)
}

async fn extract_sevenz_entry(
    client: &grammers_client::Client,
    media: &Media,
    max_bytes: u64,
    entry_index: usize,
    account: &AccountGuard,
) -> Result<ExtractedFile, String> {
    let (archive_path, extract_dir) =
        download_to_temp_file(client, media, max_bytes, "7z", "7z", account).await?;
    let path = archive_path.clone();

    let extraction_result: Result<ExtractedFile, String> = tokio::task::spawn_blocking(move || {
        let file = std::fs::File::open(&path)
            .map_err(|e| format!("Failed to open temp 7z file: {}", e))?;
        let len = file
            .metadata()
            .map_err(|e| format!("Failed to read 7z file metadata: {}", e))?
            .len();
        let mut reader = sevenz_rust2::SevenZReader::new(file, len, [].as_slice().into())
            .map_err(|e| format!("Failed to create 7z reader: {}", e))?;

        let mut found: Option<(String, u64, Vec<u8>)> = None;
        let mut idx: usize = 0;

        reader
            .for_each_entries(|entry, entry_reader| {
                if idx >= MAX_ARCHIVE_ENTRIES {
                    return Err(sevenz_rust2::Error::other(format!(
                        "Archive contains more than {MAX_ARCHIVE_ENTRIES} entries"
                    )));
                }
                let current = idx;
                idx += 1;
                if current != entry_index {
                    return Ok(true); // continue
                }
                if entry.is_directory {
                    return Err(sevenz_rust2::Error::other(
                        "Cannot extract a directory entry",
                    ));
                }
                if entry.size > MAX_ARCHIVE_ENTRY_BYTES {
                    return Err(sevenz_rust2::Error::other(
                        "Archive entry exceeds the extraction size limit",
                    ));
                }
                if entry.compressed_size > 0
                    && entry.size / entry.compressed_size > MAX_ARCHIVE_COMPRESSION_RATIO
                {
                    return Err(sevenz_rust2::Error::other(
                        "Archive entry exceeds the compression ratio limit",
                    ));
                }
                let safe_name = sanitise_entry_name(entry.name(), entry_index);
                let mut buf = Vec::new();
                entry_reader
                    .take(MAX_ARCHIVE_ENTRY_BYTES + 1)
                    .read_to_end(&mut buf)
                    .map_err(|e| {
                        sevenz_rust2::Error::other(format!("Failed to read 7z entry bytes: {}", e))
                    })?;
                if buf.len() as u64 > MAX_ARCHIVE_ENTRY_BYTES {
                    return Err(sevenz_rust2::Error::other(
                        "Archive entry exceeds the extraction size limit",
                    ));
                }
                found = Some((safe_name, entry.size, buf));
                Ok(false) // stop iteration
            })
            .map_err(|e| format!("7z extraction error: {}", e))?;

        let (safe_name, size, buf) =
            found.ok_or_else(|| format!("Entry index {} not found in 7z archive", entry_index))?;

        let temp_path = std::env::temp_dir().join(format!(
            "{}_{}",
            generate_unique_temp_prefix("extract"),
            safe_name
        ));
        if let Err(error) = std::fs::write(&temp_path, &buf) {
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!("Failed to write extracted 7z entry: {}", error));
        }

        Ok(ExtractedFile {
            temp_path: temp_path.to_string_lossy().to_string(),
            filename: safe_name,
            size,
        })
    })
    .await
    .map_err(|e| format!("7z extraction task panicked: {:?}", e))?;

    let _ = tokio::fs::remove_file(&archive_path).await;
    let _ = tokio::fs::remove_dir_all(&extract_dir).await;

    extraction_result
}

// ── Shared utilities ────────────────────────────────────────────────────

fn sanitise_entry_name(entry_name: &str, entry_index: usize) -> String {
    std::path::Path::new(entry_name)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| format!("extracted_{}", entry_index))
}

fn check_non_empty(entries: &[ArchiveEntry], filename: &str, label: &str) -> Result<(), String> {
    if entries.is_empty() {
        return Err(format!(
            "The file \"{}\" does not appear to be a valid {} archive (no entries found)",
            filename, label,
        ));
    }
    Ok(())
}

fn validate_archive_entries(entries: &[ArchiveEntry]) -> Result<(), String> {
    if entries.len() > MAX_ARCHIVE_ENTRIES {
        return Err(format!(
            "Archive contains more than {MAX_ARCHIVE_ENTRIES} entries"
        ));
    }
    let mut total = 0_u64;
    for entry in entries.iter().filter(|entry| !entry.is_dir) {
        if entry.size > MAX_ARCHIVE_ENTRY_BYTES {
            return Err("Archive entry exceeds the extraction size limit".to_string());
        }
        total = total
            .checked_add(entry.size)
            .ok_or_else(|| "Archive uncompressed size overflowed".to_string())?;
        if total > MAX_ARCHIVE_TOTAL_UNCOMPRESSED_BYTES {
            return Err("Archive exceeds the total uncompressed size limit".to_string());
        }
        if entry.compressed_size > 0
            && entry.size / entry.compressed_size > MAX_ARCHIVE_COMPRESSION_RATIO
        {
            return Err("Archive entry exceeds the compression ratio limit".to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        map_download_chunk, validate_archive_entries, zip_entry_name, AccountGuard, ArchiveEntry,
        MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_ENTRY_BYTES,
    };
    use grammers_session::{storages::SqliteSession, types::PeerInfo, Session};

    fn entry(size: u64, compressed_size: u64) -> ArchiveEntry {
        ArchiveEntry {
            filename: "file.bin".to_string(),
            size,
            compressed_size,
            is_dir: false,
        }
    }

    #[test]
    fn archive_policy_blocks_entry_count_size_and_ratio_bombs() {
        assert!(validate_archive_entries(&vec![entry(1, 1); MAX_ARCHIVE_ENTRIES + 1]).is_err());
        assert!(validate_archive_entries(&[entry(MAX_ARCHIVE_ENTRY_BYTES + 1, 1)]).is_err());
        assert!(validate_archive_entries(&[entry(2_000, 1)]).is_err());
        assert!(validate_archive_entries(&[entry(1_000, 1)]).is_ok());
    }

    #[test]
    fn zip_entry_name_errors_are_propagated() {
        let zip_error = zip::result::ZipError::FileNotFound;
        let error = zip_entry_name(Err(zip_error), 7).unwrap_err();
        assert_eq!(
            error,
            format!(
                "Failed to read ZIP entry name at index 7: {}",
                zip::result::ZipError::FileNotFound
            )
        );
    }

    #[test]
    fn iterator_errors_after_a_chunk_are_propagated_not_eof() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(
            &map_download_chunk::<&str>(Ok(Some(vec![4, 5])))
                .unwrap()
                .unwrap(),
        );
        let error = map_download_chunk::<&str>(Err("injected Telegram failure")).unwrap_err();
        assert!(error.contains("injected Telegram failure"));
        assert_eq!(bytes, vec![4, 5]);
    }

    #[test]
    fn captured_account_guard_rejects_a_replacement_account() {
        let root = std::env::temp_dir().join(format!("archive-owner-{}", uuid::Uuid::new_v4()));
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
