/**
 * Canonical, account-scoped playback identity for the Android native player.
 *
 * History is persisted by `PlaybackService.kt` in a single app-wide
 * SharedPreferences entry keyed only by the media ID string. Two accounts can
 * hold the same folder/message numbers (Telegram message IDs are per-chat and
 * even per-account), so an ID like `folder:message` silently mixes resume
 * positions and Continue Watching across accounts. The canonical ID therefore
 * embeds the verified owner and a format version:
 *
 *   v2:{ownerId}:{folderId|saved}:{messageId}
 *
 * `saved` is the reserved sentinel for Saved Messages (folder ID null) so it
 * can never collide with a numeric channel folder ID.
 *
 * Entries without the `v2:` prefix are legacy app-wide history written by
 * earlier versions. They carry no owner, so they are never attributed to any
 * account: the parser returns null and the Kotlin side purges them on its
 * next history write.
 */

export const PLAYBACK_MEDIA_ID_VERSION = 'v2';
export const SAVED_MESSAGES_FOLDER_KEY = 'saved';

export interface ParsedPlaybackMediaId {
  ownerId: string;
  folderId: number | null;
  messageId: number;
}

export function buildPlaybackMediaId(ownerId: string, folderId: number | null, messageId: number): string {
  const owner = ownerId.trim();
  if (!owner) {
    throw new Error('PLAYBACK_OWNER_REQUIRED');
  }
  const folderPart = folderId === null ? SAVED_MESSAGES_FOLDER_KEY : String(folderId);
  return `${PLAYBACK_MEDIA_ID_VERSION}:${owner}:${folderPart}:${messageId}`;
}

export function parsePlaybackMediaId(mediaId: string): ParsedPlaybackMediaId | null {
  if (typeof mediaId !== 'string' || !mediaId) {
    return null;
  }
  const parts = mediaId.split(':');
  if (parts.length !== 4 || parts[0] !== PLAYBACK_MEDIA_ID_VERSION) {
    return null;
  }
  const [, ownerId, folderPart, messagePart] = parts;
  if (!ownerId) {
    return null;
  }
  const messageId = Number(messagePart);
  if (!Number.isSafeInteger(messageId) || messageId <= 0) {
    return null;
  }
  if (folderPart === SAVED_MESSAGES_FOLDER_KEY) {
    return { ownerId, folderId: null, messageId };
  }
  const folderId = Number(folderPart);
  if (!Number.isSafeInteger(folderId) || folderId <= 0) {
    return null;
  }
  return { ownerId, folderId, messageId };
}
