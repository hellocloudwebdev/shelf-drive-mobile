import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppDiagnosticsPanel } from '../../src/components/shared/AppDiagnosticsPanel';
import { buildCrashIssueReport, diagnosticFrames, recordAppDiagnostic, CRASH_ISSUE_URL } from '../../src/services/appDiagnostics';
import { configureCrashTelemetry, reportCrash } from '../../src/services/crashTelemetry';

const mocks = vi.hoisted(() => ({
  getAppLogs: vi.fn(), saveAppLogs: vi.fn(), recordAppDiagnostic: vi.fn(), submitCrashReport: vi.fn(), copy: vi.fn(), open: vi.fn(),
}));
const nativeTraceOne = 'ANDROID_NATIVE_EXIT_TRACE\nprotobuf/base64: Cg1uYXRpdmUtZnJhbWUK\nprivate path=/data/user/0/app/cache/item; memory=customer-secret';
const nativeTraceTwo = 'ANDROID_NATIVE_EXIT_TRACE\nprotobuf/base64: Cg1uZXctdHJhY2U=\nprivate path=/data/user/0/app/files/new-item; memory=second-secret';
vi.mock('../../src/api/index', () => ({ system: mocks }));
vi.mock('../../src/utils', () => ({ copyToClipboard: mocks.copy }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: mocks.open }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAppLogs.mockResolvedValue('APP-ONLY PRIVATE LOG');
  mocks.saveAppLogs.mockResolvedValue('Downloads/shelf-drive-diagnostics.txt');
  mocks.recordAppDiagnostic.mockResolvedValue(undefined);
  mocks.copy.mockResolvedValue(undefined);
  mocks.open.mockResolvedValue(undefined);
});

describe('app-only diagnostics', () => {
  it('retains local crash events even when optional network telemetry is disabled', () => {
    configureCrashTelemetry(false);
    reportCrash(new Error('private-message'), 'react');
    expect(mocks.recordAppDiagnostic).toHaveBeenCalledWith('react_error', expect.any(Array));
    expect(mocks.submitCrashReport).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.recordAppDiagnostic.mock.calls)).not.toContain('private-message');
  });

  it('copies and saves logs only after an explicit action', async () => {
    render(<AppDiagnosticsPanel />);
    expect(mocks.getAppLogs).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Copy logs' }));
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith('APP-ONLY PRIVATE LOG'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save / Download logs' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Save / Download logs' }));
    await waitFor(() => expect(mocks.saveAppLogs).toHaveBeenCalledOnce());
  });

  it('offers standalone review without copying, saving, or uploading a sensitive native trace', async () => {
    mocks.getAppLogs.mockResolvedValueOnce(nativeTraceOne);
    render(<AppDiagnosticsPanel />);
    expect(screen.getByText(/encoded android native crash tombstones are unsanitized/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review logs' }));
    await screen.findByText((_content, element) => element?.tagName === 'PRE' && element.textContent === nativeTraceOne);
    expect(mocks.getAppLogs).toHaveBeenCalledOnce();
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.saveAppLogs).not.toHaveBeenCalled();
    expect(mocks.submitCrashReport).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('does not read or attach logs in a report without consent', async () => {
    render(<AppDiagnosticsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Report a crash' }));
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Copy report & open GitHub' }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledWith(CRASH_ISSUE_URL));
    expect(mocks.getAppLogs).not.toHaveBeenCalled();
    expect(mocks.copy.mock.calls[0][0]).not.toContain('APP-ONLY PRIVATE LOG');
  });

  it('includes exactly the reviewed snapshot only after fresh consent and keeps it out of URLs', async () => {
    render(<AppDiagnosticsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Report a crash' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review logs for this report' }));
    await screen.findByText('APP-ONLY PRIVATE LOG');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy report & open GitHub' }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledWith(CRASH_ISSUE_URL));
    expect(mocks.copy.mock.calls[0][0]).toContain('APP-ONLY PRIVATE LOG');
    expect(mocks.getAppLogs).toHaveBeenCalledOnce();
    expect(mocks.open.mock.calls[0][0]).not.toContain('PRIVATE');
    await waitFor(() => expect(screen.queryByRole('checkbox')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Report a crash' }));
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it('revokes consent immediately when reviewing a new snapshot and leaves the new snapshot unchecked', async () => {
    mocks.getAppLogs
      .mockResolvedValueOnce('FIRST APP-ONLY LOG')
      .mockResolvedValueOnce('SECOND APP-ONLY LOG');
    render(<AppDiagnosticsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Report a crash' }));
    const reviewButton = screen.getByRole('button', { name: 'Review logs for this report' });
    fireEvent.click(reviewButton);
    await screen.findByText('FIRST APP-ONLY LOG');

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    fireEvent.click(reviewButton);
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(true);
    await screen.findByText('SECOND APP-ONLY LOG');
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(false);
    expect(mocks.getAppLogs).toHaveBeenCalledTimes(2);
  });

  it('requires fresh consent for the exact native-sensitive snapshot reviewed for each report', async () => {
    mocks.getAppLogs.mockResolvedValueOnce(nativeTraceOne).mockResolvedValueOnce(nativeTraceTwo);
    render(<AppDiagnosticsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Report a crash' }));
    const reviewButton = screen.getByRole('button', { name: 'Review logs for this report' });
    fireEvent.click(reviewButton);
    await screen.findByText((_content, element) => element?.tagName === 'PRE' && element.textContent === nativeTraceOne);
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    fireEvent.click(reviewButton);
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(true);
    await screen.findByText((_content, element) => element?.tagName === 'PRE' && element.textContent === nativeTraceTwo);
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Copy report & open GitHub' }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledWith(CRASH_ISSUE_URL));
    const report = mocks.copy.mock.calls[0][0] as string;
    expect(report).toContain(nativeTraceTwo);
    expect(report).not.toContain(nativeTraceOne);
    expect(mocks.getAppLogs).toHaveBeenCalledTimes(2);
  });

  it('cancel does not open GitHub or copy a report', () => {
    render(<AppDiagnosticsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Report a crash' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel report' }));
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('does not open GitHub if clipboard preparation fails', async () => {
    mocks.copy.mockRejectedValueOnce(new Error('clipboard unavailable'));
    render(<AppDiagnosticsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Report a crash' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy report & open GitHub' }));
    await screen.findByRole('alert');
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('keeps large issue drafts bounded and tells users to attach the full export', () => {
    const report = buildCrashIssueReport('4.4.8', 'oldest-entry\n' + 'x'.repeat(100_000) + '\nnewest-entry');
    expect(report.length).toBeLessThan(50_000);
    expect(report).toContain('newest-entry');
    expect(report).not.toContain('oldest-entry');
    expect(report).toContain('attach the complete file');
  });

  it('omits an entire oversized native base64 section from clipboard excerpts', () => {
    const encodedTrace = 'Cw==' + 'A'.repeat(90_000);
    const logs = 'ordinary-history-entry\n=== Sensitive app-native crash traces ===\n' + encodedTrace;
    const report = buildCrashIssueReport('4.4.8', logs);
    expect(report.length).toBeLessThan(50_000);
    expect(report).toContain('Native tombstone data omitted from clipboard excerpt. Use Save / Download logs, decode and inspect before manually attaching the complete file.');
    expect(report).toContain('ordinary-history-entry');
    expect(report).not.toContain(encodedTrace);
    expect(report).not.toContain('=== Sensitive app-native crash traces ===');
  });

  it('strips messages, URLs, source paths, and non-error user values from crash shape', () => {
    const error = new Error('secret-token /private/customer.txt');
    error.stack = 'Error: secret-token\n    at uploadFile (https://private.example/token:12:4)\n    at /private/customer.txt:4:2\n    at Promise.all (index 0)';
    expect(diagnosticFrames(error)).toEqual(['uploadFile', 'Promise.all']);
    expect(diagnosticFrames({ stack: 'secret' })).toEqual([]);
    recordAppDiagnostic('js_window_error', error);
    expect(mocks.recordAppDiagnostic).toHaveBeenCalledWith('js_window_error', ['uploadFile', 'Promise.all']);
  });
});
