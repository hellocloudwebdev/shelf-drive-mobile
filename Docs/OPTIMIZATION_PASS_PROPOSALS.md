# Optimization Pass — Phase 3 Proposals (planning only)

Status: proposals with evidence gathered at `a2f22d69` + the optimization-pass branch (October 2026). None of the items below have been implemented in this pass. Every proposal lists the evidence it rests on and a suggested execution order; nothing here should be merged without its own verification plan.

## 1. Split `MobileDashboard.tsx` (~2,450 lines, 87 hook calls)

Evidence: `app/src/components/mobile/MobileDashboard.tsx` is the largest frontend file; it renders the home/folder/media/settings views plus the transfer and playback overlays in one component. Type-checking it was only re-enabled in this pass (it had been excluded from `tsconfig.json`).

Proposed decomposition (behavior-preserving, mechanical first):
- `mobile/screens/HomeScreen.tsx` — home sections, Continue Watching, Recent.
- `mobile/screens/FolderScreen.tsx` — browsing view + `TouchFileList` wiring.
- `mobile/screens/MediaScreens.tsx` — Photos/Videos/Documents tabs (they share the activity-query pattern).
- `mobile/screens/SettingsScreen.tsx` — the settings tab blocks.
- `mobile/navigation/*` — sidebar, bottom nav glue, deep-link handling.
- Keep every React Query key and the lazy boundaries exactly as they are; extract components downward, hooks stay where the queries live until a follow-up pass.

Constraints: `MobileDashboard.tsx` is a declared shared-core divergence (repo links), so the split is mobile-local; React Query keys are frozen (`['files', view, folderId, ownerId]`); the file-list refresh semantics (chunk merge + terminal snapshot) must not be touched.

Verification: `tsc --noEmit`, full vitest run, `build:verify` with byte-level chunk-size comparison, and the `MobileFolderRefresh` / `MobileFolderMutations` suites as the behavior latch.

## 2. Split `commands/fs.rs` (~7,000 lines) and extract streaming from `server.rs`

Evidence: `commands/fs.rs` is the upload/download core plus archive, URL-upload SSRF logic, and platform branches in one file; `server.rs` mixes the loopback HTTP server, range parsing, encrypted streaming, and HLS routing.

Proposed seams (public command surface unchanged, `cmd_*` names and registration frozen):
- `commands/fs/upload.rs`, `commands/fs/download.rs`, `commands/fs/archive.rs`, `commands/fs/remote_upload.rs` (the SSRF-guarded URL upload incl. `is_public_remote_ip` and its tests).
- `server/range.rs` (`parse_range_header` + tests — also the natural home for the HTTP 416 follow-up), `server/plain_stream.rs`, `server/encrypted_stream.rs`, `server/hls.rs`.
- No behavior changes in the same commits as the moves.

Verification: `cargo test --locked` (362+ tests), `cargo check --target aarch64-linux-android`, JNI contract check (command surface untouched), `deny.toml` graph unchanged.

## 3. Pagination / virtualization for Photos, Videos, Documents

Evidence: all three tabs call `listFileActivity(accountId, view, 250)` (`MobileDashboard.tsx` photos/videos/documents queries) and render the full list; the backend limit constant is the only cap. Before designing, inspect whether `cmd_get_file_activity` supports a cursor (the Rust side owns `file_activity` in `shares.db` — the SQL uses LIMIT without an offset/cursor today, so the work is backend + frontend).

Proposal: add a keyset cursor (`(activity_ts, message_id)`) to `cmd_get_file_activity` as a NEW command variant (e.g. `cmd_get_file_activity_page`) to keep the frozen command intact, land the backend first behind the existing facade pattern, then paginate the three tabs with a virtualized list (the codebase already virtualizes `TouchFileList` on TV).

Measurement gate: record `listFileActivity` row counts and render time on a populated account before/after (device measurement required — not doable on this workstation).

## 4. Memory budgets and startup deferral

Evidence: `imageCachePolicy.ts` already centralizes thumbnail/preview TTLs and caps; `server.rs` has an FFmpeg cache LRU; playback buffers are ExoPlayer defaults. What is missing is a single documented budget table and enforcement of a startup work budget.

Proposal (measure first, on device): capture RSS/PSS at startup and during media playback (Android Studio profiler or `dumpsys meminfo`), then set budgets: thumbnails (current cap × device tier), PDF preview pages, offline cache (`device_cache` limit already exists), HLS segment cache. Defer non-critical startup work (update check, crash-queue flush, sync engine start already async) behind first-frame; the frozen event/command contracts are unaffected.

## 5. Build variants and shared-core parity

- **arm64-only APK**: CI builds four ABIs (`android.yml` `--target aarch64 armv7 i686 x86_64`). A play-store/device-only arm64 variant would cut build time roughly in half and APK size ~40%. Propose adding an arm64-only *candidate* path while keeping the 4-ABI production build; needs a product decision about x86_64 emulators.
- **Mobile-only build flag**: the frontend ships desktop chunks to Android today (DesktopDashboard chunk 288,736 B is downloaded only when routed, but the route table and some desktop-only modules are in the graph). A Vite `define`/condition flag keyed on the mobile shell could drop desktop-only route components; needs careful work because `app/src` is shared-core — the flag must live in the shell entry, not in shared modules.
- **Shared-core parity checker**: `Docs/SHARED_CORE_SYNC.md` defines the shared paths but nothing verifies drift. Propose a CI job that, given a documented mechanism to read the desktop repo (a read-only deploy key secret + explicit allowlist of the shared paths from SHARED_CORE_SYNC.md), diffs `git diff <last-synced-sha>..HEAD -- <shared paths>` against the same diff in the desktop repo and fails on divergence. The mechanism for cross-repo read access needs an owner decision (deploy key vs. GitHub App), which is why this is a proposal.

## 6. Security and privacy review (findings only; defaults unchanged)

Verified during this pass, no action taken:
- Crash reporting: frontend queue flushed via `cmd_submit_crash_report`; consent is gated behind `DeferredCrashReportingConsent` (tests exist). `PRIVACY.md` describes the flow; no discrepancy found in code, but the supporter-terms gap documented in `ARCHITECTURE_FREEZE.md` (Deferred item 2) still stands.
- Webview filesystem: **fixed in this pass** — the blanket `$APPDATA/**`/`$APPCACHE/**` fs grant (which covered `telegram.session`, `shares.db`, `transfers.db`, `workspace.db`) was narrowed to the asset-protocol-mirroring read set and the write grant removed; the frontend imports zero `plugin-fs` APIs.
- Exported Android components / deep links: `AndroidManifest.xml` in `android-overrides` should get a dedicated pass (share receivers, `MainActivity` launchMode, deep-link intent filters) — not covered by automated tests today.
- Localhost streaming: stream tokens are 256-bit, 1 h TTL, owner+folder+message bound (regression tests exist); the server enforces loopback Host validation. Remaining device-level verification (notification metadata, lock screen, PiP behavior with the new owner-scoped media IDs) is listed as an outstanding device test in the final report.
- Temp-file cleanup: `temp_artifacts.rs` brokers deletable paths; a device pass verifying no plaintext residue after cancelled downloads remains outstanding.
- Sensitive logging: `PlaybackService` and the JNI commands do not log media IDs or owner IDs (verified by grep); a repo-wide log-lint pass (deny `log` calls containing owner/session material) is proposed but not implemented.
