import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UpdateBanner } from './UpdateBanner';
import '../../i18n';
import type { UpdateInstallPhase } from '../../services/updateReliability';

const defaultProps = {
    available: true,
    version: '4.6.0',
    downloading: false,
    progress: 0,
    phase: null as UpdateInstallPhase | null,
    managedByPackageManager: false,
    onUpdate: vi.fn(),
    onDismiss: vi.fn(),
};

describe('UpdateBanner', () => {
    it('adds top safe-area padding and stacks its contents below the mobile breakpoint', () => {
        const { container } = render(<UpdateBanner {...defaultProps} />);
        const banner = container.querySelector('.fixed');
        const content = banner?.firstElementChild;

        expect(banner?.getAttribute('style')).toContain('max(env(safe-area-inset-top, 0px), var(--update-banner-inset, 24px))');
        expect(banner?.className).toContain('sm:[--update-banner-inset:0px]');
        expect(content?.className).toContain('flex-col');
        expect(content?.className).toContain('sm:flex-row');
        expect(content?.className).toContain('sm:gap-4');
        expect(screen.getByText('A new version (4.6.0) is available!')).toBeTruthy();
    });

    it('keeps update and dismiss actions available and selects the package-manager action label', () => {
        const onUpdate = vi.fn();
        const onDismiss = vi.fn();
        render(
            <UpdateBanner
                {...defaultProps}
                managedByPackageManager
                onUpdate={onUpdate}
                onDismiss={onDismiss}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'common.open' }));
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(onUpdate).toHaveBeenCalledOnce();
        expect(onDismiss).toHaveBeenCalledOnce();
    });

    it.each([
        ['downloading', 42, 'Downloading update… 42%'],
        ['verifying', 100, 'Verifying signed update…'],
        ['installing', 100, 'Installing update…'],
    ] as const)('shows the %s progress state without update/dismiss actions', (phase, progress, message) => {
        render(
            <UpdateBanner
                {...defaultProps}
                downloading
                progress={progress}
                phase={phase}
            />,
        );

        expect(screen.getByText(message)).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('renders nothing when no update is available', () => {
        const { container } = render(<UpdateBanner {...defaultProps} available={false} />);
        expect(container.querySelector('.fixed')).toBeNull();
    });
});
