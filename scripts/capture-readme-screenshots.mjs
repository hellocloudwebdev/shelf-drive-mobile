// Captures real UI screenshots of the mobile shell by running the Vite dev
// server with a mocked Tauri IPC layer and a phone-sized Chromium viewport.
//
//   cd app && npm run dev -- --host 127.0.0.1 --port 4173      (terminal 1)
//   node scripts/capture-readme-screenshots.mjs                 (terminal 2)
//
// Output: screenshots/live/*.png  (824 x 1830, Android 15 / Pixel 9 profile)
//
// The capture is deterministic: the mock layer pins the workspace fixture so
// every run produces the same library, the same transfer queue and the same
// storage counters. Set SHOT_PREFIX to namespace an experimental run, or
// SHOT_DIR to write somewhere else.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'app', 'package.json'));
const { chromium } = require('@playwright/test');

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const OUT = process.env.SHOT_DIR
  ? path.resolve(process.env.SHOT_DIR)
  : path.join(root, 'screenshots', 'live');
const PREFIX = process.env.SHOT_PREFIX ?? '';
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 412, height: 915 };
const DEVICE = {
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36',
  locale: 'en-US',
};

const captured = [];
const problems = [];
const warnings = [];

/** Mock Tauri IPC + plugin shims so the browser build renders a full workspace. */
function installMocks({ theme, authed }) {
  const day = 86_400_000;
  const now = Date.now();
  const stamp = (offsetDays) =>
    new Date(now - offsetDays * day).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  const thumb = (a, b) => `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><circle cx="292" cy="104" r="44" fill="#fff" opacity=".34"/><path d="M0 400V290l110-90 100 70 80-50 110 90v90z" fill="#000" opacity=".26"/></svg>`)}`;
  const f = (id, name, size, mime, ext, ago, extra = {}) => ({
    id, name, size, sizeStr: '', mime_type: mime, file_ext: ext, type: 'file', icon_type: 'file',
    created_at: stamp(ago), encryption_state: 'plain',
    is_favorite: false, is_pinned: false, offline_available: false, ...extra,
  });
  const MB = 1024 * 1024;
  const library = [
    f(101, 'Iceland_Aurora_2026.jpg', 4.8 * MB, 'image/jpeg', 'jpg', 1, { is_favorite: true }),
    f(102, 'Product_Launch_Keynote.mp4', 812 * MB, 'video/mp4', 'mp4', 2, { offline_available: true }),
    f(103, 'Q3_Financial_Report.pdf', 2.4 * MB, 'application/pdf', 'pdf', 3, { is_pinned: true }),
    f(104, 'Golden_Hour_Sahara.png', 6.1 * MB, 'image/png', 'png', 4),
    f(105, 'Midnight_Drive.flac', 38 * MB, 'audio/flac', 'flac', 5),
    f(106, 'Design_System_v4.zip', 148 * MB, 'application/zip', 'zip', 6),
    f(107, 'Travel_Vlog_Kyoto.mov', 1.3 * 1024 * MB, 'video/quicktime', 'mov', 7, { is_favorite: true }),
    f(108, 'Passport_Scan_Encrypted.pdf', 1.1 * MB, 'application/pdf', 'pdf', 9, { encryption_state: 'encrypted' }),
    f(109, 'Mountain_Lake_Dawn.jpg', 5.2 * MB, 'image/jpeg', 'jpg', 10),
    f(110, 'Podcast_Ep42_Final.mp3', 64 * MB, 'audio/mpeg', 'mp3', 12),
    f(111, 'Neon_City_Night.jpg', 3.9 * MB, 'image/jpeg', 'jpg', 2, { is_favorite: true }),
    f(112, 'Lavender_Fields.jpg', 4.4 * MB, 'image/jpeg', 'jpg', 3),
    f(113, 'Desert_Road_Trip.jpg', 5.8 * MB, 'image/jpeg', 'jpg', 5),
    f(114, 'Coral_Reef_Dive.png', 7.2 * MB, 'image/png', 'png', 6, { is_favorite: true }),
    f(115, 'Snow_Peak_Sunrise.jpg', 4.1 * MB, 'image/jpeg', 'jpg', 8),
    f(116, 'City_Skyline_Dusk.jpg', 3.6 * MB, 'image/jpeg', 'jpg', 11),
  ];
  const folders = [
    { id: 11, name: 'Photos & Memories', is_public: false, display_order: 0 },
    { id: 12, name: 'Work Projects', is_public: false, display_order: 1 },
    { id: 13, name: 'Movies & Shows', is_public: false, display_order: 2 },
    { id: 14, name: 'Music Library', is_public: false, display_order: 3 },
    { id: 15, name: 'Documents Vault', is_public: false, display_order: 4 },
    { id: 16, name: 'Travel 2026', is_public: false, display_order: 5 },
  ];
  const thumbs = {
    101: thumb('#0ea5e9', '#6366f1'), 102: thumb('#7c3aed', '#ec4899'), 104: thumb('#f59e0b', '#ef4444'),
    107: thumb('#f43f5e', '#f59e0b'), 109: thumb('#10b981', '#0ea5e9'), 111: thumb('#a855f7', '#0ea5e9'),
    112: thumb('#c084fc', '#f472b6'), 113: thumb('#fbbf24', '#b45309'), 114: thumb('#06b6d4', '#14b8a6'),
    115: thumb('#e0f2fe', '#6366f1'), 116: thumb('#fb7185', '#7c3aed'),
  };
  const mkJob = (id, direction, status, filename, progress, total, speed, pos) => ({
    id, ownerId: '1', direction, kind: direction === 'upload' ? 'local_upload' : 'download', status,
    folderId: 11, filename, progress, transferredBytes: Math.round((total * progress) / 100), totalBytes: total,
    speedBytesPerSec: speed, queuePosition: pos, revision: 1, createdAt: now - 60000, updatedAt: now,
  });
  const jobs = [
    mkJob('j1', 'upload', 'uploading', 'Product_Launch_Keynote.mp4', 68, 812 * MB, 6.4 * MB, 0),
    mkJob('j2', 'download', 'downloading', 'Travel_Vlog_Kyoto.mov', 34, 1.3 * 1024 * MB, 9.1 * MB, 1),
    mkJob('j3', 'upload', 'pending', 'Design_System_v4.zip', 0, 148 * MB, 0, 2),
    mkJob('j4', 'upload', 'completed', 'Iceland_Aurora_2026.jpg', 100, 4.8 * MB, 0, 3),
    mkJob('j5', 'download', 'completed', 'Q3_Financial_Report.pdf', 100, 2.4 * MB, 0, 4),
  ];
  const calls = [];
  const callbacks = new Map();
  const listeners = {};
  let cbSeq = 0;
  window.__calls = calls;
  Object.assign(window, {
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
    __TAURI_OS_PLUGIN_INTERNALS__: { os_type: 'android', platform: 'android', arch: 'aarch64', version: '15', family: 'unix' },
    __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      convertFileSrc: (p) => p,
      transformCallback: (cb) => { const id = ++cbSeq; callbacks.set(id, cb); return id; },
      invoke: async (command, args = {}) => {
        calls.push(command);
        switch (command) {
          case 'cmd_check_connection': return true;
          case 'cmd_get_startup_health': return { ok: true };
          case 'cmd_get_enriched_folders': case 'cmd_scan_folders': return folders;
          case 'cmd_get_groups': return [];
          case 'cmd_workspace_account': return '1';
          case 'cmd_get_files': case 'cmd_get_cached_files': {
            if (command === 'cmd_get_cached_files') return library;
            const payload = { ownerId: args.ownerId ?? '1', folderId: args.folderId ?? null, requestId: args.requestId ?? '', files: library };
            for (const id of listeners['folder-load-chunk'] ?? []) callbacks.get(id)?.({ event: 'folder-load-chunk', id, payload });
            return { ...payload, complete: true };
          }
          case 'cmd_get_storage_insight': {
            const v = args.view;
            const out = library.filter((x) => v === 'photos' ? x.mime_type.startsWith('image/') : v === 'videos' ? x.mime_type.startsWith('video/') : v === 'documents' ? /pdf|zip|audio/.test(x.mime_type) : v === 'favorites' ? x.is_favorite : v === 'offline' ? x.offline_available : v === 'pinned' ? x.is_pinned : true);
            return { files: out, scanned_count: out.length, duplicate_groups: 0 };
          }
          case 'cmd_get_thumbnail': return thumbs[args.messageId] ?? '';
          case 'cmd_transfer_list': return jobs;
          case 'cmd_transfer_activity': return { ownerId: '1', jobs, legacy: [] };
          case 'cmd_get_android_transfer_environment': return { isTelevision: false };
          case 'cmd_get_android_network_status': return { online: true, metered: false };
          case 'cmd_is_network_available': return true;
          case 'cmd_get_bandwidth': return { date: '', up_bytes: 18.4 * 1024 * MB, down_bytes: 42.7 * 1024 * MB, limit_bytes: 250 * 1024 * MB, period: 'weekly' };
          case 'cmd_get_vault_status': return { enabled: false, unlocked: false };
          case 'cmd_get_offline_cache_status': return { file_count: 1, total_bytes: 812 * MB, max_files: 100, max_bytes: 5 * 1024 * MB };
          case 'cmd_workspace_read': case 'cmd_workspace_index':
            return { ownerId: '1', collections: [], searches: [], scans: [], files: [] };
          case 'cmd_playback_read': return { ownerId: '1', items: [], queue: [], preferences: { volume: 1, speed: 1 } };
          case 'cmd_get_file_activity': {
            const v = args.view;
            return library.filter((x) => v === 'photos' ? x.mime_type.startsWith('image/') : v === 'videos' ? x.mime_type.startsWith('video/') : v === 'documents' ? /pdf|zip|audio/.test(x.mime_type) : v === 'favorites' ? x.is_favorite : v === 'pinned' ? x.is_pinned : true).slice(0, args.limit ?? 250);
          }
          case 'cmd_get_android_playback_history': case 'cmd_list_cached_files':
          case 'cmd_get_sync_pairs': case 'cmd_get_sync_conflicts': case 'cmd_list_shares': case 'cmd_get_cached_variants':
            return [];
          case 'cmd_get_pending_share_count': return 0;
          case 'plugin:event|listen': (listeners[args.event] ??= []).push(args.handler); return args.handler;
          case 'plugin:event|unlisten': return;
          default: return null;
        }
      },
    },
  });
  if (authed) {
    localStorage.setItem('shelf-drive-ui:store:config.json', JSON.stringify({ api_id: '12345' }));
  }
  localStorage.setItem('theme', theme);
  localStorage.setItem('theme-preference', theme);
  // Skip the crash-reporting consent sheet; the tour is captured separately.
  localStorage.setItem('shelf-drive-crash-consent', 'declined');
}

const browser = await chromium.launch();

async function openPage({ theme = 'dark', authed = true } = {}) {
  const ctx = await browser.newContext({ ...DEVICE, colorScheme: theme });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
  // The browser build logs React DOM nesting warnings from the update banner;
  // they are informational and must not fail a screenshot run.
  page.on('console', (m) => { if (m.type() === 'error') warnings.push(m.text().slice(0, 160)); });
  await page.addInitScript(installMocks, { theme, authed });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForTimeout(4500);
  return { ctx, page };
}

const snap = async (page, name, { settle = 1100 } = {}) => {
  await page.waitForTimeout(settle);
  const file = path.join(OUT, `${PREFIX}${name}.png`);
  await page.screenshot({ path: file });
  captured.push(`${PREFIX}${name}.png`);
  console.log('captured', `${PREFIX}${name}.png`);
};

const tap = async (page, name, label, { exact = true, optional = false } = {}) => {
  const locator = page.getByRole('button', { name: label, exact }).last();
  try {
    await locator.click({ timeout: 6000 });
    await page.waitForTimeout(700);
    return true;
  } catch (error) {
    const note = `${name}: could not tap "${label}" (${error.message.split('\n')[0]})`;
    if (optional) { console.log('skip', note); return false; }
    problems.push(note);
    return false;
  }
};

/** Scroll the page's inner scroll container until `text` is in view. */
const scrollToText = async (page, text) => {
  const target = page.getByText(text, { exact: false }).first();
  try {
    await target.scrollIntoViewIfNeeded({ timeout: 5000 });
    await page.waitForTimeout(600);
    return true;
  } catch {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(600);
    return false;
  }
};

// ---------------------------------------------------------------- auth pass
{
  const { ctx, page } = await openPage({ theme: 'dark', authed: false });
  await snap(page, '01-auth');
  await ctx.close();
}

// ---------------------------------------------------------------- dark pass
{
  const { ctx, page } = await openPage({ theme: 'dark' });

  // First-run introduction (three slides)
  await snap(page, '02-tour-cloud');
  await tap(page, 'tour', 'Next');
  await snap(page, '03-tour-private');
  await tap(page, 'tour', 'Next');
  await snap(page, '04-tour-ready');
  await tap(page, 'tour', 'Finish');
  await page.waitForTimeout(1200);

  await snap(page, '05-home');

  await tap(page, 'folder', 'Open folder Photos & Memories');
  await snap(page, '06-folder');
  await tap(page, 'home', 'Home');

  await tap(page, 'photos', 'Photos');
  await snap(page, '07-photos');

  await tap(page, 'videos', 'Videos');
  await snap(page, '08-videos');

  await tap(page, 'documents', 'Documents');
  await snap(page, '09-documents');

  await tap(page, 'home', 'Home');
  await tap(page, 'drawer', 'Open folders');
  await snap(page, '10-drawer', { settle: 900 });
  await tap(page, 'drawer-close', 'Close folders');

  await tap(page, 'actions', 'Actions for Iceland_Aurora_2026.jpg', { exact: false });
  await snap(page, '11-file-actions', { settle: 900 });
  await tap(page, 'actions-close', 'Cancel');
  await page.waitForTimeout(700);

  await tap(page, 'upload', 'Upload');
  await snap(page, '12-upload-sheet', { settle: 900 });
  await tap(page, 'upload-close', 'Cancel');
  await page.waitForTimeout(700);

  await tap(page, 'settings', 'Settings');
  await snap(page, '13-settings');
  if (await scrollToText(page, 'Appearance')) {
    await snap(page, '14-settings-appearance');
  }

  await ctx.close();
}

// --------------------------------------------------------------- light pass
{
  const { ctx, page } = await openPage({ theme: 'light' });

  // Capture light theme tour slide
  await snap(page, '18-light-tour');
  await tap(page, 'tour', 'Next', { optional: true });
  await tap(page, 'tour', 'Next', { optional: true });
  await tap(page, 'tour', 'Finish', { optional: true });
  await page.waitForTimeout(1400);

  await snap(page, '15-light-home');
  await tap(page, 'photos', 'Photos');
  await snap(page, '16-light-photos');

  await tap(page, 'home', 'Home');
  await tap(page, 'folder', 'Open folder Photos & Memories');
  await snap(page, '19-light-folder');

  await tap(page, 'documents', 'Documents');
  await snap(page, '20-light-documents');

  await tap(page, 'settings', 'Settings');
  await snap(page, '17-light-settings');

  await ctx.close();
}

await browser.close();

console.log(`\n${captured.length} screenshots written to ${OUT}`);
if (warnings.length) {
  const unique = [...new Set(warnings)];
  console.log(`\n${warnings.length} browser console message(s), ${unique.length} unique:`);
  for (const warning of unique.slice(0, 5)) {
    console.log(' ·', warning.replace(/\s+/g, ' '));
  }
}
if (problems.length) {
  console.log('\nproblems:');
  for (const problem of problems) console.log(' -', problem);
  process.exitCode = 1;
}
