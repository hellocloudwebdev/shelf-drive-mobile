import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Store } from '@tauri-apps/plugin-store';
import { useFileDownload } from '../../src/hooks/useFileDownload';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), listen: vi.fn(), emit: vi.fn(), save: vi.fn(), open: vi.fn(),
  unlisten: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen, emit: mocks.emit }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open, save: mocks.save }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('../../src/context/SettingsContext', async () => {
  const { DEFAULT_SETTINGS } = await import('../../src/config/defaultSettings');
  return { useSettings: () => ({ settings: { ...DEFAULT_SETTINGS, maxConcurrentDownloads: 1, downloadWebdavTipSeen: true }, updateSetting: vi.fn() }) };
});
vi.mock('../../src/context/ConfirmContext', () => ({ useConfirm: () => ({ confirm: vi.fn(), chooseDownloadCollision: vi.fn(async () => 'keep_both') }) }));
vi.mock('../../src/utils', async () => ({
  isAndroidPlatform: true,
  pickWithFallback: async (pick: () => Promise<unknown>) => pick(),
  showFileDialogFallback: vi.fn(),
  sanitizeFilename: (await vi.importActual<typeof import('../../src/utils/files')>('../../src/utils/files')).sanitizeFilename,
  formatBytes: (size: number) => String(size),
}));
vi.mock('../../src/services/feedback', () => ({ triggerHaptic: vi.fn() }));
vi.mock('../../src/services/desktopTransferEngine', async () => ({
  ...(await vi.importActual('../../src/services/desktopTransferEngine')),
  listDesktopTransfers: vi.fn(async () => []), listenToDesktopTransfers: vi.fn(async () => () => {}),
  enqueueDesktopTransfers: vi.fn(async () => []), clearTerminalTransfers: vi.fn(async () => []),
  transferItemAction: vi.fn(), transferBulkAction: vi.fn(), supplyTransferPromptToken: vi.fn(async () => {}),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

const ENVIRONMENT = {
  connected: true, metered: false, roaming: false, charging: true, batteryLow: false,
  storageLow: false, freeBytes: 10 * 1024 ** 3, powerSaveMode: false, backgroundRestricted: false, isTelevision: false,
};

function makeStore() {
  return { get: vi.fn(async () => []), set: vi.fn(async () => {}), save: vi.fn(async () => {}) } as unknown as Store;
}

function routeInvoke() {
  mocks.invoke.mockImplementation((command: string) => {
    if (command === 'cmd_get_android_transfer_environment') return Promise.resolve(ENVIRONMENT);
    if (command === 'cmd_get_file_encryption_info') return Promise.resolve({ state: 'plain', protection_mode: 'standard' });
    if (command === 'cmd_download_file') return Promise.resolve(undefined);
    return Promise.resolve(undefined);
  });
}

async function enqueueOne(result: { current: ReturnType<typeof useFileDownload> }) {
  await act(async () => { await result.current.queueDownload(77, 'video.txt', 42, 10); });
}

function statusOf(result: { current: ReturnType<typeof useFileDownload> }) {
  return result.current.downloadQueue[0]?.status;
}

const downloadCallCount = () => mocks.invoke.mock.calls.filter(([command]) => command === 'cmd_download_file').length;

// Complements DownloadQueueRetries.test.tsx: these cases drive the budget
// through the network-reconnect flip (useNetworkStatus path) instead of the
// scheduled backoff flip, and cover pause/unmount cleanup of pending waits.
describe('Android download retry budgets via network reconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeInvoke();
    mocks.listen.mockImplementation(async () => mocks.unlisten);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('caps in-flight transient-network retries at three total attempts across reconnects', async () => {
    vi.useFakeTimers();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_get_android_transfer_environment') return Promise.resolve(ENVIRONMENT);
      if (command === 'cmd_get_file_encryption_info') return Promise.resolve({ state: 'plain', protection_mode: 'standard' });
      if (command === 'cmd_download_file') return Promise.reject(new Error('connection reset by peer'));
      return Promise.resolve(undefined);
    });
    const { result, rerender } = renderHook(({ online }) => useFileDownload(makeStore(), online, 'waiting', 'account-a'), { initialProps: { online: true } });
    await enqueueOne(result);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(statusOf(result)).toBe('waiting_for_network');

    // Each reconnect flips waiting_for_network back to pending and restarts
    // the transfer. Three attempts total (initial + two retries), then a
    // terminal error.
    for (let cycle = 0; cycle < 3; cycle += 1) {
      rerender({ online: false });
      rerender({ online: true });
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    }

    const downloadCalls = mocks.invoke.mock.calls.filter(([command]) => command === 'cmd_download_file').length;
    expect(downloadCalls).toBe(3);
    expect(statusOf(result)).toBe('error');

    // Exhaustion is terminal: further reconnects never re-attempt.
    rerender({ online: false });
    rerender({ online: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'cmd_download_file')).toHaveLength(3);
    expect(statusOf(result)).toBe('error');
  });

  it('clears pending pre-flight retry timers when the queue unmounts', async () => {
    vi.useFakeTimers();
    mocks.invoke.mockImplementation((command: string) => command === 'cmd_get_android_transfer_environment'
      ? Promise.reject(new Error('JNI bridge unavailable'))
      : Promise.resolve({ state: 'plain', protection_mode: 'standard' }));
    const { result, unmount } = renderHook(({ online }) => useFileDownload(makeStore(), online, 'waiting', 'account-a'), { initialProps: { online: true } });
    await enqueueOne(result);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
    const callsAtUnmount = mocks.invoke.mock.calls.filter(([command]) => command === 'cmd_get_android_transfer_environment').length;
    expect(callsAtUnmount).toBe(2);

    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });

    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'cmd_get_android_transfer_environment')).toHaveLength(callsAtUnmount);
  });

  it('recovers a transiently failing download when the network reconnects', async () => {
    vi.useFakeTimers();
    let downloadCalls = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_get_android_transfer_environment') return Promise.resolve(ENVIRONMENT);
      if (command === 'cmd_get_file_encryption_info') return Promise.resolve({ state: 'plain', protection_mode: 'standard' });
      if (command === 'cmd_download_file') {
        downloadCalls += 1;
        return downloadCalls === 1 ? Promise.reject(new Error('connection reset by peer')) : Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });
    const { result, rerender } = renderHook(({ online }) => useFileDownload(makeStore(), online, 'waiting', 'account-a'), { initialProps: { online: true } });
    await enqueueOne(result);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(statusOf(result)).toBe('waiting_for_network');

    rerender({ online: false });
    rerender({ online: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    expect(statusOf(result)).toBe('success');
  });

  it('does not restart a scheduled retry after pause-all', async () => {
    vi.useFakeTimers();
    mocks.invoke.mockImplementation((command: string) => command === 'cmd_get_android_transfer_environment'
      ? Promise.reject(new Error('JNI bridge unavailable'))
      : Promise.resolve({ state: 'plain', protection_mode: 'standard' }));
    const { result } = renderHook(({ online }) => useFileDownload(makeStore(), online, 'waiting', 'account-a'), { initialProps: { online: true } });
    await enqueueOne(result);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(statusOf(result)).toBe('waiting_for_network');
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'cmd_get_android_transfer_environment')).toHaveLength(1);

    act(() => { result.current.pauseAll(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });

    // The scheduled environment retry must not flip the paused queue back to
    // pending: no further environment reads, no start.
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'cmd_get_android_transfer_environment')).toHaveLength(1);
    expect(result.current.downloadQueue.map(item => item.status)).not.toContain('pending');
    expect(result.current.downloadQueue.map(item => item.status)).not.toContain('downloading');
  });

  it('holds a waiting download paused across a network reconnect after pause-all', async () => {
    vi.useFakeTimers();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_get_android_transfer_environment') return Promise.resolve(ENVIRONMENT);
      if (command === 'cmd_get_file_encryption_info') return Promise.resolve({ state: 'plain', protection_mode: 'standard' });
      if (command === 'cmd_download_file') return Promise.reject(new Error('connection reset by peer'));
      return Promise.resolve(undefined);
    });
    const { result, rerender } = renderHook(({ online }) => useFileDownload(makeStore(), online, 'waiting', 'account-a'), { initialProps: { online: true } });
    await enqueueOne(result);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(statusOf(result)).toBe('waiting_for_network');
    expect(downloadCallCount()).toBe(1);

    // Pause-all must pause a waiting item, not leave it for the next
    // reconnect to resurrect.
    act(() => { result.current.pauseAll(); });
    expect(statusOf(result)).toBe('paused');
    rerender({ online: false });
    rerender({ online: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(statusOf(result)).toBe('paused');
    expect(downloadCallCount()).toBe(1);

    // Only an explicit resume restarts the work (and the transient budget
    // restarts with it, because pause-all cleared it).
    act(() => { result.current.resumeAll(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(downloadCallCount()).toBe(2);
    expect(statusOf(result)).toBe('waiting_for_network');
  });
});
