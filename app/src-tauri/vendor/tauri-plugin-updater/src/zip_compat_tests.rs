// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT
// Shelf Drive compatibility coverage for the local zip 9.0.4 dependency patch.

use std::io::Cursor;

#[test]
fn zip9_extracts_deflated_installer_bytes() {
    let directory = tempfile::tempdir().unwrap();
    let bytes = include_bytes!("../tests/fixtures/installer-deflate.zip");
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    archive.extract(directory.path()).unwrap();
    assert_eq!(
        std::fs::read(directory.path().join("shelf-test-setup.exe")).unwrap(),
        b"synthetic installer fixture; never execute\n"
    );
}

#[test]
fn zip9_does_not_write_parent_path_installer() {
    let root = tempfile::tempdir().unwrap();
    let destination = root.path().join("extracted");
    std::fs::create_dir(&destination).unwrap();
    let bytes = include_bytes!("../tests/fixtures/parent-path.zip");
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    // Rejection or a confined/sanitized path are both safe outcomes.
    let _ = archive.extract(&destination);
    assert!(!root.path().join("escaped-installer.exe").exists());
}

#[test]
fn zip9_error_converts_to_existing_updater_error() {
    let error = match zip::ZipArchive::new(Cursor::new(b"not a zip archive")) {
        Ok(_) => panic!("invalid archive was accepted"),
        Err(error) => error,
    };
    let error: crate::Error = error.into();
    assert!(matches!(error, crate::Error::Extract(_)));
}
