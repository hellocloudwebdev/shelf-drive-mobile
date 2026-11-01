import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MobileDashboard from '../../src/components/mobile/MobileDashboard';
import { fileQueryKey } from '../../src/services/fileListRefresh';
import type { TelegramFile } from '../../src/types';
import '../../src/i18n';

// Integration wiring proof: MobileDashboard mounts the REAL useFileOperations
// (the hook is not mocked here, unlike MobileFolderRefresh.test.tsx) and the
// mutation commands are asserted against the transport, so delete / rename /
// move / bulk flows are proven end to end through the dashboard, including
// account propagation, cross-folder source resolution and account-switch
// races. Cross-folder items reach the dashboard through the home Recent
// section (a channel file opened while browsing Saved Messages), mirroring
// how they appear in the real UI; a folder listing itself can only contain
// its own folder's files (the refresh service rejects anything else).

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  confirm: vi.fn(),
  queueBulkDownload: vi.fn(),
  connection: { accountId: '100' as string | null, activeFolderId: 42 as number | null },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('../../src/hooks/usePlatform', () => ({
  usePlatform: () => ({ isMobile: true, isDesktop: false, isAndroid: false, isTelevision: false }),
  isMobilePreview: () => false,
}));
vi.mock('../../src/hooks/useTelegramConnection', () => ({ useTelegramConnection: () => ({
  ...mocks.connection, store: {}, folders: [{ id: 42, name: 'Folder' }, { id: 7, name: 'Other' }], groups: [],
  isConnected: true, isSyncing: false, accountId: mocks.connection.accountId,
  handleLogout: vi.fn(), setActiveFolderId: vi.fn(), handleSyncFolders: vi.fn(),
  handleCreateFolder: vi.fn(), handleFolderDelete: vi.fn(), handleFolderRename: vi.fn(),
  handleFolderToggleVisibility: vi.fn(), handleExportFolderInvite: vi.fn(), handleCreateGroup: vi.fn(),
}) }));
vi.mock('../../src/context/SettingsContext', async () => {
  const { DEFAULT_SETTINGS } = await import('../../src/config/defaultSettings');
  return { useSettings: () => ({ settings: { ...DEFAULT_SETTINGS, driveTourSeen: true }, updateSetting: vi.fn(), updateSettings: vi.fn(), isLoaded: true }) };
});
vi.mock('../../src/context/ConfirmContext', () => ({ useConfirm: () => ({ confirm: mocks.confirm, chooseDownloadCollision: vi.fn(async () => 'keep_both') }) }));
vi.mock('../../src/hooks/useFileUpload', () => ({ useFileUpload: () => ({
  uploadQueue: [], setUploadQueue: vi.fn(), handleManualUpload: vi.fn(), handleFolderUpload: vi.fn(),
  clearFinished: vi.fn(), cancelAll: vi.fn(), pauseAll: vi.fn(), resumeAll: vi.fn(),
  cancelItem: vi.fn(), retryItem: vi.fn(),
}) }));
vi.mock('../../src/hooks/useFileDownload', () => ({ useFileDownload: () => ({
  downloadQueue: [], queueDownload: vi.fn(), queueBulkDownload: mocks.queueBulkDownload, clearFinished: vi.fn(),
  cancelAll: vi.fn(), pauseAll: vi.fn(), resumeAll: vi.fn(), cancelItem: vi.fn(), retryItem: vi.fn(),
  pauseItem: vi.fn(), resumeItem: vi.fn(),
}) }));
vi.mock('../../src/hooks/useUpdateCheck', () => ({ useUpdateCheck: () => ({ available: false, status: 'idle' }) }));
vi.mock('../../src/hooks/useGlobalFileSearch', () => ({ useGlobalFileSearch: () => ({ results: [], isSearching: false }) }));
// Leaf UI mocks that expose the exact real handler wiring as buttons.
vi.mock('../../src/components/mobile/TouchFileList', () => ({ TouchFileList: (props: any) => <section aria-label="Files">
  {props.files.map((file: TelegramFile) => <div key={`${file.folder_id}:${file.id}`}>
    <button onClick={() => props.onToggleSelection(file.id)}>Select {file.name}</button>
    <button onClick={() => props.onDelete(file)}>Delete {file.name}</button>
    <button onClick={() => props.onRename(file)}>Rename {file.name}</button>
  </div>)}
  <button onClick={() => props.onBulkMove(7)}>Move selected to 7</button>
  <button onClick={() => props.onBulkDelete()}>Bulk delete selected</button>
  <button onClick={() => props.onBulkDownload()}>Bulk download selected</button>
</section> }));
vi.mock('../../src/components/mobile/FileRow', () => ({ FileRow: (props: any) => <div>
  <span>{props.file.name}</span>
  <button onClick={() => props.onActions(props.file)}>Actions {props.file.name}</button>
</div>, FileRowSkeleton: () => null }));
vi.mock('../../src/components/mobile/FileActionSheet', () => ({ FileActionSheet: (props: any) => <section aria-label="File actions">
  <button onClick={() => props.onDelete(props.file)}>Sheet delete {props.file.name}</button>
  <button onClick={() => props.onKeepOffline(props.file)}>Sheet keep {props.file.name} offline</button>
  <button onClick={() => props.onDownload(props.file)}>Sheet download {props.file.name}</button>
</section> }));
vi.mock('../../src/components/mobile/MobileBottomNav', () => ({ MobileBottomNav: () => <nav />, MobileTab: {} }));
vi.mock('../../src/components/mobile/FloatingUploadButton', () => ({ FloatingUploadButton: () => null, TransferIndicator: () => null, UploadSheet: () => null }));
vi.mock('../../src/components/mobile/MobileUpdatePrompt', () => ({ MobileUpdatePrompt: () => null }));
vi.mock('../../src/components/mobile/ActionPopover', () => ({ ActionPopover: () => null, ActionItem: () => null }));
vi.mock('../../src/components/desktop/dashboard/ShareDialog', () => ({ ShareDialog: () => null }));
vi.mock('../../src/components/mobile/RenameFolderSheet', () => ({ RenameFolderSheet: () => null }));
vi.mock('../../src/components/mobile/FileSheets', () => ({
  RenameFileSheet: (props: any) => <button onClick={() => void props.onRename(props.file, 'renamed.txt')}>Confirm rename {props.file.name}</button>,
  MoveFileSheet: () => null,
}));
vi.mock('../../src/components/mobile/PhotoGrid', () => ({ PhotoGrid: () => null, PhotoGridSkeleton: () => null }));
vi.mock('../../src/components/mobile/VideoRow', () => ({ VideoList: () => null, VideoListSkeleton: () => null }));
vi.mock('../../src/components/mobile/DocumentRow', () => ({ DocumentList: () => null, DocumentListSkeleton: () => null }));
vi.mock('../../src/components/mobile/SettingsSection', () => ({ SettingsSection: () => null, SettingsRow: () => null, SettingsToggleRow: () => null }));
vi.mock('../../src/components/mobile/ThemeSegmented', () => ({ ThemeSegmented: () => null }));
vi.mock('../../src/components/desktop/dashboard/DriveConceptTour', () => ({ DriveConceptTour: () => null }));
vi.mock('../../src/components/desktop/dashboard/BandwidthWidget', () => ({ BandwidthWidget: () => null }));
vi.mock('../../src/components/shared/LazyFeatureBoundary', () => ({ LazyFeatureBoundary: (props: any) => <>{props.children}</> }));
vi.mock('../../src/components/shared/PdfViewer', () => ({ PdfViewer: () => null }));
vi.mock('../../src/components/shared/PreviewModal', () => ({ PreviewModal: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

const file = (id: number, name: string, folder_id: number | null = 42): TelegramFile => ({ id, folder_id, name, size: 1, sizeStr: '1 B' });

describe('MobileDashboard file mutations through the real useFileOperations hook', () => {
  let client: QueryClient;
  let view: ReturnType<typeof render>;
  const renderDashboard = () => render(<QueryClientProvider client={client}><MobileDashboard /></QueryClientProvider>);
  const rerenderDashboard = () => view.rerender(<QueryClientProvider client={client}><MobileDashboard /></QueryClientProvider>);

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 300_000 } } });
    mocks.connection = { accountId: '100', activeFolderId: null };
    mocks.confirm.mockReset().mockResolvedValue(true);
    mocks.queueBulkDownload.mockReset();
    mocks.invoke.mockReset().mockImplementation((command: string, request: { ownerId?: string; folderId?: number | null; requestId?: string; view?: string }) => {
      if (command === 'cmd_get_files') {
        // A folder listing may only contain its own folder's files.
        return Promise.resolve({
          requestId: request.requestId ?? '',
          ownerId: request.ownerId ?? '',
          folderId: request.folderId ?? null,
          complete: true,
          files: [file(1, 'A.txt'), file(2, 'B.txt'), file(3, 'C.txt')],
        });
      }
      if (command === 'cmd_get_file_activity') {
        // Recent activity crosses folders: a channel file surfaced while the
        // user browses Saved Messages (root).
        return request.view === 'recents' ? Promise.resolve([file(9, 'Shared video.mp4', 7)]) : Promise.resolve([]);
      }
      if (command === 'cmd_get_offline_files') return Promise.resolve([]);
      if (command === 'cmd_get_bandwidth') return Promise.resolve({ down: 0, up: 0 });
      return Promise.resolve([]);
    });
    mocks.listen.mockReset().mockResolvedValue(vi.fn());
    view = renderDashboard();
  });

  // Mount at home, then open folder 42 through the connection mock — the same
  // pattern MobileFolderRefresh uses to reach the browsing view.
  const openFolder = async () => {
    mocks.connection = { ...mocks.connection, activeFolderId: 42 };
    await act(async () => { rerenderDashboard(); });
    await screen.findByRole('button', { name: 'Delete A.txt' });
  };

  function invokeCalls(command: string) {
    return mocks.invoke.mock.calls.filter(([name]) => name === command).map(([, payload]) => payload);
  }

  it('deletes a file in the open folder with the verified owner and source folder', async () => {
    await openFolder();
    fireEvent.click(screen.getByRole('button', { name: 'Delete A.txt' }));
    await waitFor(() => expect(invokeCalls('cmd_delete_file')).toEqual([
      { ownerId: '100', messageId: 1, folderId: 42 },
    ]));
  });

  it('resolves a cross-folder Recent item to its own source folder when deleting', async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Actions Shared video.mp4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sheet delete Shared video.mp4' }));
    await waitFor(() => expect(invokeCalls('cmd_delete_file')).toEqual([
      { ownerId: '100', messageId: 9, folderId: 7 },
    ]));
  });

  it('renames through the sheet callback with the owner and source folder', async () => {
    await openFolder();
    fireEvent.click(screen.getByRole('button', { name: 'Rename A.txt' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm rename A.txt' }));
    await waitFor(() => expect(invokeCalls('cmd_rename_file')).toEqual([
      { ownerId: '100', messageId: 1, folderId: 42, newName: 'renamed.txt' },
    ]));
  });

  it('moves the selected file with a single source folder and distinct target', async () => {
    await openFolder();
    fireEvent.click(screen.getByRole('button', { name: 'Select A.txt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move selected to 7' }));
    await waitFor(() => expect(invokeCalls('cmd_move_files')).toEqual([
      { ownerId: '100', messageIds: [1], sourceFolderId: 42, targetFolderId: 7 },
    ]));
  });

  it('bulk-deletes the selected folder items in one pass', async () => {
    await openFolder();
    fireEvent.click(screen.getByRole('button', { name: 'Select A.txt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select B.txt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bulk delete selected' }));
    await waitFor(() => expect(invokeCalls('cmd_delete_file')).toHaveLength(2));
    expect(invokeCalls('cmd_delete_file')).toEqual([
      { ownerId: '100', messageId: 1, folderId: 42 },
      { ownerId: '100', messageId: 2, folderId: 42 },
    ]);
  });

  it('bulk-downloads the selected files into the dashboard download queue with the browsing folder', async () => {
    await openFolder();
    fireEvent.click(screen.getByRole('button', { name: 'Select A.txt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select C.txt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bulk download selected' }));
    await waitFor(() => expect(mocks.queueBulkDownload).toHaveBeenCalledTimes(1));
    // Rows arrive normalized by the file-list service.
    const normalized = (file: TelegramFile) => ({ ...file, sizeStr: '1 Bytes', type: 'file' });
    expect(mocks.queueBulkDownload).toHaveBeenCalledWith([normalized(file(1, 'A.txt')), normalized(file(3, 'C.txt'))], 42);
  });

  it('keeps a cross-folder Recent item offline at its own source', async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Actions Shared video.mp4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sheet keep Shared video.mp4 offline' }));
    await waitFor(() => expect(invokeCalls('cmd_get_preview')).toEqual([
      { messageId: 9, folderId: 7 },
    ]));
  });

  it('drops a pending delete when the account switches mid-operation', async () => {
    await openFolder();
    const request = deferred<void>();
    mocks.invoke.mockImplementation((command: string, req: any) => {
      if (command === 'cmd_delete_file') return request.promise;
      if (command === 'cmd_get_files') {
        return Promise.resolve({ requestId: req.requestId ?? '', ownerId: req.ownerId ?? '', folderId: req.folderId ?? null, complete: true, files: [file(1, 'A.txt')] });
      }
      return Promise.resolve([]);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete A.txt' }));
    await waitFor(() => expect(invokeCalls('cmd_delete_file')).toEqual([{ ownerId: '100', messageId: 1, folderId: 42 }]));

    const bCache = fileQueryKey('200', 42);
    client.setQueryData(bCache, [file(1, 'A.txt', 42)]);
    mocks.connection = { ...mocks.connection, accountId: '200' };
    await act(async () => { rerenderDashboard(); });
    await act(async () => { request.resolve(); });
    await act(async () => { rerenderDashboard(); });
    // The delete fired exactly once, under account A. Resolving it late must
    // not replay it under account B, and account B's same-numbered row
    // survives (the optimistic removal is scoped to account A's queries).
    expect(invokeCalls('cmd_delete_file')).toHaveLength(1);
    expect(invokeCalls('cmd_delete_file')).toEqual([{ ownerId: '100', messageId: 1, folderId: 42 }]);
    const bRows = client.getQueryData<TelegramFile[]>(bCache) ?? [];
    expect(bRows.some(row => row.id === 1)).toBe(true);
  });

  it('does not reinterpret a same-numbered message from another account’s cache', async () => {
    await openFolder();
    const bKey = fileQueryKey('200', 42);
    client.setQueryData(bKey, [{ ...file(1, 'A.txt', 42), sizeStr: '1 Bytes', type: 'file' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete A.txt' }));
    await waitFor(() => expect(invokeCalls('cmd_delete_file')).toHaveLength(1));
    // Account B's cached row for the same message number in the same folder
    // number is untouched by account A's delete.
    expect(client.getQueryData(bKey)).toEqual([{ ...file(1, 'A.txt', 42), sizeStr: '1 Bytes', type: 'file' }]);
    expect(client.getQueryState(bKey)?.isInvalidated).toBe(false);
  });
});
