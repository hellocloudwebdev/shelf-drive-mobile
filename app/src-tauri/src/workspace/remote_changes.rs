//! Update only the initiating account's cache after a verified remote mutation.
//! Unowned legacy encryption/inventory rows are never reassigned or erased.
use super::{
    store::{file_key, Store},
    AccountGuard,
};

fn migrate_opened(
    store: &Store,
    old_key: &str,
    new_key: &str,
    target: Option<i64>,
    new_message: i32,
) -> Result<(), String> {
    if old_key == new_key {
        return Ok(());
    }
    if let Some(mut opened) = store.record::<serde_json::Value>("opened", old_key)? {
        if let Some(destination) = store.record::<serde_json::Value>("opened", new_key)? {
            let old_time = opened
                .get("last_opened_at")
                .and_then(serde_json::Value::as_i64)
                .unwrap_or_default();
            let destination_time = destination
                .get("last_opened_at")
                .and_then(serde_json::Value::as_i64)
                .unwrap_or_default();
            let old_count = opened
                .get("open_count")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or_default();
            let destination_count = destination
                .get("open_count")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or_default();
            if let Some(fields) = opened.as_object_mut() {
                fields.insert(
                    "last_opened_at".into(),
                    old_time.max(destination_time).into(),
                );
                fields.insert(
                    "open_count".into(),
                    old_count.saturating_add(destination_count).into(),
                );
            }
        }
        if let Some(fields) = opened.as_object_mut() {
            fields.insert("folder_id".into(), serde_json::to_value(target).unwrap());
            fields.insert("message_id".into(), i64::from(new_message).into());
        }
        store.put_record("opened", new_key, &opened)?;
    }
    store.remove_record("opened", old_key)
}

pub enum Change {
    Rename {
        folder: Option<i64>,
        message: i32,
        name: String,
    },
    Delete {
        folder: Option<i64>,
        message: i32,
    },
    Move {
        source: Option<i64>,
        message: i32,
        target: Option<i64>,
        new_message: i32,
    },
}

fn apply(account: &AccountGuard, changes: Vec<Change>) -> Result<(), String> {
    account.validate()?;
    let store = Store::open(&account.root, account.owner)?;
    store.transaction(|| {
        for change in changes {
            account.validate()?;
            match change {
                Change::Rename {
                    folder,
                    message,
                    name,
                } => {
                    if let Some(mut file) = store.file(&file_key(folder, i64::from(message)))? {
                        file.file.name = name;
                        store.remember_local_file(&file.file)?;
                    }
                }
                Change::Delete { folder, message } => {
                    let key = file_key(folder, i64::from(message));
                    store.execute(
                        "DELETE FROM workspace_files WHERE key=?",
                        &[key.clone().into()],
                    )?;
                    store.remove_record("envelope-v1", &key)?;
                }
                Change::Move {
                    source,
                    message,
                    target,
                    new_message,
                } => {
                    let old_key = file_key(source, i64::from(message));
                    let new_key = file_key(target, i64::from(new_message));
                    if let Some(mut file) = store.file(&old_key)? {
                        file.file.folder_id = target;
                        file.file.id = i64::from(new_message);
                        store.remember_local_file(&file.file)?;
                        for table in ["workspace_tags", "workspace_membership"] {
                            store.execute(
                                &format!("UPDATE OR IGNORE {table} SET file=? WHERE file=?"),
                                &[new_key.clone().into(), old_key.clone().into()],
                            )?;
                        }
                        for kind in ["favorite", "pin", "activity"] {
                            if let Some(value) =
                                store.record::<serde_json::Value>(kind, &old_key)?
                            {
                                store.put_record(kind, &new_key, &value)?;
                            }
                        }
                    }
                    migrate_opened(&store, &old_key, &new_key, target, new_message)?;
                    super::playback::reconcile_move(&store, source, message, target, new_message)?;
                    store.execute("DELETE FROM workspace_files WHERE key=?", &[old_key.into()])?;
                    store.remove_record("envelope-v1", &file_key(source, i64::from(message)))?;
                }
            }
        }
        account.validate()
    })
}

pub async fn record(account: &AccountGuard, changes: Vec<Change>) -> Result<(), String> {
    let account = account.clone();
    tokio::task::spawn_blocking(move || apply(&account, changes))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::FileMetadata;
    use grammers_session::{storages::SqliteSession, types::PeerInfo, Session};
    struct Fixture {
        root: std::path::PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("file-mutation-owner-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&root).unwrap();
            let fixture = Self { root };
            fixture.sign_in(101);
            for owner in [101, 202] {
                Store::open(&fixture.root, owner)
                    .unwrap()
                    .remember_local_file(&FileMetadata {
                        id: 42,
                        folder_id: None,
                        name: format!("private-{owner}.txt"),
                        size: 10,
                        mime_type: Some("text/plain".into()),
                        file_ext: Some("txt".into()),
                        created_at: "date".into(),
                        icon_type: "file".into(),
                        encryption_state: "plain".into(),
                        is_favorite: false,
                        is_pinned: false,
                    })
                    .unwrap();
            }
            fixture
        }
        fn sign_in(&self, owner: i64) {
            for name in [
                "telegram.session",
                "telegram.session-wal",
                "telegram.session-shm",
            ] {
                let _ = std::fs::remove_file(self.root.join(name));
            }
            let session =
                crate::test_block_on(SqliteSession::open(self.root.join("telegram.session")))
                    .unwrap();
            crate::test_block_on(session.cache_peer(PeerInfo::User {
                id: owner,
                auth: None,
                bot: Some(false),
                is_self: Some(true),
            }))
            .unwrap();
        }
        fn account(&self) -> AccountGuard {
            AccountGuard::open(&self.root, Some("101")).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }
    #[test]
    fn file_cache_rename_move_and_delete_never_touch_another_account() {
        let fixture = Fixture::new();
        let account = fixture.account();
        let a = Store::open(&fixture.root, 101).unwrap();
        a.tag(&["saved:42".into()], "keep-tag", true).unwrap();
        a.put_record("favorite", "saved:42", &true).unwrap();
        a.put_record(
            "envelope-v1",
            "saved:42",
            &serde_json::json!({"test":"bound to the original message"}),
        )
        .unwrap();
        apply(
            &account,
            vec![Change::Rename {
                folder: None,
                message: 42,
                name: "renamed.txt".into(),
            }],
        )
        .unwrap();
        assert_eq!(
            a.file("saved:42").unwrap().unwrap().file.name,
            "renamed.txt"
        );
        apply(
            &account,
            vec![Change::Move {
                source: None,
                message: 42,
                target: Some(9),
                new_message: 84,
            }],
        )
        .unwrap();
        assert!(a.file("saved:42").unwrap().is_none());
        assert!(a
            .record::<serde_json::Value>("envelope-v1", "saved:42")
            .unwrap()
            .is_none());
        let moved = a.file("9:84").unwrap().unwrap();
        assert_eq!(moved.file.name, "renamed.txt");
        assert!(moved.file.is_favorite);
        assert_eq!(moved.tags, ["keep-tag"]);
        apply(
            &account,
            vec![Change::Delete {
                folder: Some(9),
                message: 84,
            }],
        )
        .unwrap();
        assert!(a.file("9:84").unwrap().is_none());
        let b = Store::open(&fixture.root, 202).unwrap();
        assert_eq!(
            b.file("saved:42").unwrap().unwrap().file.name,
            "private-202.txt"
        );
    }

    #[test]
    fn remote_move_rekeys_recents_playback_bookmarks_and_queue() {
        let fixture = Fixture::new();
        let account = fixture.account();
        let store = Store::open(&fixture.root, 101).unwrap();
        store
            .put_record(
                "opened",
                "saved:42",
                &serde_json::json!({
                    "folder_id": null,
                    "message_id": 42,
                    "last_opened_at": 123,
                    "open_count": 3
                }),
            )
            .unwrap();
        store
            .put_record(
                "opened",
                "9:84",
                &serde_json::json!({
                    "folder_id": 9,
                    "message_id": 84,
                    "last_opened_at": 150,
                    "open_count": 2
                }),
            )
            .unwrap();
        let playback_file = crate::workspace::playback::PlaybackFile {
            folder_id: None,
            message_id: 42,
            name: "private-101.txt".into(),
            size: 10,
            mime_type: Some("video/mp4".into()),
            encryption_state: "plain".into(),
        };
        crate::workspace::playback::mutate(
            &store,
            crate::workspace::playback::PlaybackMutation::Progress {
                file: playback_file.clone(),
                position_ms: 4_200,
                duration_ms: 10_000,
                volume: 0.8,
                speed: 1.25,
            },
        )
        .unwrap();
        crate::workspace::playback::mutate(
            &store,
            crate::workspace::playback::PlaybackMutation::Bookmark {
                file: playback_file.clone(),
                position_ms: 2_000,
                label: "Chapter two".into(),
            },
        )
        .unwrap();
        let destination = crate::workspace::playback::PlaybackFile {
            folder_id: Some(9),
            message_id: 84,
            ..playback_file.clone()
        };
        let neighbor = crate::workspace::playback::PlaybackFile {
            folder_id: Some(9),
            message_id: 85,
            ..playback_file.clone()
        };
        crate::workspace::playback::mutate(
            &store,
            crate::workspace::playback::PlaybackMutation::Enqueue {
                files: vec![playback_file, destination.clone(), neighbor.clone()],
            },
        )
        .unwrap();

        apply(
            &account,
            vec![Change::Move {
                source: None,
                message: 42,
                target: Some(9),
                new_message: 84,
            }],
        )
        .unwrap();

        let recents =
            crate::commands::file_activity::read_activity(&store, "recents", None).unwrap();
        assert_eq!(recents.len(), 1);
        assert_eq!(
            (recents[0].file.folder_id, recents[0].file.id),
            (Some(9), 84)
        );
        assert_eq!(recents[0].last_opened_at, 150);
        let opened: serde_json::Value = store.record("opened", "9:84").unwrap().unwrap();
        assert_eq!(opened["open_count"], 5);
        assert!(store
            .record::<serde_json::Value>("opened", "saved:42")
            .unwrap()
            .is_none());

        let snapshot = crate::workspace::playback::snapshot(&store).unwrap();
        assert_eq!(snapshot.items.len(), 1);
        assert_eq!(snapshot.items[0].media_id, "101:9:84");
        assert_eq!(snapshot.items[0].position_ms, 4_200);
        assert_eq!(snapshot.items[0].bookmarks[0].position_ms, 2_000);
        assert_eq!(snapshot.items[0].bookmarks[0].label, "Chapter two");
        assert_eq!(snapshot.items[0].file.folder_id, Some(9));
        assert_eq!(snapshot.items[0].file.message_id, 84);
        assert!(snapshot
            .queue
            .iter()
            .any(|file| file.folder_id == Some(9) && file.message_id == 84));
        assert!(snapshot.queue.iter().any(|file| file.message_id == 85));
        assert_eq!(snapshot.queue.len(), 2);
    }
    #[test]
    fn file_cache_update_after_account_switch_preserves_both_owners() {
        let fixture = Fixture::new();
        let account = fixture.account();
        fixture.sign_in(202);
        assert!(apply(
            &account,
            vec![Change::Delete {
                folder: None,
                message: 42
            }]
        )
        .unwrap_err()
        .contains("ACCOUNT_CHANGED"));
        for owner in [101, 202] {
            assert!(Store::open(&fixture.root, owner)
                .unwrap()
                .file("saved:42")
                .unwrap()
                .is_some());
        }
    }
    #[test]
    fn failed_file_cache_move_rolls_back_the_original_metadata() {
        let fixture = Fixture::new();
        let account = fixture.account();
        let a = Store::open(&fixture.root, 101).unwrap();
        a.execute("CREATE TRIGGER fail_move BEFORE INSERT ON workspace_files WHEN NEW.key='9:84' BEGIN SELECT RAISE(FAIL,'disk unavailable'); END", &[]).unwrap();
        assert!(apply(
            &account,
            vec![Change::Move {
                source: None,
                message: 42,
                target: Some(9),
                new_message: 84
            }]
        )
        .is_err());
        assert!(a.file("saved:42").unwrap().is_some());
        assert!(a.file("9:84").unwrap().is_none());
    }
}
