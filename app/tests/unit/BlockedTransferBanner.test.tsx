import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BlockedTransferBanner } from '../../src/components/mobile/BlockedTransferBanner';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'activity.status_paused') return 'Paused';
      if (key === 'common.retry') return 'Retry';
      if (key === 'common.transfers') return 'Transfers';
      if (key === 'common.close') return 'Close';
      return key;
    },
  }),
}));

describe('BlockedTransferBanner', () => {
  it('renders transfer count, status, and the blocked reason', () => {
    render(
      <BlockedTransferBanner
        blockedCount={3}
        reason="Waiting for an unmetered Wi-Fi connection"
        onRetry={vi.fn()}
        onOpenTransfers={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText('3 · Paused')).toBeTruthy();
    expect(screen.getByText('Waiting for an unmetered Wi-Fi connection')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('triggers onRetry when retry button is pressed', () => {
    const handleRetry = vi.fn();
    render(
      <BlockedTransferBanner
        blockedCount={1}
        reason="Transfers are paused while roaming"
        onRetry={handleRetry}
        onOpenTransfers={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(handleRetry).toHaveBeenCalledTimes(1);
  });

  it('triggers onOpenTransfers when transfers button is pressed', () => {
    const handleOpenTransfers = vi.fn();
    render(
      <BlockedTransferBanner
        blockedCount={2}
        reason="Waiting for the device to charge"
        onRetry={vi.fn()}
        onOpenTransfers={handleOpenTransfers}
        onDismiss={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Transfers' }));
    expect(handleOpenTransfers).toHaveBeenCalledTimes(1);
  });

  it('triggers onDismiss when close button is pressed', () => {
    const handleDismiss = vi.fn();
    render(
      <BlockedTransferBanner
        blockedCount={5}
        reason="Checking Android transfer conditions"
        onRetry={vi.fn()}
        onOpenTransfers={vi.fn()}
        onDismiss={handleDismiss}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(handleDismiss).toHaveBeenCalledTimes(1);
  });
});
