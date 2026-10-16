import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSettings } from '../../src/context/SettingsContext';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, setMock, saveMock, loadMock, migrateMock, clearMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  setMock: vi.fn(),
  saveMock: vi.fn(),
  loadMock: vi.fn(),
  migrateMock: vi.fn(),
  clearMock: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-store', () => ({ load: loadMock }));
vi.mock('../../src/api/index', () => ({ settings: { migrateProxySecret: migrateMock, clearProxySecret: clearMock } }));

import { SettingsProvider } from '../../src/context/SettingsContext';
import { DEFAULT_SETTINGS } from '../../src/config/defaultSettings';

function SettingsHarness() {
  const { settings, isLoaded, updateSetting } = useSettings();
  return <><p>{`${settings.maxConcurrentUploads}:${isLoaded}`}</p><button onClick={() => updateSetting('maxConcurrentUploads', 2)}>Edit before load</button></>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('SettingsProvider initialization edits', () => {
  beforeEach(() => {
    getMock.mockReset();
    setMock.mockReset().mockResolvedValue(undefined);
    saveMock.mockReset().mockResolvedValue(undefined);
    loadMock.mockReset().mockResolvedValue({ get: getMock, set: setMock, save: saveMock });
    migrateMock.mockReset();
    clearMock.mockReset();
  });

  it('reconciles a pre-load edit over the persisted snapshot and writes the reconciled result', async () => {
    const storedRead = deferred<Partial<typeof DEFAULT_SETTINGS> | null>();
    getMock.mockReturnValue(storedRead.promise);
    render(<SettingsProvider><SettingsHarness /></SettingsProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Edit before load' }));
    expect(screen.getByText('2:false')).toBeTruthy();
    expect(setMock).not.toHaveBeenCalled();

    await act(async () => {
      storedRead.resolve({ maxConcurrentUploads: 5, zipFolders: false });
      await storedRead.promise;
    });

    expect(await screen.findByText('2:true')).toBeTruthy();
    await waitFor(() => expect(setMock).toHaveBeenCalledWith('settings', expect.objectContaining({ maxConcurrentUploads: 2, zipFolders: false })));
  });

  it('keeps crash reporting enabled by default with no first-launch consent gate', () => {
    expect(DEFAULT_SETTINGS.crashReportingEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.crashReportingConsentSeen).toBe(true);
  });
});
