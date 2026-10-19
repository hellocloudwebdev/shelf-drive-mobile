# Telegram Drive Privacy Policy

Last updated: August 29, 2026

Telegram Drive is a local-first desktop and Android client. It does not operate a file-storage or Telegram account service and does not sell personal information. The optional supporter feature in supported desktop and Android builds uses a narrowly scoped verification service described below.

## Data stored on your device

Application settings, transfer queues, cached thumbnails and previews, local activity flags, and encrypted vault material are stored locally. Cache controls in Settings can remove cached media without deleting files stored in Telegram.

## Data sent to Telegram

Authentication and file operations connect directly to Telegram using credentials supplied by the user. Folders are represented by private Telegram channels. Telegram receives the messages and file bytes necessary to provide those operations, subject to Telegram's own terms and privacy policy.

The Telegram API hash is stored in the desktop operating-system credential manager or Android Keystore, separately from ordinary JSON settings. A legacy plaintext API hash is retained only until secure migration succeeds. The non-secret API ID and Telegram session database remain in the application's local data directory.

## Crash reporting

Crash reporting is enabled by default and can be disabled at any time in Settings; disabling it also clears queued reports. A report contains only the application version, operating-system platform, error type, timestamp, and sanitized function names. It excludes error messages, file names, paths, file contents, Telegram messages or identifiers, credentials, phone numbers, and user-entered values.

### Local app diagnostic logs

Shelf Drive also keeps a bounded, automatically rotated diagnostic history in its private app storage, independently of the optional remote crash-report preference. This structured history records only this app's technical events and sanitized crash frames, without file contents, credentials, or raw exception messages. The separate raw native traces described below are not sanitized and can contain sensitive process data. Neither collection reads system-wide logcat or other apps' logs.

On Android API level 31 and later, the app may also capture raw native exit traces for this app from Android's `ApplicationExitInfo` API, at startup on a background worker and when local diagnostics are read. The raw protobuf traces are stored in the app's `noBackupFilesDir` and are limited to at most 3 traces of 128 KiB each, with a 7-day retention period. Expired or excess traces are pruned when traces are captured or read. This is best-effort data: Android may not provide a trace, and available data may be absent. Traces are exported as base64 so binary protobuf bytes are preserved; base64 adds encoding overhead. The capture is bounded to 128 KiB plus one byte to detect oversized traces. If a trace exceeds 128 KiB, its exported data is truncated and explicitly marked incomplete. These are app-only traces; Shelf Drive does not collect system-wide traces or traces from other apps.

Settings offers **Review logs**, **Copy logs**, and **Save / Download logs**. Encoded native tombstones are unsanitized and may contain sensitive memory contents, paths, identifiers, or other data. Logs and traces remain local unless you explicitly copy or save them, or choose to include the exact reviewed snapshot in a report. Decode and inspect native traces before any public sharing; oversized traces are explicitly marked incomplete. Exports include the app's support snapshot and diagnostic history. Copying places the export on the device clipboard; saving creates a file outside private app storage. Diagnostic logs and native traces are not automatically uploaded.

**Report a crash** opens a preparation flow with log inclusion off by default. To include a log, first review it and explicitly consent for that report. The app copies the prepared report locally and opens the repository's GitHub issue composer without putting logs in the URL. You must paste, review, and submit the issue yourself; alternatively, save the log and attach the file manually in GitHub. No diagnostic attachment is silently uploaded and no public issue is created automatically. Submitted GitHub issues and their attachments may be public under GitHub's terms.

## Local sharing servers

WebDAV, REST, and password-protected local links are disabled until enabled by the user. They listen on the addresses shown in Settings and use capability tokens, API keys, or passwords. Disabling a server or regenerating its credential revokes that access. Guest or anonymous WebDAV connections receive no token-scoped file access.

## Supporter mode

Ad-free access on up to three supported Windows, macOS, Linux, or Android devices in total is activated only after the supporter service verifies one PayPal payment. Telegram Drive does not request or store the purchaser's PayPal email address. The service stores a PayPal order ID and capture ID, payment amount and currency, entitlement status, the accepted supporter-terms version, and cryptographic hashes/public keys used to enforce the shared device limit and refresh access. It does not receive Telegram credentials, phone numbers, file names, file contents, folder information, or application activity.

The device private key, recovery code, and short-lived checkout secret are protected by the platform's secure credential storage, including the desktop operating system credential manager or Android Keystore. A signed entitlement token and non-secret checkout metadata are stored in the application's local data directory. Normal application updates reuse these stable credentials and do not require reactivation.

PayPal processes the payment under PayPal's own terms and privacy policy. Cloudflare processes network requests needed to operate the verification service under Cloudflare's privacy and security terms. Telegram Drive does not add IP addresses or raw PayPal webhook payloads to its D1 entitlement records. Verified PayPal refund and reversal notifications revoke the associated ad-free entitlement. The supporter terms referenced by this policy are not included in this repository; confirm the current terms with the maintainer before paying.

## User control

Users can clear caches, disable crash reporting, stop local servers, revoke share links, lock the encryption vault, and remove local settings. Files stored in Telegram remain governed by the user's Telegram account until the user deletes them. Payment records that must be retained for fraud prevention, entitlement enforcement, refunds, disputes, accounting, or legal obligations are kept only as long as reasonably necessary for those purposes.

Security reports should not include credentials or private file data. Contact the maintainer through [cameronamer.com](https://www.cameronamer.com) to arrange private disclosure.
