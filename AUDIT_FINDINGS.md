# Shelf Drive Audit Findings

## Scope and commit

Consolidated code-audit results for the repository's `main` snapshot at audit time, commit `0962360990bb3499a852804de13ff41cab204271`. The input covered selected React/API, Rust service/command, crypto/sync/transfer, Android integration, and CI/release/documentation paths. This is a synthesis of those reviews, not an independent re-audit; findings below retain their supplied line evidence.

> **Historical snapshot:** This audit records the code and configuration at the cited commit, when Android API 24 was the configured minimum. Since v4.4.8, the current support baseline is Android 12–16 (API 31–36), with `minSdk` 31 and `targetSdk` 36. References below to Android 7–9/API 24-era behavior describe that audited snapshot only; they neither promise current support for those versions nor establish that a finding has since been fixed.

## Executive summary

The consolidated reviews report **46 numbered code/configuration/documentation findings**: 4 high-severity, 32 medium-severity, and 10 low-severity. Separately, one **medium-priority dependency-security item** covers 12 `npm audit` advisories in development/build/test dependencies (7 high, 4 moderate, 1 low; fixes are available); those package advisory counts are not included in the 46 numbered findings. The most consequential findings include vault locking that does not revoke keys already copied into in-flight decrypt operations, stale deletion preconditions in sync and scheduled cleanup, and SSRF controls bypassable through a configured proxy or NAT64 translation. Other findings span account/session boundaries, Android sharing and publication, file moves/cache identity, upload cancellation, search, settings, playback, and desktop/mobile workflows.

All reported defects are **static/source findings**: the supplied results do not describe runtime reproduction of any finding. The frontend review reports TypeScript compilation succeeded, 66 unit-test files passed (343 passed, 6 skipped), and i18n checks passed structure/type gates with existing warnings; it explicitly notes affected mobile wiring is not covered. The Android review reports its JNI contract checker passed (25 Rust/Kotlin signatures and R8 keep rules). These checks do not reproduce or disprove the findings below. No Rust test suite, Android emulator/device test, full platform build, or live Telegram/proxy/WebDAV integration test is reported as run. Other limitations are summarized under [Checks still needed and coverage gaps](#checks-still-needed-and-coverage-gaps).

## Prioritized findings (1–18)

### 1. Vault lock does not revoke keys already copied into active decrypt operations

- **Severity / confidence:** High / High
- **Type:** Static/source finding; no race test or runtime reproduction reported.
- **Evidence:** `app/src-tauri/src/crypto/state.rs:231-264,291-306` returns cloned `SecretKey` values. `app/src-tauri/src/crypto_commands.rs:304-315` clears vault state on lock but cannot invalidate those clones. Encrypted transfer snapshots a key at `app/src-tauri/src/commands/fs.rs:3249`, then decrypts/writes plaintext at `:3391-3407` and publishes it at `:3458-3465` without checking lock state. Encrypted streaming resolves a key at `app/src-tauri/src/server.rs:579-589` and decrypts fetched ranges at `:392-432` without a vault-state check.
- **Impact:** An operation already in progress can continue writing or returning protected plaintext after the user locks the vault, contrary to the lock command's stated handle-revocation behavior.
- **Fix steps:** Replace detached key snapshots with revocable operation leases; increment a vault lock/session generation on lock; check lease validity before each plaintext write, before publishing a download, and before returning streamed data. Cancel active leases on lock and remove uncommitted plaintext partials. In streaming, recheck after awaited fetches and before yielding bytes.

### 2. Sync deletion preconditions are separated from destructive actions

- **Severity / confidence:** High / High
- **Type:** Static/source finding; no race was dynamically reproduced.
- **Evidence:** Local deletion verifies/hash-checks at `app/src-tauri/src/sync_engine/executor.rs:639-648` (verification at `:425-452`) and later unlinks without rechecking. Remote deletion verifies a Telegram fingerprint at `:661-671` (verification at `:323-353`) and then separately deletes; `app/src-tauri/src/commands/fs.rs:2646-2663` checks only that the message still exists, not that its fingerprint is unchanged.
- **Impact:** With deletion propagation enabled, a concurrent local edit or remote replacement between verification and deletion can be irreversibly lost. Existing tests cover static precondition outcomes, not the race.
- **Fix steps:** For local deletion, atomically move the candidate to a uniquely named same-directory quarantine, hash the moved object, delete only if the expected hash matches, and otherwise preserve/restore it and report conflict. For remote deletion, carry the expected fingerprint through deletion and re-fetch/revalidate immediately before the Telegram delete (including after flood-wait); report conflict if changed. Telegram has no compare-and-delete primitive, so document the residual server-side race.

### 3. Mobile file mutations are disabled because the operation hook receives no account ID

- **Severity / confidence:** High / High
- **Type:** Static/source finding; tests passed but do not exercise the mobile hook wiring.
- **Evidence:** `app/src/components/mobile/MobileDashboard.tsx:719` calls `useFileOperations(...)` with five arguments, omitting its sixth `ownerId`; `app/src/hooks/useFileOperations.ts:15-22` defaults it to `null`. Delete returns immediately at `:34-36`; bulk-delete/move/rename have equivalent owner guards at `:57-60,92-95,110-113`. Desktop passes `accountId` at `app/src/components/desktop/DesktopDashboard.tsx:294`.
- **Impact:** Mobile delete, rename, move, and bulk-delete controls do not reach the backend. Delete/move/bulk-delete silently return; rename reports failure.
- **Fix steps:** Pass `accountId ?? undefined` as the sixth hook argument in `MobileDashboard`. Add a mobile integration test using the real hook to trigger delete/rename/move and assert that the API facade receives the active owner ID.

### 4. Stream capability tokens do not bind to the source folder

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; route arguments were checked, but no Telegram-backed runtime fixture was run.
- **Evidence:** `app/src-tauri/src/commands/streaming.rs:23-42` accepts but ignores `folder_id`, issuing a token bound only to `file_id`. `app/src-tauri/src/server.rs:500-519` validates only `message_id`, then independently resolves the caller-supplied folder. `app/src-tauri/src/stream_token.rs:141-156` also matches composite HLS/file keys by final message-ID component alone. Frontend supplies folder at `app/src/api/index.ts:312` and `app/src/components/mobile/MobileMediaPlayer.tsx:98-105`.
- **Impact:** A token issued for one file can be replayed against another folder with the same Telegram message ID in the same active account, retrieving a different file and weakening the stream URL's bearer-capability boundary.
- **Fix steps:** Bind tokens to the full resource identity: account owner, folder/peer (with explicit Saved Messages sentinel), and message ID. Include folder at issuance and validate the full tuple at stream/HLS/fMP4 endpoints. Replace suffix-only matching with structured identity. Add collision tests for equal message IDs in distinct peers.

### 5. In-flight REST handlers can return prior-account results after logout or account switch

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; race not reproduced.
- **Evidence:** Guard helpers are defined at `app/src-tauri/src/api_routes.rs:116-143` and used for guarded download handlers at `:723-727,780`. In contrast, `api_list_files` clones the raw client at `:410-414` and returns at `:639`; `api_get_file` clones at `:659-664` and returns at `:675-706`; `api_search_files` clones at `:1204-1208` and returns at `:1302` without account guard. Logout changes/suspends lifecycle at `app/src-tauri/src/commands/auth.rs:395-417`; stale-generation rejection is implemented in `app/src-tauri/src/workspace/account.rs:287-301,303-363`.
- **Impact:** A request awaiting Telegram may finish using a cloned old client and return prior-account file/folder data after logout or account replacement. The REST API key persists independently of the active account.
- **Fix steps:** Capture an `AccountGuard`, validate at request start and again before returning results (and around mutation side effects) in each handler cloning a client. Provide account-root app data where needed rather than omitting the guard. Add concurrency tests overlapping requests with logout/account replacement.

### 6. Mobile previews use browsing-folder context instead of the file's source

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; no cross-folder preview test reported.
- **Evidence:** `app/src/components/mobile/MobileDashboard.tsx:2272-2276` supplies `activeFolderId` to the player for `playingFile`; lines `2287-2305` do likewise for PDF/image viewers. `app/src/components/mobile/MobileMediaPlayer.tsx:98-105,123-125` uses it for stream lookup/URL/media ID. Desktop preview paths also use supplied context: `app/src/components/desktop/dashboard/PdfViewer.tsx:67-74,97-106` and `PreviewModal.tsx:194-197,210-212,227`. Cross-folder results carry their actual `folder_id`; `app/src/services/fileIdentity.ts:3-6` documents explicit `null` Saved Messages versus missing context.
- **Impact:** Opening a cross-folder item from Recent, media views, or search can request a same-numbered message from Saved Messages/current channel instead of the item's actual source, causing failure or wrong-item playback/preview.
- **Fix steps:** Resolve source once with `sourceFolder(file, activeFolderId)` and use it for mobile media, PDF, and image preview calls, stream URL, and playback media ID. Preserve explicit `folder_id: null` as Saved Messages. Add cross-folder preview tests.

### 7. Mobile single-file downloads use the active folder rather than file origin

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; callback not directly covered by the passing unit suite.
- **Evidence:** `app/src/components/mobile/MobileDashboard.tsx:828-830` queues action-sheet downloads with `activeFolderId`, ignoring `file.folder_id`. `app/src/hooks/useFileDownload.ts:792-800` persists that folder argument as the queued item's `folderId`; folder refresh stamps actual source at `app/src/services/fileListRefresh.ts:75-77`.
- **Impact:** Downloading a channel file from Recent while at root targets the message ID in Saved Messages; another selected folder similarly misdirects the request. It can fail or resolve a different same-numbered message.
- **Fix steps:** Queue `sourceFolder(file, activeFolderId)` and preserve explicit null. Add a regression test for a recent channel file downloaded from root.

### 8. Sync byte-range parser mishandles suffix ranges

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; no parser test or runtime reproduction reported.
- **Evidence:** `app/src-tauri/src/server.rs:56-76` parses the first range component as an absolute start, so `bytes=-1024` returns `None`. Plaintext callers at `:142-163` treat `None` as no range and serve the full file from byte zero with status 200; encrypted callers at `:368-380` treat it as absent and return the initial capped range instead. Invalid/unsatisfiable ranges are also not distinguished from absent headers.
- **Impact:** Seeking/requesting the tail returns incorrect bytes; encrypted media may return a misleading 206 response containing the first 4 MiB, and plaintext can trigger a full-file transfer.
- **Fix steps:** Distinguish absent, valid, and invalid/unsatisfiable range headers. Implement `bytes=-N` as the final `min(N,total_size)` bytes; validate empty/zero-sized, extra, malformed, and multi-range cases; return 416 with `Content-Range: bytes */<size>` for unsatisfiable requests (or document a deliberate policy). Test plaintext and encrypted paths.

### 9. Android recovery uses WorkManager without initializing it

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; no Android emulator/instrumentation test reported.
- **Evidence:** `app/android-overrides/app/src/main/AndroidManifest.xml:111-120` removes `androidx.work.WorkManagerInitializer` metadata. `app/android-overrides/app/src/main/java/com/hellocloudweb/shelfdrive/ShelfDriveApplication.kt:9-13` supplies `Configuration.Provider` but does not call `WorkManager.initialize`. `TransferRecoveryWorker.schedule` uses `WorkManager.getInstance(context)` at `app/android-overrides/app/src/main/java/com/hellocloudweb/shelfdrive/TransferRecoveryWorker.kt:86-99`; cancellation does so at `:65`.
- **Impact:** Recovery scheduling/cancellation can fail whenever invoked, including boot/package-replaced and service stop flows; ordinary startup and transfer-engine operation are not reported as affected.
- **Fix steps:** Initialize WorkManager exactly once in `ShelfDriveApplication.onCreate` with the provided configuration, or restore a supported initializer path. Preserve custom scheduler ID range. Add cold-start instrumentation test that schedules recovery and verifies enqueue.

### 10. Mobile download callback discards the file identity before deletion

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; mobile action-sheet adapter not covered by the cited tests.
- **Evidence:** `app/src/components/mobile/MobileDashboard.tsx:832-834` receives a `TelegramFile` but calls `handleDeleteOp(file.id)`. The hook's numeric branch resolves only through `displayedFilesRef.current` at `app/src/hooks/useFileOperations.ts:37-45`; the mobile hook is supplied current `allFiles` at `MobileDashboard.tsx:719`. Action-sheet files can come from Recent/search/media and be absent from that list.
- **Impact:** Once the missing-owner defect is fixed, deleting a cross-folder item can still fail to resolve, or resolve a different file with the same ID in the current list.
- **Fix steps:** Pass the original object (`handleDeleteOp(file)`) so the hook captures folder-aware identity. Add an action-sheet test deleting a cross-folder result while a different folder is active.

### 11. Mobile bulk share hard-codes Saved Messages as source

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; no mobile bulk-share test reported.
- **Evidence:** `app/src/components/mobile/MobileDashboard.tsx:889-911` selects from displayed files but sends `folderId: null` for every file. The API contract accepts source folder at `app/src/api/index.ts:191-195,587-590`; refresh preserves real `folder_id` at `app/src/services/fileListRefresh.ts:75-77`.
- **Impact:** Sharing selected channel files looks up their IDs in Saved Messages, potentially failing or linking a different same-numbered file.
- **Fix steps:** Supply `sourceFolder(file, activeFolderId)` for each file and include captured owner ID or route through the ownership-checking share service. Test that a channel file sends its channel ID to `cmd_create_share`.

### 12. Offline pin/remove coalesces explicit Saved Messages null into the selected folder

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; no runtime reproduction reported.
- **Evidence:** `app/src/components/mobile/MobileDashboard.tsx:848-853,861-865` uses `file.folder_id ?? activeFolderId`. `TelegramFile.folder_id` explicitly permits null at `app/src/types/files.ts:3-10`; `sourceFolder` defines correct null-versus-missing behavior at `app/src/services/fileIdentity.ts:3-6`.
- **Impact:** From a cross-folder activity view while a channel is selected, Keep Offline/Remove Offline for a Saved Messages item operates on the selected channel's cache entry with the same ID rather than Saved Messages.
- **Fix steps:** Use `sourceFolder(file, activeFolderId)` in both handlers and consistently use the resolved source for cache operations and invalidation. Add null-source regression coverage.

### 13. Proxy traffic test uses a fresh unauthenticated Telegram session

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; runtime command was not executed.
- **Evidence:** `app/src-tauri/src/commands/network.rs:217-260` deletes any previous `test.session`, opens a new `SqliteSession`, and uses hard-coded API ID `12345` without authenticating. At `:267-290`, only `client.get_me()` success counts as reachable; every RPC error maps to false.
- **Impact:** A proxy that carries traffic to Telegram can still be reported as failed because the fresh session is unauthenticated and `get_me` requires an authorized account; the test is functionally unreliable and normally false absent authorization.
- **Fix steps:** Use the current authenticated client/session and real API ID with an account guard, or define this as an unauthenticated transport/API reachability probe and treat a recognized authorization-required response as proof Telegram was reached. Add command tests for reachable-but-unauthorized behavior.

### 14. Proxy network availability and latency checks reject DNS hostnames

- **Severity / confidence:** Low / High
- **Type:** Static/source finding; commands were not tested.
- **Evidence:** Proxy config permits hostnames (`app/src-tauri/src/vpn_optimizer.rs:138-154`) and formats address as `host:port` at `:293-299`. `app/src-tauri/src/commands/network.rs:329-343` parses directly as `SocketAddr` and returns false on failure; `:374-392` also parses as `SocketAddr` and returns -1. `cmd_get_proxy_status` resolves via `ToSocketAddrs` at `:156-169`.
- **Impact:** Valid reachable DNS-based proxies report unavailable and latency `-1`, misleading diagnostics and any policy relying on those values.
- **Fix steps:** Resolve via `ToSocketAddrs` as the status command does; attempt resolved addresses with configured timeout. Add hostname and literal-IP tests.

### 15. Dependency-assurance workflow path filters omit gate scripts

- **Severity / confidence:** Medium / High
- **Type:** Static CI wiring finding; no synthetic PR/workflow run reported.
- **Evidence:** `.github/workflows/dependency-assurance.yml:5-15` PR path filter omits `scripts/check-rust-advisory-baseline.cjs` and `scripts/test-assurance-scripts.cjs`, while the job invokes the checker at `:57-60`. Push trigger is limited to main/develop at `:16-17`; release is tag-triggered.
- **Impact:** A PR changing only the Rust advisory-baseline checker (or its assurance-script tests) can avoid this pre-merge assurance workflow, so a weakened/broken gate may not be exercised.
- **Fix steps:** Add both root scripts to `pull_request.paths`; include other root scripts the workflow depends on so changes to gate logic always trigger it. Validate with a workflow/path-filter test or synthetic PR.

### 16. Android resilience runbook targets a retired application ID

- **Severity / confidence:** Low / High
- **Type:** Static documentation/config cross-reference; no device execution reported.
- **Evidence:** `Docs/ANDROID_SIDELOAD_RELEASE.md:82-84` supplies `com.cameronamer.telegramdrive` to three scenarios. `app/scripts/test-android-resilience.sh:4,17-18` uses its first argument as package target. Current ID is `com.hellocloudweb.shelfdrive` in `app/android-overrides/app/build.gradle.kts:58-65` and `app/src-tauri/tauri.conf.json:10`.
- **Impact:** Following those commands targets a package that is not the current app, so scenarios do not test Shelf Drive and may fail to launch/inspect it.
- **Fix steps:** Replace all three documented IDs with `com.hellocloudweb.shelfdrive`, or omit the argument to use the script's current default.

### 17. Sideload release runbook promises desktop artifacts not built here

- **Severity / confidence:** Low / High
- **Type:** Static documentation/workflow mismatch; workflow not run.
- **Evidence:** `Docs/ANDROID_SIDELOAD_RELEASE.md:44` says the workflow builds Windows, Linux, and macOS and attaches desktop artifacts. `.github/workflows/release.yml:188-197` calls Android build and lines `:199 onward` collect Android artifacts, with no desktop build jobs. README `:282-288` and `Docs/SHARED_CORE_SYNC.md:54-60` describe Android-only mobile release jobs.
- **Impact:** Release operators may expect desktop binaries from this repository and distribute artifacts it does not produce.
- **Fix steps:** Correct the runbook to describe Android-only artifacts and point to the sibling desktop repository's release process for desktop builds.

### 18. Architecture freeze incorrectly labels implemented Android support deferred

- **Severity / confidence:** Low / High
- **Type:** Static documentation/status mismatch; workflows were not executed.
- **Evidence:** `Docs/ARCHITECTURE_FREEZE.md:124` says Android is deferred, no generated Android project exists, and workflow is dispatch-only. `.github/workflows/android.yml:3-6` supports `workflow_call` and `workflow_dispatch`; `.github/workflows/release.yml:188-197` calls it for tag releases. Android overrides/native implementation are tracked under `app/android-overrides/`.
- **Impact:** Misleads contributors/reviewers about supported platform and where production Android builds are exercised. Generated `gen/android` is ignored build output, so its absence from a clean checkout is not evidence of missing Android support.
- **Fix steps:** Update deferred-status text to reflect current Android implementation and reusable tag-release workflow; retain only genuinely outstanding blockers.

## Supplemental findings (19–46)

### 19. Concurrent Android URI copies can alias and overwrite a cached file

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; no Android runtime reproduction.
- **Evidence:** `app/android-overrides/app/src/main/java/com/hellocloudweb/shelfdrive/MainActivity.kt:521-530` chooses a filename after a non-atomic `File.exists()` check. At `:964-975`, copies are locked only per `cacheKey`, open the chosen destination through truncating `FileOutputStream`, and map the URI to that path. Distinct URIs with the same display name run on the two-thread executor (`:67-72,1180-1193`) and can select the same path.
- **Impact:** Cached shares may alias; overlapping copies can overwrite/interleave data, cause one URI to upload another's bytes, or let removal of one entry delete the other's cache file.
- **Fix steps:** Give each copy a unique destination using UUID names and atomic exclusive creation (`createNewFile`/equivalent), and map each URI only to its reserved path. Test concurrent copies of distinct URIs with identical display names.

### 20. Android cached-share uploads are queued without an owner ID

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; no device or mobile integration reproduction.
- **Evidence:** `app/src/components/mobile/MobileDashboard.tsx:565-574` stages a cached share and creates a queue item without `ownerId`. The hook is initialized with `accountId` at `:311`, but `app/src/hooks/useFileUpload.ts:61,282-290,885-887` processes/returns only items whose `ownerId` matches; the dashboard receives the raw queue setter rather than an owner-injecting wrapper.
- **Impact:** The cached-share item is filtered out and never uploaded; its original cached URI is removed after staging at `MobileDashboard.tsx:575`, stranding the staged file.
- **Fix steps:** Enqueue via the hook's ownership-checked `enqueueUploadItems` path or attach the verified active `accountId` as `ownerId` and reject a missing account. Test staging a cached share and verify it appears in the active owner's queue and reaches the upload command.

### 21. Failed pre-Android-Q download copies can leave partial public files

- **Severity / confidence:** Low / High
- **Type:** Static/source finding; no Android runtime or injected I/O-failure test.
- **Evidence:** In `app/android-overrides/app/src/main/java/com/hellocloudweb/shelfdrive/MainActivity.kt:676-701`, the API<29 branch deletes its public target only after a size mismatch. A stream-copy exception reaches the outer catch at `:819-828`, which cleans only `insertedUri` (null on this branch) and returns false without deleting the partial target. At the audited commit, API 24+ was configured as supported (`app/android-overrides/app/build.gradle.kts:62-67`) and legacy storage permission is declared through API 28 (`AndroidManifest.xml:9-10`).
- **Historical impact (audited snapshot only):** On the then-configured API 24+ range, an interrupted Android 7–9 download could leave an incomplete file in public Downloads even though the operation reported failure; future downloads could choose a suffixed name. This is not a claim about current Android 12–16 behavior or a statement that the finding is fixed.
- **Fix steps:** Track the legacy target beyond the branch and delete it on every post-creation failure. Publish/scan only after exact byte-count verification. Add an output-copy failure regression test.

### 22. Upload cancellation can be lost before registration and ignored during publication

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; not runtime-reproduced. A focused Rust test attempt could not compile (see coverage gaps).
- **Evidence:** `cmd_cancel_transfer` first inserts the ID into `cancelled_transfers`, then signals only an already-registered sender (`app/src-tauri/src/commands/fs.rs:1521-1533`). Standard and encrypted upload check cancellation before registering the sender (`:1902-1917` and `:2294-2309`), leaving a race where cancellation sees no sender and upload then registers without rechecking. The sender is removed when streaming completes (`:1926-1931`, `:2322-2327`); subsequent Telegram send/retry/flood-wait paths (`:1975-2021`, `:2357-2439`) do not observe cancellation.
- **Impact:** A cancelled transfer can continue and publish a Telegram message, including after a retry delay; cancellation in the registration race may fail to stop upload streaming.
- **Fix steps:** Use a cancellation token/state whose registration and initial canceled check are atomic; retain cancellation observation through publication, retry and flood-wait, checking before each send attempt and defining already-in-flight behavior. Apply to both upload modes and test registration-boundary and publication cancellation deterministically.

### 23. Interactive move can delete a source message changed after forwarding

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; no Telegram-backed race reproduction.
- **Evidence:** `app/src-tauri/src/commands/fs.rs:3563-3574` forwards selected messages, verifies only that each forward result exists, then deletes the original IDs without checking source content/version. The user-facing caller is `app/src/hooks/useFileOperations.ts:110-128`.
- **Impact:** If the source is edited after forwarding but before deletion, the destination retains the older forwarded snapshot while deletion irreversibly removes the newer source. This is the interactive move path, distinct from sync deletion preconditions.
- **Fix steps:** Re-fetch and compare a stable source fingerprint/version (media identity, size/content fingerprint and caption) against the pre-move or forwarded snapshot before deleting. On any mismatch retain originals and report conflict. Document the residual non-atomic Telegram race and add a test that changes the source between forward and delete.

### 24. Global search returns basic-group results whose source IDs cannot be resolved

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; no live Telegram reproduction; referenced source tests were inspected, not run.
- **Evidence:** `app/src-tauri/src/commands/fs.rs:4510-4516` maps `Peer::Chat` to numeric `folder_id`. `app/src-tauri/src/commands/utils.rs:39-44` resolves only `Peer::Channel` and `Peer::User`, returning not-found at `:54` otherwise. A download caller passes the ID to `resolve_peer` at `fs.rs:2834`. `search_scope_tests.rs:90-95` asserts only the emitted ID mapping, not resolution.
- **Impact:** Search may surface basic-group documents that cannot be opened/downloaded; if numeric IDs collide across peer kinds, a command could resolve a different peer.
- **Fix steps:** Carry a typed Telegram peer kind plus ID through search results and commands, and resolve basic groups without namespace collision; alternatively exclude unsupported peer kinds from global results until supported. Test search-to-operation resolution.

### 25. Global search labels encrypted uploads as plaintext

- **Severity / confidence:** Low / High
- **Type:** Static/source finding; no runtime fixture.
- **Evidence:** `app/src-tauri/src/commands/fs.rs:4530-4568` converts document results and hard-codes `encryption_state: "plain"` at `:4565` without checking the envelope. Encrypted uploads use the `TDENC2` caption at `:2347`; ordinary listing recognizes it at `:4274-4277,4317-4339`. The desktop badge consumes the field at `app/src/components/desktop/dashboard/FileListItem.tsx:84`.
- **Impact:** Encrypted search results are presented as unencrypted and expose the generic `TDENC2` caption as their name, inconsistent with ordinary listing's protected-metadata handling.
- **Fix steps:** Share envelope detection/conversion with folder listing. Mark suspected envelopes protected even when probing is deferred, and reveal original metadata only when the current account key permits it. Add encrypted-search fixtures.

### 26. ZIP export turns a valid Unix backslash filename into a traversal entry

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; no archive regression or extraction test run.
- **Evidence:** `app/src-tauri/src/commands/fs.rs:4934-4939,4952-4955` derives archive paths from source-relative names and replaces every backslash with `/` before passing the path to the ZIP writer. On Unix, a literal filename such as `..\\outside.txt` is a valid single component; replacement emits `../outside.txt` without a component-level traversal check.
- **Impact:** A crafted folder entry can create a ZIP member outside the extraction root; extracting with a path-based extractor may overwrite files outside the selected destination.
- **Fix steps:** Construct archive names from validated components, reject parent/root/prefix components after normalization, and preserve or safely encode literal Unix backslashes. Test a Unix file named `..\\outside.txt` and assert no traversal entry is emitted.

### 27. Configured HTTP proxy bypasses remote URL DNS pinning

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; proxy/DNS behavior not runtime-tested.
- **Evidence:** `app/src-tauri/src/commands/fs.rs:5465-5477` resolves/validates the origin locally and calls `resolve_to_addrs`, but also configures `reqwest::Proxy::all` when a proxy is active. An HTTP proxy receives the hostname and performs its own origin resolution, outside the local pinned-address override; redirect processing repeats the pattern.
- **Impact:** With a configured HTTP proxy, a split-horizon or rebinding hostname can pass local public-IP validation while the proxy fetches a private destination, defeating the SSRF control in that configuration.
- **Fix steps:** Reject proxied untrusted URL uploads unless the proxy enforces the same destination-IP/egress policy. Otherwise use a proxy mechanism that pins/enforces the origin and reapply policy for every redirect. Test with a controlled proxy and rebinding/split-horizon origin.

### 28. IPv6 NAT64 addresses embedding private IPv4 targets pass the URL filter

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; exploitability requires a NAT64 network path, not tested.
- **Evidence:** `app/src-tauri/src/commands/fs.rs:5375-5385,5437-5442` rejects several special IPv6 classes and IPv4-mapped addresses, but not the `64:ff9b::/96` translation prefix. `64:ff9b::a9fe:a9fe` embeds `169.254.169.254` and passes the current public-address predicate.
- **Impact:** On a network with NAT64 translation, the accepted IPv6 URL can route to a blocked private IPv4 destination such as a metadata address.
- **Fix steps:** Validate IPv6 against an explicit global-unicast policy and reject translation/transition and other special-purpose ranges for literal and resolved addresses. Add tests for the NAT64 prefix and other special-use ranges.

### 29. Folder visibility and invite RPCs are not guarded against account switches

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; no account-switch race or live Telegram operation.
- **Evidence:** Visibility and invite commands clone `state.client` and perform peer resolution followed by `UpdateUsername`/`ExportChatInvite` without capturing or revalidating an account-generation guard (`app/src-tauri/src/commands/fs.rs:5042-5063,5172-5179,5190-5199,5275-5288,5311-5326`). Frontend callers pass only folder IDs (`app/src/hooks/useTelegramConnection.ts:333-368`).
- **Impact:** A pending visibility operation can mutate the old account after logout/switch; an invite export can return an old account's bearer invite link into the new account's UI context. This is distinct from guarded REST handlers.
- **Fix steps:** Capture an `AccountGuard` before peer resolution, validate after awaits and immediately before each Telegram side effect, and revalidate before returning invite data. Cancel work on generation change and test overlapping operations with logout/account replacement.

### 30. Making a channel private does not revoke exported invites despite the UI promise

- **Severity / confidence:** Medium / High
- **Type:** Static source/UI-copy finding; invite behavior not live-verified.
- **Evidence:** The private toggle calls `channels.UpdateUsername` with an empty username but does not revoke exported invites (`app/src-tauri/src/commands/fs.rs:5190-5199`). Invite export creates an invite without expiry or usage limit (`:5311-5326`). UI confirmation says shared `t.me` links stop working (`app/src/hooks/useTelegramConnection.ts:333-340`), but private invite hashes are independent of the public username.
- **Impact:** Users may believe making a folder private invalidates every previously shared link while outstanding invite links can remain usable, creating a false privacy expectation.
- **Fix steps:** Revoke all outstanding exported invites when making the channel private, or state precisely that only the public username link is disabled and expose a separate revocation action. Test the chosen behavior/promise.

### 31. HTTP(S) proxy settings are committed before the bridge starts

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; bridge failure not dynamically induced.
- **Evidence:** `app/src-tauri/src/commands/settings.rs:53-60` writes new proxy state before `start_http_bridge`; on error it returns without restoring the prior config. `app/src-tauri/src/vpn_optimizer.rs:173-200` stops the existing bridge before starting and may return without a replacement. `effective_proxy_url` returns `None` for HTTP(S) if no bridge exists (`vpn_optimizer.rs:154-168`).
- **Impact:** A rejected settings change can leave the failed proxy configured and the old bridge stopped, so later Telegram connections may run without an effective proxy or fail.
- **Fix steps:** Prepare/validate a candidate bridge before publishing config, then atomically swap on success. On failure retain old config and restore its bridge. Inject bridge-start failure and assert stored and effective configuration remain unchanged.

### 32. Network settings report success when persistence fails

- **Severity / confidence:** Low / High
- **Type:** Static/source finding; disk failure not induced.
- **Evidence:** `app/src-tauri/src/commands/settings.rs:65-70` suppresses/logs `save_network_config` errors for proxy changes; the VPN command does likewise at `:173-178`. Persistence can fail during create/write/sync/replace (`app/src-tauri/src/vpn_optimizer.rs:428-449`), and startup falls back to defaults on load failure (`:377-395`).
- **Impact:** UI success can describe only an in-memory setting that silently reverts on restart.
- **Fix steps:** Propagate persistence errors and define rollback semantics: retain prior in-memory config/bridge on save failure or explicitly report temporary-only application. Test with an injected unwritable target.

### 33. Archive download helpers treat stream errors as successful EOF

- **Severity / confidence:** Low / High
- **Type:** Static/source finding; no Telegram archive transfer run.
- **Evidence:** `app/src-tauri/src/commands/archive.rs:174-185` uses `download_iter.next().await.ok().flatten()`, discarding iterator errors and returning bytes collected so far. The temporary-file variant repeats this at `:298-318` and can return a partial archive path as complete.
- **Impact:** Transient Telegram/CDN errors appear downstream as malformed/unsupported archives instead of download failures; no transfer retry is triggered and cleanup may retain partial material.
- **Fix steps:** Match iterator results explicitly and propagate errors; remove partial archive and extraction directory on all error paths. Inject an iterator error after one chunk and assert the error propagates.

### 34. Native archive and video-metadata commands use stale Telegram clients across logout

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; no logout race or Telegram runtime.
- **Evidence:** `app/src-tauri/src/commands/archive.rs:114-130` clones `state.client` then resolves/fetches without an `AccountGuard` or post-await check. Video metadata does the same at `app/src-tauri/src/commands/video_metadata.rs:37-42,60-78`. Logout clears the state client at `app/src-tauri/src/commands/auth.rs:389-424` but cannot invalidate already-cloned values. These are distinct native command paths from the report's REST handlers.
- **Impact:** In-flight old-session commands can return prior-account metadata or register extracted archive contents in temporary storage after the active account changed.
- **Fix steps:** Capture a session generation before the first await, verify the cloned client belongs to it, and revalidate after network awaits and before returning/registering artifacts. Cancel on logout; add logout/replacement concurrency tests.

### 35. Scheduled cleanup can delete a message after its fingerprint becomes stale

- **Severity / confidence:** High / High
- **Type:** Static/source finding; no runtime race reproduction. This is the retention-worker delete path, separate from sync deletion and interactive move.
- **Evidence:** `app/src-tauri/src/workspace/cleanup.rs:293-315` fetches the message/fingerprint and passes it to `process_one`. The latter compares at `:247-253`, persists `deleting` at `:254-256`, then calls `delete().await` at `:257-263`; the closure at `:307-313` deletes by message ID alone. Existing tests at `:345-468` do not mutate the fingerprint between validation and the delete callback.
- **Impact:** If a message is edited/replaced after the read but before the delete RPC, retention can irreversibly delete changed content although the scheduled fingerprint described the earlier file.
- **Fix steps:** Re-fetch and compare immediately before `delete_messages`, including after any awaited transition/flood-wait; preserve a conflict state on mismatch. Telegram lacks atomic compare-and-delete, so document residual race and test mutation between due-check and delete callback.

### 36. Remote moves do not rekey recent activity or playback state

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; no remote move executed.
- **Evidence:** Interactive moves forward to a new message ID and delete the original at `app/src-tauri/src/commands/fs.rs:3563-3589`; WebDAV does likewise at `app/src-tauri/src/webdav.rs:804-827`. Workspace reconciliation copies only favorite, pin, and activity record kinds (`app/src-tauri/src/workspace/remote_changes.rs:69-75`) before removing the old file. Recent opens use kind `opened` and folder/message identity (`app/src-tauri/src/commands/file_activity.rs:47-54,119-139`); playback history/queue similarly bind to old media IDs (`app/src-tauri/src/workspace/playback.rs:117-124,150-158`).
- **Impact:** Moved files disappear from Recents; continue-watching position/bookmarks and queued items remain tied to the deleted source identity and cannot resume the moved media.
- **Fix steps:** In move reconciliation, migrate opened activity and rekey playback history/embedded `PlaybackFile` and matching queue entries to the forwarded identity. Resolve destination-key conflicts deterministically. Test Recents, playback resume/bookmarks, and queue after move.

### 37. Preview cache hits miss same-size replacement of remote media

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; no Telegram-backed cache test.
- **Evidence:** `app/src-tauri/src/workspace/assets.rs:709-713` derives preview target from stable file key and extension. At `:720-738`, a regular cached file with length equal to indexed size is returned before remote media is checked; remote check at `:470-471` compares only size and is reached on cache miss.
- **Impact:** Replaced/edited Telegram media with the same message identity, size, and extension can leave stale local preview/playback bytes indefinitely until eviction or manual cache clear.
- **Fix steps:** Bind cache entries to a source revision/fingerprint (media identity and edit metadata) and validate on hits; invalidate on verified content refresh if no revision metadata exists. Test same-key, same-size replacement.

### 38. Desktop Copy Telegram Link can use the wrong folder

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; no runtime reproduction.
- **Evidence:** `app/src/components/desktop/dashboard/ContextMenu.tsx:134-140` resolves a username from file/folders/active-folder context. `app/src/components/desktop/dashboard/fileActionDescriptors.ts:41-44` falls back to `activeFolderId` when no matching folder exists; explicit Saved Messages `folder_id: null` matches none and incorrectly falls back. Smart-view navigation preserves selected folder (`app/src/components/desktop/dashboard/Sidebar.tsx:354,373`).
- **Impact:** A Saved Messages item in a cross-folder view can offer/copy a link to an unrelated active public channel with the same message ID.
- **Fix steps:** Honor null-versus-undefined: explicit `folder_id: null` means Saved Messages and must not fall back; only missing/undefined source may use active folder. Test root item acted on while a public folder remains active.

### 39. Desktop UI drops the file pin action and has no pinned-view route

- **Severity / confidence:** Low / High
- **Type:** Static/source finding; no runtime reproduction.
- **Evidence:** `ContextMenu.tsx:23` declares `onTogglePinned`, but destructuring at `:26` omits it and no pin item is rendered. `FileExplorer.tsx:429-431` supplies the callback and `DesktopDashboard.tsx:897` supplies its handler. `Sidebar.tsx:346-381` has no pinned SmartView entry although `DesktopDashboard.tsx:661-675` maps a pinned view.
- **Impact:** Desktop users have no visible way to pin/unpin files or browse the pinned view despite the callback/handler existing.
- **Fix steps:** Destructure and render pin/unpin action with state-aware label/icon; add a pinned sidebar entry wired to `onSmartViewChange`. Test action callback and navigation.

### 40. A late cancel can leave a successfully completed transfer marked cancelled

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; no late-resolution regression test or runtime reproduction.
- **Evidence:** Upload completion at `app/src/hooks/useFileUpload.ts:394-419` checks `cancelledRef` at `:412` and skips success state/cache invalidation at `:415-418`. Download does likewise at `app/src/hooks/useFileDownload.ts:637-675` (`:654-664`). Cancel handlers mark items cancelled before backend completion (`useFileUpload.ts:791-800`; `useFileDownload.ts:992-1009`), while backend upload/download can complete successfully (`app/src-tauri/src/commands/fs.rs:1975-1998,3459-3488`).
- **Impact:** A cancellation racing after the backend's last cancellable point can leave an actually completed transfer displayed as cancelled; upload listing invalidation is skipped and retry may duplicate an upload or repeat a download.
- **Fix steps:** Treat successful backend resolution as authoritative completion; clear cancellation bookkeeping, set success, and run normal invalidation/completion logic. If backend can resolve cancellation, return an explicit completed/cancelled result. Test cancel-then-resolve-success for both hooks.

### 41. Adaptive quality selection changes only the cap and then stops adapting

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; no targeted adaptive test or runtime playback.
- **Evidence:** `app/src/hooks/useAdaptiveStreaming.ts:949-960` makes decisions only while `settings.quality === 'original'` and changes that shared setting via `setQuality(t.quality)`. This bypasses the transcode path in `app/src/components/desktop/dashboard/AdaptiveMediaPlayer.tsx:574-614`, where manual changes start HLS transcode. `app/src/components/shared/QualitySelector.tsx:45-58,93-109` advertises adaptive mode/presets as HLS/transcode-dependent.
- **Impact:** Adaptive playback can remain at original resolution under a bandwidth cap while UI reports a lower preset; after the first choice it no longer reevaluates throughput.
- **Fix steps:** Route automatic decisions through the same quality-transition/transcode logic as manual selection. Track adaptive-selected quality separately and keep reevaluating with hysteresis. Test multiple speed changes, transcode requests, and up/down transitions.

### 42. WorkspaceHub discards the selected item's navigation context

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; existing targeted tests did not exercise this wrapper.
- **Evidence:** `app/src/components/workspace/WorkspaceHub.tsx:56-58` accepts `orderedFiles` from `MediaTimeline` but invokes `onOpen(file, files)`, discarding timeline order. `CleanupPanel.tsx:39-40` calls `onOpen(file)` while `WorkspaceHub.tsx:56` defaults context to filtered library files, which may omit the cleanup candidate. The desktop consumer uses context at `app/src/components/desktop/DesktopDashboard.tsx:490-491`; `PhotoSlideshow.tsx:35-36,118-120` falls back to first image or closes if the selected key is absent.
- **Impact:** Timeline video next/previous can follow library order; opening a cleanup image excluded by filters can show a different image or close the viewer because the selected item is absent from slideshow sequence.
- **Fix steps:** Preserve supplied `orderedFiles`; ensure the context sequence includes selected file by workspace key, using full indexed workspace or a sequence augmented with the item when absent. Derive slideshow keys from corrected sequence. Test timeline ordering and filtered-out cleanup preview.

### 43. Late settings load overwrites edits made during initialization

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; no deferred-store regression or runtime test.
- **Evidence:** `app/src/context/SettingsContext.tsx:33-58` asynchronously reads persisted settings then unconditionally calls `setSettings(loaded)` and replaces `latestSettingsRef`; `:77-91` allows updates before `isLoaded`. `SettingsModal.tsx:60-62,786-823` does not gate edits on readiness, and `app/src/App.tsx:229-242` mounts dashboard independently of settings readiness.
- **Impact:** An early user preference edit can be overwritten by the later store read, leaving UI/in-memory state inconsistent with the queued write until restart.
- **Fix steps:** Reconcile pending per-key edits over the loaded snapshot before publishing, or centrally prevent preference mutations until loaded. Test update-before-resolving-read with a deferred store.

### 44. Logout restores the previous account's active folder for the next account

- **Severity / confidence:** Medium / High
- **Type:** Static/source finding; no account-switch runtime or targeted assertion.
- **Evidence:** `app/src/hooks/useTelegramConnection.ts:130-132` restores `activeFolderId` from shared settings without account association and `:375-380` persists it. Successful logout removes API credentials/folders at `:207-218` but not `activeFolderId`. Desktop uses it for folder-scoped loading (`app/src/components/desktop/DesktopDashboard.tsx:245`).
- **Impact:** After account A logs out and B logs in, the UI may target A's old folder/channel ID, showing errors/empty results or an unrelated same-ID resource.
- **Fix steps:** Clear `activeFolderId` on successful logout or persist/restore it only under the verified account ID. Test logout/login with a different account.

### 45. Settings-sync upload can bypass replacement confirmation when status lookup fails

- **Severity / confidence:** Medium / High
- **Type:** Static frontend/backend trace; no runtime reproduction.
- **Evidence:** `app/src/components/desktop/dashboard/settings/SettingsTabs.tsx:74-84` sets status to null on lookup failure. Upload prompts only for `status?.available && !status.current_device` (`:91-105`), while its button is disabled only when `status?.available === false` or an action is active (`:168-170`), so null enables it. Backend uploads a new message and deletes prior settings-sync messages (`app/src-tauri/src/commands/settings_sync.rs:395-407`).
- **Impact:** If status fails transiently but a later upload succeeds, the only encrypted backup from another device can be overwritten without explicit replacement confirmation.
- **Fix steps:** Disable upload while status is unknown/errored; require a fresh successful status check and confirmation whenever a remote backup exists from another device. Preserve existing backup if status cannot be established. Test status rejection followed by attempted upload.

### 46. Settings search filters tab categories, not individual settings

- **Severity / confidence:** Low / High
- **Type:** Static UI/source finding; no search test or UI runtime test.
- **Evidence:** Search input is at `app/src/components/desktop/dashboard/SettingsModal.tsx:745-747`, but `:749-756` filters only tab entries against tab keys and a short hard-coded keyword list. The Advanced panel promises search by option name at `app/src/components/desktop/dashboard/settings/SettingsTabs.tsx:225`; e.g. “transcode cache” or “zip before upload” do not match a tab although the controls exist in General settings.
- **Impact:** Users searching by displayed setting name can get no result for a setting that exists.
- **Fix steps:** Index actual setting labels/aliases with owning tab and navigate/scroll to matching controls, or narrow the UI promise to category search. Test exact setting-name queries and unmatched terms.

## Additional dependency-security finding

### Vulnerable JavaScript build/test dependencies remain in the lockfile

- **Severity / confidence:** Medium for this app's runtime risk / High confidence in the package findings (npm reports 7 high, 4 moderate, and 1 low advisories).
- **Type:** Dependency advisory; verified by `npm audit` against the checked-in `app/package-lock.json` as of 2026-10-14. No vulnerable package was identified as an application runtime dependency; these are dev/build/test dependencies or their transitives.
- **Evidence:** `app/package.json:54-71` declares Vite, PostCSS, Vitest, coverage tooling, and related build/test tools as dev dependencies. The installed lockfile resolves vulnerable versions including `vite@7.3.1`, `postcss@8.5.6`, `vitest@4.1.10`, `@vitest/mocker@4.1.10`, `rollup@4.55.1`, `nanoid@3.3.11`, `picomatch@4.0.3`, `undici@7.29.0`, `browserslist@4.28.1`, and `@babel/core@7.28.6`. Reported advisory classes include dev-server arbitrary file read, build-tool path traversal/file write, and denial-of-service; npm marked fixes available for all 12 package advisories.
- **Impact:** The checked-in development toolchain is vulnerable when the relevant tools process attacker-controlled inputs or an exposed dev-server request. This is not evidence that the shipped mobile application runtime is vulnerable; the exposure is in contributor/CI build and test environments.
- **Fix steps:** From `app/`, run `npm audit fix`, inspect and commit the resulting `package-lock.json` changes, then rerun `npm ci`, `npm audit`, `npm test`, and `npm run build`. Add an explicit CI audit gate or documented allowlist only for reviewed, time-bounded exceptions.

## Checks still needed and coverage gaps

- **Frontend/mobile:** No Android emulator/device or live Telegram backend was used. Affected mobile action-sheet wiring was not covered by existing integration tests; `MobileFolderRefresh` mocks `useFileOperations`, and no real mobile action-sheet test verifies owner/source IDs. Desktop-only component internals outside source-identity cross-check were not exhaustively audited. Generated locale catalogs were excluded; i18n bootstrap/tests and repository i18n check were inspected.
- **Rust services/commands:** No Rust test suite or cross-platform build completed; `cargo test --lib` stopped before project tests because the environment lacks `gdk-3.0` development metadata. The supplementary review inspected all 6,385 lines of `commands/fs.rs` across five assigned ranges and selected remaining command handlers, but did not examine every Rust module/function line-by-line. No live Telegram/proxy/WebDAV integration was run.
- **Crypto/sync/transfer:** The supplementary review covered additional database/migration, workspace cleanup, cache, playback, and remote-change modules, but was not a full Rust audit. Rust tests/build were not completed. Telegram has no atomic delete-by-fingerprint primitive, so revalidation cannot completely eliminate server-side change races.
- **Android:** No Gradle build, emulator/device instrumentation, or phone/TV runtime flow was run. Generated `app/src-tauri/gen/android` was not reviewed or built; CI regenerates it and checks overrides against generated inputs.
- **CI/release:** GitHub Actions workflows, signed APK/AAB release, and emulator suites were not run. No configured signing setup/tested Actions runner was available to the review. Not every helper under `app/scripts/i18n/` or the entire `Cargo.lock` was audited line-by-line.
- **Finding validation overall:** Supplied evidence supports source/static conclusions, not observed production behavior. No finding is marked test-reproduced. Tests/checks reported as passing are documented in the executive summary and should not be interpreted as targeted regression coverage.
### Supplemental pass coverage and validation limits

The following coverage notes describe the supplementary review results that contributed findings 19–46. They extend, rather than claim to exhaust, the earlier selected-path scope above. The supplied review records reported no agent failures (`failures: []`).

- **Rust filesystem, Android staging/download publication, and folder operations:** Reviewed `commands/fs.rs` lines 1–1515 plus caller/test-context ranges, Android `MainActivity.kt`, `MobileDashboard.tsx`, `useFileUpload.ts`, API bindings, Tauri registration, REST/WebDAV callers, DB schema, and Android build/manifest. No emulator, live Telegram account, runtime E2E, or targeted Rust/Kotlin/mobile integration tests were available/run. Android URI-copy race and pre-Q cleanup need regression tests. Folder create/delete/rename were traced but no additional actionable defect was established.
- **Rust upload/cancellation:** Reviewed `fs.rs` lines 1516–2527 plus cancellation plumbing in transfer engine, account scope, crypto state, sync caller, and frontend upload/cancel paths. No live runtime test, full Rust build/suite, Android build, or Telegram integration test. A focused `cargo test` attempt for dropped-path validation stopped before tests because `pkg-config` could not find `gdk-3.0`; no Rust test result is confirmed.
- **Rust mutation/download:** Reviewed `fs.rs` move/rename/delete/download ranges (including 2528–3630) and download-destination/utils modules with frontend callers. No Rust suite, Android build/device, or live Telegram test; move race remains static and needs regression coverage.
- **Listing/search/scanning/metadata:** Reviewed `fs.rs` listing/search ranges (including 3631–4810), resolver, models, search-scope tests, API and UI consumers. No Rust tests or live Telegram account; inspected tests are not claimed as passing. Review was limited to the assigned paths and source-identity callers, not all commands.
- **Archive/sharing/remote URL upload:** Reviewed `fs.rs` lines 4811–6385, temp-artifact, transfer, frontend callers and `reqwest` lockfile version. No Rust tests, device/account, proxy, controlled DNS-rebinding endpoint, or NAT64 network. Proxy/NAT64 impact depends on deployment/network configuration; invite-hash persistence was not live-verified.
- **Remaining Rust commands/contracts:** Reviewed archive, download destination, activity/inventory/folder-group/preview/storage/video/startup/settings/sync/WebDAV/auth and related command modules, registration, state and callers. No Rust suite/cross-platform build or Android/Telegram/archive/proxy/disk-failure/account-switch runtime test; findings are static.
- **Workspace storage/database/cleanup/cache/playback:** Reviewed DB/migrations and workspace assets, cleanup, device cache, packs, playback, remote changes, storage/store/account-scope code and move/activity callers. No Rust test/build, device, or Telegram runtime; inspected in-module tests were not run. Telegram has no atomic compare-and-delete, leaving a residual cleanup race even after revalidation; review was not a whole-application audit.
- **Desktop/mobile file-management UI:** Reviewed assigned desktop dashboard components and mobile row/action components plus relevant dashboard/hooks/identity/workspace call paths. No live backend/device flow and no targeted component tests were found for the affected workflows; conclusions are static.
- **Frontend transfer lifecycle:** Reviewed upload/download/operation hooks, transfer services/UI, backend completion paths, and six focused existing transfer test files. The reported run passed **6 files / 46 tests** (`transferOwnerCapture`, `DownloadQueueRetries`, `MobileDownloadRetry`, `DownloadCollisionChoice`, `desktopTransferEngine`, `transferQueuePolicy`); tests do not cover late cancellation followed by successful backend resolution. No full suite/build, device, or live Telegram runtime.
- **Media/playback:** Reviewed media/player components, adaptive streaming/playback hooks and services, relevant API/backend paths. No targeted adaptive-streaming tests were found/run and no runtime playback/device/account test was available; conclusions are static.
- **Sync/workspace/offline/sharing UI:** Reviewed assigned sync/workspace components, contexts/hooks/services and API/dashboard callers. Nine targeted test files passed (**36 tests**), but none covers the WorkspaceHub open-wrapper scenario; no Android or Telegram runtime validation.
- **App shell/auth/settings/lifecycle:** Reviewed app/provider/auth/theme/settings components, account/settings/lifecycle services and related tests. No tests were executed in this pass and no account-switch runtime was available; no additional defect was established in theme, auth orchestration, crash reporting, updates, or localization paths beyond findings 43–46.

- **Agent failures:** The supplied audit results report `failures: []`; no agent failure was reported.


## Follow-up audit and repair pass — 2026-10-16

> **Historical snapshot:** This section records the state on `fix/login-security-ux-2026-10-16` before the changes were committed. The changes were subsequently committed to `main` and released as v4.4.4. Its branch status and verification table below describe that snapshot only, not the current repository.

This pass rechecked the repository on branch `fix/login-security-ux-2026-10-16` and implemented fixes for findings **1–29 and 31–46**, plus the JavaScript dependency-security item. At the time of this note, the changes were still in the working tree and had not been committed or pushed.

### Resolution status and residual risks

- **Findings 1–29, 31–46:** Fixes and regression coverage are in the current worktree. Coverage spans vault-operation revocation and protected streaming, exact stream-resource capabilities, sync/scheduled/interactive deletion checks, API and command account guards, mobile source/owner identity, Android cache and transfer recovery, proxy diagnostics/settings transactions, archive error handling, search and ZIP/SSRF hardening, move/history/cache identity, transfer cancellation, adaptive playback, settings initialization/sync/search, desktop workflows, and CI/dependency checks.
- **Finding 30 — clarified, not fully automated:** The “Make Private” confirmation now says that removing the public username does **not** revoke previously exported private invite links and directs the user to Telegram invite settings. There is no in-app bulk invite-revocation action in this pass.
- **Telegram destructive-operation race:** Sync and scheduled cleanup, and interactive moves, now re-fetch/revalidate fingerprints and account scope immediately before deletion; Telegram offers no atomic compare-and-delete, so a narrow server-side race remains.
- **Upload cancellation boundary:** Cancellation now covers registration, retries, and pre-publication checks. It cannot retract a Telegram send that the server has already accepted/in flight.
- **Runtime/platform limits:** No live Telegram, proxy, or WebDAV integration was run. No Android Gradle/device build was run: this workspace has no generated Android Gradle wrapper, Gradle executable, or Android SDK environment.

### Final verification

| Check | Result |
| --- | --- |
| Frontend unit tests | **72 files passed; 373 tests passed, 6 skipped** |
| Production frontend build and bundle budgets | **Passed** (`npm run build:verify`) |
| Localization checks | **Passed** (`npm run i18n:check`; existing untranslated-literal debt remains within the configured no-regression budget) |
| Rust formatting | **Passed** (`cargo fmt --all -- --check`) |
| Rust Clippy | **Passed** (`cargo clippy --lib --all-targets -- -D warnings`) |
| Locked Rust tests | **347 passed; 0 failed** (`cargo test --locked`) |
| Android release-version contract | **Passed** (`4.4.3`, versionCode `4004003`) |
| Immutable Rust git pins and assurance-script contracts | **Passed** (4 full immutable revisions) |
| npm advisory and dependency-license policy | **Passed** against the reviewed advisory baseline and license policy |
| Whitespace/integrity | **Passed** (`git diff --check`) |

The frontend run emitted expected test diagnostics from mocked offline/error cases; these did not fail tests. The audit is based on repository source and automated tests, not production-account reproduction.
## Repository-wide follow-up audit — 2026-10-17 (v4.4.5)

A fresh read-only review covered Rust command/API and streaming paths, React transfer/media lifecycles, Android background-transfer constraints, release automation, and project documentation. Confirmed findings fixed in this pass:

- Validated transfer IDs before deriving upload staging paths; bound REST uploads and folder operations to the active account and rechecked account scope around asynchronous/remote side effects.
- Changed interrupted media downloads into terminal HTTP gateway errors rather than silently ending a successful-looking response.
- Made transcode polling single-flight and generation-safe, cancelling stale jobs and preventing late preparation/status responses from replacing a newer playback choice; disposed Android upload listeners that resolve after unmount.
- Applied the saved `allow_roaming` setting to both WorkManager recovery and JobScheduler user-initiated transfer constraints, with an Android instrumentation contract test.
- Made release predecessor-manifest lookup fail closed on GitHub/API/download errors, added the locale-literal scan to release verification, and pinned the Android App Bundle certificate to the protected production fingerprint.
- Aligned README and privacy copy with the owner-selected crash-reporting policy: enabled by default, with an in-app Settings opt-out. Removed the unsupported MIT assertion and disclosed the missing supporter-terms document instead of linking to a nonexistent file.

### Residual risks and owner follow-up

- The existing “Make Private” copy correctly warns that removing a public username does not revoke previously exported private Telegram invites; there is still no in-app bulk invite-revocation action. Users must revoke those invites in Telegram.
- This repository has no `LICENSE` file and no GitHub license declaration; no license terms are inferred here. The supporter terms document is also absent. The maintainer must supply authoritative license/terms documents or remove the related program claims.
- No live Telegram, proxy, or WebDAV operations were performed. Signed Android packaging and emulator instrumentation require the Android SDK, Gradle wrapper/tooling, and JDK signer utilities available in GitHub Actions; those are not installed on this computer.

### Verification for this pass

- Frontend coverage suite: **passed**; production build and bundle budgets: **passed** (`MediaPlayer` feature chunk 249,993 / 250,000 bytes; initial JavaScript 549,744 / 550,000 bytes).
- Generated localization key check, locale validation, and i18n literal scan: **passed**. Locale validation reports 17 non-blocking existing plural/copied-English warnings; literal debt remains within its configured no-regression budget.
- Locked Rust library tests: **349 passed, 0 failed**; `cargo fmt --all -- --check` and locked all-target Clippy with `-D warnings`: **passed**.
- Release-assurance script contracts: **passed**, including signer-fingerprint matching/mismatch and fail-closed previous-manifest resolution. The Android version gate passed for v4.4.5 against the published v4.4.4 manifest (versionCode 4004004 → 4004005).
- `git diff --check`: **passed**.

## Release follow-up — proposed v4.4.6

- Fixed the phone sign-in “Verifying…” hang with bounded native authentication operations, frontend watchdogs, and generation-safe cleanup. Corrected the nested Result return and moved transfer-ID validation into a shared module that also compiles on Android.
- The direct `zip` upgrade alone did not clear dependency assurance: `tauri-plugin-updater` 2.10.1 still pulled Windows-only `zip` 4.6.1. The owner rejected advisory exceptions. No exception for RUSTSEC-2026-0367/0368/0369 is present or permitted by the new static guard.
- Vendored the already-locked updater 2.10.1 Rust/build inputs with original licenses and provenance, and patched its Windows ZIP requirement to exact version 9.0.4 with explicit DEFLATE support. The application lockfile now contains **only zip 9.0.4**, selecting the local updater source. Runtime updater implementation is unchanged; added compatibility tests exercise compressed synthetic archive extraction, parent-path confinement, and ZIP error conversion on Windows. No installer fixture is executed.
- Added native Windows updater library tests to dependency assurance, using the application's locked dependency graph. The ordinary RustSec advisory policy stays blocking. The local patch must be removed after a compatible upstream release adopts patched ZIP.
- The earlier Android build at `79e98d4` compiled APK/AAB binaries and passed the pinned App Bundle certificate comparison, then failed packaging because the branch name `main` was treated as a release tag. Packaging now derives the tag for branch/manual builds and preserves strict validation for actual tagged releases; focused regression coverage passed (27 tests).

Validation at preparation time: the complete isolated frontend suite passed (74 files, 397 tests passed, 6 skipped). The isolated ZIP dependency contract, existing advisory-baseline and release-assurance contracts, v4.4.6 version contract (Android versionCode 4004006), and Rust formatting passed. Local Rust library tests remain blocked by the offline sandbox's missing cached `typed-path` 0.12.3 dependency; Windows compatibility, fresh advisory assurance, and final signed Android artifacts must pass CI before release approval is requested. No new release tag or publication is authorized yet. Crash reporting remains enabled by default with the existing Settings opt-out.

### CI follow-up to the ZIP patch

[Dependency assurance run 39031919950](https://github.com/hellocloudwebdev/shelf-drive-mobile/actions/runs/39031919950) passed on `dbb6e4c`, including native Windows updater compatibility and Rust advisories/licenses/bans/sources with no ZIP advisory exception. Coverage CI then exposed the app archive reader's zip 9 API migration: member names are now fallible. Listing and extraction now propagate contextual filename errors rather than ignoring or stringifying them; the existing extraction confinement checks are unchanged, with a new error-propagation regression.

The frontend budget gate also caught the small authentication-watchdog increase. The corrective build defers only crash-consent dialog presentation until its existing settings-ready mount boundary, leaving telemetry configuration and enabled-by-default policy unchanged. Duplicated media-shortcut DOM lookup and folder-ID normalization were removed without changing shortcut behavior. Budget ceilings and coverage floors are unchanged. The obsolete Android run for `dbb6e4c` was intentionally canceled so the corrected final commit can be rebuilt; it is not final release evidence.

Final local corrective validation passed: **75 frontend files, 398 tests passed, 6 skipped**; Rust formatting; and every original production bundle ceiling. Initial/largest JavaScript is **548,278 / 550,000 bytes**, desktop route JavaScript **288,142 / 310,000 bytes**, and MediaPlayer **249,931 / 250,000 bytes**. No budget or coverage threshold was increased. The corrected native app archive API remains subject to the fresh CI Rust test/coverage run.
