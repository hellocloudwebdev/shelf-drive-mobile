/**
 * Mobile (Android/iOS) page-zoom suppression.
 *
 * Why this exists: a phone has no reason to pinch-zoom an app shell. Chromium's
 * WebView ignores `user-scalable=no` in a growing number of builds, and iOS
 * ignores it entirely, so the viewport directive alone does not stop the UI from
 * drifting under a two-finger gesture. The native layer disables
 * `WebSettings.setSupportZoom`, but the gesture detector can still be reached.
 *
 * This guard blocks the remaining paths at the DOM level:
 *  - multi-touch gestures (`gesturestart`/`gesturechange`/`gestureend` are
 *    non-standard WebKit/Chromium events used for pinch),
 *  - `touchmove` events that carry two or more active touches,
 *  - `ctrl`+wheel, which desktop Chromium/WebView report for trackpad pinch,
 *  - double-tap-to-zoom,
 *  - and it pins the viewport so the initial scale cannot drift.
 *
 * Desktop is untouched: `isMobileRuntime` requires a mobile user agent or a
 * coarse pointer, so mouse/keyboard users keep normal browser zoom.
 */

export interface MobileZoomGuardWindow {
  navigator?: { userAgent?: string; maxTouchPoints?: number };
  matchMedia?: (query: string) => { matches: boolean };
  addEventListener?: (type: string, listener: (event: any) => void, options?: any) => void;
  document?: Document;
}

export interface MobileZoomGuardDocument {
  addEventListener: (type: string, listener: (event: any) => void, options?: any) => void;
  head?: { appendChild: (node: any) => void } | null;
  querySelector: (selector: string) => any;
  createElement: (tagName: string) => any;
  getElementById?: (id: string) => any;
}

const MOBILE_ZOOM_GUARD_STYLE_ID = 'shelf-drive-mobile-zoom-guard';
const DOUBLE_TAP_WINDOW_MS = 350;

/** Non-passive so `preventDefault()` on touchmove is honoured by the browser. */
const BLOCKING_LISTENER: AddEventListenerOptions = { passive: false, capture: true };
const PASSIVE_LISTENER: AddEventListenerOptions = { passive: true, capture: true };

const ZOOM_GUARD_CSS = `
html, body {
  touch-action: pan-x pan-y;
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
  overscroll-behavior: none;
}
#root, #root * {
  touch-action: pan-x pan-y;
}
`;

/** True for phone/tablet runtimes where page zoom should be unavailable. */
export function isMobileRuntime(win: MobileZoomGuardWindow): boolean {
  const userAgent = win.navigator?.userAgent ?? '';
  const mobileUserAgent = /Android|iPhone|iPod|iPad|Mobile Safari|Windows Phone|webOS|BlackBerry/i.test(userAgent);
  // iPadOS 13+ reports a desktop user agent; maxTouchPoints exposes the truth.
  const tabletUserAgent = /Macintosh/i.test(userAgent) && (win.navigator?.maxTouchPoints ?? 0) > 1;
  if (mobileUserAgent || tabletUserAgent) return true;

  try {
    const coarsePointer = win.matchMedia?.('(pointer: coarse)');
    return Boolean(coarsePointer?.matches) && (win.navigator?.maxTouchPoints ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Pin the viewport so the page cannot start zoomed or become zoomable. */
export function lockViewportScale(doc: MobileZoomGuardDocument): boolean {
  const viewport = doc.querySelector('meta[name="viewport"]');
  if (!viewport) return false;

  const directives = String(viewport.content || '')
    .split(',')
    .map((directive: string) => directive.trim())
    .filter(Boolean)
    .filter((directive: string) => !/^(user-scalable|maximum-scale|minimum-scale)\s*=/i.test(directive));
  directives.push('maximum-scale=1.0', 'minimum-scale=1.0', 'user-scalable=no');
  viewport.content = directives.join(', ');
  return true;
}

/** Inject the coarse-pointer stylesheet once. */
export function injectZoomGuardStyles(doc: MobileZoomGuardDocument): boolean {
  if (doc.getElementById?.(MOBILE_ZOOM_GUARD_STYLE_ID)) return false;
  const style = doc.createElement('style');
  style.id = MOBILE_ZOOM_GUARD_STYLE_ID;
  style.textContent = ZOOM_GUARD_CSS;
  if (!doc.head) return false;
  doc.head.appendChild(style);
  return true;
}

interface ZoomGuardOptions {
  /** Provide deterministic detection in tests. */
  forceEnabled?: boolean;
}

/**
 * Install the guard. Returns `true` when the guard is active, so callers can
 * assert behaviour without poking at listeners. Calling it twice is safe.
 */
export function installMobileZoomGuard(
  win: MobileZoomGuardWindow,
  doc?: MobileZoomGuardDocument,
  options: ZoomGuardOptions = {},
): boolean {
  const guardedDocument = (doc ?? win.document) as MobileZoomGuardDocument | undefined;
  if (!guardedDocument) return false;

  const enabled = options.forceEnabled ?? isMobileRuntime(win);
  if (!enabled) return false;
  if (!win.addEventListener) return false;

  lockViewportScale(guardedDocument);
  injectZoomGuardStyles(guardedDocument);

  const block = (event: any) => {
    if (event?.cancelable !== false) event.preventDefault?.();
    // Stop pointer-events-based zoom handlers that sit above the document.
    event?.stopPropagation?.();
  };

  // WebKit/Chromium proprietary multi-touch gesture events (pinch).
  win.addEventListener('gesturestart', block, PASSIVE_LISTENER);
  win.addEventListener('gesturechange', block, PASSIVE_LISTENER);
  win.addEventListener('gestureend', block, PASSIVE_LISTENER);
  guardedDocument.addEventListener('gesturestart', block, PASSIVE_LISTENER);
  guardedDocument.addEventListener('gesturechange', block, PASSIVE_LISTENER);
  guardedDocument.addEventListener('gestureend', block, PASSIVE_LISTENER);

  // Any two-finger scroll/pinch. A single finger must still scroll the app.
  guardedDocument.addEventListener(
    'touchmove',
    (event: any) => {
      const touches = event?.touches?.length ?? 0;
      if (touches > 1) block(event);
    },
    BLOCKING_LISTENER,
  );

  // Trackpad/desktop-mode pinch arrives as ctrl+wheel inside the WebView.
  guardedDocument.addEventListener(
    'wheel',
    (event: any) => {
      if (event?.ctrlKey) block(event);
    },
    BLOCKING_LISTENER,
  );

  // iOS Safari zooms on double tap even with the viewport pinned.
  let lastTouchEnd = 0;
  guardedDocument.addEventListener(
    'touchend',
    (event: any) => {
      const now = Date.now();
      if (now - lastTouchEnd <= DOUBLE_TAP_WINDOW_MS) block(event);
      lastTouchEnd = now;
    },
    BLOCKING_LISTENER,
  );

  // Some Android builds zoom on a `dblclick` synthesised from two taps.
  guardedDocument.addEventListener(
    'dblclick',
    (event: any) => block(event),
    { passive: false, capture: true },
  );

  return true;
}
