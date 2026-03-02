/**
 * Unit tests for WAT timezone utilities.
 *
 * @see Requirements 14.5
 */

import { describe, it, expect } from 'vitest';

import {
  WAT_OFFSET_MS,
  WAT_OFFSET_MINUTES,
  WAT_TIMEZONE,
  toWAT,
  formatDateWAT,
  formatDateNigerian,
  formatShortDateWAT,
  formatTimeWAT,
  nowWAT,
  createWATDate,
  startOfDayWAT,
  isSameWATDay,
  getWATDayOfWeek,
} from './timezone.js';

// ─── Constants ───────────────────────────────────────────────────────────────

describe('WAT constants', () => {
  it('WAT_OFFSET_MS is 1 hour in milliseconds', () => {
    expect(WAT_OFFSET_MS).toBe(3_600_000);
  });

  it('WAT_OFFSET_MINUTES is 60', () => {
    expect(WAT_OFFSET_MINUTES).toBe(60);
  });

  it('WAT_TIMEZONE is Africa/Lagos', () => {
    expect(WAT_TIMEZONE).toBe('Africa/Lagos');
  });
});

// ─── toWAT ───────────────────────────────────────────────────────────────────

describe('toWAT', () => {
  it('shifts UTC midnight to 01:00 WAT', () => {
    const utcMidnight = new Date('2024-01-15T00:00:00Z');
    const wat = toWAT(utcMidnight);
    expect(wat.getUTCHours()).toBe(1);
  });

  it('shifts UTC 23:00 to WAT 00:00 next day', () => {
    const utc23 = new Date('2024-01-15T23:00:00Z');
    const wat = toWAT(utc23);
    expect(wat.getUTCHours()).toBe(0);
    expect(wat.getUTCDate()).toBe(16);
  });

  it('preserves minutes and seconds', () => {
    const date = new Date('2024-06-10T14:30:45Z');
    const wat = toWAT(date);
    expect(wat.getUTCHours()).toBe(15);
    expect(wat.getUTCMinutes()).toBe(30);
    expect(wat.getUTCSeconds()).toBe(45);
  });

  it('does not mutate the original date', () => {
    const original = new Date('2024-01-15T12:00:00Z');
    const originalMs = original.getTime();
    toWAT(original);
    expect(original.getTime()).toBe(originalMs);
  });
});

// ─── formatDateWAT ──────────────────────────────────────────────────────────

describe('formatDateWAT', () => {
  it('formats UTC midnight as 01:00 WAT with +01:00 offset', () => {
    const date = new Date('2024-01-15T00:00:00Z');
    expect(formatDateWAT(date)).toBe('2024-01-15T01:00:00+01:00');
  });

  it('formats a mid-day time correctly', () => {
    const date = new Date('2024-06-10T14:30:45Z');
    expect(formatDateWAT(date)).toBe('2024-06-10T15:30:45+01:00');
  });

  it('handles day rollover from UTC 23:xx', () => {
    const date = new Date('2024-03-31T23:30:00Z');
    expect(formatDateWAT(date)).toBe('2024-04-01T00:30:00+01:00');
  });

  it('pads single-digit months and days', () => {
    const date = new Date('2024-02-05T08:05:03Z');
    expect(formatDateWAT(date)).toBe('2024-02-05T09:05:03+01:00');
  });
});

// ─── formatDateNigerian ─────────────────────────────────────────────────────

describe('formatDateNigerian', () => {
  it('uses DD/MM/YYYY HH:mm WAT format', () => {
    const date = new Date('2024-01-15T10:30:00Z');
    expect(formatDateNigerian(date)).toBe('15/01/2024 11:30 WAT');
  });

  it('pads single-digit values', () => {
    const date = new Date('2024-02-05T03:05:00Z');
    expect(formatDateNigerian(date)).toBe('05/02/2024 04:05 WAT');
  });

  it('handles day rollover', () => {
    const date = new Date('2024-12-31T23:30:00Z');
    expect(formatDateNigerian(date)).toBe('01/01/2025 00:30 WAT');
  });
});

// ─── formatShortDateWAT ─────────────────────────────────────────────────────

describe('formatShortDateWAT', () => {
  it('returns DD/MM/YYYY format', () => {
    const date = new Date('2024-06-15T12:00:00Z');
    expect(formatShortDateWAT(date)).toBe('15/06/2024');
  });

  it('handles day rollover near midnight UTC', () => {
    const date = new Date('2024-06-15T23:30:00Z');
    expect(formatShortDateWAT(date)).toBe('16/06/2024');
  });
});

// ─── formatTimeWAT ──────────────────────────────────────────────────────────

describe('formatTimeWAT', () => {
  it('returns HH:mm WAT format', () => {
    const date = new Date('2024-01-15T14:30:00Z');
    expect(formatTimeWAT(date)).toBe('15:30 WAT');
  });

  it('pads single-digit hours and minutes', () => {
    const date = new Date('2024-01-15T02:05:00Z');
    expect(formatTimeWAT(date)).toBe('03:05 WAT');
  });
});

// ─── nowWAT ─────────────────────────────────────────────────────────────────

describe('nowWAT', () => {
  it('returns a date approximately 1 hour ahead of UTC now', () => {
    const before = Date.now() + WAT_OFFSET_MS;
    const wat = nowWAT();
    const after = Date.now() + WAT_OFFSET_MS;
    expect(wat.getTime()).toBeGreaterThanOrEqual(before - 50);
    expect(wat.getTime()).toBeLessThanOrEqual(after + 50);
  });
});

// ─── createWATDate ──────────────────────────────────────────────────────────

describe('createWATDate', () => {
  it('creates a UTC date that represents the given WAT time', () => {
    // 06:00 WAT = 05:00 UTC
    const date = createWATDate(2024, 1, 15, 6, 0, 0);
    expect(date.getUTCHours()).toBe(5);
    expect(date.getUTCDate()).toBe(15);
    expect(date.getUTCMonth()).toBe(0); // January
    expect(date.getUTCFullYear()).toBe(2024);
  });

  it('handles midnight WAT (00:00 WAT = 23:00 UTC previous day)', () => {
    const date = createWATDate(2024, 1, 15, 0, 0, 0);
    expect(date.getUTCHours()).toBe(23);
    expect(date.getUTCDate()).toBe(14);
  });

  it('defaults hours, minutes, seconds to 0', () => {
    const date = createWATDate(2024, 6, 10);
    // 00:00 WAT = 23:00 UTC previous day
    expect(date.getUTCHours()).toBe(23);
    expect(date.getUTCDate()).toBe(9);
  });

  it('uses 1-indexed months', () => {
    const date = createWATDate(2024, 12, 25, 12, 0, 0);
    expect(date.getUTCMonth()).toBe(11); // December is 11 in JS
    expect(date.getUTCDate()).toBe(25);
    expect(date.getUTCHours()).toBe(11);
  });

  it('round-trips through toWAT correctly', () => {
    const date = createWATDate(2024, 3, 15, 14, 30, 45);
    const wat = toWAT(date);
    expect(wat.getUTCFullYear()).toBe(2024);
    expect(wat.getUTCMonth()).toBe(2); // March = 2
    expect(wat.getUTCDate()).toBe(15);
    expect(wat.getUTCHours()).toBe(14);
    expect(wat.getUTCMinutes()).toBe(30);
    expect(wat.getUTCSeconds()).toBe(45);
  });
});

// ─── startOfDayWAT ─────────────────────────────────────────────────────────

describe('startOfDayWAT', () => {
  it('returns midnight WAT for a given date', () => {
    const date = new Date('2024-01-15T14:30:00Z');
    const start = startOfDayWAT(date);
    const wat = toWAT(start);
    expect(wat.getUTCHours()).toBe(0);
    expect(wat.getUTCMinutes()).toBe(0);
    expect(wat.getUTCSeconds()).toBe(0);
  });

  it('handles dates near UTC midnight correctly', () => {
    // 23:30 UTC on Jan 15 = 00:30 WAT on Jan 16
    const date = new Date('2024-01-15T23:30:00Z');
    const start = startOfDayWAT(date);
    const wat = toWAT(start);
    // Start of day should be Jan 16 00:00 WAT
    expect(wat.getUTCDate()).toBe(16);
    expect(wat.getUTCHours()).toBe(0);
  });
});

// ─── isSameWATDay ───────────────────────────────────────────────────────────

describe('isSameWATDay', () => {
  it('returns true for dates on the same WAT day', () => {
    const a = new Date('2024-01-15T05:00:00Z'); // 06:00 WAT
    const b = new Date('2024-01-15T20:00:00Z'); // 21:00 WAT
    expect(isSameWATDay(a, b)).toBe(true);
  });

  it('returns false for dates on different WAT days', () => {
    const a = new Date('2024-01-15T05:00:00Z'); // 06:00 WAT Jan 15
    const b = new Date('2024-01-15T23:30:00Z'); // 00:30 WAT Jan 16
    expect(isSameWATDay(a, b)).toBe(false);
  });

  it('returns true for UTC dates that cross midnight but same WAT day', () => {
    // Both are Jan 15 in WAT
    const a = new Date('2024-01-14T23:30:00Z'); // 00:30 WAT Jan 15
    const b = new Date('2024-01-15T22:59:00Z'); // 23:59 WAT Jan 15
    expect(isSameWATDay(a, b)).toBe(true);
  });
});

// ─── getWATDayOfWeek ────────────────────────────────────────────────────────

describe('getWATDayOfWeek', () => {
  it('returns correct day of week in WAT', () => {
    // 2024-01-15 is a Monday
    const monday = new Date('2024-01-15T12:00:00Z');
    expect(getWATDayOfWeek(monday)).toBe(1); // Monday
  });

  it('handles day rollover affecting day of week', () => {
    // Sunday 2024-01-14 23:30 UTC = Monday 2024-01-15 00:30 WAT
    const date = new Date('2024-01-14T23:30:00Z');
    expect(getWATDayOfWeek(date)).toBe(1); // Monday in WAT
  });
});
