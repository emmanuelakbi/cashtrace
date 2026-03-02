/**
 * WAT (West Africa Time) timezone utilities for Nigerian context.
 *
 * All date/time operations in CashTrace use WAT (UTC+1) as the reference timezone.
 * This module provides formatting, conversion, and scheduling helpers
 * that ensure consistent timezone handling across the insights engine
 * and other modules.
 *
 * @module utils/timezone
 * @see Requirements 14.5
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** WAT offset from UTC in milliseconds (+1 hour). */
export const WAT_OFFSET_MS = 60 * 60 * 1000;

/** WAT offset from UTC in minutes (+60). */
export const WAT_OFFSET_MINUTES = 60;

/** IANA-style timezone identifier for WAT. */
export const WAT_TIMEZONE = 'Africa/Lagos';

// ─── Core Conversion ─────────────────────────────────────────────────────────

/**
 * Convert a Date to a WAT-adjusted Date.
 *
 * Shifts the UTC time by +1 hour to represent WAT.
 * The returned Date's UTC methods will yield WAT-local values.
 *
 * @param date - The input date (any timezone)
 * @returns A new Date shifted to WAT
 */
export function toWAT(date: Date): Date {
  const utcMs = date.getTime();
  return new Date(utcMs + WAT_OFFSET_MS);
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/**
 * Format a date as an ISO-like string in WAT timezone.
 *
 * Output format: `YYYY-MM-DDTHH:mm:ss+01:00`
 *
 * @param date - The input date
 * @returns ISO string with WAT offset indicator
 */
export function formatDateWAT(date: Date): string {
  const wat = toWAT(date);
  const year = wat.getUTCFullYear();
  const month = String(wat.getUTCMonth() + 1).padStart(2, '0');
  const day = String(wat.getUTCDate()).padStart(2, '0');
  const hours = String(wat.getUTCHours()).padStart(2, '0');
  const minutes = String(wat.getUTCMinutes()).padStart(2, '0');
  const seconds = String(wat.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+01:00`;
}

/**
 * Format a date for Nigerian display context.
 *
 * Output format: `DD/MM/YYYY HH:mm WAT`
 * Uses day/month/year ordering common in Nigeria.
 *
 * @param date - The input date
 * @returns Human-readable date string in Nigerian format
 */
export function formatDateNigerian(date: Date): string {
  const wat = toWAT(date);
  const day = String(wat.getUTCDate()).padStart(2, '0');
  const month = String(wat.getUTCMonth() + 1).padStart(2, '0');
  const year = wat.getUTCFullYear();
  const hours = String(wat.getUTCHours()).padStart(2, '0');
  const minutes = String(wat.getUTCMinutes()).padStart(2, '0');

  return `${day}/${month}/${year} ${hours}:${minutes} WAT`;
}

/**
 * Format a date as a short date string in WAT.
 *
 * Output format: `DD/MM/YYYY`
 *
 * @param date - The input date
 * @returns Short date string in Nigerian format
 */
export function formatShortDateWAT(date: Date): string {
  const wat = toWAT(date);
  const day = String(wat.getUTCDate()).padStart(2, '0');
  const month = String(wat.getUTCMonth() + 1).padStart(2, '0');
  const year = wat.getUTCFullYear();

  return `${day}/${month}/${year}`;
}

/**
 * Format a time-only string in WAT.
 *
 * Output format: `HH:mm WAT`
 *
 * @param date - The input date
 * @returns Time string in WAT
 */
export function formatTimeWAT(date: Date): string {
  const wat = toWAT(date);
  const hours = String(wat.getUTCHours()).padStart(2, '0');
  const minutes = String(wat.getUTCMinutes()).padStart(2, '0');

  return `${hours}:${minutes} WAT`;
}

// ─── Scheduling Helpers ──────────────────────────────────────────────────────

/**
 * Get the current date/time in WAT.
 *
 * @returns A Date shifted to WAT (UTC methods yield WAT-local values)
 */
export function nowWAT(): Date {
  return toWAT(new Date());
}

/**
 * Create a Date for a specific time in WAT.
 *
 * Useful for scheduling (e.g., daily generation at 06:00 WAT).
 *
 * @param year - Full year
 * @param month - Month (1-12, NOT 0-indexed)
 * @param day - Day of month
 * @param hours - Hours (0-23), defaults to 0
 * @param minutes - Minutes (0-59), defaults to 0
 * @param seconds - Seconds (0-59), defaults to 0
 * @returns A UTC Date that corresponds to the given WAT time
 */
export function createWATDate(
  year: number,
  month: number,
  day: number,
  hours: number = 0,
  minutes: number = 0,
  seconds: number = 0,
): Date {
  // Build the WAT time as UTC, then subtract the offset to get true UTC
  const watAsUtc = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  return new Date(watAsUtc - WAT_OFFSET_MS);
}

/**
 * Get the start of the current day in WAT (00:00:00 WAT).
 *
 * @param date - Reference date (defaults to now)
 * @returns A UTC Date representing midnight WAT on the given day
 */
export function startOfDayWAT(date: Date = new Date()): Date {
  const wat = toWAT(date);
  const year = wat.getUTCFullYear();
  const month = wat.getUTCMonth() + 1;
  const day = wat.getUTCDate();

  return createWATDate(year, month, day);
}

/**
 * Check if two dates fall on the same calendar day in WAT.
 *
 * @param a - First date
 * @param b - Second date
 * @returns True if both dates are on the same WAT calendar day
 */
export function isSameWATDay(a: Date, b: Date): boolean {
  const watA = toWAT(a);
  const watB = toWAT(b);

  return (
    watA.getUTCFullYear() === watB.getUTCFullYear() &&
    watA.getUTCMonth() === watB.getUTCMonth() &&
    watA.getUTCDate() === watB.getUTCDate()
  );
}

/**
 * Get the WAT day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday).
 *
 * @param date - The input date
 * @returns Day of week in WAT
 */
export function getWATDayOfWeek(date: Date): number {
  return toWAT(date).getUTCDay();
}
