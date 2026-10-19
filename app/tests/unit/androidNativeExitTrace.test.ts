import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const native = 'android-overrides/app/src/main/java/com/hellocloudweb/shelfdrive/';

describe('Android local native trace integration contracts', () => {
  it('only queries this exact package and checks both UIDs on every supported SDK', () => {
    const code = read(`${native}AppDiagnostics.kt`);
    expect(code).toContain('getHistoricalProcessExitReasons(context.packageName, 0, EXIT_SUMMARY_LIMIT)');
    expect(code).toContain('info.realUid == Process.myUid() && info.packageUid == Process.myUid()');
    expect(code).toContain('NativeExitTracePolicy.canCapture(Build.VERSION.SDK_INT, context.packageName,');
    expect(code).toContain('info.processName, info.realUid, info.packageUid, Process.myUid(), info.reason)');
    expect(code).toContain('info.traceInputStream');
    expect(code).not.toContain('Build.VERSION.SDK_INT < 34 ||');
    expect(code).not.toMatch(/Runtime\.getRuntime|ProcessBuilder|\/data\/tombstones|\.description/);
    expect(read('android-overrides/app/src/main/AndroidManifest.xml')).not.toContain('android.permission.READ_LOGS');
  });

  it('uses non-backed-up private storage and does not perform trace IO during Application startup', () => {
    const code = read(`${native}AppDiagnostics.kt`);
    expect(code).toContain('File(context.noBackupFilesDir, "native_exit_traces")');
    expect(code).toContain('Thread({');
    expect(code).toContain('"app-native-exit-capture"');
    expect(code).toContain('isDaemon = true');
    expect(code).toContain('if (!captureScheduled)');
    expect(code).toContain('store.snapshot(now)');
    expect(code).toContain('.snapshot(System.currentTimeMillis())');
    expect(code).not.toMatch(/https?:\/\/|openConnection|upload|sendBroadcast/);
  });

  it('exports raw binary only with explicit encoding, sensitivity and truncation metadata', () => {
    const code = read(`${native}AppDiagnostics.kt`);
    expect(code).toContain('NOT sanitized');
    expect(code).toContain('put("encoding", "base64")');
    expect(code).toContain('put("format", "android_tombstone_protobuf")');
    expect(code).toContain('put("truncated", trace.truncated)');
    expect(code).toContain('put("capturedBytes", trace.bytes.size)');
    expect(code).toContain('Base64.getEncoder().encodeToString(trace.bytes)');
    const rust = read('src-tauri/src/diagnostics.rs');
    expect(rust).toContain('MAX_ANDROID_LOG_BYTES: usize = 1100 * 1024');
    expect(rust).toContain('tail_by_bytes(&contents, MAX_ANDROID_LOG_BYTES)');
  });

  it('reproduces the native policy and store in generated Android builds', () => {
    const apply = read('scripts/apply-android-overrides.cjs');
    for (const file of ['AppDiagnostics.kt', 'NativeExitTraceStore.kt', 'NativeExitTracePolicy.kt']) {
      expect(apply).toContain(`app/src/main/java/com/hellocloudweb/shelfdrive/${file}`);
    }
  });
});
