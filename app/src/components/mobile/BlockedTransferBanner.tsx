import { RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface BlockedTransferBannerProps {
  blockedCount: number;
  reason: string;
  onRetry: () => void;
  onOpenTransfers: () => void;
  onDismiss: () => void;
}

/**
 * High-visibility banner shown on Home when pending or queued transfers are
 * held back by network or Android transfer policies.
 */
export function BlockedTransferBanner({
  blockedCount,
  reason,
  onRetry,
  onOpenTransfers,
  onDismiss,
}: BlockedTransferBannerProps) {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-3 rounded-[1.125rem] border border-app-warning/25 bg-app-warning/10 p-3.5 shadow-[var(--shadow-raised)]"
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-app-warning/20 text-app-warning"
        aria-hidden="true"
      >
        <RefreshCw className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-app-warning">
            {blockedCount} · {t('activity.status_paused')}
          </span>
        </div>
        <p className="mt-0.5 text-xs leading-snug text-app-text-secondary">
          {reason}
        </p>
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="press-row flex items-center gap-1.5 rounded-lg bg-app-warning/20 px-2.5 py-1 text-xs font-semibold text-app-warning transition-colors hover:bg-app-warning/30"
            aria-label={t('common.retry')}
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            <span>{t('common.retry')}</span>
          </button>
          <button
            type="button"
            onClick={onOpenTransfers}
            className="press-row rounded-lg bg-app-hover px-2.5 py-1 text-xs font-medium text-app-text-secondary transition-colors hover:text-app-text"
          >
            <span>{t('common.transfers')}</span>
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="press-row -mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-app-text-tertiary transition-colors hover:bg-app-hover hover:text-app-text"
        aria-label={t('common.close')}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
