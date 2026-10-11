import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUpdateCheck } from '../../src/hooks/useUpdateCheck';
import { RELEASES_URL } from '../../src/services/installationInfo';

describe('useUpdateCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    history.replaceState(null, '', '/');
  });
  afterEach(() => { vi.useRealTimers(); });

  it('does not run the startup update check in the browser preview', async () => {
    history.replaceState(null, '', '/?mobile');
    vi.useFakeTimers();
    const { result } = renderHook(() => useUpdateCheck());

    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });

    expect(result.current.checking).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not run an explicit update check in the browser preview', async () => {
    history.replaceState(null, '', '/?mobile');
    const { result } = renderHook(() => useUpdateCheck());

    await act(async () => { await result.current.checkForUpdates(); });

    // No IPC backend exists in the preview; the guard must prevent the
    // failed-check error state without touching native Android checking.
    expect(result.current.checking).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.available).toBe(false);
  });

  it('points the manual-release fallback at the mobile repository', () => {
    // SHARED_CORE_SYNC.md: the mobile repo's RELEASES_URL may point at the
    // mobile repository instead of the desktop one.
    expect(RELEASES_URL).toContain('github.com/hellocloudwebdev/shelf-drive-mobile/');
  });
});
