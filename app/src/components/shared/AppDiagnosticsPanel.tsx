import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { openUrl } from '@tauri-apps/plugin-opener';
import { system } from '../../api/index';
import { copyToClipboard } from '../../utils';
import { version } from '../../../package.json';
import { buildCrashIssueReport, CRASH_ISSUE_URL } from '../../services/appDiagnostics';

/** Shared by mobile Settings, desktop Settings, and Help. Nothing is uploaded here. */
export function AppDiagnosticsPanel() {
  const [busy, setBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [includeLogs, setIncludeLogs] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [reviewedLogs, setReviewedLogs] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reviewSequence = useRef(0);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await action(); }
    catch { setError('Could not complete this action. Your report has not been submitted. Please try again.'); }
    finally { setBusy(false); }
  };
  const beginReport = () => {
    reviewSequence.current += 1;
    setIncludeLogs(false);
    setReviewedLogs(null);
    setError(null);
    setReportOpen(true);
  };
  const reviewLogAttachment = () => {
    const reviewId = ++reviewSequence.current;
    setIncludeLogs(false);
    setReviewedLogs(null);
    setPreview(null);
    void run(async () => {
      const logs = await system.getAppLogs();
      if (reviewId !== reviewSequence.current) return;
      setIncludeLogs(false);
      setReviewedLogs(logs);
      setPreview(logs);
    });
  };
  const prepareReport = () => void run(async () => {
    reviewSequence.current += 1;
    // An unchecked box must not even read logs. Consent applies only to this report.
    const logs = includeLogs ? reviewedLogs : undefined;
    if (includeLogs && logs === null) throw new Error('Review logs first');
    await copyToClipboard(buildCrashIssueReport(version, logs ?? undefined));
    // Never put logs in a query string or call the GitHub create-issue API.
    await openUrl(CRASH_ISSUE_URL);
    toast.success('Report copied. Paste it into GitHub, review it, then submit it yourself.');
    setReportOpen(false);
    setIncludeLogs(false);
    setReviewedLogs(null);
    setPreview(null);
  });
  const buttonClass = 'quiet-control rounded-lg border border-app-border-subtle px-3 py-2 text-xs font-medium text-app-text disabled:opacity-50';

  return <section aria-label="App diagnostic logs" className="space-y-3 p-4 text-start">
    <div><h3 className="text-sm font-semibold text-app-text">App diagnostic logs</h3>
      <p className="mt-1 text-xs leading-5 text-app-text-secondary">Saved automatically on this device with bounded rotation. Only Shelf Drive events are captured, never system-wide logcat or other apps. Older entries are removed as space is needed.</p>
      <p className="mt-1 text-xs leading-5 text-app-text-secondary">Logs and the support snapshot may reveal device or technical details. Review before sharing. Saving creates a file outside private app storage; copying places it on your clipboard.</p>
    </div>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} className={buttonClass} onClick={() => void run(async () => { await copyToClipboard(await system.getAppLogs()); toast.success('App logs copied.'); })}>Copy logs</button>
      <button type="button" disabled={busy} className={buttonClass} onClick={() => void run(async () => { const destination = await system.saveAppLogs(); if (destination) toast.success(`Logs saved: ${destination}`); })}>Save / Download logs</button>
      <button type="button" disabled={busy} className={buttonClass} onClick={beginReport}>Report a crash</button>
    </div>
    {reportOpen && <div className="space-y-3 rounded-lg border border-app-border-subtle p-3" aria-label="Crash report preparation">
      <h4 className="text-sm font-semibold text-app-text">Prepare a GitHub issue</h4>
      <p className="text-xs leading-5 text-app-text-secondary">GitHub issues are public. Review the log below before choosing to include it. Nothing is attached or uploaded automatically. We copy a report, then open GitHub; you paste, edit, and submit it yourself. Large logs include only the most recent excerpt in the pasted report. You can save the complete log and attach the file manually in GitHub.</p>
      <button type="button" disabled={busy} className={buttonClass} onClick={reviewLogAttachment}>Review logs for this report</button>
      <label className="flex items-start gap-2 text-xs leading-5 text-app-text">
        <input type="checkbox" checked={includeLogs} disabled={busy || reviewedLogs === null} onChange={event => setIncludeLogs(event.target.checked)} className="mt-1" />
        I consent to include the reviewed app log in this report and share it publicly if I submit the GitHub issue.
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} className={buttonClass} onClick={prepareReport}>Copy report &amp; open GitHub</button>
        <button type="button" disabled={busy} className={buttonClass} onClick={() => { reviewSequence.current += 1; setReportOpen(false); setIncludeLogs(false); setReviewedLogs(null); setPreview(null); setError(null); }}>Cancel report</button>
      </div>
    </div>}
    {preview !== null && <details open className="text-xs text-app-text-secondary"><summary>Log preview — review for sensitive details</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-app-border-subtle p-3" tabIndex={0}>{preview}</pre></details>}
    {busy && <p role="status" className="text-xs text-app-text-secondary">Working…</p>}
    {error && <p role="alert" className="text-xs text-app-warning">{error}</p>}
  </section>;
}
