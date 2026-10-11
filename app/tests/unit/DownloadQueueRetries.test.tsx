import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileDownload } from '../../src/hooks/useFileDownload';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  emit: vi.fn(),
  unlisten: vi.fn(),
  settings: {
    maxConcurrentUploads: 1,
    maxConcurrentDownloads: 1,
    encryptionDefaultMode: 'standard',
    encryptionProtectMetadata: true,
    videoUploadMode: 'file',
    downloadWebdavTipSeen: false,
    androidWifiOnlyTransfers: false,
    androidAllowRoaming: false,
    androidRequireCharging: false,
    androidPauseOnLowBattery: false,
    androidMinimumFreeStorageGb: 0.25,
  } as Record<string, unknown>,
  store: { get: vi.fn(async () => []), set: vi.fn(async () => {}), save: vi.fn(async () => {}) },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen, emit: mocks.emit }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));
vi.mock('../../src/context/SettingsContext', () => ({ useSettings: () => ({ settings: mocks.settings, updateSetting: vi.fn() }) }));
vi.mock('../../src/context/ConfirmContext', () => ({ useConfirm: () => ({ confirm: vi.fn(async () => true), chooseDownloadCollision: vi.fn(async () => 'keep_both') }) }));
vi.mock('../../src/utils', async () => ({
  isAndroidPlatform: true,
  pickWithFallback: async (pick: () => Promise<unknown>) => pick(),
  showFileDialogFallback: vi.fn(),
  sanitizeFilename: (await vi.importActual<typeof import('../../src/utils/files')>('../../src/utils/files')).sanitizeFilename,
  formatBytes: (size: number) => String(size),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));

const GIB = 1024 ** 3;
const environment = {
  connected: true, metered: false, roaming: false, charging: true, batteryLow: false,
  storageLow: false, freeBytes: 10 * GIB, powerSaveMode: false, backgroundRestricted: false,
  isTelevision: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const envCalls = () => mocks.invoke.mock.calls.filter(([command]) => command === 'cmd_get_android_transfer_environment').length;
const downloadCalls = () => mocks.invoke.mock.calls.filter(([command]) => command === 'cmd_download_file').length;
const cancelCalls = () => mocks.invoke.mock.calls.filter(([command]) => command === 'cmd_cancel_transfer').length;

const defaultInvoke = () => {
  mocks.invoke.mockImplementation((command: string) => {
    if (command === 'cmd_get_android_transfer_environment') return Promise.resolve(environment);
    if (command === 'cmd_get_file_encryption_info') return Promise.resolve({ state: 'plain', protection_mode: 'standard' });
    return Promise.resolve(undefined);
  });
};

const renderDownloads = () => renderHook(({ owner }) => useFileDownload(mocks.store as never, true, '', owner), { initialProps: { owner: 'account-a' } });

/** Flush microtask chains without advancing scheduled timers. */
const flush = async () => {
  for (let i = 0; i < 6; i++) {
    await act(async () => { await Promise.resolve(); });
  }
};
const advance = async (ms: number) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

describe('Android download queue reliability', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.listen.mockResolvedValue(mocks.unlisten);
    Object.assign(mocks.settings, { maxConcurrentDownloads: 1 });
    defaultInvoke();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits and retries with backoff when the transfer environment cannot be read, then fails terminally', async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_get_android_transfer_environment') return Promise.reject(new Error('jni not ready'));
      return Promise.resolve(undefined);
    });
    const { result } = renderDownloads();
    await flush();
    await act(async () => { await result.current.queueDownload(1, 'a.bin', null, 1000); });
    await flush();
    // First failure: waiting, with a scheduled retry — not stuck pending, not erroring.
    expect(result.current.downloadQueue[0]?.status).toBe('waiting_for_network');
    expect(envCalls()).toBe(1);
    await advance(2000);
    expect(result.current.downloadQueue[0]?.status).toBe('waiting_for_network');
    expect(envCalls()).toBe(2);
    await advance(4000);
    expect(result.current.downloadQueue[0]?.status).toBe('error');
    expect(result.current.downloadQueue[0]?.error).toContain('after 3 attempts');
    expect(envCalls()).toBe(3);
    expect(downloadCalls()).toBe(0);
  });

  it('recovers automatically when the environment read succeeds on a retry', async () => {
    let envAttempts = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_get_android_transfer_environment') {
        envAttempts++;
        return envAttempts === 1 ? Promise.reject(new Error('jni not ready')) : Promise.resolve(environment);
      }
      if (command === 'cmd_get_file_encryption_info') return Promise.resolve({ state: 'plain', protection_mode: 'standard' });
      return Promise.resolve(undefined);
    });
    const { result } = renderDownloads();
    await flush();
    await act(async () => { await result.current.queueDownload(1, 'a.bin', null, 1000); });
    await flush();
    expect(result.current.downloadQueue[0]?.status).toBe('waiting_for_network');
    await advance(2000);
    await advance(100);
    expect(result.current.downloadQueue[0]?.status).toBe('success');
    expect(downloadCalls()).toBe(1);
  });

  it('shares one in-flight environment read between concurrent starts', async () => {
    Object.assign(mocks.settings, { maxConcurrentDownloads: 2 });
    const pendingEnvironment = deferred<typeof environment>();
    let downloadStarted!: () => void;
    const download = deferred<void>();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_get_android_transfer_environment') return pendingEnvironment.promise;
      if (command === 'cmd_get_file_encryption_info') return Promise.resolve({ state: 'plain', protection_mode: 'standard' });
      if (command === 'cmd_download_file') { downloadStarted?.(); return download.promise; }
      return Promise.resolve(undefined);
    });
    const { result } = renderDownloads();
    await flush();
    await act(async () => {
      await result.current.queueBulkDownload([
        { id: 1, name: 'one.bin', folder_id: null, size: 10 },
        { id: 2, name: 'two.bin', folder_id: null, size: 10 },
      ] as never[], null);
    });
    await flush();
    expect(envCalls()).toBe(1);
    await act(async () => {
      pendingEnvironment.resolve(environment);
      await flush();
    });
    await flush();
    expect(downloadCalls()).toBe(2);
    await act(async () => { download.resolve(); });
    await flush();
    expect(result.current.downloadQueue.map(item => item.status)).toEqual(['success', 'success']);
  });

  it('aborts a start cancelled during the environment window and allows a manual retry', async () => {
    const pendingEnvironment = deferred<typeof environment>();
    const pendingDownload = deferred<void>();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_get_android_transfer_environment') return pendingEnvironment.promise;
      if (command === 'cmd_get_file_encryption_info') return Promise.resolve({ state: 'plain', protection_mode: 'standard' });
      if (command === 'cmd_download_file') return pendingDownload.promise;
      return Promise.resolve(undefined);
    });
    const { result } = renderDownloads();
    await flush();
    await act(async () => { await result.current.queueDownload(1, 'a.bin', null, 1000); });
    await flush();
    const id = result.current.downloadQueue[0].id;
    expect(result.current.downloadQueue[0].status).toBe('pending');
    act(() => { result.current.cancelItem(id); });
    await flush();
    expect(result.current.downloadQueue[0].status).toBe('cancelled');
    await act(async () => { pendingEnvironment.resolve(environment); });
    await flush();
    // The backend download must never start for the cancelled start.
    expect(downloadCalls()).toBe(0);
    // A manual retry resurrects the cancelled item.
    await act(async () => { await result.current.retryItem(id); });
    await flush();
    expect(result.current.downloadQueue[0].status).toBe('downloading');
    expect(downloadCalls()).toBe(1);
    await act(async () => { pendingDownload.resolve(); });
    await flush();
    expect(result.current.downloadQueue[0].status).toBe('success');
  });

  it('never starts the backend download after a cancellation during the metadata window', async () => {
    const pendingEncryption = deferred<{ state: string; protection_mode: string }>();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_get_android_transfer_environment') return Promise.resolve(environment);
      if (command === 'cmd_get_file_encryption_info') return pendingEncryption.promise;
      return Promise.resolve(undefined);
    });
    const { result } = renderDownloads();
    await flush();
    await act(async () => { await result.current.queueDownload(1, 'a.bin', null, 1000); });
    await flush();
    const id = result.current.downloadQueue[0].id;
    expect(result.current.downloadQueue[0].status).toBe('downloading');
    act(() => { result.current.cancelItem(id); });
    expect(result.current.downloadQueue[0].status).toBe('cancelled');
    expect(cancelCalls()).toBe(1);
    await act(async () => { pendingEncryption.resolve({ state: 'plain', protection_mode: 'standard' }); });
    await flush();
    expect(downloadCalls()).toBe(0);
  });

  it('retries transient transfer failures at most three times, then fails terminally', async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_get_android_transfer_environment') return Promise.resolve(environment);
      if (command === 'cmd_get_file_encryption_info') return Promise.resolve({ state: 'plain', protection_mode: 'standard' });
      if (command === 'cmd_download_file') return Promise.reject(new Error('Connection reset by peer'));
      return Promise.resolve(undefined);
    });
    const { result } = renderDownloads();
    await flush();
    await act(async () => { await result.current.queueDownload(1, 'a.bin', null, 1000); });
    await flush();
    expect(result.current.downloadQueue[0].status).toBe('waiting_for_network');
    expect(downloadCalls()).toBe(1);
    await advance(2000);
    expect(result.current.downloadQueue[0].status).toBe('waiting_for_network');
    expect(downloadCalls()).toBe(2);
    await advance(4000);
    expect(result.current.downloadQueue[0].status).toBe('error');
    expect(result.current.downloadQueue[0].error).toContain('after 3 attempts');
    expect(downloadCalls()).toBe(3);
  });

  it('grants a fresh set of automatic attempts after a manual retry', async () => {
    let downloadCallsMade = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_get_android_transfer_environment') return Promise.resolve(environment);
      if (command === 'cmd_get_file_encryption_info') return Promise.resolve({ state: 'plain', protection_mode: 'standard' });
      if (command === 'cmd_download_file') { downloadCallsMade++; return Promise.reject(new Error('Connection reset by peer')); }
      return Promise.resolve(undefined);
    });
    const { result } = renderDownloads();
    await flush();
    await act(async () => { await result.current.queueDownload(1, 'a.bin', null, 1000); });
    await flush();
    await advance(2000);
    await advance(4000);
    expect(result.current.downloadQueue[0].status).toBe('error');
    expect(downloadCallsMade).toBe(3);
    await act(async () => { await result.current.retryItem(result.current.downloadQueue[0].id); });
    await flush();
    // The first post-retry failure must be a retryable wait, not a terminal error.
    expect(result.current.downloadQueue[0].status).toBe('waiting_for_network');
    expect(downloadCallsMade).toBe(4);
    await advance(2000);
    await advance(4000);
    expect(result.current.downloadQueue[0].status).toBe('error');
    expect(downloadCallsMade).toBe(6);
  });

  it('runs one download at a time and frees the slot for the next item', async () => {
    const downloads = [deferred<void>(), deferred<void>()];
    let index = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_get_android_transfer_environment') return Promise.resolve(environment);
      if (command === 'cmd_get_file_encryption_info') return Promise.resolve({ state: 'plain', protection_mode: 'standard' });
      if (command === 'cmd_download_file') return downloads[index++]?.promise ?? Promise.resolve();
      return Promise.resolve(undefined);
    });
    const { result } = renderDownloads();
    await flush();
    await act(async () => {
      await result.current.queueBulkDownload([
        { id: 1, name: 'one.bin', folder_id: null, size: 10 },
        { id: 2, name: 'two.bin', folder_id: null, size: 10 },
      ] as never[], null);
    });
    await flush();
    expect(downloadCalls()).toBe(1);
    await act(async () => { downloads[0].resolve(); });
    await flush();
    expect(downloadCalls()).toBe(2);
    await act(async () => { downloads[1].resolve(); });
    await flush();
    expect(result.current.downloadQueue.map(item => item.status)).toEqual(['success', 'success']);
  });

  it('detaches the progress listener even when unmount wins the race', async () => {
    const lateListener = deferred<() => void>();
    mocks.listen.mockReturnValue(lateListener.promise);
    const { unmount } = renderDownloads();
    await flush();
    unmount();
    await act(async () => { lateListener.resolve(mocks.unlisten); });
    await flush();
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it('drops scheduled retries when the account changes', async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_get_android_transfer_environment') return Promise.reject(new Error('jni not ready'));
      return Promise.resolve(undefined);
    });
    const { result, rerender } = renderDownloads();
    await flush();
    await act(async () => { await result.current.queueDownload(1, 'a.bin', null, 1000); });
    await flush();
    expect(result.current.downloadQueue[0].status).toBe('waiting_for_network');
    expect(envCalls()).toBe(1);
    rerender({ owner: 'account-b' });
    await flush();
    await advance(10_000);
    // The scheduled retry for the previous account never fires.
    expect(envCalls()).toBe(1);
    expect(result.current.downloadQueue).toEqual([]);
  });

  it('keeps Telegram FLOOD_WAIT cooldown behavior intact', async () => {
    let downloadsMade = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_get_android_transfer_environment') return Promise.resolve(environment);
      if (command === 'cmd_get_file_encryption_info') return Promise.resolve({ state: 'plain', protection_mode: 'standard' });
      if (command === 'cmd_download_file') {
        downloadsMade++;
        return downloadsMade === 1 ? Promise.reject(new Error('FLOOD_WAIT_30')) : Promise.resolve();
      }
      return Promise.resolve(undefined);
    });
    const { result } = renderDownloads();
    await flush();
    await act(async () => { await result.current.queueDownload(1, 'a.bin', null, 1000); });
    await flush();
    expect(result.current.downloadQueue[0].status).toBe('cooldown');
    expect(mocks.emit).toHaveBeenCalledWith('telegram-cooldown', expect.objectContaining({ operation: 'Download', active: true }));
    await advance(30_000);
    await flush();
    expect(result.current.downloadQueue[0].status).toBe('success');
    expect(mocks.emit).toHaveBeenCalledWith('telegram-cooldown', expect.objectContaining({ operation: 'Download', active: false }));
  });

  describe('FLOOD_WAIT cooldown lifecycle', () => {
    const cooldownEndEmissions = () => mocks.emit.mock.calls.filter(([, payload]) => (payload as { active?: boolean })?.active === false);
    const queueFloodWaitedDownload = async (result: { current: ReturnType<typeof useFileDownload> }) => {
      mocks.invoke.mockImplementation((command: string) => {
        if (command === 'cmd_get_android_transfer_environment') return Promise.resolve(environment);
        if (command === 'cmd_get_file_encryption_info') return Promise.resolve({ state: 'plain', protection_mode: 'standard' });
        if (command === 'cmd_download_file') return Promise.reject(new Error('FLOOD_WAIT_30'));
        return Promise.resolve(undefined);
      });
      await act(async () => { await result.current.queueDownload(1, 'a.bin', null, 1000); });
      await flush();
      expect(result.current.downloadQueue[0]?.status).toBe('cooldown');
      expect(mocks.emit).toHaveBeenCalledWith('telegram-cooldown', expect.objectContaining({ operation: 'Download', active: true }));
      mocks.emit.mockClear();
    };

    it('retracts the cooldown flip when the item is cancelled during cooldown', async () => {
      const { result } = renderDownloads();
      await flush();
      await queueFloodWaitedDownload(result);
      const id = result.current.downloadQueue[0].id;
      act(() => { result.current.cancelItem(id); });
      await flush();
      expect(result.current.downloadQueue).toEqual([]);
      await advance(60_000);
      await flush();
      // The stale end-of-cooldown emission must not fire for a removed item.
      expect(cooldownEndEmissions()).toEqual([]);
    });

    it('retracts the cooldown flip when the item is paused during cooldown', async () => {
      const { result } = renderDownloads();
      await flush();
      await queueFloodWaitedDownload(result);
      const id = result.current.downloadQueue[0].id;
      act(() => { result.current.pauseItem(id); });
      await flush();
      expect(result.current.downloadQueue[0].status).toBe('paused');
      await advance(60_000);
      await flush();
      expect(cooldownEndEmissions()).toEqual([]);
      // The paused item must not be flipped back to pending by the timer.
      expect(result.current.downloadQueue[0].status).toBe('paused');
    });

    it('never fires the cooldown flip for a previous account after switching accounts', async () => {
      const { result, rerender } = renderDownloads();
      await flush();
      await queueFloodWaitedDownload(result);
      rerender({ owner: 'account-b' });
      await flush();
      await advance(60_000);
      await flush();
      expect(cooldownEndEmissions()).toEqual([]);
      expect(result.current.downloadQueue).toEqual([]);
    });

    it('does not fire the cooldown flip after unmount', async () => {
      const { result, unmount } = renderDownloads();
      await flush();
      await queueFloodWaitedDownload(result);
      unmount();
      await advance(60_000);
      await flush();
      expect(cooldownEndEmissions()).toEqual([]);
    });
  });

  it('cleans up scheduled retries on cancel-all', async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_get_android_transfer_environment') return Promise.reject(new Error('jni not ready'));
      return Promise.resolve(undefined);
    });
    const { result } = renderDownloads();
    await flush();
    await act(async () => {
      await result.current.queueDownload(1, 'a.bin', null, 1000);
      await result.current.queueDownload(2, 'b.bin', null, 1000);
    });
    await flush();
    expect(envCalls()).toBe(2);
    act(() => { result.current.cancelAll(); });
    await flush();
    await advance(10_000);
    expect(envCalls()).toBe(2);
    expect(result.current.downloadQueue).toEqual([]);
  });
});
