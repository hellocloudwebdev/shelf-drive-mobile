/// Validate an ID before it is used to select or construct transfer state.
///
/// Kept in a common module because URL-upload commands run on mobile even
/// though the durable desktop transfer engine is not compiled there.
pub(crate) fn validate_transfer_id(id: &str) -> Result<(), String> {
    if id.trim().is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("Transfer ID is missing or invalid".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_transfer_id;

    #[test]
    fn rejects_path_syntax_in_transfer_ids() {
        for id in [
            "../outside",
            "nested/file",
            r"nested\file",
            ".",
            "C:outside",
        ] {
            assert!(
                validate_transfer_id(id).is_err(),
                "accepted unsafe ID: {id}"
            );
        }
        assert!(validate_transfer_id("upload-7c63_a1").is_ok());
    }
}
