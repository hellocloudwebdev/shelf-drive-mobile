import { describe, expect, it } from 'vitest';
import { parseTelegramApiId } from '../../src/services/telegramCredentials';

describe('parseTelegramApiId', () => {
  it('accepts a positive integer with surrounding whitespace', () => {
    expect(parseTelegramApiId(' 12345678 ')).toBe(12345678);
  });

  it.each(['', '12abc', '12.5', '-1', '+1', '1 2'])('rejects malformed ID %j', (value) => {
    expect(() => parseTelegramApiId(value)).toThrow(/digits only/);
  });

  it.each(['0', '2147483648', '999999999999999999999'])('rejects out-of-range ID %j', (value) => {
    expect(() => parseTelegramApiId(value)).toThrow(/positive 32-bit integer/);
  });
});
