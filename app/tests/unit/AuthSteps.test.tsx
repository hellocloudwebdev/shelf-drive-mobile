import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import i18n from '../../src/i18n';
import {
  AuthMethodStep,
  AuthPasswordStep,
  AuthSetupStep,
} from '../../src/components/shared/auth/AuthSteps';

const methodProps = (overrides: Partial<Parameters<typeof AuthMethodStep>[0]> = {}) => ({
  isMobile: true,
  loginMethod: 'phone' as const,
  loading: false,
  phone: '',
  qrUrl: null,
  qrPolling: false,
  onPhoneChange: vi.fn(),
  onSelectPhone: vi.fn(),
  onSelectQr: vi.fn(),
  onPhoneSubmit: vi.fn(),
  onQrLogin: vi.fn(),
  onBack: vi.fn(),
  ...overrides,
});

describe('authentication step components', () => {
  it('renders secure setup controls and wires credential, help, and development actions', () => {
    const props = {
      apiId: '',
      apiHash: 'secret-hash',
      isMobile: true,
      loading: false,
      onApiIdChange: vi.fn(),
      onApiHashChange: vi.fn(),
      onSubmit: vi.fn(),
      onShowHelp: vi.fn(),
      onDevLogin: vi.fn(),
    };
    render(<AuthSetupStep {...props} />);

    fireEvent.change(screen.getByLabelText(i18n.t('auth.api_id')), { target: { value: '12345' } });
    fireEvent.change(screen.getByLabelText(i18n.t('auth.api_hash')), { target: { value: 'updated-hash' } });
    expect(props.onApiIdChange).toHaveBeenCalledWith('12345');
    expect(props.onApiHashChange).toHaveBeenCalledWith('updated-hash');

    const apiHash = screen.getByLabelText(i18n.t('auth.api_hash')) as HTMLInputElement;
    expect(apiHash.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show API Hash' }));
    expect(apiHash.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide API Hash' }));
    expect(apiHash.type).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: i18n.t('auth.how_to_get_credentials') }));
    expect(props.onShowHelp).toHaveBeenCalledOnce();
    const devButton = screen.queryByRole('button', { name: i18n.t('auth.dev_mode') });
    if (devButton) {
      fireEvent.click(devButton);
      expect(props.onDevLogin).toHaveBeenCalledOnce();
    }
    fireEvent.submit(screen.getByLabelText(i18n.t('auth.api_id')).closest('form')!);
    expect(props.onSubmit).toHaveBeenCalledOnce();
  });

  it('prefills a recognized international number and updates the full number when country changes', () => {
    const props = methodProps({ phone: '+44 20 1234' });
    render(<AuthMethodStep {...props} />);

    const country = screen.getByRole('combobox', { name: 'Country Code' }) as HTMLSelectElement;
    const localNumber = screen.getByLabelText(i18n.t('auth.phone_number')) as HTMLInputElement;
    expect(country.value).toBe('+44');
    expect(localNumber.value).toBe('20 1234');

    fireEvent.change(country, { target: { value: '+91' } });
    expect(props.onPhoneChange).toHaveBeenLastCalledWith('+91201234');

    fireEvent.change(localNumber, { target: { value: '+919876543210' } });
    expect(country.value).toBe('+91');
    expect(localNumber.value).toBe('9876543210');
    expect(props.onPhoneChange).toHaveBeenLastCalledWith('+919876543210');
  });

  it('falls back to the default dial code for an unknown prefix and strips punctuation from local input', () => {
    const props = methodProps({ phone: '+999 12345' });
    render(<AuthMethodStep {...props} />);

    const country = screen.getByRole('combobox', { name: 'Country Code' }) as HTMLSelectElement;
    const localNumber = screen.getByLabelText(i18n.t('auth.phone_number')) as HTMLInputElement;
    expect(country.value).toBe('+91');
    expect(localNumber.value).toBe('12345');

    fireEvent.change(localNumber, { target: { value: '91 234-567' } });
    expect(localNumber.value).toBe('91234567');
    expect(props.onPhoneChange).toHaveBeenLastCalledWith('+9191234567');
  });

  it('offers desktop QR controls, renders loading and scan states, and wires refresh and back actions', () => {
    const onSelectPhone = vi.fn();
    const onSelectQr = vi.fn();
    const onQrLogin = vi.fn();
    const onBack = vi.fn();
    const props = methodProps({
      isMobile: false,
      loginMethod: 'qr',
      loading: true,
      onSelectPhone,
      onSelectQr,
      onQrLogin,
      onBack,
    });
    const { rerender } = render(<AuthMethodStep {...props} />);

    expect(screen.getByRole('button', { name: i18n.t('auth.phone_number') })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('auth.qr_code') }));
    expect(onSelectQr).toHaveBeenCalledOnce();
    expect(document.querySelector('.animate-spin')).toBeTruthy();

    rerender(<AuthMethodStep {...props} loading={false} qrUrl="tg://login?token=qr" qrPolling />);
    expect(screen.getByText(i18n.t('auth.scan_qr'))).toBeTruthy();
    expect(screen.getByText(i18n.t('auth.waiting_for_scan'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('auth.refresh_qr') }));
    expect(onQrLogin).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('auth.back_to_config') }));
    expect(onBack).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('auth.phone_number') }));
    expect(onSelectPhone).toHaveBeenCalledOnce();
  });

  it('submits a two-factor password and reflects the loading state', () => {
    const onPasswordChange = vi.fn();
    const onSubmit = vi.fn();
    const onBack = vi.fn();
    const props = { password: '', loading: false, onPasswordChange, onSubmit, onBack };
    const { rerender } = render(<AuthPasswordStep {...props} />);

    const password = screen.getByLabelText(i18n.t('auth.cloud_password')) as HTMLInputElement;
    expect(password.type).toBe('password');
    fireEvent.change(password, { target: { value: 'correct horse battery staple' } });
    expect(onPasswordChange).toHaveBeenCalledWith('correct horse battery staple');
    rerender(<AuthPasswordStep {...props} password="correct horse battery staple" />);
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(onSubmit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('auth.back_to_code') }));
    expect(onBack).toHaveBeenCalledOnce();

    rerender(<AuthPasswordStep {...props} password="filled" loading />);
    expect((screen.getByRole('button', { name: 'Verifying...' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
