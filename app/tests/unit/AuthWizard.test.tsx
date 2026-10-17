import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthWizard } from '../../src/components/shared/AuthWizard';
import { AuthCodeStep } from '../../src/components/shared/auth/AuthSteps';
import { AUTH_COMMAND_TIMEOUT_MS } from '../../src/api';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
  })),
}));
vi.mock('../../src/context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}));
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, values?: { seconds?: number }) => ({
      'auth.telegram_code': 'Telegram code',
      'auth.sign_in': 'Sign in',
      'auth.verifying': 'Verifying',
      'auth.change_phone': 'Change phone',
      'auth.use_qr_instead': 'Use QR instead',
      'auth.code_sent_sms': 'Code sent by SMS',
      'auth.resend_code': 'Resend code',
      'auth.resending': 'Resending',
      'auth.resend_in': `Resend in ${values?.seconds ?? 0}`,
    }[key] ?? key),
  }),
}));

const defaultInvoke = async (command: string) => {
  if (command === 'cmd_auth_qr_login') return 'tg://login?token=test';
  if (command === 'cmd_auth_qr_poll') return { success: false, next_step: 'waiting' };
  if (command === 'cmd_auth_request_code') {
    return {
      status: 'code_required',
      delivery: 'sms',
      codeLength: 5,
      resendAfterSeconds: 30,
      nextDelivery: 'call',
      numericCode: true,
    };
  }
  if (command === 'cmd_auth_sign_in') return { success: true };
  if (command === 'cmd_auth_check_password') return { success: true };
  return null;
};

async function reachPhoneStep(onLogin = vi.fn()) {
  render(<AuthWizard onLogin={onLogin} />);
  fireEvent.change(screen.getByLabelText('API ID'), { target: { value: '12345' } });
  fireEvent.change(screen.getByLabelText('API Hash'), { target: { value: 'abcdef' } });
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  await screen.findByText('Scan with your Telegram app');
  fireEvent.click(screen.getByRole('button', { name: /Phone Number/ }));
  return onLogin;
}

async function requestSmsCode() {
  fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: '+15551234567' } });
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  await screen.findByText('Code sent by SMS');
}

async function flushMicrotasks() {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
  });
}

describe('AuthWizard phone authentication', () => {
  beforeEach(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    invokeMock.mockImplementation(defaultInvoke);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves setup, phone-code, and successful sign-in sequencing', async () => {
    const onLogin = vi.fn();
    render(<AuthWizard onLogin={onLogin} />);

    fireEvent.change(screen.getByLabelText('API ID'), { target: { value: '12345' } });
    fireEvent.change(screen.getByLabelText('API Hash'), { target: { value: 'abcdef' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    await screen.findByText('Scan with your Telegram app');
    fireEvent.click(screen.getByRole('button', { name: /Phone Number/ }));
    fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: '+15551234567' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    await screen.findByText('Code sent by SMS');
    fireEvent.change(screen.getByLabelText('Telegram code'), { target: { value: '12a3456' } });
    expect((screen.getByLabelText('Telegram code') as HTMLInputElement).value).toBe('12345');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledOnce());
    const commands = invokeMock.mock.calls.map(([command]) => command);
    expect(commands).toContain('cmd_load_api_hash');
    expect(commands).toContain('cmd_store_api_hash');
    expect(commands.filter(command => String(command).startsWith('cmd_auth_'))).toEqual([
      'cmd_auth_qr_login',
      'cmd_auth_request_code',
      'cmd_auth_sign_in',
    ]);
  });

  it('masks the API hash unless the user explicitly reveals it', () => {
    render(<AuthWizard onLogin={vi.fn()} />);
    const apiHash = screen.getByLabelText('API Hash') as HTMLInputElement;
    expect(apiHash.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show API Hash' }));
    expect(apiHash.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide API Hash' }));
    expect(apiHash.type).toBe('password');
  });

  it('rejects malformed API IDs before persisting credentials or starting login', async () => {
    render(<AuthWizard onLogin={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('API ID'), { target: { value: '123abc' } });
    fireEvent.change(screen.getByLabelText('API Hash'), { target: { value: 'abcdef' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    expect((await screen.findByRole('alert')).textContent).toContain('API ID must contain digits only.');
    expect(invokeMock.mock.calls.some(([command]) => command === 'cmd_store_api_hash')).toBe(false);
    expect(invokeMock.mock.calls.some(([command]) => String(command).startsWith('cmd_auth_'))).toBe(false);
  });

  it('does not proceed with sign-in if secure API-hash storage fails', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'cmd_store_api_hash') throw new Error('secure store unavailable');
      return null;
    });
    render(<AuthWizard onLogin={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('API ID'), { target: { value: '12345' } });
    fireEvent.change(screen.getByLabelText('API Hash'), { target: { value: 'abcdef' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    expect((await screen.findByRole('alert')).textContent).toContain('Unable to save sign-in credentials securely.');
    expect(invokeMock.mock.calls.some(([command]) => String(command).startsWith('cmd_auth_'))).toBe(false);
  });

  it('offers QR login on mobile when Telegram cannot deliver a usable phone code', () => {
    const onUseQr = vi.fn();
    render(<AuthCodeStep
      codeDelivery={{ status: 'qr_recommended', delivery: 'firebase', numericCode: false }}
      deliveryMessage="Phone code delivery is unsupported"
      code="" loading={false} resendWait={0} isMobile
      onCodeChange={vi.fn()} onSubmit={vi.fn()} onOpenFragment={vi.fn()}
      onResend={vi.fn()} onUseQr={onUseQr} onChangePhone={vi.fn()}
    />);

    expect(screen.queryByLabelText('Telegram code')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use QR instead' }));
    expect(onUseQr).toHaveBeenCalledOnce();
  });

  it('returns from Verifying with a clear error when the phone-code IPC watchdog expires', async () => {
    await reachPhoneStep();
    invokeMock.mockImplementation((command: string) => {
      if (command === 'cmd_auth_request_code') return new Promise(() => {});
      return defaultInvoke(command);
    });
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: '+15551234567' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect((screen.getByRole('button', { name: /Verifying/i }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTH_COMMAND_TIMEOUT_MS.requestCode);
    });

    expect(screen.getByRole('alert').textContent).toMatch(/timed out while requesting a sign-in code/i);
    expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('ignores a late phone-code response after returning to configuration', async () => {
    await reachPhoneStep();
    let resolveRequest: (value: unknown) => void = () => {};
    invokeMock.mockImplementation((command: string) => {
      if (command === 'cmd_auth_request_code') {
        return new Promise(resolve => { resolveRequest = resolve; });
      }
      return defaultInvoke(command);
    });

    fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: '+15551234567' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.click(screen.getByRole('button', { name: /Back to Configuration/ }));
    expect(await screen.findByLabelText('API ID')).toBeTruthy();

    await act(async () => {
      resolveRequest({
        status: 'code_required', delivery: 'sms', codeLength: 5,
        resendAfterSeconds: 30, nextDelivery: 'call', numericCode: true,
      });
    });
    expect(screen.queryByText('Code sent by SMS')).toBeNull();
  });

  it('completes phone-code sign-in through the two-step password challenge', async () => {
    const onLogin = await reachPhoneStep();
    await requestSmsCode();
    invokeMock.mockImplementation((command: string) => {
      if (command === 'cmd_auth_sign_in') return { success: false, next_step: 'password' };
      if (command === 'cmd_auth_check_password') return { success: true };
      return defaultInvoke(command);
    });

    fireEvent.change(screen.getByLabelText('Telegram code'), { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const password = await screen.findByLabelText(/cloud password/i);
    fireEvent.change(password, { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledOnce());
    expect(invokeMock.mock.calls.map(([command]) => command)).toContain('cmd_auth_check_password');
  });

  it('recovers from code and 2FA failures so each login step can be retried', async () => {
    await reachPhoneStep();
    await requestSmsCode();
    let signInCalls = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command === 'cmd_auth_sign_in') {
        signInCalls += 1;
        if (signInCalls === 1) throw new Error('PHONE_CODE_INVALID');
        return { success: false, next_step: 'password' };
      }
      if (command === 'cmd_auth_check_password') throw new Error('PASSWORD_HASH_INVALID');
      return defaultInvoke(command);
    });

    fireEvent.change(screen.getByLabelText('Telegram code'), { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'PHONE_CODE_INVALID');
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const password = await screen.findByLabelText(/cloud password/i);
    fireEvent.change(password, { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect((await screen.findByRole('alert')).textContent).toBe('PASSWORD_HASH_INVALID');
    expect((screen.getByRole('button', { name: 'Unlock' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('completes QR login after polling and opens the password step when requested', async () => {
    const onLogin = await reachPhoneStep();
    await requestSmsCode();
    invokeMock.mockImplementation((command: string) => {
      if (command === 'cmd_auth_qr_login') return 'tg://login?token=qr-test';
      if (command === 'cmd_auth_qr_poll') return { success: true, next_step: 'password' };
      if (command === 'cmd_auth_check_password') return { success: true };
      return defaultInvoke(command);
    });
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('button', { name: 'Use QR instead' }));
    await flushMicrotasks();
    expect(screen.getByText('Scan with your Telegram app')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    const password = screen.getByLabelText(/cloud password/i);
    fireEvent.change(password, { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });

    expect(onLogin).toHaveBeenCalledOnce();
    expect(invokeMock.mock.calls.map(([command]) => command)).toContain('cmd_auth_qr_poll');
  });
});
