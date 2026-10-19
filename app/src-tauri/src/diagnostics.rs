use std::{
    collections::VecDeque,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(target_os = "android")]
use tauri::Manager;

const FILE_NAME: &str = "app-diagnostics.log";
const ROTATED_FILE_NAME: &str = "app-diagnostics.log.1";
const MAX_FILE_BYTES: usize = 512 * 1024;
const MAX_RECORD_BYTES: usize = 4096;
const MAX_EARLY_RECORDS: usize = 64;
#[cfg(any(target_os = "android", test))]
const MAX_ANDROID_LOG_BYTES: usize = 1100 * 1024;
const MAX_FRONTEND_FRAMES: usize = 16;
const MAX_FRONTEND_FRAME_BYTES: usize = 128;
const FRONTEND_EVENTS: &[&str] = &[
    "app_started",
    "js_window_error",
    "js_unhandled_rejection",
    "react_error",
    "app_background",
    "app_foreground",
];

#[derive(Default)]
struct Store {
    directory: Option<PathBuf>,
    early: VecDeque<String>,
}

static STORE: OnceLock<Mutex<Store>> = OnceLock::new();

fn store() -> &'static Mutex<Store> {
    STORE.get_or_init(|| Mutex::new(Store::default()))
}

fn epoch_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn json_line(
    kind: &str,
    level: &str,
    target: &str,
    event: Option<&str>,
    frames: &[String],
    location: Option<&str>,
) -> String {
    let mut value = serde_json::json!({
        "ts": epoch_millis(),
        "kind": kind,
        "level": level,
        "target": target,
    });
    if let Some(event) = event {
        value["event"] = serde_json::Value::String(event.to_owned());
    }
    if !frames.is_empty() {
        value["frames"] = serde_json::json!(frames);
    }
    if let Some(location) = location {
        value["location"] = serde_json::Value::String(location.to_owned());
    }
    let mut line = serde_json::to_string(&value).unwrap_or_else(|_| "{}".to_owned());
    line.push('\n');
    if line.len() > MAX_RECORD_BYTES {
        line.truncate(MAX_RECORD_BYTES - 1);
        line.push('\n');
    }
    line
}

fn append_bounded(directory: &Path, line: &str, sync: bool) -> std::io::Result<()> {
    fs::create_dir_all(directory)?;
    let current = directory.join(FILE_NAME);
    let rotated = directory.join(ROTATED_FILE_NAME);
    let current_len = fs::metadata(&current)
        .map(|m| m.len() as usize)
        .unwrap_or(0);
    if current_len.saturating_add(line.len()) > MAX_FILE_BYTES {
        let _ = fs::remove_file(&rotated);
        if current.exists() {
            if current_len <= MAX_FILE_BYTES {
                fs::rename(&current, &rotated)?;
            } else {
                // Do not preserve an oversized pre-existing file as the rotated copy.
                fs::remove_file(&current)?;
            }
        }
    }
    // A single bounded record is guaranteed smaller than the per-file limit.
    let mut file = OpenOptions::new().create(true).append(true).open(current)?;
    file.write_all(line.as_bytes())?;
    file.flush()?;
    if sync {
        file.sync_data()?;
    }
    Ok(())
}

fn append_line(line: String) {
    if let Ok(mut state) = store().lock() {
        if let Some(directory) = state.directory.as_deref() {
            let _ = append_bounded(directory, &line, false);
        } else {
            if state.early.len() == MAX_EARLY_RECORDS {
                state.early.pop_front();
            }
            state.early.push_back(line);
        }
    }
}

/// Initialize persistent storage after Tauri resolves the platform log directory.
pub fn initialize(directory: PathBuf) -> std::io::Result<()> {
    fs::create_dir_all(&directory)?;
    let mut state = store()
        .lock()
        .map_err(|_| std::io::Error::other("diagnostics lock poisoned"))?;
    state.directory = Some(directory.clone());
    while let Some(line) = state.early.pop_front() {
        append_bounded(&directory, &line, false)?;
    }
    Ok(())
}

fn record_frontend(event: &str, frames: &[String]) -> Result<(), String> {
    if !FRONTEND_EVENTS.contains(&event) {
        return Err("Unsupported diagnostic event".to_owned());
    }
    if frames.len() > MAX_FRONTEND_FRAMES {
        return Err("Too many diagnostic frames".to_owned());
    }
    if frames.iter().any(|frame| !valid_frame(frame)) {
        return Err("Diagnostic frames must contain function symbols only".to_owned());
    }
    let frames = frames.to_vec();
    append_line(json_line(
        "frontend",
        "info",
        "frontend",
        Some(event),
        &frames,
        None,
    ));
    Ok(())
}

fn valid_frame(frame: &str) -> bool {
    !frame.is_empty()
        && frame.len() <= MAX_FRONTEND_FRAME_BYTES
        && frame
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.$<>:-[]".contains(&b))
        && (frame.as_bytes()[0].is_ascii_alphabetic() || b"_$".contains(&frame.as_bytes()[0]))
}

/// Store only metadata for app-owned Rust log calls: never format or persist `record.args()`.
pub struct AppLogger {
    forwarder: env_logger::Logger,
}

impl log::Log for AppLogger {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        metadata.target() == "app_lib"
            || metadata.target().starts_with("app_lib::")
            || self.forwarder.enabled(metadata)
    }

    fn log(&self, record: &log::Record<'_>) {
        if self.forwarder.enabled(record.metadata()) {
            self.forwarder.log(record);
        }
        let target = record.target();
        if target == "app_lib" || target.starts_with("app_lib::") {
            let safe_target: String = target
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | ':' | '.'))
                .take(160)
                .collect();
            let level = match record.level() {
                log::Level::Error => "error",
                log::Level::Warn => "warn",
                log::Level::Info => "info",
                log::Level::Debug => "debug",
                log::Level::Trace => "trace",
            };
            // Source basenames and line numbers identify upload/error branches without retaining
            // formatted messages, which can include file names, URLs, tokens, or user values.
            let location = record.file().and_then(|file| {
                let basename = Path::new(file).file_name()?.to_str()?;
                let safe: String = basename
                    .chars()
                    .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
                    .take(96)
                    .collect();
                Some(format!("{safe}:{}", record.line().unwrap_or(0)))
            });
            append_line(json_line(
                "rust_log",
                level,
                &safe_target,
                None,
                &[],
                location.as_deref(),
            ));
        }
    }

    fn flush(&self) {
        self.forwarder.flush();
    }
}

pub fn install_logger() {
    let forwarder = env_logger::Builder::from_env(env_logger::Env::default()).build();
    let _ = log::set_boxed_logger(Box::new(AppLogger { forwarder }));
    log::set_max_level(log::LevelFilter::Trace);
}

pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let location = info.location().map(|location| {
            let file = Path::new(location.file())
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("unknown");
            let safe_file: String = file
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
                .take(96)
                .collect();
            format!(
                "{}:{}",
                if safe_file.is_empty() {
                    "unknown"
                } else {
                    &safe_file
                },
                location.line()
            )
        });
        // Deliberately do not inspect or format the panic payload: it may contain secrets.
        let line = json_line(
            "panic",
            "error",
            "app_lib",
            Some("panic"),
            &["panic".to_owned()],
            location.as_deref(),
        );
        // Avoid a panic-hook deadlock if panicking code already holds this mutex.
        if let Ok(mut state) = store().try_lock() {
            if let Some(directory) = state.directory.as_deref() {
                let _ = append_bounded(directory, &line, true);
            } else {
                if state.early.len() == MAX_EARLY_RECORDS {
                    state.early.pop_front();
                }
                state.early.push_back(line);
            }
        }
    }));
}

#[tauri::command]
pub fn cmd_record_app_diagnostic(event: String, frames: Vec<String>) -> Result<(), String> {
    record_frontend(&event, &frames)
}

#[tauri::command]
pub fn cmd_get_app_logs(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "android")]
    let system = crate::cmd_get_system_diagnostics(app.clone())
        .unwrap_or_else(|_| "Android system diagnostics are not currently available.".to_owned());
    #[cfg(not(target_os = "android"))]
    let system = format!(
        "=== Shelf Drive Diagnostics ===\nPackage: {}\nVersion: {}\nOS: {} {}",
        env!("CARGO_PKG_NAME"),
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH,
    );
    let mut result = format!("{system}\n\n=== App-owned diagnostics ===\n");
    #[cfg(target_os = "android")]
    {
        match android_app_log(&app) {
            Ok(contents) if !contents.trim().is_empty() => {
                result.push_str("--- Android app diagnostics ---\n");
                // Two 256 KiB history files + three 128 KiB traces encoded as base64,
                // with room for bounded exit metadata. Do not cut valid tombstones in half.
                result.push_str(&tail_by_bytes(&contents, MAX_ANDROID_LOG_BYTES));
                result.push('\n');
            }
            Ok(_) => {}
            Err(_) => result.push_str("(Android app diagnostics are not yet available.)\n"),
        }
    }
    #[cfg(not(target_os = "android"))]
    let _ = app;
    if let Ok(state) = store().lock() {
        if let Some(directory) = state.directory.as_deref() {
            for name in [ROTATED_FILE_NAME, FILE_NAME] {
                if let Ok(contents) = fs::read_to_string(directory.join(name)) {
                    result.push_str(&contents);
                }
            }
        }
    }
    Ok(result)
}

#[cfg(target_os = "android")]
fn android_app_log(_app: &tauri::AppHandle) -> Result<String, String> {
    let context = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(context.vm().cast()) }
        .map_err(|_| "Android diagnostics unavailable")?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|_| "Android diagnostics unavailable")?;
    let main_class = crate::jni_cache::get_main_activity_jclass()
        .ok_or("Android diagnostics are still initializing")?;
    let value = env
        .call_static_method(
            &main_class,
            "getAppDiagnosticLog",
            "()Ljava/lang/String;",
            &[],
        )
        .map_err(|_| "Android diagnostics unavailable")?
        .l()
        .map_err(|_| "Android diagnostics unavailable")?;
    let contents: String = env
        .get_string(&jni::objects::JString::from(value))
        .map_err(|_| "Android diagnostics unavailable")?
        .into();
    Ok(contents)
}

#[tauri::command]
pub fn cmd_save_app_logs(app: tauri::AppHandle) -> Result<String, String> {
    let contents = cmd_get_app_logs(app.clone())?;
    #[cfg(target_os = "android")]
    {
        let directory = app
            .path()
            .app_cache_dir()
            .map_err(|_| "Could not resolve app cache directory")?;
        fs::create_dir_all(&directory).map_err(|_| "Could not prepare diagnostics export")?;
        let path = directory.join("shelf-drive-diagnostics.txt");
        fs::write(&path, contents).map_err(|_| "Could not write diagnostics export")?;
        let result = save_android_diagnostics(&path);
        let _ = fs::remove_file(path);
        return result.map(|()| "Diagnostics saved to Downloads".to_owned());
    }
    #[cfg(not(target_os = "android"))]
    {
        use tauri_plugin_dialog::DialogExt;
        let Some(path) = app
            .dialog()
            .file()
            .set_file_name("shelf-drive-diagnostics.txt")
            .blocking_save_file()
        else {
            return Ok(String::new());
        };
        let path = path
            .into_path()
            .map_err(|_| "Invalid diagnostics export path")?;
        fs::write(path, contents).map_err(|_| "Could not save diagnostics export")?;
        Ok("Diagnostics saved".to_owned())
    }
}

#[cfg(any(target_os = "android", test))]
fn tail_by_bytes(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_owned();
    }
    let mut start = text.len() - max_bytes;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    text[start..].to_owned()
}

#[cfg(target_os = "android")]
fn save_android_diagnostics(path: &Path) -> Result<(), String> {
    let context = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(context.vm().cast()) }
        .map_err(|_| "Unable to access Android file export")?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|_| "Unable to access Android file export")?;
    let main_class =
        crate::jni_cache::get_main_activity_jclass().ok_or("Android is still initializing")?;
    let path = env
        .new_string(path.to_string_lossy().as_ref())
        .map_err(|_| "Unable to prepare diagnostics export")?;
    let name = env
        .new_string("shelf-drive-diagnostics.txt")
        .map_err(|_| "Unable to prepare diagnostics export")?;
    let mime = env
        .new_string("text/plain")
        .map_err(|_| "Unable to prepare diagnostics export")?;
    let saved = env
        .call_static_method(
            &main_class,
            "saveFileToPublicDownloads",
            "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Z",
            &[
                jni::objects::JValue::from(&path),
                jni::objects::JValue::from(&name),
                jni::objects::JValue::from(&mime),
            ],
        )
        .map_err(|_| "Unable to export diagnostics")?
        .z()
        .map_err(|_| "Unable to export diagnostics")?;
    if saved {
        Ok(())
    } else {
        Err("Unable to save diagnostics to Downloads".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        std::env::temp_dir().join(format!(
            "app-diagnostics-test-{}-{}-{}",
            std::process::id(),
            epoch_millis(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ))
    }

    #[test]
    fn rotates_into_two_bounded_files() {
        let directory = temp_dir();
        let line = format!("{}\n", "x".repeat(4090));
        for _ in 0..270 {
            append_bounded(&directory, &line, false).unwrap();
        }
        assert!(fs::metadata(directory.join(FILE_NAME)).unwrap().len() <= MAX_FILE_BYTES as u64);
        assert!(
            fs::metadata(directory.join(ROTATED_FILE_NAME))
                .unwrap()
                .len()
                <= MAX_FILE_BYTES as u64
        );
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 2);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn frontend_event_and_frames_are_allowlisted_and_bounded() {
        assert!(record_frontend("app_started", &["App.start".to_owned()]).is_ok());
        assert!(record_frontend("arbitrary_event", &[]).is_err());
        assert!(record_frontend("react_error", &["Error: private data".to_owned()]).is_err());
        assert!(record_frontend(
            "react_error",
            &vec!["Frame".to_owned(); MAX_FRONTEND_FRAMES + 1]
        )
        .is_err());
    }

    #[test]
    fn panic_payload_is_not_record_content() {
        let line = json_line(
            "panic",
            "error",
            "app_lib",
            Some("panic"),
            &["panic".to_owned()],
            Some("main.rs:10"),
        );
        assert!(!line.contains("payload"));
        assert!(!line.contains("secret"));
    }

    #[test]
    fn android_export_preserves_bounded_native_traces_and_history() {
        let base64_per_trace = (128 * 1024_usize).div_ceil(3) * 4;
        let history_and_trace_data = "a".repeat(2 * 256 * 1024 + 3 * base64_per_trace);
        // Bounded summaries, trace metadata and warning text have ample reserved space.
        let contents = format!("{history_and_trace_data}{}", "m".repeat(16 * 1024));
        assert!(contents.len() < MAX_ANDROID_LOG_BYTES);
        assert_eq!(tail_by_bytes(&contents, MAX_ANDROID_LOG_BYTES), contents);
        assert_eq!(tail_by_bytes("a€z", 3), "z");
    }
}
