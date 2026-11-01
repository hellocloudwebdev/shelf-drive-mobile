import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MobileDashboard from '../../src/components/mobile/MobileDashboard';
import type { FolderLoadResult } from '../../src/services/fileListRefresh';
import type { AndroidPlaybackHistoryEntry } from '../../src/api/index';
import '../../src/i18n';

// Continue Watching reads one app-wide SharedPreferences history through the
// JNI bridge, so every row must be filtered to the verified account and the
// canonical `v2:{owner}:{folder|saved}:{message}` ID before it can be shown.

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  connection: { accountId: '100' as string | null, activeFolderId: 42 as number | null },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl: vi.fn(async () => () => {}) }));
vi.mock('../../src/hooks/usePlatform', () => ({
  usePlatform: () => ({ isMobile: true, isDesktop: false, isAndroid: true, isTelevision: false }),
  isMobilePreview: () => false,
}));
vi.mock('../../src/hooks/useTelegramConnection', () => ({ useTelegramConnection: () => ({
  ...mocks.connection, store: {}, folders: [{ id: 42, name: 'Folder' }], groups: [],
  isConnected: true, isSyncing: false, accountId: mocks.connection.accountId,
  handleLogout: vi.fn(), setActiveFolderId: vi.fn(), handleSyncFolders: vi.fn(),
  handleCreateFolder: vi.fn(), handleFolderDelete: vi.fn(), handleFolderRename: vi.fn(),
  handleFolderToggleVisibility: vi.fn(), handleExportFolderInvite: vi.fn(), handleCreateGroup: vi.fn(),
}) }));
vi.mock('../../src/context/SettingsContext', async () => {
  const { DEFAULT_SETTINGS } = await import('../../src/config/defaultSettings');
  // Private metadata off so rows show the persisted entry title, letting the
  // assertions distinguish which account's history row was matched even when
  // both accounts play the same-numbered message (same file name).
  return { useSettings: () => ({ settings: { ...DEFAULT_SETTINGS, driveTourSeen: true, androidPrivateMediaMetadata: false }, updateSetting: vi.fn(), updateSettings: vi.fn(), isLoaded: true }) };
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
vi.mock('../../src/components/mobile/TouchFileList', () => ({ TouchFileList: () => <section aria-label="Files" /> }));
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
vi.mock('../../src/components/shared/PdfViewer', () => ({ PdfViewer: () => null }));
vi.mock('../../src/components/shared/PreviewModal', () => ({ PreviewModal: () => null }));

const entry = (mediaId: string, positionMs: number, overrides: Partial<AndroidPlaybackHistoryEntry> = {}): AndroidPlaybackHistoryEntry => ({
  mediaId,
  title: 'Media',
  positionMs,
  durationMs: 600_000,
  completed: false,
  lastPlayedAt: 1,
  ...overrides,
});

class DebugErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: unknown) { console.error('DASHBOARD_CRASH:', error, info); }
  render() { return this.state.error ? null : this.props.children; }
}

describe('Continue Watching account isolation', () => {
  let client: QueryClient;
  const renderDashboard = () => render(<QueryClientProvider client={client}><DebugErrorBoundary><MobileDashboard /></DebugErrorBoundary></QueryClientProvider>);
  const rerenderDashboard = (view: ReturnType<typeof renderDashboard>) => view.rerender(<QueryClientProvider client={client}><MobileDashboard /></QueryClientProvider>);
  let view: ReturnType<typeof renderDashboard>;

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    mocks.connection = { accountId: '100', activeFolderId: 42 };
    mocks.invoke.mockReset().mockImplementation((command: string, request: { ownerId?: string; folderId?: number | null }) => {
      if (command === 'cmd_get_android_playback_history') {
        return Promise.resolve<AndroidPlaybackHistoryEntry[]>([
          // Account A (current): mid-progress in the open folder.
          entry('v2:100:42:900', 120_000, { title: 'A clip' }),
          // Account B: identical folder/message numbers, different account.
          entry('v2:200:42:900', 240_000, { title: 'B clip' }),
          // Legacy app-wide row for the same numbers: owner unknown.
          entry('42:900', 300_000, { title: 'Legacy clip' }),
          // Account A, but Saved Messages while a channel folder is open.
          entry('v2:100:saved:900', 90_000, { title: 'Saved clip' }),
          // Account A, finished: must not resurface.
          entry('v2:100:42:901', 10_000, { title: 'Finished clip', completed: true }),
          // Account A, below the 10s watch floor.
          entry('v2:100:42:902', 5_000, { title: 'Skimmed clip' }),
        ]);
      }
      if (command === 'cmd_get_files') {
        return Promise.resolve<FolderLoadResult>({
          requestId: (request as { requestId: string }).requestId,
          ownerId: (request as { ownerId?: string }).ownerId ?? '',
          folderId: (request as { folderId?: number | null }).folderId ?? null,
          complete: true,
          files: [
            { id: 900, folder_id: 42, name: 'A clip.mp4', size: 1, sizeStr: '1 B' },
            { id: 901, folder_id: 42, name: 'Finished clip.mp4', size: 1, sizeStr: '1 B' },
            { id: 902, folder_id: 42, name: 'Skimmed clip.mp4', size: 1, sizeStr: '1 B' },
          ],
        });
      }
      if (command === 'cmd_get_cached_files') return Promise.resolve([]);
      if (command === 'cmd_list_cached_files') return Promise.resolve([]);
      if (command === 'cmd_get_file_activity' || command === 'cmd_get_offline_files') return Promise.resolve([]);
      if (command === 'cmd_get_android_transfer_environment') {
        return Promise.resolve({ connected: true, wifi: false, metered: false, roaming: false, charging: false, battery_low: false, storage_low: false, free_bytes: 0 });
      }
      if (command === 'cmd_get_bandwidth') return Promise.resolve({ down: 0, up: 0 });
      return Promise.resolve([]);
    });
    mocks.listen.mockReset().mockResolvedValue(vi.fn());
    view = renderDashboard();
  });

  const continueTitles = () => [...screen.queryByRole('region', { name: /continue watching/i })?.querySelectorAll('button span.truncate, button span[class*="truncate"]') ?? []]
    .map(node => node.textContent);

  it('shows only the signed-in account rows for the open folder', async () => {
    await waitFor(() => expect(screen.getByRole('region', { name: /continue watching/i })).toBeTruthy());
    const titles = continueTitles();
    // Private metadata is off, so rows show the persisted entry title — and
    // exactly one row: the current account's folder entry.
    expect(titles).toEqual(['A clip']);
    expect(titles).not.toContain('B clip');
    expect(titles).not.toContain('Legacy clip');
    expect(titles).not.toContain('Saved clip');
    expect(titles).not.toContain('Finished clip');
    expect(titles).not.toContain('Skimmed clip');
  });

  it('never shows the previous account after switching accounts mid-session', async () => {
    await waitFor(() => expect(screen.getByRole('region', { name: /continue watching/i })).toBeTruthy());
    mocks.connection = { ...mocks.connection, accountId: '200' };
    await act(async () => { rerenderDashboard(view); });
    await waitFor(() => expect(continueTitles()).toEqual(['B clip']));
    expect(continueTitles()).not.toContain('A clip');
    expect(continueTitles()).not.toContain('Legacy clip');
  });

  it('shows nothing without a verified account', async () => {
    await waitFor(() => expect(screen.getByRole('region', { name: /continue watching/i })).toBeTruthy());
    mocks.connection = { ...mocks.connection, accountId: null };
    await act(async () => { rerenderDashboard(view); });
    await waitFor(() => expect(screen.queryByRole('region', { name: /continue watching/i })).toBeNull());
  });
});
