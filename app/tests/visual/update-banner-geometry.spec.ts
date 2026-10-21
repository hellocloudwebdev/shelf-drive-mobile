import { expect, test } from '@playwright/test';

const fixtureHtml = `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="/src/App.css" />
  </head>
  <body>
    <div id="update-banner-fixture"></div>
    <script type="module">
      import RefreshRuntime from "/@react-refresh";
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    </script>
    <script type="module">
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOMClient from '/node_modules/.vite/deps/react-dom_client.js';
      import { I18nextProvider } from '/node_modules/.vite/deps/react-i18next.js';
      import { UpdateBanner } from '/src/components/shared/UpdateBanner.tsx';
      import i18n, { ensureLanguageResource } from '/src/i18n/index.ts';
      await ensureLanguageResource('en');

      const params = new URLSearchParams(window.location.search);
      const downloading = params.get('downloading') === 'true';
      const app = React.createElement(React.Fragment, null,
        React.createElement(UpdateBanner, {
          available: true,
          version: '2.4.0',
          downloading,
          progress: 42,
          phase: null,
          managedByPackageManager: false,
          onUpdate: () => {},
          onDismiss: () => {}
        }),
        React.createElement('main', { 'data-testid': 'content-below' },
          React.createElement('p', null, 'App content below the update notice')
        )
      );
      ReactDOMClient.createRoot(document.getElementById('update-banner-fixture')).render(
        React.createElement(I18nextProvider, { i18n }, app)
      );
    </script>
  </body>
</html>`;

test.beforeEach(async ({ page }) => {
  await page.route('**/__update_banner_geometry**', route =>
    route.fulfill({ contentType: 'text/html', body: fixtureHtml }),
  );
  await page.goto('/__update_banner_geometry');
  await expect(page.getByText('A new version (2.4.0) is available!')).toBeVisible();
  await expect.poll(() => page.locator('div.fixed.inset-x-0.top-0').evaluate(element => {
    const transform = getComputedStyle(element).transform;
    return transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
  })).toBe(0);
});

test('mobile widths keep the update action on one line and the banner within the viewport', async ({ page }) => {
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 740 });
    const banner = page.locator('div.fixed.inset-x-0.top-0');
    const button = page.getByRole('button', { name: 'Update & Restart' });
    await expect(banner).toBeVisible();
    await expect(button).toBeVisible();

    const geometry = await page.evaluate(() => {
      const root = document.querySelector('div.fixed.inset-x-0.top-0')!;
      const button = root.querySelector('button')!;
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      const textNode = walker.nextNode()!;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const actionLines = range.getClientRects().length;
      const rootRect = root.getBoundingClientRect();
      return {
        actionLines,
        bannerWidth: rootRect.width,
        bannerLeft: rootRect.left,
        bannerRight: rootRect.right,
        viewportWidth: document.documentElement.clientWidth,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });

    expect(geometry.actionLines, `action text wraps at ${width}px`).toBe(1);
    expect(geometry.bannerLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.bannerRight).toBeLessThanOrEqual(width);
    expect(geometry.bannerWidth).toBeLessThanOrEqual(width);
    expect(geometry.horizontalOverflow).toBe(false);
  }
});

test('mobile banner content clears the 24px top-inset fallback', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const geometry = await page.locator('div.fixed.inset-x-0.top-0').evaluate(element => {
    const root = element as HTMLElement;
    const text = root.querySelector('span')!;
    return {
      topPadding: Number.parseFloat(getComputedStyle(root).paddingTop),
      textTop: text.getBoundingClientRect().top,
    };
  });

  expect(geometry.topPadding).toBeGreaterThanOrEqual(24);
  expect(geometry.textTop).toBeGreaterThanOrEqual(24);
});

test('downloading progress state fits narrow viewports without horizontal overflow', async ({ page }) => {
  await page.goto('/__update_banner_geometry?downloading=true');
  await expect(page.getByText('Downloading update… 42%')).toBeVisible();
  await expect.poll(() => page.locator('div.fixed.inset-x-0.top-0').evaluate(element => {
    const transform = getComputedStyle(element).transform;
    return transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
  })).toBe(0);
  await page.setViewportSize({ width: 320, height: 740 });

  const geometry = await page.evaluate(() => {
    const root = document.querySelector('div.fixed.inset-x-0.top-0')!;
    const progress = root.querySelector('.w-32')!;
    const rootRect = root.getBoundingClientRect();
    const progressRect = progress.getBoundingClientRect();
    return {
      bannerRight: rootRect.right,
      progressRight: progressRect.right,
      viewportWidth: document.documentElement.clientWidth,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });

  expect(geometry.progressRight).toBeLessThanOrEqual(geometry.bannerRight);
  expect(geometry.bannerRight).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.horizontalOverflow).toBe(false);
});

test('desktop update banner presents message and action in a single row', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const geometry = await page.locator('div.fixed.inset-x-0.top-0 > div').evaluate(element => {
    const inner = element as HTMLElement;
    const message = inner.querySelector('div')!;
    const button = inner.querySelector('button')!;
    const innerRect = inner.getBoundingClientRect();
    const messageRect = message.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    return {
      flexDirection: getComputedStyle(inner).flexDirection,
      messageTop: messageRect.top,
      messageHeight: messageRect.height,
      buttonTop: buttonRect.top,
      buttonHeight: buttonRect.height,
      messageRight: messageRect.right,
      buttonLeft: buttonRect.left,
      innerWidth: innerRect.width,
      viewportWidth: document.documentElement.clientWidth,
    };
  });

  expect(geometry.flexDirection).toBe('row');
  const messageCenter = geometry.messageTop + geometry.messageHeight / 2;
  const buttonCenter = geometry.buttonTop + geometry.buttonHeight / 2;
  expect(Math.abs(messageCenter - buttonCenter)).toBeLessThanOrEqual(2);
  expect(geometry.messageRight).toBeLessThanOrEqual(geometry.buttonLeft);
  expect(geometry.innerWidth).toBeLessThanOrEqual(geometry.viewportWidth);
});
