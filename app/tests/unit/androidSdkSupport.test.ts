import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), '..');
const read = (...parts: string[]) => readFileSync(resolve(root, ...parts), 'utf8');

describe('Android 12–16 support contract', () => {
  it('keeps the Tauri and generated Gradle minimum at API 31 with target API 36', () => {
    const config = JSON.parse(read('app', 'src-tauri', 'tauri.conf.json'));
    const gradle = read('app', 'android-overrides', 'app', 'build.gradle.kts');
    expect(config.bundle.android.minSdkVersion).toBe(31);
    expect(gradle).toMatch(/minSdk\s*=\s*31\b/);
    expect(gradle).toMatch(/targetSdk\s*=\s*36\b/);
    expect(gradle).toMatch(/compileSdk\s*=\s*36\b/);
    expect(gradle).not.toContain('JacksonCompatibilityVisitorFactory');
    expect(existsSync(resolve(root, 'app/android-overrides/app/src/main/java/com/hellocloudweb/shelfdrive/JacksonAndroidCompat.java'))).toBe(false);
    expect(existsSync(resolve(root, 'app/android-overrides/buildSrc/src/main/kotlin/JacksonCompatibilityVisitorFactory.kt'))).toBe(false);
  });

  it('runs both phone endpoints and current Google TV instrumentation in protected CI', () => {
    const workflow = read('.github', 'workflows', 'android.yml');
    for (const api of [31, 36]) {
      expect(workflow).toContain(`'system-images;android-${api};google_apis;x86_64'`);
      expect(workflow).toContain(`ANDROID_EMULATOR_API: '${api}'`);
    }
    expect(workflow).toContain("'system-images;android-36;google-tv;x86_64'");
    expect(workflow).not.toContain('android-24;');
    expect(workflow).not.toContain('api24-avd');
    expect(read('README.md')).toContain('Android 12');
    expect(read('Docs', 'ANDROID_SIDELOAD_RELEASE.md')).toContain('API 31');
  });
});
