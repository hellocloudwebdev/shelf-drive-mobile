import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appFile = (...parts: string[]) => readFileSync(resolve(process.cwd(), ...parts), 'utf8');

describe('Android native lifecycle instrumentation', () => {
  it('shares the native runtime instead of destroying its last Activity between cases', () => {
    const suite = appFile('android-overrides', 'app', 'src', 'androidTest', 'java', 'com', 'hellocloudweb', 'shelfdrive', 'UploadLifecycleInstrumentationTest.kt');
    expect(suite.match(/ActivityScenario\.launch\(MainActivity::class\.java\)/g)).toHaveLength(1);
    expect(suite).toContain('@BeforeClass');
    expect(suite).not.toContain('.use {');
    expect(suite).not.toContain('scenario.close()');
    expect(suite).toContain('scenario.moveToState(Lifecycle.State.CREATED)');
    expect(suite).toContain('scenario.moveToState(Lifecycle.State.RESUMED)');
    expect(suite).toContain('foregroundServiceUpdatesAndSurvivesActivityBackgroundResume');
    expect(suite).toContain('productionServiceApiUsesUidtOrFallbackAcrossActivityBackgroundResume');
  });

  it('promotes accepted updates with their new state and terminal starts before cleanup', () => {
    const service = appFile('android-overrides', 'app', 'src', 'main', 'java', 'com', 'hellocloudweb', 'shelfdrive', 'UploadForegroundService.kt');
    const command = service.slice(service.indexOf('override fun onStartCommand'), service.indexOf('override fun onTimeout'));
    const stateUpdate = command.indexOf('activeCount = intent.getIntExtra');
    const acceptedPromotion = command.indexOf('startAsForeground(createNotification())', stateUpdate);
    expect(stateUpdate).toBeGreaterThan(0);
    expect(acceptedPromotion).toBeGreaterThan(command.indexOf('paused = intent.getBooleanExtra'));
    expect(command.indexOf('startAsForeground(createNotification())')).toBeLessThan(command.indexOf('stopForeground(STOP_FOREGROUND_REMOVE)'));
    expect(command).not.toContain('notifyProgress()');
  });

  it('returns emulator instrumentation results before external process cleanup', () => {
    const runner = appFile('scripts', 'run-android-emulator-tests.sh');
    expect(runner).toContain('-Pandroid.testInstrumentationRunnerArguments.waitForActivitiesToComplete=false');
    expect(runner).toContain('trap cleanup EXIT INT TERM');
    expect(runner).toContain('emu kill');
  });
});
