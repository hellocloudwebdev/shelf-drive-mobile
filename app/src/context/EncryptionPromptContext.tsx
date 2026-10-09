import { createContext, lazy, ReactNode, Suspense, useCallback, useContext, useRef, useState } from 'react';

export interface FilePassphraseRequest {
    title: string;
    message?: string;
    /** Shows the key-loss disclaimer and blocks submission until it is acknowledged. */
    requireAcknowledgement?: boolean;
    /** Asks for the passphrase twice and blocks submission until both entries match. */
    confirmPassphrase?: boolean;
    passphraseLabel?: string;
    confirmLabel?: string;
    submitLabel?: string;
}

interface EncryptionPromptContextValue {
    requestFilePassphrase: (request: FilePassphraseRequest) => Promise<string | null>;
}

interface ActiveRequest {
    request: FilePassphraseRequest;
    resolve: (passphrase: string | null) => void;
}

const EncryptionPromptSheet = lazy(() => import('../components/shared/EncryptionPromptSheet'));

const EncryptionPromptContext = createContext<EncryptionPromptContextValue | null>(null);

/**
 * Promise-based file-passphrase prompt used by the transfer hooks.
 *
 * Replaces the native `window.confirm`/`window.prompt` flow, which Android
 * WebViews may suppress — a suppressed prompt used to resolve `null` and
 * silently cancel or stall encrypted transfers. One prompt is open at a
 * time; a request that arrives while another is open resolves `null`
 * immediately, so the caller aborts instead of queueing a second dialog.
 */
export function EncryptionPromptProvider({ children }: { children: ReactNode }) {
    const [active, setActive] = useState<ActiveRequest | null>(null);
    const activeRef = useRef<ActiveRequest | null>(null);

    const close = useCallback((result: string | null) => {
        const request = activeRef.current;
        activeRef.current = null;
        setActive(null);
        request?.resolve(result);
    }, []);

    const requestFilePassphrase = useCallback((request: FilePassphraseRequest) => new Promise<string | null>((resolve) => {
        if (activeRef.current) {
            console.warn('[EncryptionPrompt] A passphrase prompt is already open; cancelling the new request.');
            resolve(null);
            return;
        }
        const entry: ActiveRequest = { request, resolve };
        activeRef.current = entry;
        setActive(entry);
    }), []);

    return (
        <EncryptionPromptContext.Provider value={{ requestFilePassphrase }}>
            {children}
            {active && (
                <Suspense fallback={null}>
                    <EncryptionPromptSheet
                        request={active.request}
                        onClose={close}
                    />
                </Suspense>
            )}
        </EncryptionPromptContext.Provider>
    );
}

export function useEncryptionPrompt() {
    const value = useContext(EncryptionPromptContext);
    if (!value) throw new Error('useEncryptionPrompt must be used within EncryptionPromptProvider');
    return value;
}
