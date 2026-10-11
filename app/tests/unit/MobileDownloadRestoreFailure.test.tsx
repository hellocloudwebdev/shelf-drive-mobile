import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Store } from '@tauri-apps/plugin-store';
import { useFileDownload } from '../../src/hooks/useFileDownload';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), listen: vi.fn(), emit: vi.fn(), save: vi.fn(), open: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen, emit: mocks.emit }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open, save: mocks.save }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('../../src/context/SettingsContext', async () => {
  const { DEFAULT_SETTINGS } = await import('../../src/config/defaultSettings');
  return { useSettings: () => ({ settings: { ...DEFAULT_SETTINGS, maxConcurrentDownloads: 1 }, updateSetting: vi.fn() }) };
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

// When the plugin-store read for the saved queue fails, the hook must not
// leave the scheduler gated off forever: every download enqueued afterwards
// would otherwise hang as 'pending' for the whole session. The queue must
// degrade to the designed unpersisted-work error state instead.
describe('Android download queue after a failed restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listen.mockImplementation(async () => vi.fn());
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_get_android_transfer_environment') return Promise.resolve(ENVIRONMENT);
      if (command === 'cmd_get_file_encryption_info') return Promise.resolve({ state: 'plain', protection_mode: 'standard' });
      return Promise.resolve(undefined);
    });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('errors newly enqueued downloads instead of leaving them pending forever', async () => {
    vi.useFakeTimers();
    const brokenStore = {
      get: vi.fn(async () => { throw new Error('store unreadable'); }),
      set: vi.fn(async () => { throw new Error('store unwritable'); }),
      save: vi.fn(async () => { throw new Error('store unwritable'); }),
    } as unknown as Store;
    const { result } = renderHook(({ online }) => useFileDownload(brokenStore, online, 'waiting', 'account-a'), { initialProps: { online: true } });

    await act(async () => { await result.current.queueDownload(77, 'video.txt', 42, 10); });

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });

    expect(result.current.downloadQueue[0]?.status).toBe('error');
    expect(result.current.downloadQueue[0]?.error).toContain('Could not save this download');
  });
});
