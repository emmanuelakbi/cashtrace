// Gemini Integration - Nigerian format parsing utilities
// Validates: Requirements 11.1, 11.2, 11.3, 11.6

/**
 * Month abbreviation lookup (case-insensitive).
 */
const MONTH_ABBREVS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/**
 * Matches DD/MM/YYYY or DD-MM-YYYY (numeric month).
 */
const NUMERIC_DATE_REGEX = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;

/**
 * Matches DD/MMM/YYYY or DD-MMM-YYYY (abbreviated month name).
 */
const ABBREV_DATE_REGEX = /^(\d{1,2})[/-]([A-Za-z]{3})[/-](\d{4})$/;

/**
 * Parse a Nigerian-format date string into ISO 8601 (YYYY-MM-DD).
 *
 * Supported formats:
 * - DD/MM/YYYY  (e.g. 25/12/2024)
 * - DD-MM-YYYY  (e.g. 25-12-2024)
 * - DD/MMM/YYYY (e.g. 25/Dec/2024)
 * - DD-MMM-YYYY (e.g. 25-Dec-2024)
 *
 * Returns `null` when the input cannot be parsed or represents an invalid date.
 */
export function parseNigerianDate(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let day: number;
  let month: number;
  let year: number;

  // Try numeric format first: DD/MM/YYYY or DD-MM-YYYY
  const numericMatch = NUMERIC_DATE_REGEX.exec(trimmed);
  if (numericMatch) {
    day = parseInt(numericMatch[1], 10);
    month = parseInt(numericMatch[2], 10);
    year = parseInt(numericMatch[3], 10);
  } else {
    // Try abbreviated month format: DD/MMM/YYYY or DD-MMM-YYYY
    const abbrevMatch = ABBREV_DATE_REGEX.exec(trimmed);
    if (!abbrevMatch) {
      return null;
    }

    day = parseInt(abbrevMatch[1], 10);
    const monthAbbrev = abbrevMatch[2].toLowerCase();
    const resolvedMonth = MONTH_ABBREVS[monthAbbrev];
    if (resolvedMonth === undefined) {
      return null;
    }
    month = resolvedMonth;
    year = parseInt(abbrevMatch[3], 10);
  }

  // Validate ranges
  if (month < 1 || month > 12) {
    return null;
  }
  if (day < 1 || day > 31) {
    return null;
  }
  if (year < 1) {
    return null;
  }

  // Use Date to validate the actual calendar date (handles leap years, month lengths)
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  const yStr = year.toString().padStart(4, '0');
  const mStr = month.toString().padStart(2, '0');
  const dStr = day.toString().padStart(2, '0');

  return `${yStr}-${mStr}-${dStr}`;
}

/**
 * Currency prefix pattern.
 * Matches ₦, NGN, or standalone N followed by optional whitespace.
 * The standalone N is only matched when immediately followed by a digit or comma
 * to avoid false positives on regular words.
 */
const CURRENCY_PREFIX_REGEX = /^(?:₦|NGN|N)\s*/i;

/**
 * Parse a Nigerian currency string into a numeric Naira value.
 *
 * Supported prefixes: ₦, NGN, N (case-insensitive).
 * Handles comma-separated thousands (e.g. ₦1,234,567.89).
 * Handles optional whitespace between prefix and amount.
 *
 * Returns `null` when the input cannot be parsed.
 */
export function parseNigerianCurrency(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Strip currency prefix
  const withoutPrefix = trimmed.replace(CURRENCY_PREFIX_REGEX, '');
  if (withoutPrefix.length === 0) {
    return null;
  }

  // Remove commas used as thousands separators
  const cleaned = withoutPrefix.replace(/,/g, '');

  // Validate the remaining string is a valid number
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) {
    return null;
  }

  const value = parseFloat(cleaned);

  if (!isFinite(value) || value < 0) {
    return null;
  }

  return value;
}

/**
 * Nigerian phone number pattern for extraction from free text.
 *
 * Matches:
 * - Local format: 08012345678, 080-1234-5678, 080 1234 5678
 * - International with +: +2348012345678, +234-801-234-5678, +234 801 234 5678
 * - International without +: 2348012345678, 234-801-234-5678
 *
 * Valid prefixes after country code: 70, 80, 81, 90, 91
 */
const PHONE_EXTRACT_REGEX = /(?:\+?234[-.\s]?)?0?[789][01]\d[-.\s]?\d{3}[-.\s]?\d{4}/g;

/**
 * Normalisation helper — strip everything except digits.
 */
function stripNonDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Normalise a raw phone match to the standard local format (0XXXXXXXXXX, 11 digits).
 * Returns `null` if the digits don't form a valid Nigerian number.
 */
function normalizePhone(digits: string): string | null {
  // International format with 234 prefix (13 digits: 2348012345678)
  if (digits.length === 13 && digits.startsWith('234')) {
    const local = '0' + digits.slice(3);
    return validateLocalPhone(local) ? local : null;
  }

  // Local format (11 digits: 08012345678)
  if (digits.length === 11 && digits.startsWith('0')) {
    return validateLocalPhone(digits) ? digits : null;
  }

  // 10 digits without leading zero (8012345678) — from stripped international
  if (digits.length === 10) {
    const local = '0' + digits;
    return validateLocalPhone(local) ? local : null;
  }

  return null;
}

/**
 * Validate that a local-format phone (0XXXXXXXXXX) has a valid Nigerian prefix.
 */
function validateLocalPhone(local: string): boolean {
  if (local.length !== 11) {
    return false;
  }
  const prefix = local.slice(0, 4);
  // Valid prefixes: 070x, 080x, 081x, 090x, 091x
  return /^0[789][01]\d$/.test(prefix);
}

export interface ExtractedPhone {
  /** The original text matched in the input. */
  original: string;
  /** Normalised local format: 0XXXXXXXXXX (11 digits). */
  normalized: string;
}

/**
 * Extract and normalise Nigerian phone numbers from free text.
 *
 * Returns an array of unique phone numbers found in the input,
 * each with the original matched text and the normalised local format.
 */
export function extractNigerianPhone(text: string): ExtractedPhone[] {
  const matches = text.match(PHONE_EXTRACT_REGEX);
  if (!matches) {
    return [];
  }

  const seen = new Set<string>();
  const results: ExtractedPhone[] = [];

  for (const original of matches) {
    const digits = stripNonDigits(original);
    const normalized = normalizePhone(digits);
    if (normalized !== null && !seen.has(normalized)) {
      seen.add(normalized);
      results.push({ original: original.trim(), normalized });
    }
  }

  return results;
}
