import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/config/defaultSettings';
import {
  mergeStoredSettings,
  settingsForPersistence,
} from '../../src/services/settingsPersistence';
import { SYNCABLE_SETTING_KEYS } from '../../src/services/settingsSync';
import type { Settings } from '../../src/types/settings';

describe('mobile concurrency settings', () => {
  it('defaults upload and download concurrency to 6', () => {
    expect(DEFAULT_SETTINGS.maxConcurrentUploads).toBe(6);
    expect(DEFAULT_SETTINGS.maxConcurrentDownloads).toBe(6);
  });

  it('includes concurrency settings in encrypted cross-device sync keys', () => {
    expect(SYNCABLE_SETTING_KEYS).toContain('maxConcurrentUploads');
    expect(SYNCABLE_SETTING_KEYS).toContain('maxConcurrentDownloads');
  });

  it('persists and restores custom concurrency settings in range [1, 10]', () => {
    const custom: Partial<Settings> = {
      maxConcurrentUploads: 3,
      maxConcurrentDownloads: 8,
    };
    const merged = mergeStoredSettings(DEFAULT_SETTINGS, custom);
    expect(merged.maxConcurrentUploads).toBe(3);
    expect(merged.maxConcurrentDownloads).toBe(8);

    const forStorage = settingsForPersistence(merged);
    expect(forStorage.maxConcurrentUploads).toBe(3);
    expect(forStorage.maxConcurrentDownloads).toBe(8);
  });

  it('validates and clamps concurrency values between 1 and 10', () => {
    const clampConcurrency = (val: unknown) =>
      Math.max(1, Math.min(10, Number(val) || 1));

    expect(clampConcurrency(0)).toBe(1);
    expect(clampConcurrency(-5)).toBe(1);
    expect(clampConcurrency(1)).toBe(1);
    expect(clampConcurrency(6)).toBe(6);
    expect(clampConcurrency(10)).toBe(10);
    expect(clampConcurrency(15)).toBe(10);
    expect(clampConcurrency('invalid')).toBe(1);
  });
});
