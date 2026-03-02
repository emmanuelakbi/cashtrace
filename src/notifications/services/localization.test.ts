/**
 * Nigerian Localization — Unit Tests
 *
 * Tests Naira formatting, WAT timezone conversion, and English/Pidgin
 * translation lookup for the notification localization utilities.
 *
 * @module notifications/services/localization.test
 */

import { describe, it, expect } from 'vitest';

import { formatNaira, formatWatDate, formatWatTime, translate } from './localization.js';

// ─── formatNaira ─────────────────────────────────────────────────────────────

describe('formatNaira', () => {
  it('should format kobo to Naira with two decimal places', () => {
    expect(formatNaira(5000000)).toBe('₦50,000.00');
  });

  it('should format zero kobo', () => {
    expect(formatNaira(0)).toBe('₦0.00');
  });

  it('should format small amounts correctly', () => {
    expect(formatNaira(50)).toBe('₦0.50');
    expect(formatNaira(1)).toBe('₦0.01');
    expect(formatNaira(100)).toBe('₦1.00');
  });

  it('should format large amounts with comma separators', () => {
    expect(formatNaira(100000000)).toBe('₦1,000,000.00');
  });

  it('should handle amounts that produce fractional kobo-to-naira values', () => {
    expect(formatNaira(12345)).toBe('₦123.45');
  });
});

// ─── formatWatDate ───────────────────────────────────────────────────────────

describe('formatWatDate', () => {
  it('should convert UTC midnight to 01:00 WAT', () => {
    // 2024-06-15T00:00:00Z → WAT is 01:00
    const utcDate = new Date('2024-06-15T00:00:00Z');
    expect(formatWatDate(utcDate)).toBe('15 Jun 2024, 01:00 WAT');
  });

  it('should convert UTC 23:00 to WAT next day 00:00', () => {
    // 2024-06-15T23:00:00Z → WAT is 2024-06-16 00:00
    const utcDate = new Date('2024-06-15T23:00:00Z');
    expect(formatWatDate(utcDate)).toBe('16 Jun 2024, 00:00 WAT');
  });

  it('should format a mid-day UTC time correctly', () => {
    // 2024-01-10T14:30:00Z → WAT is 15:30
    const utcDate = new Date('2024-01-10T14:30:00Z');
    expect(formatWatDate(utcDate)).toBe('10 Jan 2024, 15:30 WAT');
  });
});

// ─── formatWatTime ───────────────────────────────────────────────────────────

describe('formatWatTime', () => {
  it('should format time-only in WAT', () => {
    const utcDate = new Date('2024-06-15T08:45:00Z');
    expect(formatWatTime(utcDate)).toBe('09:45 WAT');
  });

  it('should wrap around midnight correctly', () => {
    const utcDate = new Date('2024-06-15T23:30:00Z');
    expect(formatWatTime(utcDate)).toBe('00:30 WAT');
  });
});

// ─── translate (English) ─────────────────────────────────────────────────────

describe('translate — English', () => {
  it('should return English translation for known keys', () => {
    expect(translate('new_transaction', 'en')).toBe('New Transaction');
    expect(translate('security_alert', 'en')).toBe('Security Alert');
    expect(translate('payment_received', 'en')).toBe('Payment Received');
    expect(translate('payment_sent', 'en')).toBe('Payment Sent');
    expect(translate('daily_digest', 'en')).toBe('Daily Summary');
    expect(translate('weekly_digest', 'en')).toBe('Weekly Summary');
  });
});

// ─── translate (Pidgin) ──────────────────────────────────────────────────────

describe('translate — Pidgin', () => {
  it('should return Pidgin translation for known keys', () => {
    expect(translate('new_transaction', 'pcm')).toBe('New Money Matter');
    expect(translate('security_alert', 'pcm')).toBe('Security Wahala');
    expect(translate('payment_received', 'pcm')).toBe('Money Don Enter');
    expect(translate('payment_sent', 'pcm')).toBe('Money Don Comot');
    expect(translate('daily_digest', 'pcm')).toBe('Today Summary');
    expect(translate('weekly_digest', 'pcm')).toBe('This Week Summary');
  });
});

// ─── translate (fallback) ────────────────────────────────────────────────────

describe('translate — fallback', () => {
  it('should return the key itself when translation is not found', () => {
    expect(translate('unknown_key', 'en')).toBe('unknown_key');
    expect(translate('nonexistent', 'pcm')).toBe('nonexistent');
  });
});
