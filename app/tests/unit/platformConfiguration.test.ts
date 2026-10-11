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
    // privacy policy, project site). opener:default would additionally grant
    // the unscoped open_url command (arbitrary paths) and reveal-item-in-dir,
    // neither of which the mobile app uses.
    const mobile = readJson('src-tauri/capabilities/mobile.json') as {
      permissions?: string[];
    };

    expect(mobile.permissions).toContain('opener:allow-default-urls');
    expect(mobile.permissions).not.toContain('opener:default');
  });
});
