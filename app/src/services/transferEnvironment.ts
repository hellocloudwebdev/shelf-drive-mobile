import { android } from '../api/index';
import type { AndroidTransferEnvironment } from './androidTransferPolicy';

export interface TransferEnvironmentQueryOptions {
    /** Total attempts including the first one. Defaults to 3. */
    attempts?: number;
    /** Delay before the first retry, doubled for each further retry. Defaults to 400ms. */
    baseDelayMs?: number;
    /** Upper bound for a single retry delay. Defaults to 4s. */
    maxDelayMs?: number;
    /** Overrides the backend call; used by tests. */
    fetchEnvironment?: () => Promise<AndroidTransferEnvironment>;
    /** Overrides the retry delay; used by tests. */
    delay?: (ms: number) => Promise<void>;
}

interface QueryState {
    inFlight: Promise<AndroidTransferEnvironment> | null;
}

const state: QueryState = { inFlight: null };

const defaultDelay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function queryWithRetries(options: TransferEnvironmentQueryOptions): Promise<AndroidTransferEnvironment> {
    const attempts = Math.max(1, options.attempts ?? 3);
    const baseDelayMs = Math.max(0, options.baseDelayMs ?? 400);
    const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 4_000);
    const fetchEnvironment = options.fetchEnvironment ?? (() => android.getTransferEnvironment());
    const wait = options.delay ?? defaultDelay;

    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await fetchEnvironment();
        } catch (error) {
            lastError = error;
            if (attempt < attempts) {
                await wait(Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)));
            }
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Reads the Android transfer environment with bounded retries and backoff.
 *
 * The JNI bridge behind `cmd_get_android_transfer_environment` fails
 * transiently while the activity class cache is still initializing and right
 * after process starts, before `appContext` is published. Without retries a
 * single failure left transfer queues silently blocked. Concurrent callers
 * share one in-flight attempt chain so several queue items starting at once
 * cannot stampede the bridge.
 *
 * Failure is thrown to the caller after the final attempt — the transfer
 * gates keep treating an unknown environment as blocked.
 */
export function queryAndroidTransferEnvironment(options: TransferEnvironmentQueryOptions = {}): Promise<AndroidTransferEnvironment> {
    if (state.inFlight) return state.inFlight;
    const attemptChain = queryWithRetries(options).finally(() => {
        if (state.inFlight === attemptChain) state.inFlight = null;
    });
    state.inFlight = attemptChain;
    return attemptChain;
}

/** Clears the shared in-flight promise; only for tests. */
export function resetTransferEnvironmentQueryForTests(): void {
    state.inFlight = null;
}
