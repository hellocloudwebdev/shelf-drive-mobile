import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { parseVersion, readChangelogVersion, verifyReleaseVersions } = require('../../scripts/verify-android-release-version.cjs') as {
  parseVersion: (version: string) => { version: string; versionCode: number };
  readChangelogVersion: (contents: string) => string;
  verifyReleaseVersions: (args: {
    appRoot: string; tag?: string; changelog?: string; previousManifest?: string; generatedProperties?: string;
  }) => { version: string; versionCode: number };
};

const temporaryDirectories: string[] = [];

function writePreviousManifest(manifest: { packageName?: string; versionCode?: number; version?: string }): string {
  const directory = mkdtempSync(join(tmpdir(), 'android-previous-manifest-'));
  temporaryDirectories.push(directory);
  const manifestPath = join(directory, 'android-update.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return manifestPath;
}

afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
});

describe('Android release versioning', () => {
  it('maps semantic versions to monotonically ordered Android version codes', () => {
    expect(parseVersion('3.0.0').versionCode).toBe(3_000_000);
    expect(parseVersion('3.1.2').versionCode).toBe(3_001_002);
    expect(parseVersion('4.0.0').versionCode).toBeGreaterThan(parseVersion('3.999.999').versionCode);
  });

  it('rejects ambiguous or overflowing versions', () => {
    expect(() => parseVersion('3.0')).toThrow();
    expect(() => parseVersion('3.1000.0')).toThrow();
    expect(() => parseVersion('9999.0.0')).toThrow();
  });

  it('reads the first release version used as the GitHub release body', () => {
    expect(readChangelogVersion('## [3.7.0] - 2026-08-27\n\nNotes\n\n## [3.6.0]')).toBe('3.7.0');
    expect(() => readChangelogVersion('# Changelog\n\nNo release headings')).toThrow();
  });

  it('requires an exact version tag when a tagged release is supplied', () => {
    const appRoot = process.cwd();
    const packageVersion = JSON.parse(readFileSync(resolve(appRoot, 'package.json'), 'utf8')).version as string;
    expect(verifyReleaseVersions({ appRoot, tag: `v${packageVersion}` }).version).toBe(packageVersion);
    expect(() => verifyReleaseVersions({ appRoot, tag: 'main' }))
      .toThrow(`release tag main must equal v${packageVersion}`);
  });

  describe('previous-update-manifest monotonicity', () => {
    // The repository's real app root supplies the genuine package/tauri/Cargo
    // versions; only the previous manifest is a fixture.
    const appRoot = process.cwd();

    it('accepts a previous release with a lower Android versionCode', () => {
      const previousManifest = writePreviousManifest({
        packageName: 'com.hellocloudweb.shelfdrive',
        versionCode: 4_000_001,
      });
      expect(verifyReleaseVersions({ appRoot, previousManifest }).versionCode).toBeGreaterThan(4_000_001);
    });

    it('rejects a release that does not advance past the previous versionCode', () => {
      const packageVersion = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')).version as string;
      const currentCode = parseVersion(packageVersion).versionCode;
      // Equal or higher previous versionCodes mean the new release does not
      // advance the installed base; both must be rejected.
      for (const previousCode of [currentCode, currentCode + 1]) {
        const previousManifest = writePreviousManifest({
          packageName: 'com.hellocloudweb.shelfdrive',
          versionCode: previousCode,
        });
        expect(() => verifyReleaseVersions({ appRoot, previousManifest }))
          .toThrow(/must be greater than the previous release/);
      }
    });

    it('rejects a previous manifest for a different application package', () => {
      const previousManifest = writePreviousManifest({
        packageName: 'com.example.other',
        versionCode: 1,
      });
      expect(() => verifyReleaseVersions({ appRoot, previousManifest }))
        .toThrow(/wrong package name/);
    });

    it('rejects a previous manifest with a non-integer versionCode', () => {
      const previousManifest = writePreviousManifest({
        packageName: 'com.hellocloudweb.shelfdrive',
        versionCode: '4.0.2-not-a-code' as unknown as number,
      });
      expect(() => verifyReleaseVersions({ appRoot, previousManifest }))
        .toThrow(/must be greater than the previous release/);
    });
  });
});
