import { expect, test, type Page } from '@playwright/test';

async function openMobile(page: Page, url = '/?mobile', theme = 'light') {
  await page.addInitScript((preference) => {
    localStorage.setItem('shelf_drive_tour_seen', 'true');
    localStorage.setItem('theme-preference', preference);
  }, theme);
  await page.goto(url);
  // The browser-only preview bypasses the authenticated startup locale loader.
  await page.evaluate(async () => {
    const modulePath = '/src/i18n/index.ts';
    const locale = await import(/* @vite-ignore */ modulePath);
    await locale.ensureLanguageResource('en');
    await locale.default.changeLanguage('en');
  });
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

for (const width of [320, 390, 430]) {
  test(`all five mobile destinations remain usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await openMobile(page);
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('button')).toHaveCount(5);
    for (const name of ['Home', 'Photos', 'Videos', 'Documents', 'Settings']) {
      const tab = nav.getByRole('button', { name, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-current', 'page');
      const bounds = await tab.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (width === 390) {
        await testInfo.attach(`mobile-${name.toLowerCase()}`, { body: await page.screenshot(), contentType: 'image/png' });
      }
    }
    await nav.getByRole('button', { name: 'Home', exact: true }).click();
    const upload = page.getByRole('button', { name: 'Upload', exact: true });
    await expect(upload).toBeVisible();
    await upload.click();
    await expect(page.getByRole('dialog', { name: 'Upload options' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload File Choose files from your device' })).toBeVisible();
  });
}

// Optional comparison against an unchanged local production server. The
// visual redesign must not restyle or move the protected upload affordance.
for (const theme of ['light', 'dark']) {
  test(`upload button computed UI stays unchanged in ${theme} mode`, async ({ page, browser }) => {
    test.skip(!process.env.MOBILE_BASELINE_URL, 'Set MOBILE_BASELINE_URL to an unchanged production preview.');
    await page.setViewportSize({ width: 390, height: 844 });
    const baseline = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await openMobile(baseline, `${process.env.MOBILE_BASELINE_URL}/?mobile`, theme);
    await openMobile(page, '/?mobile', theme);
    const styles = async (target: Page) => target.getByRole('button', { name: 'Upload', exact: true }).evaluate((element) => {
      const style = getComputedStyle(element);
      return Object.fromEntries(['width', 'height', 'bottom', 'right', 'borderRadius', 'background', 'boxShadow', 'color', 'backdropFilter', 'border', 'fontSize', 'padding', 'position', 'zIndex'].map(key => [key, style[key as keyof CSSStyleDeclaration]]));
    });
    expect(await styles(page)).toEqual(await styles(baseline));
    await baseline.close();
  });
}
