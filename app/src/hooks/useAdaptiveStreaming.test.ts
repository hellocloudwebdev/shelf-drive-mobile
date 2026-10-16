import { describe, expect, it, vi } from 'vitest';
import { AdaptiveQualityController } from './useAdaptiveStreaming';
import { dispatchQualityTransition } from '../components/desktop/dashboard/AdaptiveMediaPlayer';

describe('adaptive quality selection', () => {
    it('reevaluates multiple down/up bandwidth changes and dispatches HLS transcode requests', () => {
        const controller = new AdaptiveQualityController();
        const prepareTranscodedStream = vi.fn();
        const setManualQuality = vi.fn();
        const requests: string[] = [];
        const observe = (kbps: number) => {
            const next = controller.update(kbps);
            if (!next) return;
            dispatchQualityTransition(next, true, {
                setManualQuality,
                transcodeAvailable: true,
                startTranscode: quality => {
                    requests.push(quality);
                    prepareTranscodedStream(quality);
                },
                switchToOriginal: vi.fn(),
                useThrottle: vi.fn(),
            });
        };

        for (const speed of [500, 500, 1100, 1100, 2500, 2500, 5000, 5000,
            3000, 3000, 1200, 1200, 500, 500, 1300, 1300, 2500, 2500, 5000, 5000]) {
            observe(speed);
        }

        expect(requests).toEqual([
            '360p', '480p', '720p', '1080p',
            '720p', '480p', '360p', '480p', '720p', '1080p',
        ]);
        expect(prepareTranscodedStream.mock.calls).toEqual(requests.map(q => [q]));
        // Auto-selected tiers must not overwrite the user's persisted/manual preference.
        expect(setManualQuality).not.toHaveBeenCalled();
    });

    it('does not oscillate around an adjacent-tier boundary', () => {
        const controller = new AdaptiveQualityController();
        expect(controller.update(1000)).toBeNull();
        expect(controller.update(1000)).toBe('480p');

        const changes = [1950, 2050, 1900, 2150, 1850, 2200, 2000, 1950]
            .map(speed => controller.update(speed))
            .filter((quality): quality is NonNullable<typeof quality> => quality !== null);
        expect(changes).toEqual([]);
    });

    it('requires two stable samples before switching, including after a noisy candidate', () => {
        const controller = new AdaptiveQualityController();
        expect(controller.update(1000)).toBeNull();
        expect(controller.update(1000)).toBe('480p');
        expect(controller.update(2500)).toBeNull();
        expect(controller.update(2200)).toBeNull();
        expect(controller.update(2500)).toBeNull();
        expect(controller.update(2600)).toBe('720p');
    });

    it('uses bandwidth throttling when HLS transcoding is unavailable', () => {
        const setManualQuality = vi.fn();
        const startTranscode = vi.fn();
        const useThrottle = vi.fn();
        dispatchQualityTransition('480p', true, {
            setManualQuality,
            transcodeAvailable: false,
            startTranscode,
            switchToOriginal: vi.fn(),
            useThrottle,
        });
        expect(useThrottle).toHaveBeenCalledWith('480p');
        expect(startTranscode).not.toHaveBeenCalled();
        expect(setManualQuality).not.toHaveBeenCalled();
    });
});
