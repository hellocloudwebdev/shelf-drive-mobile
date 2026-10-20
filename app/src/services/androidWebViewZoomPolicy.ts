/**
 * Disable page zoom only inside the Android Tauri WebView. Desktop
 * browser/Tauri zoom is intentionally left to the host platform and app controls.
 *
 * Chromium ignores `user-scalable=no` in many builds, so `maximum-scale` is
 * pinned as well; the runtime gesture guard in `mobileZoomGuard.ts` covers the
 * rest.
 */
export function applyAndroidWebViewZoomPolicy(
  document: Document,
  userAgent: string,
  runningInTauri: boolean,
): boolean {
  if (!runningInTauri || !/android/i.test(userAgent)) return false;

  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!viewport) return false;

  const directives = (viewport.content || '')
    .split(',')
    .map((directive) => directive.trim())
    .filter(Boolean)
    .filter((directive) => !/^(user-scalable|maximum-scale|minimum-scale)\s*=/i.test(directive));
  directives.push('maximum-scale=1.0', 'user-scalable=no');
  viewport.content = directives.join(', ');
  return true;
}
