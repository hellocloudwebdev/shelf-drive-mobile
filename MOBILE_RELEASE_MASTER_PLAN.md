# Shelf Drive Mobile — Release Master Plan

**Updated:** 2026-10-10  
**Audit base:** `release/v4.0.3` at `b0d5542e36ca746743d8507337d1cdec06a52422`; `main` at `19c2e3304a288e4fafdb76e455834d93ec4e6853`.  
**Status:** Audit in progress. No release tag, public release, secret rotation, or signing-key change authorized.

## 1. Release decision

**NO-GO for production release** until all P0 gates below pass. The successful debug APK workflow proves only that an unsigned debug APK was built. It does not prove release signing, updater compatibility, real-device reliability, or feature completeness.

Repository: [hellocloudwebdev/shelf-drive-mobile](https://github.com/hellocloudwebdev/shelf-drive-mobile)  
Desktop reference: [hellocloudwebdev/shelf-drive](https://github.com/hellocloudwebdev/shelf-drive)

## 2. Evidence snapshot

| Evidence | Finding |
|---|---|
| Branches API | `main` = `19c2e330`; `release/v4.0.3` = `b0d5542`; both reported unprotected |
| Compare `main...release/v4.0.3` | Release branch is 2 commits ahead; reliability implementation and v4.0.3 version changes are not on `main` |
| Commit `b0d5542` | Exists; adds protection sheet, blocked-transfer banner, bounded Android environment retries, concurrency controls, tests and v4.0.3 version bump |
| Android Debug APK run [37978844409](https://github.com/hellocloudwebdev/shelf-drive-mobile/actions/runs/37978844409) | Completed successfully; one artifact `shelf-drive-android-debug-apk`, 122,984,101 bytes; unsigned debug build |
| Dependency assurance run [37974647052](https://github.com/hellocloudwebdev/shelf-drive-mobile/actions/runs/37974647052) | Failed on main because `GHSA-68FV-2MGG-JV7Q` (high, `source-map-js`) was new to the temporary npm advisory allowlist. The release branch lockfile already contains patched `source-map-js` 1.2.2; main still contains 1.2.1. The candidate branch still needs a fresh successful dependency-assurance run |
| i18n validation run `37974647049` | Passed on main |
| Existing `Docs/CROSS_PLATFORM_MIGRATION_AUDIT.md` | Present; audit is dated 2026-10-02 and needs validation against current code |
| `MOBILE_RELEASE_MASTER_PLAN.md` | Did not exist at repository root when checked |
| Signing secret values | Cannot be inspected through the available repository API; prior claims that all secrets exist are not independently verified here |
| Physical device | No evidence of completed device testing in the checked CI run; still required |

### Package identity — verify before any upgrade/release test

Both `main` and `release/v4.0.3` currently declare Tauri identifier **`com.hellocloudweb.shelfdrive`** in `app/src-tauri/tauri.conf.json`. This differs from the earlier handoff's reported `com.hellocloudwebdev.shelfdrive`. Treat the handoff value as unverified/incorrect until the built APK's application ID is read with Android build tools. Do not change the identifier casually: it controls Android install/upgrade continuity.

## 3. Prioritized work

Severity meanings: **P0** = release blocker/security/data integrity; **P1** = important supported feature/reliability gap; **P2** = lower-priority parity or platform follow-up. Status is deliberately conservative: a code path being present or a CI job passing is not proof of end-to-end behavior.

### P0 — Release blockers

#### R-001 — Reconcile release branch and main
- **Finding:** `release/v4.0.3` is 2 commits ahead of `main`; main still declares v4.0.2 while the release branch declares v4.0.3.
- **Severity/status:** P0 / verified.
- **Dependencies:** none.
- **Affected files:** `CHANGELOG.md`, `app/package.json`, `app/package-lock.json`, `app/src-tauri/Cargo.toml`, `app/src-tauri/Cargo.lock`, `app/src-tauri/tauri.conf.json`, reliability UI/services/tests.
- **Acceptance:** choose the intended integration path; compare the full diff; verify package, Tauri, Cargo, lockfile and changelog versions agree; run version-contract tests. Do not tag either branch until a single reviewed release commit is selected.

#### R-002 — Clear the dependency-assurance gate
- **Finding:** main CI fails because `GHSA-68FV-2MGG-JV7Q` (high, `source-map-js`) is new to the temporary npm advisory allowlist. Source inspection confirms `main` locks `source-map-js` 1.2.1, while `release/v4.0.3` already locks patched version 1.2.2 (its parent commit `56d830c` documents the advisory fix).
- **Severity/status:** P0 / failure reproduced on main; dependency fix present on release branch but not yet proven by a fresh successful candidate CI run.
- **Dependencies:** R-001 determines how the fix is integrated.
- **Affected files:** `app/package-lock.json`, `dependency-policy/npm-audit-allowlist.json`, `scripts/check-npm-audit.cjs`.
- **Acceptance:** run `npm audit` and dependency-assurance on the exact candidate commit and confirm the new advisory is resolved without adding an allowlist entry. Ensure the patched lockfile reaches the selected release/main branch. Do not merely whitelist a high-severity advisory. Confirm no stale allowlist entries remain.

#### R-003 — Prove production signing configuration without exposing credentials
- **Finding:** `android.yml` has fail-closed checks for Android keystore and Tauri updater signing material; secret presence cannot be independently verified from the available API.
- **Severity/status:** P0 / verification pending.
- **Dependencies:** security triage R-004; R-001.
- **Affected files:** `.github/workflows/android.yml`, `.github/workflows/release.yml`, `app/scripts/package-android-release.sh`, `app/scripts/verify-android-artifacts.sh`.
- **Acceptance:** authorized maintainer verifies required secret *names* exist in the intended repository/environment without printing values; test the release workflow's protected signing gate; verify the APK certificate SHA-256 against the pinned expected fingerprint; verify AAB signature; verify updater manifest signature with the embedded public key. Never commit credential files.

#### R-004 — Assess possible updater private-key exposure
- **Finding:** a previous session reportedly included the updater private key in a transcript. Exposure scope, transcript audience/retention and actual key contents are not established by this audit.
- **Severity/status:** P0 / security incident assessment open.
- **Dependencies:** coordinate with repository owner/security decision-maker before any key action.
- **Affected areas:** session/transcript access controls, secret storage, Android updater public-key pin, desktop updater public-key pin, signing workflows.
- **Acceptance:** document whether the transcript contained the actual private key or only a placeholder/derived text; restrict access/retention where possible; establish whether unauthorized access is plausible; verify current keypair compatibility using non-secret fingerprints/signature verification. **Do not reveal the key, print secret values, generate a replacement, rotate casually, or change embedded public keys**. If rotation is approved, first design and test a compatibility/migration plan for already-installed clients and both updater channels.

#### R-005 — Verify package ID, signing certificate, version and ABI coverage
- **Finding:** declared identifier is `com.hellocloudweb.shelfdrive`; handoff claimed a different ID. Debug artifact is unsigned and cannot establish production certificate continuity.
- **Severity/status:** P0 / identity discrepancy verified; built artifact checks pending.
- **Dependencies:** R-001, R-003, R-004.
- **Affected files:** `app/src-tauri/tauri.conf.json`, generated Android Gradle configuration, `app/scripts/package-android-release.sh`, `app/scripts/verify-android-artifacts.sh`, release workflow.
- **Acceptance:** inspect the actual APK application ID; compare against v4.0.2 installed package and intended Play/sideload channel; verify versionName/versionCode monotonicity, all four native ABI payloads (arm64-v8a, armeabi-v7a, x86, x86_64), 16 KB page alignment, APK and AAB signatures, certificate fingerprint, SHA-256 checksums, artifact provenance/attestation and exact filenames. No package-ID changes without an approved migration plan.

#### R-006 — Validate updater URL, signing format and installed-app upgrade path
- **Finding:** mobile `android_updates.rs` on the v4.0.3 branch points to the mobile repository's `releases/latest/download/android-update.json` and signature. Commit `efbdcdd` exists and the Android workflow normalizes updater key input. End-to-end compatibility is not proven by the debug build.
- **Severity/status:** P0 / code configuration partly verified; signed end-to-end test pending.
- **Dependencies:** R-003 through R-005.
- **Affected files:** `app/src-tauri/src/android_updates.rs`, `app/src-tauri/tauri.conf.json`, `.github/workflows/android.yml`, `.github/workflows/release.yml`, `app/scripts/package-android-release.sh`.
- **Acceptance:** use a test/staging release path first; verify manifest signature, package name, semantic version and versionCode, GitHub URL allowlist, SHA-256, safe filename, download interruption behavior, installer handoff, and upgrade from the previous signed build. Confirm existing clients trust the same public key. Never disable signature verification.

#### R-007 — Complete transfer reliability and recovery testing on a physical Android device
- **Finding:** v4.0.3 adds a protection sheet, blocked-transfer banner, bounded transfer-environment retries and concurrency settings; the debug workflow did not test real-device behavior.
- **Severity/status:** P0 / code change exists; device acceptance pending.
- **Dependencies:** R-001; debug APK available; use non-production test files/accounts.
- **Affected files:** `app/src/components/shared/EncryptionPromptSheet.tsx`, `app/src/context/EncryptionPromptContext.tsx`, `app/src/components/mobile/BlockedTransferBanner.tsx`, `app/src/services/transferEnvironment.ts`, `app/src/services/androidTransferPolicy.ts`, `app/src/hooks/useFileUpload.ts`, `app/src/hooks/useFileDownload.ts`, `app/src/components/mobile/MobileDashboard.tsx`, Kotlin services/workers in `app/android-overrides/app/src/main/java/`.
- **Acceptance matrix:** upload unprotected/protected; cancel and dismiss protection sheet; wrong/cancelled passphrase; small/large file; download and MediaStore save; concurrency 1 and >1; Wi-Fi, metered mobile data, offline/online transition, roaming/battery policy; JNI query transient failure/timeout; app background/foreground; screen lock; process death/relaunch; reboot/recovery worker; partial failure and retry; duplicate filename; storage full/permission denial; verify queued items are not silently dropped, duplicated, or marked complete incorrectly. Record Android version/device model, steps, logs with secrets/PII removed, expected vs actual and outcome.

#### R-008 — Run complete CI release gates on the selected release commit
- **Finding:** debug workflow passed; dependency assurance failed on main. This is not a production release verification.
- **Severity/status:** P0 / pending.
- **Dependencies:** R-001 through R-007.
- **Affected files:** `.github/workflows/release.yml`, `.github/workflows/android.yml`, `.github/workflows/dependency-assurance.yml`, `.github/workflows/quality-assurance.yml`, `app/package.json`.
- **Acceptance:** frontend tests/coverage, TypeScript build/type checks, bundle budget, i18n validation, JNI contract, applicable Rust tests, `cargo fmt --check`, `cargo clippy -D warnings`, Android JVM/instrumentation/emulator tests, ABI and artifact validation, signing and updater verification all pass on the exact candidate commit. Investigate every skipped/conditional gate; no unexplained failures or baseline exceptions.

### P1 — Feature parity and reliability backlog

For each item, first re-check the current mobile tree and `invoke_handler`; the 2026-10-06 parity report is useful input but is not current proof. Reuse compatible domain logic/contracts and adapt UI to mobile. Do not blindly copy desktop components.

#### F-101 — Full Encryption/Vault management UI
- **Severity:** P1 (promote to P0 if existing encryption state cannot be safely managed).
- **Dependencies:** R-007; confirm mobile command signatures and settings persistence.
- **Reference:** desktop `app/src/components/shared/EncryptionSettingsSection.tsx`.
- **Mobile areas:** `app/src/components/mobile/`, mobile settings components, crypto API facades in `app/src/api/`, `app/src-tauri/src/lib.rs`, vault commands/tests.
- **Scope:** vault create/unlock/change passphrase, default upload protection, metadata protection, auto-lock/lock-on-sleep, temporary plaintext policy, recovery drill, encrypted bundle export/import, verify encrypted file.
- **Acceptance:** create/unlock/lock/restart/recovery flows; wrong passphrase and cancellation; no plaintext secrets in logs; tests for command errors and lifecycle state.

#### F-102 — Folder Sync UI
- **Severity:** P1; destructive deletion/sync conflicts require explicit safeguards.
- **Dependencies:** prove Android SAF directory selection support or ship a tested fallback; confirm commands are registered and callable on mobile.
- **Reference:** desktop `SyncSettingsPanel.tsx`, `SyncDashboard`, `SyncContext`, `useSyncEngine.ts`.
- **Acceptance:** add/edit/pause/resume/remove pair; one-way/two-way direction; deletion opt-in; ignore patterns; dry-run/plan preview; conflict handling; offline interruption; local directory permissions; duplicate prevention; audit/log visibility.

#### F-103 — WebDAV and REST API settings
- **Severity:** P1 / security-sensitive network surface.
- **Dependencies:** confirm server binding, Android network policy and whether on-device access from other apps is supported/safe.
- **Reference:** desktop WebDAV and REST API settings tabs; mobile facades in `app/src/api/index.ts`.
- **Acceptance:** enable/disable, port validation, API key/token regeneration and copy, explicit permission warnings, runtime status, loopback vs LAN binding proof, authentication tests, no accidental exposure to local network, stop-on-background/lifecycle behavior. If unsafe or unsupported, document as intentionally unavailable instead of exposing controls.

#### F-104 — Share management and revocation
- **Severity:** P1.
- **Dependencies:** validate existing share command behavior and expiry/password support.
- **Reference:** desktop `SharingSettingsTab`; mobile `ShareDialog.tsx`, `FileActionSheet`.
- **Acceptance:** list existing shares, copy URL, display expiry/password state, revoke confirmation, revoked URL no longer serves content, error and empty states, permission scoping.

#### F-105 — Encrypted settings backup/sync
- **Severity:** P1 / security-sensitive.
- **Dependencies:** passphrase UX and encrypted payload contract review.
- **Reference:** desktop `SettingsSyncSection.tsx`.
- **Acceptance:** opt-in enablement; explicit passphrase requirements; upload/download/apply; wrong-passphrase handling; schema/version compatibility; no plaintext settings or passphrase leakage; backup restore tests across desktop/mobile versions.

#### F-106 — Offline trip packs and cleanup
- **Severity:** P1.
- **Dependencies:** storage quota and lifecycle behavior; ensure delete grace period is preserved.
- **Reference:** `OfflinePacksPanel.tsx`, `CleanupPanel.tsx`, workspace commands.
- **Acceptance:** create/list/download/remove pack; interruption/resume; size estimate and low-storage handling; stale item cleanup preview; undo/grace period; no unintended deletion; test airplane mode.

#### F-107 — Archive browser
- **Severity:** P1.
- **Dependencies:** validate ZIP/7z/RAR format support and safe extraction limits on Android.
- **Reference:** desktop `ArchiveViewerModal.tsx`; mobile commands `cmd_list_archive_contents`, `cmd_extract_archive_entry`.
- **Acceptance:** list entries and metadata; extract selected entry; path traversal rejection; decompression-bomb/resource limits; unsupported/corrupt archive messaging; progress/cancel and storage-full tests.

#### F-108 — Missing connection, performance and privacy settings
- **Severity:** P1.
- **Areas:** bandwidth up/down, proxy type, performance mode, crash-reporting consent/toggle, auto-update toggle, upload/download concurrency (already added in v4.0.3; verify on release branch).
- **Acceptance:** values persist across restart; controls match effective runtime behavior; proxy credentials stay in approved secure storage; crash reporting respects consent and opt-out; updater toggle has clear semantics and cannot bypass signature verification.

#### F-109 — Transfer durability architecture decision
- **Severity:** P1 for reliability; architectural change must be separately reviewed.
- **Finding:** current Android queue is frontend-driven with plugin-store persistence and foreground-service/WorkManager support; desktop durable transfer engine commands are compile-gated off mobile. Byte-level resume was previously identified as absent.
- **Dependencies:** R-007 device evidence and transfer contract review.
- **Decision required:** retain/document and harden the mobile queue, or propose a small measured migration to a native durable engine. Do not remove compile gates or replace the pump in a bulk change.
- **Acceptance:** process death, force-stop, reboot, network changes, partial chunks, duplicate/retry semantics and queue persistence are covered. If byte-level resume is added, server-side chunk semantics and encrypted-transfer integrity must be proven first.

### P2 — Additional parity and platform follow-ups

- **F-201 Theme customization:** presets/custom accent only after design-token contract is verified; test light/dark/system and persisted custom theme.
- **F-202 QR login:** verify Telegram QR login API support and mobile lifecycle; otherwise mark unsupported with a clear reason.
- **F-203 Video quality/transcode:** investigate FFmpeg packaging, CPU/RAM/battery costs and codec support before adding controls.
- **F-204 Network-config read-back and batch metadata:** replace blind writes/single-file calls only where measurable value and tests justify it.
- **F-205 iOS:** not part of the Android v4.0.3 release gate. Existing audit says iOS adapters/build are absent; before an iOS target, review updater-plugin gating, `unrar` cfg, Keychain, Files/share-sheet staging, AVPlayer, privacy lock and background-transfer constraints. Do not claim iOS support until a signed device/TestFlight workflow exists.
- **F-206 Intentional desktop-only surfaces:** system tray, close-to-tray/window-state, single-instance, desktop notifications, Linux rendering workaround and `linux_startup` should remain desktop-only unless a mobile-specific product requirement exists.

## 4. Required small-batch implementation protocol

For every batch:
1. Start from a clean, identified branch/commit; preserve user changes.
2. State the issue ID, expected behavior, files in scope and explicit non-goals.
3. Inspect the existing API facade, command registration/gates, desktop reference and mobile caller before editing.
4. Make the smallest coherent change; do not combine unrelated feature work.
5. Run focused tests, then applicable full frontend/type/lint/Rust/Android checks.
6. Review the diff for unrelated edits, secrets, URL/package identity drift, unsafe permissions, untranslated literals and generated files.
7. Commit only after tests and diff review pass; record commit and CI run in this plan.
8. Keep physical-device checks distinct from emulator/unit results.
9. Never create a release tag or publish a release while any P0 is open.

## 5. Release acceptance checklist

- [ ] Selected candidate branch and commit agreed; v4.0.3 changes integrated intentionally.
- [ ] `main`/candidate version consistency and release version contract pass.
- [ ] New high-severity npm advisory fixed and dependency-assurance passes without unjustified allowlisting.
- [ ] Potential updater-key exposure assessed and decision documented; no unapproved rotation.
- [ ] Required signing secret names verified by an authorized maintainer; secret values never printed or committed.
- [ ] APK package ID matches intended existing install channel; upgrade continuity confirmed.
- [ ] Universal APK and AAB production-signed; certificate matches pinned SHA-256; AAB signature verified.
- [ ] Four ABI payloads and Android page-alignment checks pass.
- [ ] Manifest signature, public-key compatibility, SHA-256, URL allowlist and in-app update install path verified.
- [ ] Frontend tests/type-check/build/bundle, i18n, JNI, Rust tests/fmt/clippy, Android tests/emulators and all required CI gates pass on the exact candidate.
- [ ] Physical-device upload/download/protection/background/recovery/upgrade matrix completed and results recorded.
- [ ] Remaining unsupported features and known limitations documented.
- [ ] Final artifact names, sizes, SHA-256 digests, certificate fingerprint, package ID, version/versionCode and CI run links recorded.
- [ ] Release owner explicitly approves publication. Until then: **no tag and no public release**.

## 6. First execution order

1. Resolve the branch integration/version discrepancy (R-001) without publishing.
2. Fix the source-map-js advisory and rerun dependency assurance (R-002).
3. Conduct the updater-key exposure assessment (R-004) and verify signing configuration safely (R-003).
4. Verify the actual package ID and release artifact contracts (R-005/R-006).
5. Run the device transfer/recovery matrix (R-007), fixing failures in small batches.
6. Complete full CI release gates (R-008).
7. Start P1 feature batches in order: Vault → Sharing/Settings backup → Folder Sync → WebDAV/REST (after network-security decision) → Offline packs/Cleanup → Archive → remaining settings.
