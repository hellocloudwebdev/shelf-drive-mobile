import { describe, expect, it, vi } from 'vitest';
import { installMobileZoomGuard, isMobileRuntime, lockViewportScale } from './mobileZoomGuard';

type Listener = (event: any) => void;

function makeHarness(userAgent: string, maxTouchPoints: number, viewportContent?: string | null) {
  const document = window.document.implementation.createHTMLDocument();
  if (viewportContent !== null) {
    const viewport = document.createElement('meta');
    viewport.name = 'viewport';
    viewport.content = viewportContent ?? 'width=device-width, initial-scale=1.0, viewport-fit=cover';
    document.head.append(viewport);
  }

  const windowListeners = new Map<string, Listener[]>();
  const documentListeners = new Map<string, Listener[]>();

  const win = {
    navigator: { userAgent, maxTouchPoints },
    matchMedia: (query: string) => ({ matches: query === '(pointer: coarse)' && maxTouchPoints > 0 }),
    document,
    addEventListener: (type: string, listener: Listener) => {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), listener]);
    },
  };

  const originalAdd = document.addEventListener.bind(document);
  document.addEventListener = ((type: string, listener: Listener) => {
    documentListeners.set(type, [...(documentListeners.get(type) ?? []), listener]);
    originalAdd(type, listener);
  }) as typeof document.addEventListener;

  const dispatch = (type: string, event: Record<string, unknown> = {}) => {
    const listeners = [...(documentListeners.get(type) ?? []), ...(windowListeners.get(type) ?? [])];
    const fullEvent = {
      cancelable: true,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      touches: [],
      ...event,
    };
    listeners.forEach((listener) => listener(fullEvent));
    return fullEvent;
  };

  return { document, win, dispatch, windowListeners, documentListeners };
}

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128 Safari/537.36';

describe('isMobileRuntime', () => {
  it('detects Android phones', () => {
    expect(isMobileRuntime({ navigator: { userAgent: ANDROID_UA, maxTouchPoints: 5 } })).toBe(true);
  });

  it('detects iPadOS reporting a desktop user agent', () => {
    expect(
      isMobileRuntime({
        navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 },
      }),
    ).toBe(true);
  });

  it('detects coarse-pointer touch devices without a mobile user agent', () => {
    expect(
      isMobileRuntime({
        navigator: { userAgent: 'Linux aarch64', maxTouchPoints: 5 },
        matchMedia: (query: string) => ({ matches: query === '(pointer: coarse)' }),
      }),
    ).toBe(true);
  });

  it('leaves desktop browsers alone', () => {
    expect(
      isMobileRuntime({
        navigator: { userAgent: DESKTOP_UA, maxTouchPoints: 0 },
        matchMedia: () => ({ matches: false }),
      }),
    ).toBe(false);
  });
});

describe('lockViewportScale', () => {
  it('pins scale without duplicating existing directives', () => {
    const { document } = makeHarness(ANDROID_UA, 5, 'width=device-width, user-scalable=yes, maximum-scale=4');

    expect(lockViewportScale(document)).toBe(true);

    const content = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content ?? '';
    expect(content).toContain('width=device-width');
    expect(content).toContain('maximum-scale=1.0');
    expect(content).toContain('minimum-scale=1.0');
    expect(content).toContain('user-scalable=no');
    expect(content).not.toContain('maximum-scale=4');
    expect(content).not.toContain('user-scalable=yes');
    expect(content.match(/maximum-scale/g)).toHaveLength(1);
  });

  it('returns false without a viewport meta tag', () => {
    const { document } = makeHarness(ANDROID_UA, 5, null);
    expect(lockViewportScale(document)).toBe(false);
  });
});

describe('installMobileZoomGuard', () => {
  it('activates on mobile and pins the viewport plus injects the stylesheet', () => {
    const { document, win } = makeHarness(ANDROID_UA, 5);

    expect(installMobileZoomGuard(win)).toBe(true);

    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    expect(viewport?.content).toContain('user-scalable=no');
    expect(document.getElementById('shelf-drive-mobile-zoom-guard')).not.toBeNull();
  });

  it('does not activate on desktop so browser zoom keeps working', () => {
    const { document, win } = makeHarness(DESKTOP_UA, 0);
    const before = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content;

    expect(installMobileZoomGuard(win)).toBe(false);
    expect(document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content).toBe(before);
    expect(document.getElementById('shelf-drive-mobile-zoom-guard')).toBeNull();
  });

  it('injects the stylesheet only once', () => {
    const { document, win } = makeHarness(ANDROID_UA, 5);

    installMobileZoomGuard(win);
    installMobileZoomGuard(win);

    expect(document.querySelectorAll('#shelf-drive-mobile-zoom-guard')).toHaveLength(1);
  });

  it('blocks pinch gestures and two-finger touch moves', () => {
    const { win, dispatch } = makeHarness(ANDROID_UA, 5);
    installMobileZoomGuard(win);

    expect(dispatch('gesturestart').preventDefault).toHaveBeenCalled();
    expect(dispatch('gesturechange').preventDefault).toHaveBeenCalled();
    expect(dispatch('touchmove', { touches: [{}, {}] }).preventDefault).toHaveBeenCalled();
  });

  it('still allows one-finger scrolling', () => {
    const { win, dispatch } = makeHarness(ANDROID_UA, 5);
    installMobileZoomGuard(win);

    expect(dispatch('touchmove', { touches: [{}] }).preventDefault).not.toHaveBeenCalled();
  });

  it('blocks ctrl+wheel but not plain wheel scrolling', () => {
    const { win, dispatch } = makeHarness(ANDROID_UA, 5);
    installMobileZoomGuard(win);

    expect(dispatch('wheel', { ctrlKey: true }).preventDefault).toHaveBeenCalled();
    expect(dispatch('wheel', { ctrlKey: false }).preventDefault).not.toHaveBeenCalled();
  });

  it('suppresses double-tap zoom from a synthesised dblclick', () => {
    const { win, dispatch } = makeHarness(ANDROID_UA, 5);
    installMobileZoomGuard(win);

    expect(dispatch('dblclick').preventDefault).toHaveBeenCalled();
  });
});
