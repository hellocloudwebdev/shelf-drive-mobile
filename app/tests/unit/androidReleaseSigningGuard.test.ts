import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// Regression guard for the Android release-signing gate.
//
// Part A (always runs) proves the property-name mapping end to end: the name
// the workflow delivers via ORG_GRADLE_PROJECT_* must be the exact name the
// Gradle guard consumes. This is derived from the workflow file itself, so a
// rename on either side fails here instead of silently disabling the gate
// (the mismatch shipped undetected because Gradle does not normalize
// underscores to dots: ORG_GRADLE_PROJECT_shelfDrive_requireReleaseSigning
// defines the property "shelfDrive_requireReleaseSigning", not
// "shelfDrive.requireReleaseSigning").
//
// Part B (skipped unless the generated Android project and an Android SDK are
// available) executes the real guard paths through Gradle: missing
// credentials, malformed input, development mode, and an adequate test-only
// signing configuration.

const repoRoot = resolve(__dirname, '..', '..', '..');
const workflowPath = join(repoRoot, '.github', 'workflows', 'android.yml');
const overridePath = join(repoRoot, 'app', 'android-overrides', 'app', 'build.gradle.kts');
const genProject = join(repoRoot, 'app', 'src-tauri', 'gen', 'android');
const genAppDir = join(genProject, 'app');
const genGradleFile = join(genAppDir, 'build.gradle.kts');
const genKeystoreProperties = join(genAppDir, 'keystore.properties');
const genTestKeystore = join(genAppDir, 'test-release.keystore');

const ENV_PREFIX = 'ORG_GRADLE_PROJECT_';
const SIGNING_GRADLE_PROPERTY = 'shelfDrive_requireReleaseSigning';

const workflow = readFileSync(workflowPath, 'utf8');
const deliveredNames = [...workflow.matchAll(new RegExp(`${ENV_PREFIX}([A-Za-z0-9_]+)`, 'g'))].map(match => match[1]);
const deliveredProperty = [...new Set(deliveredNames)].at(0);

const override = readFileSync(overridePath, 'utf8');

function runGradle(requireReleaseSigning: string | undefined): { status: number | null; output: string } {
  // Fixed, literal executables with an argument list; the signing value is
  // passed through the process environment, never through a command string.
  const args = [':app:checkUniversalReleaseAarMetadata', '--rerun', '--no-daemon'];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ANDROID_HOME: process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT,
  };
  if (requireReleaseSigning !== undefined) {
    env[`${ENV_PREFIX}${SIGNING_GRADLE_PROPERTY}`] = requireReleaseSigning;
  }
  const result = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/c', 'gradlew.bat', ...args], { cwd: genProject, env, encoding: 'utf8', timeout: 300_000 })
    : spawnSync('./gradlew', args, { cwd: genProject, env, encoding: 'utf8', timeout: 300_000 });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('Android release-signing property mapping', () => {
  it('delivers the signing property through the workflow on every release build step', () => {
    // Only the universal APK/AAB build distributes packages. Require its own
    // environment to feed the guard, not just a property elsewhere in the file.
    const releaseBuildSteps = workflow.split(/\n {6}- /).filter(step =>
      step.includes('run: npm run tauri android build'),
    );
    expect(releaseBuildSteps).toHaveLength(1);
    expect(releaseBuildSteps[0]).toContain(`${ENV_PREFIX}${SIGNING_GRADLE_PROPERTY}:`);
    expect(releaseBuildSteps[0]).toContain("${{ env.PRODUCTION_ANDROID_BUILD }}");
    expect(releaseBuildSteps[0]).toContain('--apk true --aab true --ci');
    expect(deliveredNames).toHaveLength(1);
    // Exactly one distinct signing property name is delivered, so the guard
    // has a single, unambiguous source of truth.
    expect([...new Set(deliveredNames)]).toEqual([SIGNING_GRADLE_PROPERTY]);
  });

  it('consumes the delivered property name verbatim in the Gradle guard', () => {
    expect(deliveredProperty).toBe(SIGNING_GRADLE_PROPERTY);
    expect(override).toContain(`providers.gradleProperty("${deliveredProperty}")`);
  });

  it('parses the signing property strictly and fail-closed', () => {
    expect(override).toContain('.map(String::toBooleanStrict)');
    // toBooleanStrict also contains "toBoolean" as a substring; the exact
    // permissive form must be gone.
    expect(override).not.toMatch(/\.map\(String::toBoolean\)/);
    expect(override).toContain('.orElse(false)');
  });

  it('attaches the guard to every Release-named task and fails closed without credentials', () => {
    expect(override).toContain('tasks.configureEach');
    expect(override).toMatch(/name\.contains\("Release", ignoreCase = true\)/);
    expect(override).toContain('doFirst');
    expect(override).toContain('requireReleaseSigning.get() && !keystorePropertiesFile.exists()');
    expect(override).toContain('throw GradleException');
  });
});

const gradlewPresent = existsSync(join(genProject, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'));
const androidSdkAvailable = Boolean(process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT);
const generatedGradleContents = existsSync(genGradleFile) ? readFileSync(genGradleFile, 'utf8') : '';
const generatedGuardSynced = generatedGradleContents
  .includes(`providers.gradleProperty("${SIGNING_GRADLE_PROPERTY}")`)
  && generatedGradleContents.includes('.map(String::toBooleanStrict)');

describe.skipIf(!gradlewPresent || !androidSdkAvailable)('generated Android project signing guard', () => {
  it('is in sync with the override property name and strict parsing', () => {
    // Stale generated projects (apply-android-overrides.cjs not re-run) must
    // fail loudly instead of validating yesterday's guard.
    expect(generatedGuardSynced).toBe(true);
  });
});

describe.skipIf(!gradlewPresent || !androidSdkAvailable || !generatedGuardSynced)('executable signing-guard paths', () => {
  afterAll(() => {
    for (const file of [genKeystoreProperties, genTestKeystore]) {
      if (existsSync(file)) rmSync(file);
    }
  });

  it('permits development builds when the property is absent', { timeout: 300_000 }, () => {
    if (existsSync(genKeystoreProperties)) rmSync(genKeystoreProperties);
    expect(runGradle(undefined).status).toBe(0);
  });

  it('permits development builds when the property is explicitly false', { timeout: 300_000 }, () => {
    expect(runGradle('false').status).toBe(0);
  });

  it('fails closed on a malformed property value', { timeout: 300_000 }, () => {
    const result = runGradle('ture');
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("The string doesn't represent a boolean value: ture");
  });

  it('fails the release task when production signing is required but credentials are missing', { timeout: 300_000 }, () => {
    if (existsSync(genKeystoreProperties)) rmSync(genKeystoreProperties);
    const result = runGradle('true');
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('A protected release signing configuration is required');
  });

  it('accepts an adequate test-only signing configuration and proceeds past the guard', { timeout: 300_000 }, ({ skip }) => {
    // Throwaway credentials generated locally; never production secrets.
    const keytoolCheck = spawnSync('keytool', ['-help'], { encoding: 'utf8' });
    if (keytoolCheck.status !== 0) {
      skip('keytool is not available on PATH');
      return;
    }
    const generated = spawnSync('keytool', [
      '-genkeypair', '-keystore', genTestKeystore, '-alias', 'testalias',
      '-keyalg', 'RSA', '-keysize', '2048', '-validity', '1',
      '-storepass', 'testpass', '-keypass', 'testpass',
      '-dname', 'CN=Shelf Drive Local Test',
    ], { encoding: 'utf8', timeout: 120_000 });
    expect(generated.status).toBe(0);
    mkdirSync(genAppDir, { recursive: true });
    writeFileSync(genKeystoreProperties, [
      'keyAlias=testalias',
      'keyPassword=testpass',
      `storeFile=${basename(genTestKeystore)}`,
      'storePassword=testpass',
      '',
    ].join('\n'));
    expect(runGradle('true').status).toBe(0);
  });
});
