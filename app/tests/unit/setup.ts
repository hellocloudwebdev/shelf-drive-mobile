import { afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';

// Production fetches every catalog (including English) so none of them lands in
// the entry chunk; see src/i18n/index.ts. Unit tests render components and
// assert on English copy synchronously, so seed the bundle here instead of
// relying on a fetch that jsdom would never resolve.
beforeAll(() => {
  if (!i18n.hasResourceBundle('en', 'translation')) {
    i18n.addResourceBundle('en', 'translation', en, true, true);
  }
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  localStorage.clear();
});
