import { describe, expect, it, vi } from 'vitest';
import { installMobileZoomGuard, lockViewportScale } from './mobileZoomGuard';

type Listener = (event: any) => void;

function makeHarness(userAgent: string, viewportContent?: string | null, isTauri = false) {
  const document = window.document.implementation.createHTMLDocument();
  if (viewportContent !== null) {
    const viewport = document.createElement('meta');
    viewport.name = 'viewport';
    viewport.content = viewportContent ?? 'width=device-width, initial-scale=1.0, viewport-fit=cover';
    document.head.append(viewport);
  }

  const windowListeners = new Map<string, Listener[]>();
  const documentListeners = new Map<string, Listener[]>();
  const documentListenerOptions = new Map<string, AddEventListenerOptions[]>();

  const win = {
    navigator: { userAgent },
    document,
    ...(isTauri ? { __TAURI_INTERNALS__: {} } : {}),
    addEventListener: (type: string, listener: Listener) => {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), listener]);
    },
  };

  const originalAdd = document.addEventListener.bind(document);
  document.addEventListener = ((type: string, listener: Listener, options?: AddEventListenerOptions) => {
    documentListeners.set(type, [...(documentListeners.get(type) ?? []), listener]);
    documentListenerOptions.set(type, [...(documentListenerOptions.get(type) ?? []), options ?? {}]);
    originalAdd(type, listener);
  }) as typeof document.addEventListener;

  const dispatch = (type: string, event: Record<string, unknown> = {}) => {
    const listeners = [...(documentListeners.get(type) ?? []), ...(windowListeners.get(type) ?? [])];
    const fullEvent = {
      cancelable: true,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      touches: [],
      target: { closest: () => null },
      ...event,
    };
    listeners.forEach((listener) => listener(fullEvent));
    return fullEvent;
  };

  return { document, win, dispatch, windowListeners, documentListeners, documentListenerOptions };
}

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128 Safari/537.36';

describe('lockViewportScale', () => {
  it('pins scale without duplicating existing directives', () => {
    const { document } = makeHarness(ANDROID_UA, 'width=device-width, user-scalable=yes, maximum-scale=4');

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
    const { document } = makeHarness(ANDROID_UA, null);
    expect(lockViewportScale(document)).toBe(false);
  });
});

describe('installMobileZoomGuard', () => {
  it('activates in Android Tauri and pins the viewport plus injects the stylesheet', () => {
    const { document, win } = makeHarness(ANDROID_UA, undefined, true);

    expect(installMobileZoomGuard(win)).toBe(true);

    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    expect(viewport?.content).toContain('user-scalable=no');
    expect(document.getElementById('shelf-drive-mobile-zoom-guard')).not.toBeNull();
  });

  it('leaves desktop and mobile browsers untouched so accessibility zoom remains available', () => {
    const { document: desktopDocument, win: desktopWin } = makeHarness(DESKTOP_UA);
    const { document, win } = makeHarness(ANDROID_UA);
    const before = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content;

    expect(installMobileZoomGuard(desktopWin)).toBe(false);
    expect(installMobileZoomGuard(win)).toBe(false);
    expect(document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content).toBe(before);
    expect(document.getElementById('shelf-drive-mobile-zoom-guard')).toBeNull();
    expect(desktopDocument.getElementById('shelf-drive-mobile-zoom-guard')).toBeNull();
  });

  it('injects the stylesheet only once', () => {
    const { document, win } = makeHarness(ANDROID_UA, undefined, true);

    installMobileZoomGuard(win);
    installMobileZoomGuard(win);

    expect(document.querySelectorAll('#shelf-drive-mobile-zoom-guard')).toHaveLength(1);
  });

  it('blocks pinch gestures and two-finger touch moves with cancellable listeners', () => {
    const { win, dispatch, documentListenerOptions } = makeHarness(ANDROID_UA, undefined, true);
    installMobileZoomGuard(win);

    expect(dispatch('gesturestart').preventDefault).toHaveBeenCalled();
    expect(dispatch('gesturechange').preventDefault).toHaveBeenCalled();
    expect(dispatch('touchmove', { touches: [{}, {}] }).preventDefault).toHaveBeenCalled();
    expect(documentListenerOptions.get('gesturestart')?.[0]).toMatchObject({ passive: false, capture: true });
  });

  it('still allows one-finger scrolling', () => {
    const { win, dispatch } = makeHarness(ANDROID_UA, undefined, true);
    installMobileZoomGuard(win);

    expect(dispatch('touchmove', { touches: [{}] }).preventDefault).not.toHaveBeenCalled();
  });

  it('blocks ctrl+wheel but not plain wheel scrolling', () => {
    const { win, dispatch } = makeHarness(ANDROID_UA, undefined, true);
    installMobileZoomGuard(win);

    expect(dispatch('wheel', { ctrlKey: true }).preventDefault).toHaveBeenCalled();
    expect(dispatch('wheel', { ctrlKey: false }).preventDefault).not.toHaveBeenCalled();
  });

  it('does not cancel ordinary double taps or media-specific pinch handling', () => {
    const { win, dispatch } = makeHarness(ANDROID_UA, undefined, true);
    installMobileZoomGuard(win);

    expect(dispatch('dblclick').preventDefault).not.toHaveBeenCalled();
    expect(dispatch('touchend').preventDefault).not.toHaveBeenCalled();
    const mediaEvent = { touches: [{}, {}], target: { closest: () => ({ tagName: 'VIDEO' }) } };
    expect(dispatch('touchmove', mediaEvent).preventDefault).not.toHaveBeenCalled();
    expect(dispatch('gesturestart', mediaEvent).preventDefault).not.toHaveBeenCalled();
  });
});
