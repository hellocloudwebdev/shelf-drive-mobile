import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DeferredCrashReportingConsent } from '../../src/components/shared/DeferredCrashReportingConsent';

const { loadConsent } = vi.hoisted(() => ({ loadConsent: vi.fn() }));
vi.mock('../../src/components/shared/CrashReportingConsent', () => {
    loadConsent();
    return { CrashReportingConsent: () => <div role="dialog">Crash reporting preference</div> };
});

it('loads the consent presentation only after settings gating mounts it', async () => {
    const { rerender } = render(<>{false && <DeferredCrashReportingConsent />}</>);
    expect(loadConsent).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(<DeferredCrashReportingConsent />);
    expect((await screen.findByRole('dialog')).textContent).toBe('Crash reporting preference');
    expect(loadConsent).toHaveBeenCalledTimes(1);
});
