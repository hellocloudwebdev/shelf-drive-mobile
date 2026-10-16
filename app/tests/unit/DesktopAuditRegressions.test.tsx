import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TelegramFile, TelegramFolder } from '../../src/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../src/context/SettingsContext', async () => {
  const { DEFAULT_SETTINGS } = await import('../../src/config/defaultSettings');
  return { useSettings: () => ({ settings: DEFAULT_SETTINGS, updateSetting: vi.fn(), updateSettings: vi.fn(), resetSettings: vi.fn() }) };
});
vi.mock('../../src/components/desktop/dashboard/SidebarItem', () => ({ SidebarItem: () => null }));
vi.mock('../../src/components/desktop/dashboard/BandwidthWidget', () => ({ BandwidthWidget: () => null }));
vi.mock('../../src/components/desktop/dashboard/CreateFolderDialog', () => ({ CreateFolderDialog: () => null }));
vi.mock('../../src/components/desktop/sync/SyncStatusBadge', () => ({ SyncStatusBadge: () => null }));

import { ContextMenu } from '../../src/components/desktop/dashboard/ContextMenu';
import { Sidebar } from '../../src/components/desktop/dashboard/Sidebar';
import { resolvePublicFolderUsername } from '../../src/components/desktop/dashboard/fileActionDescriptors';
import { preserveSelectedWorkspaceContext } from '../../src/components/workspace/WorkspaceHub';

const file = (overrides: Partial<TelegramFile> = {}): TelegramFile => ({
  id: 7,
  name: 'photo.jpg',
  type: 'document',
  size: 123,
  folder_id: null,
  ...overrides,
} as TelegramFile);

const sidebarProps = (onSmartViewChange: (view: import('../../src/types').SmartView | null) => void) => ({
  folders: [] as TelegramFolder[],
  groups: [],
  activeFolderId: 42,
  setActiveFolderId: vi.fn(),
  onDelete: vi.fn(),
  onRename: vi.fn(),
  onToggleVisibility: vi.fn(),
  onExportInvite: vi.fn(),
  onCreate: vi.fn().mockResolvedValue(undefined),
  isSyncing: false,
  isConnected: true,
  onSync: vi.fn(),
  onLogout: vi.fn(),
  bandwidth: null,
  onAssignFolderToGroup: vi.fn().mockResolvedValue(undefined),
  onCreateGroup: vi.fn().mockResolvedValue(undefined),
  onUpdateGroup: vi.fn().mockResolvedValue(undefined),
  onDeleteGroup: vi.fn().mockResolvedValue(undefined),
  onSmartViewChange,
});

describe('desktop audit regressions', () => {
  it('does not resolve explicit Saved Messages copy-link identity from the active channel', () => {
    const folders = [{ id: 42, username: 'active_channel' }] as TelegramFolder[];
    expect(resolvePublicFolderUsername(file({ folder_id: null }), folders, 42)).toBeNull();
    expect(resolvePublicFolderUsername(file({ folder_id: 42 }), folders, null)).toBe('active_channel');
    expect(resolvePublicFolderUsername(file({ folder_id: undefined }), folders, 42)).toBe('active_channel');
  });

  it.each([
    { isPinned: false, label: 'Pin' },
    { isPinned: true, label: 'Unpin' },
  ])('shows the state-aware $label action and invokes its callback', ({ isPinned, label }) => {
    const onTogglePinned = vi.fn();
    render(<ContextMenu x={0} y={0} file={file({ is_pinned: isPinned })} onClose={vi.fn()} onDownload={vi.fn()} onDelete={vi.fn()} onPreview={vi.fn()} onTogglePinned={onTogglePinned} />);
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(onTogglePinned).toHaveBeenCalledOnce();
  });

  it('offers the pinned sidebar route and dispatches navigation', () => {
    const onSmartViewChange = vi.fn();
    render(<Sidebar {...sidebarProps(onSmartViewChange)} />);
    fireEvent.click(screen.getByRole('button', { name: 'common.pinned' }));
    expect(onSmartViewChange).toHaveBeenCalledWith('pinned');
  });

  it('keeps a supplied timeline sequence and adds a selected filtered-out item', () => {
    const first = { key: 'first' };
    const selected = { key: 'selected' };
    const last = { key: 'last' };
    expect(preserveSelectedWorkspaceContext(selected, [first, last])).toEqual([first, last, selected]);
    expect(preserveSelectedWorkspaceContext(first, [first, last])).toEqual([first, last]);
  });

});
