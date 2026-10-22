import { expect, test, type Page } from '@playwright/test';

async function openPreview(page: Page, base: string, theme: string) {
  await page.addInitScript((preference) => {
    localStorage.setItem('shelf_drive_tour_seen', 'true');
    localStorage.setItem('theme-preference', preference);
  }, theme);
  await page.goto(`${base}/?mobile`);
  await page.evaluate(async () => {
    const path = '/src/i18n/index.ts';
    const locale = await import(/* @vite-ignore */ path);
    await locale.ensureLanguageResource('en');
    await locale.default.changeLanguage('en');
    await document.fonts.ready;
  });
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await expect(page.getByText('Nothing here yet', { exact: true })).toBeVisible({ timeout: 20_000 });
}

async function computedUI(page: Page) {
  return page.locator('body, body *').evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
      tag: element.tagName,
      box: [box.x, box.y, box.width, box.height],
      styles: Array.from(style).sort().map(property => [property, style.getPropertyValue(property)]),
    };
  }));
}

for (const width of [320, 390, 430]) {
  test(`black dark surfaces and readable navigation at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await openPreview(page, '', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    await expect(page.locator('.atmospheric-canvas')).toHaveCSS('background-image', 'none');
    await expect(page.locator('.glass-nav-capsule')).not.toHaveCSS('background-image', /63, 192, 242/);
    const nav = page.getByRole('navigation', { name: 'Primary' });
    for (const name of ['Home', 'Photos', 'Videos', 'Documents', 'Settings']) {
      await nav.getByRole('button', { name, exact: true }).click();
      await expect(nav.getByRole('button', { name, exact: true })).toHaveCSS('color', 'rgb(245, 245, 245)');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (width === 390 && ['Home', 'Settings'].includes(name)) {
        if (name === 'Home') await expect(page.getByText('Nothing here yet', { exact: true })).toBeVisible({ timeout: 20_000 });
        await page.screenshot({ path: testInfo.outputPath(`black-${name.toLowerCase()}.png`) });
      }
    }
  });
}

test('every light-mode computed style and layout stays identical to production', async ({ page, browser }) => {
  test.setTimeout(120_000);
  test.skip(!process.env.MOBILE_BASELINE_URL, 'Set MOBILE_BASELINE_URL to unchanged production.');
  await page.setViewportSize({ width: 390, height: 844 });
  const baseline = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await openPreview(baseline, process.env.MOBILE_BASELINE_URL!, 'light');
  await openPreview(page, '', 'light');
  // Freeze CSS animation/transition state identically before comparing the full DOM.
  for (const target of [page, baseline]) {
    await target.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
  }
  for (const name of ['Home', 'Photos', 'Videos', 'Documents', 'Settings']) {
    for (const target of [page, baseline]) {
      await target.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name, exact: true }).click();
    }
    expect(await computedUI(page), name).toEqual(await computedUI(baseline));
  }
  await baseline.close();
});
