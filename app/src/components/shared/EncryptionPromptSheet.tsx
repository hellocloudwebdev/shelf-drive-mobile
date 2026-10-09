import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '../mobile/glass';
import { useModalFocus } from '../../hooks/useModalFocus';
import { isAndroidPlatform } from '../../utils/platform';
import type { FilePassphraseRequest } from '../../context/EncryptionPromptContext';

interface Props {
    request: FilePassphraseRequest;
    onClose: (result: string | null) => void;
}

const MIN_PASSPHRASE_BYTES = 8;

export default function EncryptionPromptSheet({ request, onClose }: Props) {
    const { t } = useTranslation();
    const [passphrase, setPassphrase] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [acknowledged, setAcknowledged] = useState(false);
    const [revealPassphrase, setRevealPassphrase] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleClose = useCallback((result: string | null) => {
        onClose(result);
    }, [onClose]);

    useModalFocus(panelRef, () => handleClose(null), !isAndroidPlatform);

    useEffect(() => {
        // Let the sheet slide in before the keyboard comes up.
        const timer = setTimeout(() => inputRef.current?.focus(), 200);
        return () => clearTimeout(timer);
    }, []);

    const passphraseBytes = new TextEncoder().encode(passphrase).length;
    const passphraseValid = passphraseBytes >= MIN_PASSPHRASE_BYTES;
    const confirmationValid = !request.confirmPassphrase || confirmation === passphrase;
    const canSubmit = passphraseValid && confirmationValid
        && (!request.requireAcknowledgement || acknowledged)
        && !submitting;

    const handleSubmit = () => {
        if (submitting || !canSubmit) return;
        setSubmitting(true);
        handleClose(passphrase);
    };

    const fields = (
        <div className="space-y-3">
            {request.message && (
                <p className="text-xs leading-5 text-app-text-secondary">{request.message}</p>
            )}
            {request.requireAcknowledgement && (
                <div className="max-h-32 overflow-y-auto rounded-xl border border-app-warning/20 bg-app-warning/10 p-3">
                    <p className="text-[11px] leading-5 text-app-text-secondary">{t('settings.encryption_disclaimer_body')}</p>
                </div>
            )}
            <div className="glass-field flex items-center gap-2.5 rounded-2xl px-3.5 py-3">
                <input
                    ref={inputRef}
                    type={revealPassphrase ? 'text' : 'password'}
                    value={passphrase}
                    onChange={event => setPassphrase(event.target.value)}
                    onKeyDown={event => {
                        if (event.key === 'Enter' && !request.confirmPassphrase) {
                            event.preventDefault();
                            handleSubmit();
                        }
                    }}
                    aria-label={request.passphraseLabel ?? t('settings.encryption_mode_passphrase')}
                    placeholder={request.passphraseLabel ?? t('settings.encryption_mode_passphrase')}
                    className="w-full bg-transparent border-0 text-sm text-app-text outline-none placeholder:text-app-text-tertiary"
                    disabled={submitting}
                    autoComplete="new-password"
                />
                <button
                    type="button"
                    onClick={() => setRevealPassphrase(value => !value)}
                    aria-label={revealPassphrase ? t('settings.hide_passphrase') : t('settings.show_passphrase')}
                    className="shrink-0 rounded-lg p-1 text-app-text-tertiary hover:text-app-text"
                >
                    {revealPassphrase ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                </button>
            </div>
            {!passphraseValid && passphrase.length > 0 && (
                <p className="text-[11px] text-app-danger">{t('settings.min_passphrase_length')}</p>
            )}
            {request.confirmPassphrase && (
                <>
                    <div className="glass-field flex items-center gap-2.5 rounded-2xl px-3.5 py-3">
                        <input
                            type={revealPassphrase ? 'text' : 'password'}
                            value={confirmation}
                            onChange={event => setConfirmation(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    handleSubmit();
                                }
                            }}
                            aria-label={request.confirmLabel ?? t('settings.confirm_passphrase')}
                            placeholder={request.confirmLabel ?? t('settings.confirm_passphrase')}
                            className="w-full bg-transparent border-0 text-sm text-app-text outline-none placeholder:text-app-text-tertiary"
                            disabled={submitting}
                            autoComplete="new-password"
                        />
                    </div>
                    {passphraseValid && confirmation.length > 0 && !confirmationValid && (
                        <p className="text-[11px] text-app-danger">{t('settings.passphrases_no_match')}</p>
                    )}
                </>
            )}
            {request.requireAcknowledgement && (
                <label className="flex items-start gap-2.5 rounded-xl border border-app-border-subtle bg-app-surface-raised/60 p-3">
                    <input
                        type="checkbox"
                        checked={acknowledged}
                        onChange={event => setAcknowledged(event.target.checked)}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-app-accent"
                    />
                    <span className="text-[11px] leading-5 text-app-text-secondary">{t('settings.encryption_disclaimer_acknowledgement')}</span>
                </label>
            )}
        </div>
    );

    const actions = (
        <div className="flex gap-3">
            <button
                type="button"
                onClick={() => handleClose(null)}
                className="press-row min-h-12 flex-1 rounded-2xl bg-app-hover px-4 py-3 text-sm font-semibold text-app-text-secondary transition-colors hover:text-app-text disabled:opacity-40"
                disabled={submitting}
            >
                {t('common.cancel')}
            </button>
            <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="press-row min-h-12 flex-1 rounded-2xl bg-app-accent px-4 py-3 text-sm font-semibold text-app-accent-contrast transition-opacity hover:bg-app-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
                {submitting
                    ? <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-app-accent-contrast/30 border-t-app-accent-contrast" aria-hidden="true" />
                    : (request.submitLabel ?? t('auth.continue'))}
            </button>
        </div>
    );

    return isAndroidPlatform ? (
        <BottomSheet
            onClose={() => handleClose(null)}
            title={request.title}
            ariaLabel={request.title}
        >
            {fields}
            <div className="mt-4">{actions}</div>
        </BottomSheet>
    ) : (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-app-overlay p-4 backdrop-blur-sm">
            <div ref={panelRef} role="dialog" aria-modal="true" aria-label={request.title} tabIndex={-1} className="quiet-raised w-[min(520px,calc(100vw-2rem))] p-5">
                <h2 className="text-lg font-semibold text-app-text">{request.title}</h2>
                {fields}
                <div className="mt-4">{actions}</div>
            </div>
        </div>
    );
}
