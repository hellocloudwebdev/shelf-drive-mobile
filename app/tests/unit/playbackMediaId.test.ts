import { describe, expect, it } from 'vitest';
import {
  buildPlaybackMediaId,
  parsePlaybackMediaId,
  PLAYBACK_MEDIA_ID_VERSION,
  SAVED_MESSAGES_FOLDER_KEY,
} from '../../src/services/playbackMediaId';

describe('canonical playback media IDs', () => {
  it('builds v2:{owner}:{folder}:{message} and round-trips through the parser', () => {
    const id = buildPlaybackMediaId('100', 42, 900);
    expect(id).toBe('v2:100:42:900');
    expect(parsePlaybackMediaId(id)).toEqual({ ownerId: '100', folderId: 42, messageId: 900 });
  });

  it('encodes Saved Messages as a reserved sentinel, distinct from any numeric folder', () => {
    const saved = buildPlaybackMediaId('100', null, 900);
    expect(saved).toBe('v2:100:saved:900');
    expect(parsePlaybackMediaId(saved)).toEqual({ ownerId: '100', folderId: null, messageId: 900 });
    // A channel whose number equals the sentinel text can never collide, and
    // Saved Messages never parses back as a numbered folder.
    expect(parsePlaybackMediaId('v2:100:900:900')).toEqual({ ownerId: '100', folderId: 900, messageId: 900 });
    expect(parsePlaybackMediaId('v2:100:saved:900')?.folderId).toBeNull();
    expect(SAVED_MESSAGES_FOLDER_KEY).toBe('saved');
  });

  it('keeps two accounts with identical folder and message numbers distinct', () => {
    const accountA = buildPlaybackMediaId('100', 42, 900);
    const accountB = buildPlaybackMediaId('200', 42, 900);
    expect(accountA).not.toBe(accountB);
    expect(parsePlaybackMediaId(accountB)?.ownerId).toBe('200');
  });

  it('refuses to build an ID without a verified owner', () => {
    expect(() => buildPlaybackMediaId('', 42, 900)).toThrow('PLAYBACK_OWNER_REQUIRED');
    expect(() => buildPlaybackMediaId('   ', null, 900)).toThrow('PLAYBACK_OWNER_REQUIRED');
  });

  it.each([
    ['42:900', 'legacy folder:message entries'],
    ['home:900', 'legacy home-prefixed entries'],
    ['v1:100:42:900', 'unknown format versions'],
    ['v2:100:42', 'wrong arity'],
    ['v2:100:42:900:7', 'extra segments'],
    ['v2::42:900', 'missing owner'],
    ['v2:100:folder:900', 'non-numeric folder'],
    ['v2:100:42:message', 'non-numeric message'],
    ['v2:100:42:0', 'non-positive message'],
    ['v2:100:-7:900', 'non-positive folder'],
    ['', 'empty strings'],
  ])('rejects %s (%s) so legacy or foreign rows are never attributed', mediaId => {
    expect(parsePlaybackMediaId(mediaId)).toBeNull();
  });

  it('exposes the current format version for cross-repo sync assertions', () => {
    expect(PLAYBACK_MEDIA_ID_VERSION).toBe('v2');
  });
});
