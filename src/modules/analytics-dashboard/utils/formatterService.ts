/**
 * Formatter utilities for Naira currency and percentage display.
 *
 * All monetary values are stored in kobo (integers) to avoid floating-point
 * errors. 1 NGN = 100 kobo.
 *
 * @module modules/analytics-dashboard/utils/formatterService
 */

import type { AmountDisplay } from '../types/index.js';

// ---------------------------------------------------------------------------
// Currency helpers
// ---------------------------------------------------------------------------

/**
 * Convert a kobo amount (integer) to Naira (decimal).
 *
 * @param kobo - Amount in kobo.
 * @returns Amount in Naira with up to 2 decimal places.
 */
export function koboToNaira(kobo: number): number {
  return kobo / 100;
}

/**
 * Format a kobo amount as a Naira string with ₦ symbol, thousands separators,
 * and exactly 2 decimal places.
 *
 * Examples:
 * - `formatAsNaira(123456)` → `"₦1,234.56"`
 * - `formatAsNaira(0)` → `"₦0.00"`
 * - `formatAsNaira(-50000)` → `"-₦500.00"`
 *
 * @param kobo - Amount in kobo (integer).
 * @returns Formatted Naira string.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.5
 */
export function formatAsNaira(kobo: number): string {
  const isNegative = kobo < 0;
  const absoluteNaira = Math.abs(koboToNaira(kobo));
  const formatted = absoluteNaira.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${isNegative ? '-' : ''}₦${formatted}`;
}

/**
 * Format a kobo amount as a signed Naira string. Positive values are prefixed
 * with `+`, negative with `-`, and zero has no sign.
 *
 * Examples:
 * - `formatAsNairaWithSign(50000)` → `"+₦500.00"`
 * - `formatAsNairaWithSign(-50000)` → `"-₦500.00"`
 * - `formatAsNairaWithSign(0)` → `"₦0.00"`
 *
 * @param kobo - Amount in kobo (integer).
 * @returns Formatted Naira string with explicit sign.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.5
 */
export function formatAsNairaWithSign(kobo: number): string {
  if (kobo === 0) {
    return '₦0.00';
  }
  if (kobo > 0) {
    const absoluteNaira = koboToNaira(kobo);
    const formatted = absoluteNaira.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `+₦${formatted}`;
  }
  // Negative – delegate to formatAsNaira which already handles the minus sign
  return formatAsNaira(kobo);
}

// ---------------------------------------------------------------------------
// Percentage helpers
// ---------------------------------------------------------------------------

/**
 * Format a numeric value as a percentage string with 1 decimal place.
 *
 * @param value - Percentage value (e.g. 15.5 means 15.5%).
 * @returns Formatted percentage string, e.g. `"15.5%"`.
 */
export function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

/**
 * Format a percentage change with an explicit sign prefix.
 *
 * Examples:
 * - `formatPercentageChange(15.5)` → `"+15.5%"`
 * - `formatPercentageChange(-8.2)` → `"-8.2%"`
 * - `formatPercentageChange(0)` → `"0.0%"`
 *
 * @param value - Percentage change value.
 * @returns Formatted percentage change string.
 */
export function formatPercentageChange(value: number): string {
  if (value > 0) {
    return `+${value.toFixed(1)}%`;
  }
  return `${value.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// AmountDisplay factory
// ---------------------------------------------------------------------------

/**
 * Create an {@link AmountDisplay} object from a kobo value.
 *
 * @param kobo - Amount in kobo (integer).
 * @returns An `AmountDisplay` with `kobo`, `naira`, and `formatted` fields.
 *
 * Validates: Requirements 7.4
 */
export function createAmountDisplay(kobo: number): AmountDisplay {
  return {
    kobo,
    naira: koboToNaira(kobo),
    formatted: formatAsNaira(kobo),
  };
}
