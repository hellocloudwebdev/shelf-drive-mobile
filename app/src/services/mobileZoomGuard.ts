/**
 * Android Tauri WebView page-zoom suppression.
 *
 * Why this exists: a phone has no reason to pinch-zoom an app shell. Chromium's
 * WebView ignores `user-scalable=no` in a growing number of builds, so the
 * viewport directive alone does not stop the UI from drifting under a
 * two-finger gesture. The native layer disables
 * `WebSettings.setSupportZoom`, but the gesture detector can still be reached.
 *
 * This guard blocks the remaining paths at the DOM level:
 *  - multi-touch gestures (`gesturestart`/`gesturechange`/`gestureend` are
 *    non-standard WebKit/Chromium events used for pinch),
 *  - `touchmove` events that carry two or more active touches,
 *  - `ctrl`+wheel, which desktop Chromium/WebView report for trackpad pinch,
 *  - and it pins the viewport so the initial scale cannot drift. CSS touch-action
 *    also suppresses browser double-tap zoom without cancelling the resulting click.
 *
 * The guard is installed only in the Android Tauri app. Ordinary desktop and
 * mobile browsers keep their native zoom behavior for accessibility.
 */

export interface MobileZoomGuardWindow {
  navigator?: { userAgent?: string };
  addEventListener?: (type: string, listener: (event: any) => void, options?: any) => void;
  document?: Document;
  __TAURI_INTERNALS__?: unknown;
}

export interface MobileZoomGuardDocument {
  addEventListener: (type: string, listener: (event: any) => void, options?: any) => void;
  head?: { appendChild: (node: any) => void } | null;
  querySelector: (selector: string) => any;
  createElement: (tagName: string) => any;
  getElementById?: (id: string) => any;
}

const MOBILE_ZOOM_GUARD_STYLE_ID = 'shelf-drive-mobile-zoom-guard';

/** Non-passive so `preventDefault()` on touchmove is honoured by the browser. */
const BLOCKING_LISTENER: AddEventListenerOptions = { passive: false, capture: true };

const ZOOM_GUARD_CSS = `
#root :not(:has(video, audio)) {
  touch-action: pan-x pan-y;
}
`;

/** The no-page-zoom policy belongs to Android's app WebView, not mobile browsers. */
function isAndroidTauriRuntime(win: MobileZoomGuardWindow): boolean {
  return Boolean(win.__TAURI_INTERNALS__) && /android/i.test(win.navigator?.userAgent ?? '');
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

  const enabled = options.forceEnabled ?? isAndroidTauriRuntime(win);
  if (!enabled) return false;
  if (!win.addEventListener) return false;

  lockViewportScale(guardedDocument);
  injectZoomGuardStyles(guardedDocument);

  const isMediaTarget = (event: any) => Boolean(event?.target?.closest?.('video, audio, [data-allow-mobile-zoom]'));

  const block = (event: any) => {
    // Leave native media controls and explicitly zoomable media surfaces to their owner.
    if (isMediaTarget(event)) return;
    if (event?.cancelable !== false) event.preventDefault?.();
    // Stop pointer-events-based zoom handlers that sit above the document.
    event?.stopPropagation?.();
  };

  // WebKit/Chromium proprietary multi-touch gesture events (pinch). These must
  // be non-passive or preventDefault() is ignored by the browser.
  win.addEventListener('gesturestart', block, BLOCKING_LISTENER);
  win.addEventListener('gesturechange', block, BLOCKING_LISTENER);
  win.addEventListener('gestureend', block, BLOCKING_LISTENER);
  guardedDocument.addEventListener('gesturestart', block, BLOCKING_LISTENER);
  guardedDocument.addEventListener('gesturechange', block, BLOCKING_LISTENER);
  guardedDocument.addEventListener('gestureend', block, BLOCKING_LISTENER);

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

  return true;
}
