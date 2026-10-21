import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Translation catalogs are data, not executable JavaScript. Only the selected
// language is fetched; Vite bundles the local JSON assets into desktop/Android.
// English is fetched like every other catalog instead of being inlined into the
// entry chunk: the startup splash renders before any catalog is needed, and
// App.tsx awaits ensureLanguageResource() before switching languages.
const localeUrls = import.meta.glob<string>(['./locales/*.json', '!./locales/en.json'], {
  eager: true, query: '?url', import: 'default',
});
const languageRequests = new Map<string, Promise<void>>();

i18n
  .use(initReactI18next)
  .init({
    resources: {},
    lng: 'en',
    // Every shipped locale is structurally complete and CI rejects missing keys.
    // Do not silently mask localization regressions with English at runtime.
    fallbackLng: false,
    interpolation: {
      escapeValue: false, // React already safeguards from XSS
    },
    react: {
      useSuspense: false,
    },
  });

export async function ensureLanguageResource(language: string): Promise<void> {
  if (i18n.hasResourceBundle(language, 'translation')) return;
  const url = localeUrls[`./locales/${language}.json`];
  if (language !== 'en' && !url) throw new Error(`Unsupported language resource: ${language}`);
  let request = languageRequests.get(language);
  if (!request) {
    request = (async () => {
      let resource: unknown;
      if (language === 'en') {
        // A dynamic import keeps English out of the entry chunk while avoiding
        // an extra JSON asset counted against the fixed non-English locale budget.
        resource = (await import('./locales/en.json')).default;
      } else {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Language resource unavailable: ${language}`);
        resource = await response.json();
      }
      if (!resource || typeof resource !== 'object' || Array.isArray(resource)) throw new Error(`Invalid language resource: ${language}`);
      if (!i18n.hasResourceBundle(language, 'translation')) {
        i18n.addResourceBundle(language, 'translation', resource, true, true);
      }
    })();
    languageRequests.set(language, request);
  }
  try { await request; }
  finally { if (languageRequests.get(language) === request) languageRequests.delete(language); }
}

export default i18n;
