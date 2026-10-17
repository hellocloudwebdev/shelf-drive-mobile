import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => path,
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

import { auth, AUTH_COMMAND_TIMEOUT_MS } from '../../src/api';
import { tauriInvokeWithTimeout } from '../../src/api/tauri';

describe('Tauri auth IPC watchdogs', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('propagates a normal response and clears its timer', async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValueOnce('ok');

    await expect(tauriInvokeWithTimeout('cmd_test', undefined, 1000, 'Timed out'))
      .resolves.toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects when IPC never responds', async () => {
    vi.useFakeTimers();
    invokeMock.mockReturnValue(new Promise(() => {}));
    const pending = tauriInvokeWithTimeout('cmd_test', undefined, 500, 'Request timed out');
    const rejected = expect(pending).rejects.toThrow('Request timed out');

    await vi.advanceTimersByTimeAsync(500);
    await rejected;
  });

  it.each([
    ['phone-code request', () => auth.requestCode('+15551234567', 12345, 'hash'), AUTH_COMMAND_TIMEOUT_MS.requestCode],
    ['QR token request', () => auth.qrLogin(12345, 'hash'), AUTH_COMMAND_TIMEOUT_MS.qrLogin],
    ['QR status poll', () => auth.qrPoll(), AUTH_COMMAND_TIMEOUT_MS.qrPoll],
    ['code sign-in', () => auth.signIn('12345'), AUTH_COMMAND_TIMEOUT_MS.signIn],
    ['two-step password', () => auth.checkPassword('password'), AUTH_COMMAND_TIMEOUT_MS.checkPassword],
    ['resend-code request', () => auth.resendCode(), AUTH_COMMAND_TIMEOUT_MS.resendCode],
    ['cancel-code request', () => auth.cancelCode(), AUTH_COMMAND_TIMEOUT_MS.cancelCode],
  ])('bounds the %s call', async (_name, call, timeoutMs) => {
    vi.useFakeTimers();
    invokeMock.mockReturnValue(new Promise(() => {}));
    const pending = call();
    const rejected = expect(pending).rejects.toThrow(/timed out/i);

    await vi.advanceTimersByTimeAsync(timeoutMs);
    await rejected;
    expect(invokeMock).toHaveBeenCalledOnce();
  });

  it('preserves a native IPC error instead of replacing it with a timeout', async () => {
    invokeMock.mockRejectedValueOnce(new Error('native failure'));

    await expect(auth.requestCode('+15551234567', 12345, 'hash'))
      .rejects.toThrow('native failure');
  });
});
