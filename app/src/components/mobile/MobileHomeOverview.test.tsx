import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { deriveMobileOverviewStats, MobileHomeOverview } from './MobileHomeOverview';
import type { TelegramFile } from '../../types';

const file = (id: number, name: string, size: number, type: TelegramFile['type'] = 'file'): TelegramFile => ({
  id,
  name,
  size,
  sizeStr: `${size} bytes`,
  type,
});

describe('deriveMobileOverviewStats', () => {
  it('counts files and category totals from the actual listing while excluding folders', () => {
    const files: TelegramFile[] = [
      file(1, 'sunset.jpg', 120),
      { ...file(2, 'clip.mp4', 350), mime_type: 'video/mp4' },
      file(3, 'notes.pdf', 80),
      file(4, 'Trips/', 0, 'folder'),
    ];

    expect(deriveMobileOverviewStats(files)).toEqual({
      fileCount: 3,
      knownBytes: 550,
      photos: 1,
      videos: 1,
      documents: 1,
    });
  });

  it('does not invent usage for empty or invalid-size listings', () => {
    expect(deriveMobileOverviewStats([])).toEqual({ fileCount: 0, knownBytes: 0, photos: 0, videos: 0, documents: 0 });
    expect(deriveMobileOverviewStats([file(1, 'empty.bin', Number.NaN)])).toEqual({
      fileCount: 1,
      knownBytes: 0,
      photos: 0,
      videos: 0,
      documents: 1,
    });
  });

  it('renders live category counts and opens the selected category', () => {
    const onNavigate = vi.fn();
    const files: TelegramFile[] = [file(1, 'photo.png', 100), file(2, 'report.pdf', 200)];
    render(
      <MobileHomeOverview
        files={files}
        loading={false}
        contextLabel="Saved Messages"
        labels={{ overview: 'Overview', files: 'Files', knownSize: 'Size', photos: 'Photos', videos: 'Videos', documents: 'Documents' }}
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Photos, 1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Documents, 1' }));
    expect(onNavigate).toHaveBeenCalledWith('documents');
  });
});
