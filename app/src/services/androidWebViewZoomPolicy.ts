/**
 * Disable browser pinch zoom only inside the Android Tauri WebView. Desktop
 * browser/Tauri zoom is intentionally left to the host platform and app controls.
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
    .filter((directive) => !/^user-scalable\s*=/i.test(directive));
  directives.push('user-scalable=no');
  viewport.content = directives.join(', ');
  return true;
}
