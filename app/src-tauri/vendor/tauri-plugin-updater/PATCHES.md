# Shelf Drive updater dependency patch

This directory contains the published `tauri-plugin-updater` 2.10.1 Rust source and build inputs, licensed Apache-2.0 OR MIT. Both upstream license texts are included. Unneeded JavaScript development files, imagery, and the upstream standalone lockfile are omitted; `api-iife.js`, generated permissions, and build inputs are retained.

Upstream provenance:

- Crate: https://crates.io/crates/tauri-plugin-updater/2.10.1
- Published crate checksum: `806d9dac662c2e4594ff03c647a552f2c9bd544e7d0f683ec58f872f952ce4af`
- Upstream commit: `d6a3898001a4bcc659e045f9501498751b77dbe6`, directory `plugins/updater` (also recorded in `.cargo_vcs_info.json`).
- `Cargo.toml.orig` remains an unmodified upstream reference; Cargo builds from the patched normalized `Cargo.toml`.

## Local changes

1. Change the Windows-only optional `zip` requirement from major version 4 to exact version `=9.0.4`, with DEFLATE support explicitly enabled so normal compressed installer archives remain supported.
2. Add Windows ZIP compatibility tests for DEFLATE extraction, parent-path confinement, and the existing `zip::result::ZipError` conversion. Installer bytes are synthetic and are never executed.
3. Register that test module only for Windows test builds with the `zip` feature enabled.
4. Raise the normalized manifest's declared minimum Rust version to 1.88, matching zip 9.0.4's published requirement. CI uses stable Rust.

The application uses `[patch.crates-io]` to select this source and pins its own direct `zip` dependency to the same version. The application lockfile is authoritative. No exception for RUSTSEC-2026-0367, RUSTSEC-2026-0368, or RUSTSEC-2026-0369 is allowed.

## Validation and removal

The dependency-assurance workflow runs the updater's library tests on Windows using the application's locked graph. A static guard rejects old ZIP versions, loss of the local patch, or an ignore for these three advisories. The existing RustSec policy remains blocking.

Remove this directory and the `[patch.crates-io]` override once a compatible upstream updater release requires a patched ZIP version. Update the application lockfile and rerun Windows updater tests, dependency assurance, and Android release builds before removal.
