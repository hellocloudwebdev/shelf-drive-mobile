import { describe, expect, it } from 'vitest';
import { applyAndroidWebViewZoomPolicy } from './androidWebViewZoomPolicy';

describe('applyAndroidWebViewZoomPolicy', () => {
  function makeDocument(content = 'width=device-width, initial-scale=1.0, viewport-fit=cover') {
    const document = window.document.implementation.createHTMLDocument();
    const viewport = document.createElement('meta');
    viewport.name = 'viewport';
    viewport.content = content;
    document.head.append(viewport);
    return { document, viewport };
  }

  it('disables pinch scaling only in the Android Tauri WebView and preserves other viewport directives', () => {
    const { document, viewport } = makeDocument();

    expect(applyAndroidWebViewZoomPolicy(document, 'Mozilla/5.0 (Linux; Android 15)', true)).toBe(true);
    expect(viewport.content).toBe(
      'width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=no',
    );
  });

  it('replaces an existing scaling directive instead of leaving contradictory policies', () => {
    const { document, viewport } = makeDocument('width=device-width, user-scalable=yes, initial-scale=1');

    applyAndroidWebViewZoomPolicy(document, 'Android', true);

    expect(viewport.content).toBe(
      'width=device-width, initial-scale=1, maximum-scale=1.0, user-scalable=no',
    );
  });

  it('pins maximum-scale because Chromium ignores user-scalable=no on its own', () => {
    const { document, viewport } = makeDocument('width=device-width, maximum-scale=3, user-scalable=yes');

    applyAndroidWebViewZoomPolicy(document, 'Android', true);

    expect(viewport.content).toContain('maximum-scale=1.0');
    expect(viewport.content).not.toContain('maximum-scale=3');
    expect(viewport.content).not.toContain('user-scalable=yes');
  });

  it.each([
    ['desktop Tauri', 'Mozilla/5.0 (X11; Linux x86_64)', true],
    ['mobile browser outside Tauri', 'Mozilla/5.0 (Linux; Android 15)', false],
  ])('leaves viewport/zoom unchanged for %s', (_label, userAgent, runningInTauri) => {
    const original = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
    const { document, viewport } = makeDocument(original);

    expect(applyAndroidWebViewZoomPolicy(document, userAgent, runningInTauri)).toBe(false);
    expect(viewport.content).toBe(original);
  });

  it('does not invent a viewport meta tag when one is absent', () => {
    const document = window.document.implementation.createHTMLDocument();

    expect(applyAndroidWebViewZoomPolicy(document, 'Android', true)).toBe(false);
    expect(document.querySelector('meta[name="viewport"]')).toBeNull();
  });
});
