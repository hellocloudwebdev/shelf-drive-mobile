import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/config/defaultSettings';
import { PrivacySettingsTab } from '../../src/components/desktop/dashboard/settings/SettingsTabs';

const { getStatusMock, uploadMock, confirmMock } = vi.hoisted(() => ({
  getStatusMock: vi.fn(),
  uploadMock: vi.fn(),
  confirmMock: vi.fn(),
}));
vi.mock('../../src/services/settingsSync', () => ({
  getSettingsSyncStatus: getStatusMock,
  uploadSettingsSync: uploadMock,
  downloadSettingsSync: vi.fn(),
}));
vi.mock('../../src/context/ConfirmContext', () => ({ useConfirm: () => ({ confirm: confirmMock }) }));
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const settings = { ...DEFAULT_SETTINGS, telegramSettingsSyncEnabled: true };
const renderPrivacyTab = () => render(
  <PrivacySettingsTab
    crashReportingEnabled={false}
    onCrashReportingChange={vi.fn()}
    settings={settings}
    onSettingsChange={vi.fn()}
    onSettingsSyncEnabledChange={vi.fn()}
  />,
);

function enterPassphrase() {
  fireEvent.change(screen.getByLabelText('Sync passphrase'), { target: { value: 'correct horse battery staple' } });
}

describe('encrypted settings sync upload safety', () => {
  beforeEach(() => {
    getStatusMock.mockReset();
    uploadMock.mockReset().mockResolvedValue({ available: true, device_id: 'this-device', current_device: true, updated_at: 10 });
    confirmMock.mockReset().mockResolvedValue(false);
  });

  it('keeps upload disabled after the remote status lookup fails', async () => {
    getStatusMock.mockRejectedValue(new Error('status unavailable'));
    renderPrivacyTab();
    enterPassphrase();

    await screen.findByRole('alert');
    expect((screen.getByRole('button', { name: 'Upload this device' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Upload this device' }));
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('requires confirmation before replacing another device backup', async () => {
    getStatusMock.mockResolvedValue({ available: true, device_id: 'other-device', current_device: false, updated_at: 20 });
    renderPrivacyTab();
    enterPassphrase();

    const upload = await screen.findByRole('button', { name: 'Upload this device' });
    await waitFor(() => expect((upload as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(upload);
    await waitFor(() => expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Replace the settings backup?' })));
    expect(uploadMock).not.toHaveBeenCalled();
  });
});
