import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8'));
}

describe('target-specific Tauri capabilities', () => {
  it('keeps Android-only permissions restricted to Android builds', () => {
    const config = readJson('src-tauri/tauri.conf.json') as {
      app: { security: { capabilities: string[] } };
    };
    const mobile = readJson('src-tauri/capabilities/mobile.json') as {
      identifier: string;
      platforms?: string[];
      permissions?: string[];
    };
    const desktop = readJson('src-tauri/capabilities/default.json') as {
      platforms?: string[];
      permissions?: string[];
    };

    expect(config.app.security.capabilities).toContain('mobile-only');
    expect(mobile.identifier).toBe('mobile-only');
    expect(mobile.platforms).toEqual(['android']);
    expect(desktop.platforms).toEqual(['linux', 'macOS', 'windows']);
    expect(desktop.permissions).toContain('updater:default');
  });

  it('scopes the Android opener permission to default-scheme URLs only', () => {
    // Every mobile openUrl call targets an https:// page (releases page,
    // privacy policy, project site, Telegram portal). The command permission
    // and URL scope are both required: allow-default-urls alone is scope-only.
    // Do not grant open_path or reveal-item-in-dir to the mobile webview.
    const mobile = readJson('src-tauri/capabilities/mobile.json') as {
      permissions?: string[];
    };

    expect(mobile.permissions).toContain('opener:allow-open-url');
    expect(mobile.permissions).toContain('opener:allow-default-urls');
    expect(mobile.permissions).not.toContain('opener:default');
    expect(mobile.permissions).not.toContain('opener:allow-open-path');
    expect(mobile.permissions).not.toContain('opener:allow-reveal-item-in-dir');
  });

  it('limits the desktop browser opener to the Telegram developer portal', () => {
    const desktop = readJson('src-tauri/capabilities/default.json') as {
      permissions: Array<string | { identifier: string; allow?: unknown[] }>;
    };
    expect(desktop.permissions).toContainEqual({
      identifier: 'opener:allow-open-url',
      allow: [{ url: 'https://my.telegram.org' }],
    });
    expect(desktop.permissions).not.toContain('opener:default');
    expect(desktop.permissions).not.toContain('opener:allow-default-urls');
  });

  it('scopes Android webview filesystem reads to media-cache folders only', () => {
    // The frontend never imports @tauri-apps/plugin-fs; the read grant exists
    // only to mirror the asset-protocol scope (previews, thumbnails, offline
    // packs). A blanket $APPDATA/$APPCACHE grant would let the webview read
    // telegram.session, shares.db, transfers.db, workspace.db and the
    // plugin-store settings files, so both the write grant and the blanket
    // read paths must stay out of the capability.
    const mobile = readJson('src-tauri/capabilities/mobile.json') as {
      permissions: Array<string | { identifier: string; allow?: Array<{ path: string }> }>;
    };

    const fsEntries = mobile.permissions.filter(
      (permission) => typeof permission !== 'string' && permission.identifier.startsWith('fs:'),
    ) as Array<{ identifier: string; allow?: Array<{ path: string }> }>;

    expect(fsEntries).toHaveLength(1);
    expect(fsEntries[0].identifier).toBe('fs:allow-read');
    expect(fsEntries[0].allow).toEqual([
      { path: '$APPCACHE/previews/**' },
      { path: '$APPDATA/thumbnails/**' },
      { path: '$APPDATA/workspace/*/offline/**' },
    ]);
  });
});
