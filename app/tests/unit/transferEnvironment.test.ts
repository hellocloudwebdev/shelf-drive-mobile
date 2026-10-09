import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  queryAndroidTransferEnvironment,
  resetTransferEnvironmentQueryForTests,
} from '../../src/services/transferEnvironment';
import {
  evaluateAndroidTransferPolicy,
  type AndroidTransferEnvironment,
} from '../../src/services/androidTransferPolicy';
import { DEFAULT_SETTINGS } from '../../src/config/defaultSettings';

const healthyEnvironment: AndroidTransferEnvironment = {
  connected: true,
  metered: false,
  roaming: false,
  charging: true,
  batteryLow: false,
  storageLow: false,
  freeBytes: 10 * 1024 ** 3,
  powerSaveMode: false,
  backgroundRestricted: false,
  isTelevision: false,
};

describe('queryAndroidTransferEnvironment', () => {
  beforeEach(() => {
    resetTransferEnvironmentQueryForTests();
  });

  it('resolves immediately when the first query succeeds', async () => {
    const fetchFn = vi.fn().mockResolvedValue(healthyEnvironment);
    const delayFn = vi.fn().mockResolvedValue(undefined);

    const result = await queryAndroidTransferEnvironment({
      fetchEnvironment: fetchFn,
      delay: delayFn,
    });

    expect(result).toEqual(healthyEnvironment);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(delayFn).not.toHaveBeenCalled();
  });

  it('retries with exponential backoff and recovers after transient errors', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('JNI class cache initializing'))
      .mockRejectedValueOnce(new Error('appContext not ready'))
      .mockResolvedValueOnce(healthyEnvironment);
    const recordedDelays: number[] = [];
    const delayFn = vi.fn().mockImplementation((ms: number) => {
      recordedDelays.push(ms);
      return Promise.resolve();
    });

    const result = await queryAndroidTransferEnvironment({
      attempts: 3,
      baseDelayMs: 200,
      maxDelayMs: 1_000,
      fetchEnvironment: fetchFn,
      delay: delayFn,
    });

    expect(result).toEqual(healthyEnvironment);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    // Attempt 1 fails -> delay 200 * 2^0 = 200
    // Attempt 2 fails -> delay 200 * 2^1 = 400
    expect(recordedDelays).toEqual([200, 400]);
  });

  it('caps backoff delays at maxDelayMs', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient 1'))
      .mockRejectedValueOnce(new Error('transient 2'))
      .mockResolvedValueOnce(healthyEnvironment);
    const recordedDelays: number[] = [];
    const delayFn = vi.fn().mockImplementation((ms: number) => {
      recordedDelays.push(ms);
      return Promise.resolve();
    });

    await queryAndroidTransferEnvironment({
      attempts: 3,
      baseDelayMs: 500,
      maxDelayMs: 600,
      fetchEnvironment: fetchFn,
      delay: delayFn,
    });

    // 500 * 2^0 = 500; 500 * 2^1 = 1000 clamped to 600
    expect(recordedDelays).toEqual([500, 600]);
  });

  it('throws after all retry attempts are exhausted', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('OEM bridge permanently unreachable'));
    const delayFn = vi.fn().mockResolvedValue(undefined);

    await expect(
      queryAndroidTransferEnvironment({
        attempts: 3,
        baseDelayMs: 50,
        fetchEnvironment: fetchFn,
        delay: delayFn,
      }),
    ).rejects.toThrow('OEM bridge permanently unreachable');

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(delayFn).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight promise across concurrent callers without stampeding', async () => {
    let finishFetch!: (env: AndroidTransferEnvironment) => void;
    const fetchFn = vi.fn().mockImplementation(
      () =>
        new Promise<AndroidTransferEnvironment>((resolve) => {
          finishFetch = resolve;
        }),
    );

    const call1 = queryAndroidTransferEnvironment({ fetchEnvironment: fetchFn });
    const call2 = queryAndroidTransferEnvironment({ fetchEnvironment: fetchFn });
    const call3 = queryAndroidTransferEnvironment({ fetchEnvironment: fetchFn });

    expect(fetchFn).toHaveBeenCalledTimes(1);

    finishFetch(healthyEnvironment);

    const [res1, res2, res3] = await Promise.all([call1, call2, call3]);
    expect(res1).toEqual(healthyEnvironment);
    expect(res2).toEqual(healthyEnvironment);
    expect(res3).toEqual(healthyEnvironment);
  });

  it('clears in-flight tracking on settlement so subsequent calls start fresh', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(healthyEnvironment)
      .mockResolvedValueOnce({ ...healthyEnvironment, metered: true });

    const first = await queryAndroidTransferEnvironment({ fetchEnvironment: fetchFn });
    expect(first.metered).toBe(false);

    const second = await queryAndroidTransferEnvironment({ fetchEnvironment: fetchFn });
    expect(second.metered).toBe(true);

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('clears in-flight tracking on failure so subsequent queries can retry', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockResolvedValueOnce(healthyEnvironment);

    await expect(
      queryAndroidTransferEnvironment({
        attempts: 1,
        fetchEnvironment: fetchFn,
      }),
    ).rejects.toThrow('fail 1');

    const recovered = await queryAndroidTransferEnvironment({
      attempts: 1,
      fetchEnvironment: fetchFn,
    });
    expect(recovered).toEqual(healthyEnvironment);
  });
});

describe('fail-safe transfer gate integration', () => {
  it('blocks transfer fail-safe when environment query fails (undefined environment)', () => {
    const gate = evaluateAndroidTransferPolicy(undefined, DEFAULT_SETTINGS);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('Checking Android transfer conditions');
  });

  it('allows transfer once environment query succeeds with satisfying conditions', () => {
    const gate = evaluateAndroidTransferPolicy(healthyEnvironment, DEFAULT_SETTINGS);
    expect(gate.allowed).toBe(true);
    expect(gate.reason).toBeUndefined();
  });

  it('enforces confirmed restriction when environment query succeeds but policy blocks', () => {
    const roamingGate = evaluateAndroidTransferPolicy(
      { ...healthyEnvironment, roaming: true },
      { ...DEFAULT_SETTINGS, androidAllowRoaming: false },
    );
    expect(roamingGate.allowed).toBe(false);
    expect(roamingGate.reason).toBe('Transfers are paused while roaming');

    const lowBatteryGate = evaluateAndroidTransferPolicy(
      { ...healthyEnvironment, batteryLow: true, charging: false },
      { ...DEFAULT_SETTINGS, androidPauseOnLowBattery: true },
    );
    expect(lowBatteryGate.allowed).toBe(false);
    expect(lowBatteryGate.reason).toBe('Transfers are paused while the battery is low');

    const lowStorageGate = evaluateAndroidTransferPolicy(
      { ...healthyEnvironment, storageLow: true },
      DEFAULT_SETTINGS,
    );
    expect(lowStorageGate.allowed).toBe(false);
    expect(lowStorageGate.reason).toBe('Android reports that device storage is low');
  });
});
