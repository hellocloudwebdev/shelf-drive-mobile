import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdaptiveMediaPlayer } from '../../src/components/desktop/dashboard/AdaptiveMediaPlayer';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  invokeVoid: vi.fn(),
  progressiveCallback: null as (() => void) | null,
  streamUrls: [] as string[],
  useFallback: true,
  msePhase: 'error' as 'error' | 'ready',
}));

vi.mock('../../src/api/tauri', () => ({
  tauriInvoke: mocks.invoke,
  tauriInvokeVoid: mocks.invokeVoid,
  tauriListen: vi.fn().mockResolvedValue(() => {}),
  tauriConvertFileSrc: vi.fn().mockReturnValue('asset://localhost/test'),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onResized: vi.fn().mockResolvedValue(() => {}),
    isFullscreen: vi.fn().mockResolvedValue(false),
    setFullscreen: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/hooks/useAdaptiveStreaming', () => ({
  useAdaptiveStreaming: (streamUrl: string, _fileName: string, onProgressiveDetected?: () => void) => {
    mocks.streamUrls.push(streamUrl);
    mocks.progressiveCallback = onProgressiveDetected || null;
    return {
      videoRef: { current: null },
      phase: mocks.msePhase,
      error: "Invalid data found while parsing box of type '=\u00ca\u0001\u00c0' at position 75037999.",
      tracks: [],
      loadProgress: 0,
      currentQuality: 'original',
      setQuality: vi.fn(),
      adaptiveMode: true,
      setAdaptiveMode: vi.fn(),
      measuredKbps: 0,
      seek: vi.fn(),
      useFallback: mocks.useFallback,
      fallbackUrl: streamUrl,
      abort: vi.fn(),
    };
  },
}));

describe('AdaptiveMediaPlayer native fallback', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.invokeVoid.mockReset().mockResolvedValue(undefined);
    mocks.progressiveCallback = null;
    mocks.streamUrls.length = 0;
    mocks.useFallback = true;
    mocks.msePhase = 'error';
    localStorage.removeItem('debug_overlay');
  });

  it('ignores and cancels a transcode preparation that resolves after a newer quality is selected', async () => {
    mocks.useFallback = false;
    mocks.msePhase = 'ready';
    let resolveOldPreparation: ((value: { status: string; job_id: string }) => void) | undefined;
    let prepareCount = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_get_transcode_capabilities') {
        return Promise.resolve({ available: true, variants: [], mode: 'original' });
      }
      if (command === 'cmd_prepare_transcoded_stream') {
        prepareCount += 1;
        if (prepareCount === 1) return new Promise(resolve => { resolveOldPreparation = resolve; });
        return Promise.resolve({ status: 'ready', playlist_url: '/480/index.m3u8' });
      }
      return Promise.resolve(undefined);
    });

    render(<AdaptiveMediaPlayer file={{ id: 42, name: 'video.mp4', size: 100, sizeStr: '100 B' }} activeFolderId={null} onClose={vi.fn()} streamUrl="http://127.0.0.1:14201/stream/home/42?token=token" />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: '720p' }).length).toBeGreaterThan(0));

    fireEvent.click(screen.getAllByRole('button', { name: '720p' })[0]);
    await waitFor(() => expect(prepareCount).toBe(1));
    fireEvent.click(screen.getAllByRole('button', { name: '480p' })[0]);
    await waitFor(() => expect(prepareCount).toBe(2));

    await act(async () => {
      resolveOldPreparation?.({ status: 'processing', job_id: 'job-720' });
      await Promise.resolve();
    });
    await new Promise(resolve => setTimeout(resolve, 1100));

    expect(mocks.invoke.mock.calls.some(([command]) => command === 'cmd_get_transcode_status')).toBe(false);
    expect(mocks.invokeVoid.mock.calls.some(([command]) => command === 'cmd_cancel_transcode')).toBe(true);
  });

  it('keeps parser and background-remux state from covering playable native video', async () => {
    let finishRemux: ((value: { url: string; output_file_key: string; status: string }) => void) | undefined;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_get_transcode_capabilities') {
        return Promise.resolve({ available: true, variants: [], mode: 'original' });
      }
      if (command === 'cmd_prepare_fmp4_stream') {
        return new Promise(resolve => { finishRemux = resolve; });
      }
      return Promise.resolve(undefined);
    });

    const streamUrl = 'http://127.0.0.1:14201/stream/home/42?token=session-token';
    const { container } = render(
      <AdaptiveMediaPlayer
        file={{ id: 42, name: 'tail-moov.mp4', size: 80_000_000, sizeStr: '76.3 MB' }}
        activeFolderId={null}
        onClose={vi.fn()}
        streamUrl={streamUrl}
      />,
    );

    await waitFor(() => expect(mocks.progressiveCallback).toBeTypeOf('function'));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('cmd_get_transcode_capabilities'));

    act(() => mocks.progressiveCallback?.());

    expect(screen.queryByText('Playback Error')).toBeNull();
    expect(screen.queryByText('Converting to streaming format...')).toBeNull();

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    fireEvent.loadedData(video!);
    fireEvent.playing(video!);

    await act(async () => {
      finishRemux?.({ url: '/fmp4/0_42.mp4', output_file_key: '0_42', status: 'ready' });
      await Promise.resolve();
    });

    expect(screen.queryByText('Playback Error')).toBeNull();
    expect(screen.queryByText('Converting to streaming format...')).toBeNull();
    expect(mocks.streamUrls.every(url => url.startsWith(streamUrl))).toBe(true);
  });

  it('clears the account-scoped key returned by the backend for the displayed media', async () => {
    localStorage.setItem('debug_overlay', '1');
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_get_master_playlist_info') return Promise.resolve({ file_key: '123_0_42', variants: [], master_playlist_url: null });
      if (command === 'cmd_clear_transcode_cache') return Promise.resolve('Cleared selected file');
      return Promise.resolve({ available: false, variants: [], mode: 'original' });
    });
    render(<AdaptiveMediaPlayer file={{ id: 42, name: 'video.mp4', size: 100, sizeStr: '100 B' }} activeFolderId={null} onClose={vi.fn()} streamUrl="http://127.0.0.1:14201/stream/home/42?token=token" />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear Transcodes' }));

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('cmd_clear_transcode_cache', { fileKey: '123_0_42' }));
    expect(mocks.invoke).toHaveBeenCalledWith('cmd_get_master_playlist_info', { messageId: 42, folderId: null });
    expect(mocks.invoke).not.toHaveBeenCalledWith('cmd_clear_transcode_cache', { fileKey: '0_42' });
  });

  it.each([undefined, ''])('never turns a missing backend key (%s) into clear-all', async fileKey => {
    localStorage.setItem('debug_overlay', '1');
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_get_master_playlist_info') return Promise.resolve({ file_key: fileKey });
      return Promise.resolve({ available: false, variants: [], mode: 'original' });
    });
    render(<AdaptiveMediaPlayer file={{ id: 42, name: 'video.mp4', size: 100, sizeStr: '100 B' }} activeFolderId={null} onClose={vi.fn()} streamUrl="http://127.0.0.1:14201/stream/home/42?token=token" />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear Transcodes' }));

    await waitFor(() => expect((screen.getByRole('button', { name: 'Clear Transcodes' }) as HTMLButtonElement).disabled).toBe(false));
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'cmd_clear_transcode_cache')).toBe(false);
  });

  it('discards a late cache identity when the source changes and allows clearing the new file', async () => {
    localStorage.setItem('debug_overlay', '1');
    let finishLookup: ((value: { file_key: string }) => void) | undefined;
    mocks.invoke.mockImplementation((command: string, args?: { messageId?: number }) => {
      if (command === 'cmd_get_master_playlist_info') return args?.messageId === 42
        ? new Promise(resolve => { finishLookup = resolve; })
        : Promise.resolve({ file_key: '123_7_43' });
      return Promise.resolve({ available: false, variants: [], mode: 'original' });
    });
    const { rerender } = render(<AdaptiveMediaPlayer file={{ id: 42, name: 'first.mp4', size: 100, sizeStr: '100 B' }} activeFolderId={null} onClose={vi.fn()} streamUrl="http://127.0.0.1:14201/stream/home/42?token=token" />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear Transcodes' }));

    rerender(<AdaptiveMediaPlayer file={{ id: 43, name: 'second.mp4', size: 100, sizeStr: '100 B' }} activeFolderId={7} onClose={vi.fn()} streamUrl="http://127.0.0.1:14201/stream/7/43?token=token" />);
    await act(async () => { finishLookup?.({ file_key: '123_0_42' }); });
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'cmd_clear_transcode_cache')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Clear Transcodes' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('cmd_clear_transcode_cache', { fileKey: '123_7_43' }));
  });

  it('does not clear a cache when its key arrives after the player closes', async () => {
    localStorage.setItem('debug_overlay', '1');
    let finishLookup: ((value: { file_key: string }) => void) | undefined;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'cmd_get_master_playlist_info') return new Promise(resolve => { finishLookup = resolve; });
      return Promise.resolve({ available: false, variants: [], mode: 'original' });
    });
    const { unmount } = render(<AdaptiveMediaPlayer file={{ id: 42, name: 'video.mp4', size: 100, sizeStr: '100 B' }} activeFolderId={null} onClose={vi.fn()} streamUrl="http://127.0.0.1:14201/stream/home/42?token=token" />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear Transcodes' }));
    unmount();

    await act(async () => { finishLookup?.({ file_key: '123_0_42' }); });

    expect(mocks.invoke.mock.calls.some(([command]) => command === 'cmd_clear_transcode_cache')).toBe(false);
  });
});
