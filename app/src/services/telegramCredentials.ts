const MAX_TELEGRAM_API_ID = 2_147_483_647;

/** Parse Telegram's signed 32-bit API ID without silently accepting parseInt prefixes. */
export function parseTelegramApiId(input: string): number {
  const value = input.trim();
  if (!/^\d+$/.test(value)) {
    throw new Error("API ID must contain digits only.");
  }

  const apiId = Number(value);
  if (!Number.isSafeInteger(apiId) || apiId < 1 || apiId > MAX_TELEGRAM_API_ID) {
    throw new Error("API ID must be a positive 32-bit integer.");
  }

  return apiId;
}
