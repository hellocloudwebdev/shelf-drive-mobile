# Shelf Drive — landing site

The static marketing site for **Shelf Drive for Android**. It is plain HTML, CSS and
JavaScript with no build step and no runtime dependencies, so it can be opened straight
from disk or published to any static host.

```
website/
├── index.html          single-page site
├── styles.css          design tokens + layout (dark and light themes)
├── main.js             theme toggle, mobile nav, scroll reveal, gallery rail, release badge
└── assets/
    ├── logo.svg        copied from app/public/logo.svg
    ├── og.png          1200×630 social preview card
    └── screens/        17 screenshots × 2 widths, WebP (412 px and 824 px)
```

## Preview locally

Any static file server works. From the repository root:

```bash
python -m http.server 8080 --directory website
# open http://127.0.0.1:8080/
```

Or with Node.js:

```bash
npx serve website
```

Opening `index.html` directly with `file://` also works, but the release badge then
falls back to a static label because the GitHub API request is blocked by the browser.

## Regenerate the images

The screenshots and the social card are generated from the live app captures, so the
site never drifts from the product:

```bash
# 1. capture fresh screenshots (needs the Vite dev server on 127.0.0.1:4173)
cd app && npm run dev -- --host 127.0.0.1 --port 4173   # terminal 1
node scripts/capture-readme-screenshots.mjs             # terminal 2

# 2. convert them to WebP and rebuild the social card
python scripts/generate_website_assets.py
```

`scripts/generate_website_assets.py` reads `screenshots/live/*.png` and writes
`website/assets/screens/<name>-sm.webp` (412 px wide) and `-lg.webp` (824 px wide),
plus `website/assets/og.png`. Keep both widths — the markup uses `srcset` so phones
download roughly 30 KB per screenshot instead of 300 KB.

## Deploy

`.github/workflows/pages.yml` publishes this folder to GitHub Pages on every push to
`main` that touches `website/**` or `screenshots/live/**`. The workflow now enables
GitHub Pages automatically if it has not been configured yet.

The site then lives at `https://<owner>.github.io/shelf-drive-mobile/`.

## Editing notes

- **Theme tokens** live at the top of `styles.css` under `:root` (dark) and
  `html[data-theme="light"]`. The toggle stores the choice in `localStorage` and the
  inline script in `<head>` applies it before first paint to avoid a flash.
- **Copy** is in `index.html` only; there is no templating or i18n layer. Keep claims
  consistent with `README.md`, `PRIVACY.md` and `SECURITY.md`.
- **Screenshots** are referenced by filename, and every `<img>` carries `width` and
  `height` so the layout reserves space before the image loads.
- **Accessibility**: every icon is inline SVG with `currentColor` strokes, focus rings
  are never removed, motion is disabled under `prefers-reduced-motion`, and the page
  was checked at 375 px, 390 px, 834 px and 1440 px widths.
