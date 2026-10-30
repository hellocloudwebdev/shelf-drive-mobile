use super::policy::SyncPreferences;
use std::{path::PathBuf, time::Duration};

pub struct LocalWatcher;

impl LocalWatcher {
    /// Watches the given local roots and forwards debounced filesystem
    /// changes as reconciliation triggers. The signature is identical on
    /// every platform; the notify-based implementation only exists on
    /// desktop because mobile platforms have no desktop-style local sync
    /// folders to watch — there the sync loop still reconciles on its
    /// periodic interval, so only the latency of change detection changes.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn spawn(
        paths: Vec<(PathBuf, SyncPreferences)>,
        debounce: Duration,
        app: tauri::AppHandle,
        mut shutdown: tokio::sync::watch::Receiver<bool>,
        trigger: tokio::sync::mpsc::Sender<()>,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            Self::run(paths, debounce, app, shutdown, trigger).await;
        })
    }

    /// Mobile stub: no filesystem watcher, no triggers, but the task still
    /// parks until shutdown so callers keep the same lifecycle semantics.
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn spawn(
        _paths: Vec<(PathBuf, SyncPreferences)>,
        _debounce: Duration,
        _app: tauri::AppHandle,
        mut shutdown: tokio::sync::watch::Receiver<bool>,
        _trigger: tokio::sync::mpsc::Sender<()>,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            loop {
                if shutdown.changed().await.is_err() {
                    break;
                }
                if *shutdown.borrow() {
                    break;
                }
            }
        })
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    async fn run(
        paths: Vec<(PathBuf, SyncPreferences)>,
        debounce: Duration,
        app: tauri::AppHandle,
        mut shutdown: tokio::sync::watch::Receiver<bool>,
        trigger: tokio::sync::mpsc::Sender<()>,
    ) {
        use notify_debouncer_full::{
            new_debouncer,
            notify::{
                event::{CreateKind, ModifyKind, RemoveKind},
                EventKind, RecursiveMode,
            },
            DebounceEventResult,
        };

        let (event_tx, mut event_rx) = tokio::sync::mpsc::unbounded_channel();
        let callback = move |result: DebounceEventResult| {
            let _ = event_tx.send(result);
        };
        let mut debouncer = match new_debouncer(debounce, None, callback) {
            Ok(debouncer) => debouncer,
            Err(error) => {
                log::error!("Failed to create folder sync watcher: {error}");
                return;
            }
        };
        for (path, _) in &paths {
            if let Err(error) = debouncer.watch(path, RecursiveMode::Recursive) {
                log::error!("Failed to watch sync folder {}: {error}", path.display());
            }
        }

        loop {
            tokio::select! {
                changed = shutdown.changed() => {
                    if changed.is_err() || *shutdown.borrow() { break; }
                }
                result = event_rx.recv() => {
                    let Some(result) = result else { break };
                    match result {
                        Ok(events) => {
                            let mut should_reconcile = false;
                            for debounced in events {
                                let action = match debounced.event.kind {
                                    EventKind::Create(CreateKind::File) | EventKind::Create(CreateKind::Any) => "upload",
                                    EventKind::Modify(ModifyKind::Data(_)) | EventKind::Modify(ModifyKind::Any) => "hash_upload",
                                    EventKind::Remove(RemoveKind::File) | EventKind::Remove(RemoveKind::Any) => "delete",
                                    EventKind::Create(CreateKind::Folder) | EventKind::Remove(RemoveKind::Folder) | EventKind::Modify(ModifyKind::Name(_)) => "rescan",
                                    _ => continue,
                                };
                                for path in debounced.event.paths {
                                    if path.to_string_lossy().ends_with(".td-sync-tmp") { continue; }
                                    if paths.iter().any(|(root, preferences)| path.strip_prefix(root).ok().is_some_and(|relative| {
                                        let relative = relative.components().map(|part| part.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
                                        preferences.ignores(&relative) || (path.is_dir() && preferences.ignores(&format!("{relative}/")))
                                    })) { continue; }
                                    let _ = app.emit("sync-fs-event", LocalFsEvent { action: action.into(), path: path.to_string_lossy().into_owned() });
                                    should_reconcile = true;
                                }
                            }
                            if should_reconcile {
                                let _ = trigger.try_send(());
                            }
                        }
                        Err(errors) => for error in errors { log::warn!("Folder sync watcher error: {error}"); },
                    }
                }
            }
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFsEvent {
    pub action: String,
    pub path: String,
}
