import { afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';

import i18n, { ensureLanguageResource } from '../../src/i18n';

beforeAll(async () => {
  await ensureLanguageResource('en');
  await i18n.changeLanguage('en');
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  localStorage.clear();
});
