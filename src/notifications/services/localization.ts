/**
 * Nigerian Localization Utilities
 *
 * Provides Naira currency formatting, WAT timezone date/time formatting,
 * and English/Pidgin translation support for notification content.
 *
 * @module notifications/services/localization
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Supported locales: English and Nigerian Pidgin English. */
export type Locale = 'en' | 'pcm';

// ─── Translation Map ─────────────────────────────────────────────────────────

const translations: Record<string, Record<Locale, string>> = {
  new_transaction: {
    en: 'New Transaction',
    pcm: 'New Money Matter',
  },
  security_alert: {
    en: 'Security Alert',
    pcm: 'Security Wahala',
  },
  payment_received: {
    en: 'Payment Received',
    pcm: 'Money Don Enter',
  },
  payment_sent: {
    en: 'Payment Sent',
    pcm: 'Money Don Comot',
  },
  daily_digest: {
    en: 'Daily Summary',
    pcm: 'Today Summary',
  },
  weekly_digest: {
    en: 'Weekly Summary',
    pcm: 'This Week Summary',
  },
};

// ─── WAT Offset ──────────────────────────────────────────────────────────────

/** WAT is UTC+1, i.e. 60 minutes ahead of UTC. */
const WAT_OFFSET_MS = 60 * 60 * 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Pad a number to two digits. */
function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Format an amount in kobo as a Naira string.
 *
 * 100 kobo = ₦1. The result uses comma-separated thousands and two decimal
 * places, e.g. `5000000` → `"₦50,000.00"`.
 */
export function formatNaira(kobo: number): string {
  const naira = kobo / 100;
  const formatted = naira.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `₦${formatted}`;
}

/**
 * Format a `Date` in WAT (UTC+1) as `"DD MMM YYYY, HH:mm WAT"`.
 */
export function formatWatDate(date: Date): string {
  const wat = new Date(date.getTime() + WAT_OFFSET_MS);
  const day = pad(wat.getUTCDate());
  const month = MONTH_ABBR[wat.getUTCMonth()];
  const year = wat.getUTCFullYear();
  const hours = pad(wat.getUTCHours());
  const minutes = pad(wat.getUTCMinutes());
  return `${day} ${month} ${year}, ${hours}:${minutes} WAT`;
}

/**
 * Format a `Date` as time-only in WAT: `"HH:mm WAT"`.
 */
export function formatWatTime(date: Date): string {
  const wat = new Date(date.getTime() + WAT_OFFSET_MS);
  const hours = pad(wat.getUTCHours());
  const minutes = pad(wat.getUTCMinutes());
  return `${hours}:${minutes} WAT`;
}

/**
 * Look up a translation key for the given locale.
 *
 * Returns the translated phrase, or the raw `key` if no translation exists.
 */
export function translate(key: string, locale: Locale): string {
  const entry = translations[key];
  if (!entry) {
    return key;
  }
  return entry[locale];
}
