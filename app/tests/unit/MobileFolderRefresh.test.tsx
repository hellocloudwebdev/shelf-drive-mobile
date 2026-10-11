import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MobileDashboard from '../../src/components/mobile/MobileDashboard';
import { fileQueryKey, type FolderLoadChunk, type FolderLoadResult } from '../../src/services/fileListRefresh';
import type { TelegramFile } from '../../src/types';
import '../../src/i18n';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), listen: vi.fn(), sync: vi.fn(),
  connection: { accountId: '100' as string | null, activeFolderId: 42 as number | null },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl: vi.fn(async () => () => {}) }));
vi.mock('../../src/hooks/usePlatform', () => ({
  usePlatform: () => ({ isMobile: true, isDesktop: false, isAndroid: false, isTelevision: false }),
  isMobilePreview: () => false,
}));
vi.mock('../../src/hooks/useTelegramConnection', () => ({ useTelegramConnection: () => ({
  ...mocks.connection, store: {}, folders: [{ id: 42, name: 'Folder' }], groups: [],
  isConnected: true, isSyncing: false, accountId: mocks.connection.accountId,
  handleLogout: vi.fn(), setActiveFolderId: vi.fn(), handleSyncFolders: mocks.sync,
  handleCreateFolder: vi.fn(), handleFolderDelete: vi.fn(), handleFolderRename: vi.fn(),
  handleFolderToggleVisibility: vi.fn(), handleExportFolderInvite: vi.fn(), handleCreateGroup: vi.fn(),
}) }));
vi.mock('../../src/context/SettingsContext', async () => {
  const { DEFAULT_SETTINGS } = await import('../../src/config/defaultSettings');
  return { useSettings: () => ({ settings: { ...DEFAULT_SETTINGS, driveTourSeen: true }, updateSetting: vi.fn(), updateSettings: vi.fn(), isLoaded: true }) };
});
vi.mock('../../src/context/ConfirmContext', () => ({ useConfirm: () => ({ confirm: vi.fn(async () => true), chooseDownloadCollision: vi.fn(async () => 'keep_both') }) }));
vi.mock('../../src/hooks/useFileUpload', () => ({ useFileUpload: () => ({
  uploadQueue: [], setUploadQueue: vi.fn(), handleManualUpload: vi.fn(), handleFolderUpload: vi.fn(),
  clearFinished: vi.fn(), cancelAll: vi.fn(), pauseAll: vi.fn(), resumeAll: vi.fn(),
  cancelItem: vi.fn(), retryItem: vi.fn(),
}) }));
vi.mock('../../src/hooks/useFileDownload', () => ({ useFileDownload: () => ({
  downloadQueue: [], queueDownload: vi.fn(), queueBulkDownload: vi.fn(), clearFinished: vi.fn(),
  cancelAll: vi.fn(), pauseAll: vi.fn(), resumeAll: vi.fn(), cancelItem: vi.fn(), retryItem: vi.fn(),
  pauseItem: vi.fn(), resumeItem: vi.fn(),
}) }));
vi.mock('../../src/hooks/useUpdateCheck', () => ({ useUpdateCheck: () => ({ available: false, status: 'idle' }) }));
vi.mock('../../src/hooks/useFileOperations', () => ({ useFileOperations: () => ({
  handleDelete: vi.fn(), handleBulkDelete: vi.fn(), handleBulkDownload: vi.fn(),
  handleBulkMove: vi.fn(), handleMoveFiles: vi.fn(), handleRenameFile: vi.fn(),
}) }));
vi.mock('../../src/hooks/useGlobalFileSearch', () => ({ useGlobalFileSearch: () => ({ results: [], isSearching: false }) }));
vi.mock('../../src/components/mobile/TouchFileList', () => ({ TouchFileList: (props: any) => <section aria-label="Files">
  <output data-testid="mobile-loading">{props.isLoading ? 'loading' : 'settled'}</output>
  {props.files.map((file: TelegramFile) => <div key={`${file.folder_id}:${file.id}`}><p>{file.name}</p>
    <button onClick={() => props.onKeepOffline(file)}>Keep {file.name} offline</button>
  </div>)}
</section> }));
vi.mock('../../src/components/mobile/MobileBottomNav', () => ({ MobileBottomNav: () => <nav />, MobileTab: {} }));
vi.mock('../../src/components/mobile/FloatingUploadButton', () => ({ FloatingUploadButton: () => null, TransferIndicator: () => null, UploadSheet: () => null }));
vi.mock('../../src/components/mobile/MobileUpdatePrompt', () => ({ MobileUpdatePrompt: () => null }));
vi.mock('../../src/components/mobile/ActionPopover', () => ({ ActionPopover: () => null, ActionItem: () => null }));
vi.mock('../../src/components/desktop/dashboard/ShareDialog', () => ({ ShareDialog: () => null }));
vi.mock('../../src/components/mobile/RenameFolderSheet', () => ({ RenameFolderSheet: () => null }));
vi.mock('../../src/components/mobile/FileActionSheet', () => ({ FileActionSheet: () => null }));
vi.mock('../../src/components/mobile/FileSheets', () => ({ RenameFileSheet: () => null, MoveFileSheet: () => null }));
vi.mock('../../src/components/mobile/PhotoGrid', () => ({ PhotoGrid: () => null, PhotoGridSkeleton: () => null }));
vi.mock('../../src/components/mobile/VideoRow', () => ({ VideoList: () => null, VideoListSkeleton: () => null }));
vi.mock('../../src/components/mobile/DocumentRow', () => ({ DocumentList: () => null, DocumentListSkeleton: () => null }));
vi.mock('../../src/components/mobile/SettingsSection', () => ({ SettingsSection: () => null, SettingsRow: () => null, SettingsToggleRow: () => null }));
vi.mock('../../src/components/mobile/ThemeSegmented', () => ({ ThemeSegmented: () => null }));
vi.mock('../../src/components/desktop/dashboard/DriveConceptTour', () => ({ DriveConceptTour: () => null }));
vi.mock('../../src/components/desktop/dashboard/BandwidthWidget', () => ({ BandwidthWidget: () => null }));
vi.mock('../../src/components/shared/LazyFeatureBoundary', () => ({ LazyFeatureBoundary: (props: any) => <>{props.children}</> }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const file = (id: number, name: string, folder_id: number | null = 42): TelegramFile => ({ id, folder_id, name, size: 1, sizeStr: '1 B' });
type Request = { ownerId: string; folderId: number | null; requestId: string };
type Scan = { request: Request; response: ReturnType<typeof deferred<FolderLoadResult>> };

describe('MobileDashboard refresh reconciliation', () => {
  let scans: Scan[];
  let handlers: Array<(event: { payload: FolderLoadChunk }) => void>;
  let client: QueryClient;
  let cacheRead: (request: Request) => Promise<TelegramFile[]>;
  const terminal = (scan: Scan, files: TelegramFile[], complete = true) => scan.response.resolve({ ...scan.request, complete, files });
  const emit = (scan: Scan, files: TelegramFile[]) => handlers.forEach(handler => handler({ payload: { ...scan.request, files } }));
  const mount = () => render(<QueryClientProvider client={client}><MobileDashboard /></QueryClientProvider>);
  const rerender = (view: ReturnType<typeof mount>) => view.rerender(<QueryClientProvider client={client}><MobileDashboard /></QueryClientProvider>);
  // The home tab also scans the root folder; only folder-42 scans are the
  // ones under test.
  const folderScans = () => scans.filter(scan => scan.request.folderId === 42);
  const open = async () => {
    mocks.connection.activeFolderId = 42;
    await act(async () => { rerender(view); });
    await waitFor(() => expect(folderScans()).toHaveLength(1));
    return folderScans()[0];
  };
  let view: ReturnType<typeof mount>;
  const names = () => [...screen.getByRole('region', { name: 'Files' }).querySelectorAll('p')].map(node => node.textContent);

  beforeEach(() => {
    scans = [];
    handlers = [];
    view = undefined as never;
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    mocks.connection = { accountId: '100', activeFolderId: null };
    mocks.sync.mockReset().mockResolvedValue(undefined);
    cacheRead = async request => request.ownerId === '100' ? [file(1, 'A.txt'), file(2, 'B.txt')] : [file(2, 'Other account.txt')];
    mocks.invoke.mockReset().mockImplementation((command: string, request: Request) => {
      if (command === 'cmd_get_cached_files') return cacheRead(request);
      if (command === 'cmd_get_files') { const response = deferred<FolderLoadResult>(); scans.push({ request, response }); return response.promise; }
      if (command === 'cmd_get_file_activity' || command === 'cmd_get_offline_files') return Promise.resolve([]);
      if (command === 'cmd_get_bandwidth') return Promise.resolve({ down: 0, up: 0 });
      return Promise.resolve(undefined);
    });
    mocks.listen.mockReset().mockImplementation(async (event: string, handler: (event: { payload: FolderLoadChunk }) => void) => {
      if (event === 'folder-load-chunk') handlers.push(handler);
      return vi.fn();
    });
    view = mount();
  });

  it('renders cached rows first, streams chunks progressively, and accepts the terminal snapshot', async () => {
    const scan = await open();
    // Cached rows appear before any chunk arrives.
    expect(names()).toEqual(['A.txt', 'B.txt']);
    // Chunks render progressively while the scan is still in flight.
    await act(async () => { emit(scan, [file(3, 'C.txt')]); });
    await waitFor(() => expect(names()).toEqual(['A.txt', 'B.txt', 'C.txt']));
    expect(screen.getByTestId('mobile-loading').textContent).toBe('settled');
    // The authoritative terminal snapshot prunes stale rows.
    await act(async () => terminal(scan, [file(2, 'B refreshed.txt'), file(3, 'C.txt')]));
    await waitFor(() => expect(names()).toEqual(['B refreshed.txt', 'C.txt']));
    expect(client.getQueryData<TelegramFile[]>(fileQueryKey('100', 42))?.map(f => f.id)).toEqual([2, 3]);
    // A late chunk from the finished request is ignored.
    act(() => emit(scan, [file(9, 'Late.txt')]));
    expect(names()).toEqual(['B refreshed.txt', 'C.txt']);
  });

  it('sends a request id and owner id so the backend can scope and cancel the scan', async () => {
    const scan = await open();
    expect(scan.request.requestId).toMatch(/^mobile-/);
    expect(scan.request.requestId.length).toBeGreaterThan('mobile-'.length);
    expect(scan.request.ownerId).toBe('100');
    expect(scan.request.folderId).toBe(42);
  });

  it('deduplicates rows that arrive in overlapping chunks', async () => {
    const scan = await open();
    await act(async () => {
      emit(scan, [file(3, 'C.txt'), file(4, 'D.txt')]);
      emit(scan, [file(3, 'C.txt'), file(5, 'E.txt')]);
    });
    await waitFor(() => expect(names()).toEqual(['A.txt', 'B.txt', 'C.txt', 'D.txt', 'E.txt']));
  });

  it('keeps cached rows when the scan returns an incomplete snapshot', async () => {
    const scan = await open();
    await act(async () => { emit(scan, [file(3, 'C.txt')]); });
    await act(async () => terminal(scan, [], false));
    await waitFor(() => expect(screen.getByTestId('mobile-loading').textContent).toBe('settled'));
    expect(names()).toEqual(['A.txt', 'B.txt', 'C.txt']);
  });

  it('keeps accumulated rows when the scan fails mid-stream', async () => {
    const scan = await open();
    await act(async () => { emit(scan, [file(3, 'C.txt')]); });
    await act(async () => scan.response.reject(new Error('offline')));
    await waitFor(() => expect(screen.getByTestId('mobile-loading').textContent).toBe('settled'));
    expect(names()).toEqual(['A.txt', 'B.txt', 'C.txt']);
  });

  it('rejects late chunks from a previous account after switching accounts', async () => {
    const first = await open();
    mocks.connection = { ...mocks.connection, accountId: '200', activeFolderId: 42 };
    rerender(view);
    await waitFor(() => expect(folderScans().some(scan => scan.request.ownerId === '200')).toBe(true));
    expect(names()).toEqual(['Other account.txt']);
    const second = folderScans().find(scan => scan.request.ownerId === '200')!;
    await act(async () => {
      emit(first, [file(7, 'Late first account.txt')]);
      terminal(first, [file(7, 'Late first account.txt')]);
    });
    expect(names()).toEqual(['Other account.txt']);
    await act(async () => terminal(second, [file(8, 'Second account.txt')]));
    await waitFor(() => expect(names()).toEqual(['Second account.txt']));
  });

  it('lets a newer refresh supersede an in-flight one without accepting its late chunks', async () => {
    const old = await open();
    // Force a refetch of the same key (simulates pull-to-refresh / invalidation).
    // Not awaited: the refetch's promise settles only when its own scan ends.
    await act(async () => { void client.invalidateQueries({ queryKey: fileQueryKey('100', 42) }); });
    await waitFor(() => expect(folderScans()).toHaveLength(2));
    expect(folderScans()[1].request.requestId).not.toBe(old.request.requestId);
    await act(async () => terminal(folderScans()[1], [file(5, 'Newest.txt')]));
    await waitFor(() => expect(names()).toEqual(['Newest.txt']));
    await act(async () => { emit(old, [file(1, 'Stale.txt')]); terminal(old, [file(1, 'Stale.txt')]); });
    expect(names()).toEqual(['Newest.txt']);
  });

  it('does not repopulate a query from late chunks after the dashboard unmounts', async () => {
    const scan = await open();
    await act(async () => terminal(scan, [file(5, 'Final.txt')]));
    await waitFor(() => expect(names()).toEqual(['Final.txt']));
    const snapshot = client.getQueryData(fileQueryKey('100', 42));
    expect(snapshot?.map(f => f.name)).toEqual(['Final.txt']);
    act(() => { view.unmount(); });
    await act(async () => { emit(scan, [file(9, 'After close.txt')]); terminal(scan, [file(9, 'After close.txt')]); });
    expect(client.getQueryData(fileQueryKey('100', 42))).toEqual(snapshot);
  });

  it('invalidates offline-keep actions through the canonical folder key so the folder refetches', async () => {
    const scan = await open();
    await act(async () => terminal(scan, [file(2, 'Doc.pdf')]));
    await waitFor(() => expect(names()).toEqual(['Doc.pdf']));
    fireEvent.click(screen.getByRole('button', { name: 'Keep Doc.pdf offline' }));
    // The canonical invalidation re-runs the folder query with a fresh request.
    await waitFor(() => expect(folderScans().length).toBeGreaterThanOrEqual(2));
    expect(mocks.invoke).toHaveBeenCalledWith('cmd_get_preview', expect.objectContaining({ messageId: 2, folderId: 42 }));
  });
});
