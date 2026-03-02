/**
 * Nigerian localization utilities for CashTrace.
 *
 * - All dates/times formatted in WAT (West Africa Time, UTC+1)
 * - Currency formatted as Naira (₦) with Kobo precision
 * - Dates formatted as DD/MM/YYYY by default
 *
 * @module utils/localization
 */

const WAT_TIMEZONE = 'Africa/Lagos';
const LOCALE = 'en-NG';
const KOBO_PER_NAIRA = 100;

/**
 * Resolves a date input (Date, ISO string, or Unix ms timestamp) to a Date object.
 */
function resolveDate(date: Date | string | number): Date {
  if (date instanceof Date) {
    return date;
  }
  return new Date(date);
}

// --- Date / Time Formatters ---

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: WAT_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: WAT_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: WAT_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Formats a date in WAT timezone as DD/MM/YYYY.
 *
 * @param date - Date object, ISO string, or Unix ms timestamp
 * @returns Formatted date string (e.g. "25/12/2024")
 */
export function formatWATDate(date: Date | string | number): string {
  const d = resolveDate(date);
  const parts = dateFormatter.formatToParts(d);
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  return `${day}/${month}/${year}`;
}

/**
 * Formats a time in WAT timezone as HH:MM (24-hour).
 *
 * @param date - Date object, ISO string, or Unix ms timestamp
 * @returns Formatted time string (e.g. "14:30")
 */
export function formatWATTime(date: Date | string | number): string {
  const d = resolveDate(date);
  const parts = timeFormatter.formatToParts(d);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
  return `${hour}:${minute}`;
}

/**
 * Formats a full date+time in WAT timezone as DD/MM/YYYY, HH:MM.
 *
 * @param date - Date object, ISO string, or Unix ms timestamp
 * @returns Formatted date-time string (e.g. "25/12/2024, 14:30")
 */
export function formatWATDateTime(date: Date | string | number): string {
  const d = resolveDate(date);
  const parts = dateTimeFormatter.formatToParts(d);
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
  return `${day}/${month}/${year}, ${hour}:${minute}`;
}

// --- Currency Formatters ---

const nairaFormatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const nairaCompactFormatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/**
 * Converts a Kobo amount to Naira.
 *
 * @param kobo - Amount in Kobo (integer)
 * @returns Amount in Naira
 */
export function koboToNaira(kobo: number): number {
  return kobo / KOBO_PER_NAIRA;
}

/**
 * Converts a Naira amount to Kobo.
 *
 * @param naira - Amount in Naira
 * @returns Amount in Kobo (rounded to nearest integer)
 */
export function nairaToKobo(naira: number): number {
  return Math.round(naira * KOBO_PER_NAIRA);
}

/**
 * Formats a Kobo amount as Naira with ₦ symbol and thousands separators.
 * Always shows 2 decimal places for Kobo precision.
 *
 * @param kobo - Amount in Kobo (integer)
 * @returns Formatted string (e.g. "₦1,500.00")
 */
export function formatNaira(kobo: number): string {
  const naira = koboToNaira(kobo);
  return nairaFormatter.format(naira).replace('NGN', '₦').replace(/\s+/g, '');
}

/**
 * Formats a Kobo amount as Naira in compact form.
 * Omits decimals when the amount is a whole Naira value.
 *
 * @param kobo - Amount in Kobo (integer)
 * @returns Formatted string (e.g. "₦1,500" for whole, "₦1,500.50" for fractional)
 */
export function formatNairaCompact(kobo: number): string {
  const naira = koboToNaira(kobo);
  const isWholeNaira = kobo % KOBO_PER_NAIRA === 0;
  const formatter = isWholeNaira
    ? new Intl.NumberFormat(LOCALE, {
        style: 'currency',
        currency: 'NGN',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })
    : nairaCompactFormatter;
  return formatter.format(naira).replace('NGN', '₦').replace(/\s+/g, '');
}
