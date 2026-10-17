//! Process-start initialization for Grammers' bundled libsql SQLite engine.
//!
//! The app also links the `sqlite` crate for its own databases. Initialize
//! Grammers/libsql before the first use of that separate SQLite implementation
//! so both engines are ready before application data is opened.

use grammers_session::storages::SqliteSession;

/// Initialize Grammers' SQLite backend before the app's `sqlite` crate opens a
/// database. Run the async session open on a dedicated thread/runtime because
/// Tauri's setup callback is synchronous; this never blocks a Tokio runtime
/// worker with a nested `block_on`.
pub(crate) fn preinitialize_grammers_sqlite() -> Result<(), String> {
    let worker = std::thread::Builder::new()
        .name("grammers-sqlite-init".to_string())
        .spawn(|| {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|error| format!("could not create initialization runtime: {error}"))?;

            runtime.block_on(async {
                SqliteSession::open(":memory:")
                    .await
                    .map(drop)
                    .map_err(|error| format!("could not initialize Grammers SQLite: {error}"))
            })
        })
        .map_err(|error| {
            format!("could not start Grammers SQLite initialization thread: {error}")
        })?;

    worker
        .join()
        .map_err(|_| "Grammers SQLite initialization thread panicked".to_string())?
}

#[cfg(test)]
mod tests {
    use grammers_session::storages::SqliteSession;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    const CHILD_PROCESS_MARKER: &str = "SHELF_DRIVE_LIBSQL_INIT_REGRESSION_CHILD";
    const TEST_NAME: &str =
        "libsql_init::tests::sqlite_open_then_grammers_session_open_after_preinit";

    fn exercise_startup_order() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after the Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "shelf-drive-libsql-init-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create isolated test directory");

        crate::libsql_init::preinitialize_grammers_sqlite()
            .expect("preinitialize real Grammers/libsql SQLite backend");

        // Exercise the actual app SQLite crate after Grammers/libsql initialized.
        let app_database = sqlite::open(root.join("shares.db"))
            .expect("open app database after Grammers preinitialization");
        drop(app_database);

        // Then open a real Grammers session, which creates/uses its libsql schema.
        let session_path = root.join("telegram.session");
        let session = crate::test_block_on(SqliteSession::open(&session_path))
            .expect("open real Grammers session after app SQLite database");
        drop(session);

        std::fs::remove_dir_all(root).expect("remove isolated test directory");
    }

    #[test]
    fn sqlite_open_then_grammers_session_open_after_preinit() {
        if std::env::var_os(CHILD_PROCESS_MARKER).is_some() {
            exercise_startup_order();
            return;
        }

        // SQLite's bundled engines share process-global symbol names. A child
        // test process ensures no other unit test has initialized either engine
        // before this exact startup-order regression sequence.
        let output = Command::new(std::env::current_exe().expect("test executable path"))
            .args(["--exact", TEST_NAME, "--nocapture"])
            .env(CHILD_PROCESS_MARKER, "1")
            .output()
            .expect("run isolated SQLite initialization regression test");
        assert!(
            output.status.success(),
            "isolated startup-order test failed\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
