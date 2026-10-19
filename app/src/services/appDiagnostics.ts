import { system } from '../api/index';

export type AppDiagnosticEvent = 'app_started' | 'js_window_error' | 'js_unhandled_rejection' | 'react_error' | 'app_background' | 'app_foreground';

/** Keep function symbols only: never error messages, source URLs, or arbitrary values. */
export function diagnosticFrames(error: unknown): string[] {
  if (!(error instanceof Error) || !error.stack) return [];
  return error.stack.split('\n').slice(1, 17).map(line =>
    line.match(/^\s*at\s+([A-Za-z_$][A-Za-z0-9_$.<>]{0,119})(?:\s|\()/)?.[1] ?? '',
  ).filter(Boolean).slice(0, 8);
}

export function recordAppDiagnostic(event: AppDiagnosticEvent, error?: unknown): void {
  // Independent of optional remote crash telemetry. Local logging never sends data.
  try {
    void system.recordAppDiagnostic(event, diagnosticFrames(error)).catch(() => {});
  } catch {
    // Diagnostics must never break app startup or replace an original failure.
  }
}

export function initializeAppDiagnostics(): void {
  recordAppDiagnostic('app_started');
  document.addEventListener('visibilitychange', () => {
    recordAppDiagnostic(document.visibilityState === 'hidden' ? 'app_background' : 'app_foreground');
  });
}

export const CRASH_ISSUE_URL = 'https://github.com/hellocloudwebdev/shelf-drive-mobile/issues/new';

export function buildCrashIssueReport(version: string, logs?: string): string {
  const summary = `## Shelf Drive crash report\n\nApp version: ${version}\n\n### What happened?\n[Describe the crash and what you were doing.]\n\n### Steps to reproduce\n1. \n\n### Expected behavior\n[What should have happened?]\n`;
  // Logs go only to the local clipboard after per-report consent, never a URL.
  if (logs === undefined) return summary;
  const maxLogChars = 48_000;
  let excerpt = logs;
  if (logs.length > maxLogChars) {
    const nativeSectionMarker = '\n=== Sensitive app-native crash traces ===\n';
    const nativeSectionStart = logs.indexOf(nativeSectionMarker);
    let ordinaryLogs = logs;
    excerpt = '';
    if (nativeSectionStart >= 0) {
      // Never tail-slice a protobuf/base64 tombstone: that would create a misleading partial trace.
      ordinaryLogs = logs.slice(0, nativeSectionStart);
      excerpt = 'Native tombstone data omitted from clipboard excerpt. Use Save / Download logs, decode and inspect before manually attaching the complete file.\n';
    }
    excerpt += ordinaryLogs.length > maxLogChars
      ? `[Older log entries omitted to fit a GitHub issue. Use Save / Download logs to attach the complete file.]\n${ordinaryLogs.slice(-maxLogChars)}`
      : ordinaryLogs;
  }
  return `${summary}\n### App-only diagnostic log (shared with my consent)\n\n${excerpt}\n`;
}
