import { RefreshCw, DownloadCloud, CheckCircle2, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from './glass';
import { cx } from '../ui/cx';
import type { UpdateInstallPhase } from '../../services/updateReliability';

interface MobileUpdatePromptProps {
  open: boolean;
  onClose: () => void;
  checking: boolean;
  available: boolean;
  downloading: boolean;
  progress: number;
  phase: UpdateInstallPhase | null;
  version: string | null;
  error: string | null;
  onCheck: () => void;
  onUpdate: () => void;
}

/**
 * Glass update sheet for the Android sideload updater. Opened
 * automatically when the startup update check finds a newer release and
 * from Settings → Updates. Every state reuses existing translations, so
 * the mobile literal budget is untouched: idle shows a Check Now button,
 * an available update shows Update & Restart, downloading/installing
 * shows the live progress bar, and failures surface the hook's error via
 * the existing failed-toast copy. The actual download, SHA-256
 * verification against the signed manifest, and installer handoff happen
 * in Rust (android_updates.rs); this sheet only reflects that state.
 */
export function MobileUpdatePrompt({
  open, onClose, checking, available, downloading, progress, phase, version, error, onCheck, onUpdate,
}: MobileUpdatePromptProps) {
  const { t } = useTranslation();

  if (!open) return null;

  const busy = downloading || phase === 'installing';
  const statusLine = checking
    ? t('settings.checking')
    : available
      ? t('settings.update_available_toast', { version: version ?? '' })
      : error
        ? t('settings.update_check_failed_toast', { error })
        : t('settings.latest_version_toast');

  return (
    <BottomSheet onClose={onClose} title={available ? t('settings.update_available') : t('settings.check_for_updates')} ariaLabel={t('settings.updates')}>
      <div className="flex items-start gap-3">
        <span
          className={cx(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
            error && !available ? 'bg-app-danger/10 text-app-danger' : available ? 'bg-app-accent text-app-accent-contrast' : 'bg-app-accent/10 text-app-accent',
          )}
          aria-hidden="true"
        >
          {error && !available ? (
            <AlertCircle className="h-5 w-5" />
          ) : available ? (
            <DownloadCloud className="h-5 w-5" />
          ) : (
            <CheckCircle2 className="h-5 w-5" />
          )}
        </span>
        <p className="min-w-0 flex-1 pt-1 text-sm leading-relaxed text-app-text-secondary" role={error && !available ? 'alert' : undefined}>
          {statusLine}
        </p>
      </div>

      {busy && (
        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-app-hover" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <div
              className="h-full rounded-full bg-app-accent transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${Math.max(4, progress)}%` }}
            />
          </div>
          <p className="mt-1.5 text-right text-badge font-mono font-semibold text-app-text">
            {phase === 'installing' ? t('settings.update_restart') : `${progress}%`}
          </p>
        </div>
      )}

      <div className="mt-4 flex gap-2.5">
        {available && !busy && (
          <button
            type="button"
            onClick={onUpdate}
            className="press-row flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-app-accent px-4 text-sm font-semibold text-app-accent-contrast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
          >
            <DownloadCloud className="h-4.5 w-4.5" aria-hidden="true" />
            {t('settings.update_restart')}
          </button>
        )}
        {!available && !checking && (
          <button
            type="button"
            onClick={onCheck}
            className="press-row flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-app-accent px-4 text-sm font-semibold text-app-accent-contrast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
          >
            <RefreshCw className={cx('h-4.5 w-4.5', checking && 'animate-spin')} aria-hidden="true" />
            {t('settings.check_now')}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="press-row flex h-11 items-center justify-center rounded-2xl bg-app-hover px-4 text-sm font-semibold text-app-text-secondary transition-colors hover:bg-app-hover/70 hover:text-app-text disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
        >
          {t('common.cancel')}
        </button>
      </div>
    </BottomSheet>
  );
}
