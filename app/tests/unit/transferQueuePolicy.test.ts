import { describe, expect, it } from 'vitest';
import {
  restoreDownloadQueue,
  restoreUploadQueue,
  hasCancellableTransfers,
  hasPauseableTransfers,
  hasResumableTransfers,
  isTransientNetworkError,
  serializeDownloadQueue,
  serializeUploadQueue,
} from '../../src/services/transferQueuePolicy';
import type { DownloadItem, QueueItem } from '../../src/types';

const upload = (status: QueueItem['status'], mode: 'standard' | 'passphrase' = 'standard'): QueueItem => ({
  id: status,
  path: `/tmp/${status}`,
  folderId: null,
  status,
  protection: { mode, promptToken: 42 },
});

const download = (status: DownloadItem['status']): DownloadItem => ({
  id: status,
  messageId: 1,
  filename: `${status}.bin`,
  folderId: null,
  status,
  promptToken: 42,
});

describe('upload queue persistence', () => {
  it('restores active items and requires passphrases again', () => {
    const restored = restoreUploadQueue([
      upload('uploading'),
      upload('paused'),
      upload('uploading', 'passphrase'),
      upload('success'),
    ]);
    expect(restored.map(item => item.status)).toEqual(['pending', 'paused', 'waiting_for_unlock']);
    expect(restored.every(item => item.protection?.promptToken === undefined)).toBe(true);
  });

  it('serializes only resumable work', () => {
    expect(serializeUploadQueue([upload('verifying'), upload('error')], true).map(item => item.status)).toEqual(['pending', 'error']);
  });

  it('keeps the existing desktop policy of dropping failed items', () => {
    expect(serializeUploadQueue([upload('error')])).toEqual([]);
  });

  it('keeps Android network waits recoverable across process recreation', () => {
    expect(restoreUploadQueue([upload('waiting_for_network')])[0].status).toBe('waiting_for_network');
  });
});

describe('download queue persistence', () => {
  it('normalizes in-flight work and removes prompt tokens', () => {
    const restored = restoreDownloadQueue([download('downloading'), download('paused'), download('waiting_for_unlock'), download('success')]);
    expect(restored.map(item => item.status)).toEqual(['pending', 'paused', 'waiting_for_unlock']);
    expect(restored.every(item => item.promptToken === undefined)).toBe(true);
  });

  it('keeps cooldown work resumable as pending', () => {
    expect(serializeDownloadQueue([download('cooldown')])[0].status).toBe('pending');
  });

  it('retains failed and network-waiting downloads for explicit or automatic retry', () => {
    expect(restoreDownloadQueue([download('error'), download('waiting_for_network')], true).map(item => item.status))
      .toEqual(['error', 'waiting_for_network']);
  });

  it('keeps the existing desktop policy of dropping failed downloads', () => {
    expect(restoreDownloadQueue([download('error')])).toEqual([]);
  });
});

describe('network failure classification', () => {
  it('recognizes transient transport failures without treating application errors as offline', () => {
    expect(isTransientNetworkError('TypeError: Failed to Fetch')).toBe(true);
    expect(isTransientNetworkError('connection reset by peer')).toBe(true);
    expect(isTransientNetworkError('DNS lookup failed: host unreachable')).toBe(true);
    expect(isTransientNetworkError('FILE_TOO_BIG')).toBe(false);
  });
});

describe('transfer action gating', () => {
  // The Android transfer notification is aggregate: its Pause action reaches
  // both the upload and the download queue. Each direction must therefore
  // announce only when it has work of its own, otherwise finishing an upload
  // produced a stale "Downloads paused" announcement.
  const statuses = (...values: string[]) => values.map(status => ({ status }));

  it('treats only in-flight and queued work as pauseable', () => {
    expect(hasPauseableTransfers(statuses('pending', 'uploading'))).toBe(true);
    expect(hasPauseableTransfers(statuses('waiting_for_network'))).toBe(true);
    expect(hasPauseableTransfers(statuses('success', 'cancelled', 'error', 'paused'))).toBe(false);
    expect(hasPauseableTransfers([])).toBe(false);
  });

  it('only resumes when something is actually paused', () => {
    expect(hasResumableTransfers(statuses('paused'))).toBe(true);
    expect(hasResumableTransfers(statuses('uploading', 'pending', 'success'))).toBe(false);
  });

  it('does not cancel when every item already finished', () => {
    expect(hasCancellableTransfers(statuses('success', 'cancelled'))).toBe(false);
    expect(hasCancellableTransfers(statuses('error'))).toBe(true);
    expect(hasCancellableTransfers(statuses('downloading'))).toBe(true);
    expect(hasCancellableTransfers([])).toBe(false);
  });

  it('stays silent for a download queue that only holds finished items while an upload runs', () => {
    const downloadsWhileUploading = statuses('success', 'cancelled');
    expect(hasPauseableTransfers(downloadsWhileUploading)).toBe(false);
    expect(hasResumableTransfers(downloadsWhileUploading)).toBe(false);
    expect(hasCancellableTransfers(downloadsWhileUploading)).toBe(false);
    // A failed item is still removable, so cancel must stay available for it.
    expect(hasCancellableTransfers(statuses('success', 'error'))).toBe(true);
  });
});