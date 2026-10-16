import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Store } from '@tauri-apps/plugin-store';
import { useFileDownload } from '../../src/hooks/useFileDownload';
import { useFileUpload } from '../../src/hooks/useFileUpload';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  invalidate: vi.fn(),
  settings: {
    maxConcurrentUploads: 1,
    maxConcurrentDownloads: 1,
    encryptionDefaultMode: 'standard',
    encryptionProtectMetadata: true,
    videoUploadMode: 'file',
    downloadWebdavTipSeen: true,
  },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen, emit: vi.fn(async () => {}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('../../src/context/SettingsContext', () => ({
  useSettings: () => ({ settings: mocks.settings, updateSetting: vi.fn() }),
}));
vi.mock('../../src/context/UploadChoiceContext', () => ({ useUploadChoice: () => ({ chooseUploadProtection: vi.fn() }) }));
vi.mock('../../src/context/ConfirmContext', () => ({ useConfirm: () => ({ confirm: vi.fn(async () => true), chooseDownloadCollision: vi.fn(async () => 'keep_both') }) }));
vi.mock('../../src/utils', async () => ({
  isAndroidPlatform: true,
  pickWithFallback: async (pick: () => Promise<unknown>) => pick(),
  showFileDialogFallback: vi.fn(),
  sanitizeFilename: (await vi.importActual<typeof import('../../src/utils/files')>('../../src/utils/files')).sanitizeFilename,
  formatBytes: (size: number) => String(size),
}));
vi.mock('../../src/services/feedback', () => ({ triggerHaptic: vi.fn() }));
vi.mock('../../src/services/fileListRefresh', () => ({ invalidateFolderFileQueries: mocks.invalidate }));
vi.mock('../../src/services/desktopTransferEngine', () => ({
  clearTerminalTransfers: vi.fn(async () => []),
  configureDesktopTransferLimits: vi.fn(async () => {}),
  enqueueDesktopTransfers: vi.fn(async () => []),
  listenToDesktopTransfers: vi.fn(async () => () => {}),
  listDesktopTransfers: vi.fn(async () => []),
  supplyTransferPromptToken: vi.fn(async () => {}),
  transferBulkAction: vi.fn(async () => {}),
  transferItemAction: vi.fn(async () => {}),
  transferJobToUploadItem: vi.fn(),
  uploadItemToTransferRequest: vi.fn(),
  downloadItemToTransferRequest: vi.fn(),
  transferJobToDownloadItem: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

const environment = {
  connected: true,
  metered: false,
  roaming: false,
  charging: true,
  batteryLow: false,
  storageLow: false,
  freeBytes: 10 * 1024 ** 3,
  powerSaveMode: false,
  backgroundRestricted: false,
  isTelevision: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeStore() {
  return { get: vi.fn(async () => []), set: vi.fn(async () => {}), save: vi.fn(async () => {}) } as unknown as Store;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listen.mockReset().mockResolvedValue(() => {});
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.invoke.mockImplementation((command: string) => {
    if (command === 'cmd_get_android_transfer_environment') return Promise.resolve(environment);
    if (command === 'cmd_get_file_encryption_info') return Promise.resolve({ state: 'plain', protection_mode: 'standard' });
    return Promise.resolve(undefined);
  });
});

describe('late cancellation after successful backend completion', () => {
  it('unlistens Android progress subscriptions that resolve after hook unmount', async () => {
    const pending = new Map<string, (unlisten: () => void) => void>();
    mocks.listen.mockImplementation((event: string) => new Promise(resolve => {
      pending.set(event, resolve);
    }));
    const { unmount } = renderHook(() => useFileUpload(42, null, true, 'waiting', 'account-a'));
    await waitFor(() => expect(pending.size).toBe(2));

    unmount();
    const progressUnlisten = vi.fn();
    const remoteUnlisten = vi.fn();
    await act(async () => {
      pending.get('upload-progress')?.(progressUnlisten);
      pending.get('remote-upload-progress')?.(remoteUnlisten);
      await Promise.resolve();
    });

    expect(progressUnlisten).toHaveBeenCalledTimes(1);
    expect(remoteUnlisten).toHaveBeenCalledTimes(1);
  });

  it('marks an upload successful and invalidates file queries when cancel races with backend success', async () => {
    const backend = deferred<void>();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_upload_file') return backend.promise;
      if (command === 'cmd_get_android_transfer_environment') return Promise.resolve(environment);
      if (command === 'cmd_get_file_encryption_info') return Promise.resolve({ state: 'plain', protection_mode: 'standard' });
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useFileUpload(42, makeStore(), true, 'waiting', 'account-a'));
    await act(async () => {
      result.current.setUploadQueue([{
        id: 'upload-race', ownerId: 'account-a', path: '/tmp/example.txt', folderId: 42,
        status: 'pending', protection: { mode: 'standard', protectMetadata: true },
      }]);
    });

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('cmd_upload_file', expect.anything()));
    act(() => result.current.cancelItem('upload-race'));
    expect(result.current.uploadQueue[0]?.status).toBe('cancelled');

    await act(async () => { backend.resolve(undefined); await backend.promise; });
    await waitFor(() => expect(result.current.uploadQueue[0]?.status).toBe('success'));
    expect(result.current.uploadQueue[0]?.progress).toBe(100);
    expect(mocks.invalidate).toHaveBeenCalledWith(expect.anything(), 42, 'account-a');
  });

  it('marks a download successful and runs completion effects when cancel races with backend success', async () => {
    const backend = deferred<void>();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_download_file') return backend.promise;
      if (command === 'cmd_get_android_transfer_environment') return Promise.resolve(environment);
      if (command === 'cmd_get_file_encryption_info') return Promise.resolve({ state: 'plain', protection_mode: 'standard' });
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useFileDownload(makeStore(), true, 'waiting', 'account-a'));
    await act(async () => { await result.current.queueDownload(77, 'example.txt', 42, 10); });

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('cmd_download_file', expect.anything()));
    const downloadId = result.current.downloadQueue[0]?.id;
    expect(downloadId).toBeDefined();
    act(() => result.current.cancelItem(downloadId!));
    expect(result.current.downloadQueue[0]?.status).toBe('cancelled');

    await act(async () => { backend.resolve(undefined); await backend.promise; });
    await waitFor(() => expect(result.current.downloadQueue[0]?.status).toBe('success'));
    expect(result.current.downloadQueue[0]?.progress).toBe(100);
  });
});
