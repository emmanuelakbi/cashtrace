/**
 * Trend service for time series cashflow visualization.
 *
 * Provides granularity selection and cache-integrated trend data retrieval.
 * All monetary values are in kobo (integers) to avoid floating-point errors.
 *
 * @module modules/analytics-dashboard/services/trendService
 */

import type { Pool } from 'pg';
import type { Redis } from 'ioredis';

import type {
  PeriodType,
  RawTrendAggregation,
  TrendData,
  TrendDataPoint,
  TrendGranularity,
} from '../types/index.js';
import { getTrendAggregations } from '../repositories/aggregationRepository.js';
import { calculatePeriodBounds } from '../utils/periodService.js';

import { cacheTrends, getCachedTrends } from './cacheService.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Short day-of-week names indexed by `getUTCDay()` (0 = Sun). */
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Short month names indexed by `getUTCMonth()` (0 = Jan). */
const MONTH_NAMES = [
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

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Determine the appropriate trend granularity based on the period length.
 *
 * - ≤ 7 days  → DAILY
 * - 8–90 days → WEEKLY
 * - > 90 days → MONTHLY
 *
 * @param startDate - Inclusive start of the period.
 * @param endDate - Exclusive end of the period.
 * @returns The granularity to use for trend aggregation.
 *
 * Validates: Requirements 6.2, 6.3, 6.4
 */
export function determineGranularity(startDate: Date, endDate: Date): TrendGranularity {
  const days = Math.ceil((endDate.getTime() - startDate.getTime()) / MS_PER_DAY);

  if (days <= 7) return 'DAILY';
  if (days <= 90) return 'WEEKLY';
  return 'MONTHLY';
}

/**
 * Format a human-readable label for a trend data point based on granularity.
 *
 * - DAILY   → short day name (e.g. "Mon", "Tue")
 * - WEEKLY  → "Week N" where N is the 1-based index within the period
 * - MONTHLY → short month name (e.g. "Jan", "Feb")
 *
 * @param date - The bucket date.
 * @param granularity - The trend granularity.
 * @param weekIndex - 1-based week index (used only for WEEKLY).
 * @returns A human-readable label string.
 */
export function formatDataPointLabel(
  date: Date,
  granularity: TrendGranularity,
  weekIndex: number,
): string {
  switch (granularity) {
    case 'DAILY':
      return DAY_NAMES[date.getUTCDay()] ?? '';
    case 'WEEKLY':
      return `Week ${weekIndex}`;
    case 'MONTHLY':
      return MONTH_NAMES[date.getUTCMonth()] ?? '';
  }
}

/**
 * Convert raw trend aggregation rows into formatted trend data points.
 *
 * Rows are assumed to already be in chronological order from the database.
 * Labels are generated based on the granularity.
 *
 * @param rows - Raw aggregation rows from the repository.
 * @param granularity - The trend granularity.
 * @returns Formatted trend data points in chronological order.
 */
export function formatTrendDataPoints(
  rows: RawTrendAggregation[],
  granularity: TrendGranularity,
): TrendDataPoint[] {
  return rows.map((row, index) => {
    const inflowsKobo = Number(row.totalInflowKobo);
    const outflowsKobo = Number(row.totalOutflowKobo);

    return {
      date: row.timeBucket,
      label: formatDataPointLabel(row.timeBucket, granularity, index + 1),
      inflowsKobo,
      outflowsKobo,
      netCashflowKobo: inflowsKobo - outflowsKobo,
      transactionCount: row.transactionCount,
    };
  });
}

// ---------------------------------------------------------------------------
// Cache-integrated orchestrator
// ---------------------------------------------------------------------------

/**
 * Build a period cache key from a period type and date range.
 *
 * @param periodType - The period type.
 * @param startDate - Start date.
 * @param endDate - End date.
 * @returns A string suitable for use as a cache key segment.
 */
function buildPeriodKey(periodType: PeriodType, startDate: Date, endDate: Date): string {
  if (periodType === 'custom') {
    return `custom:${startDate.toISOString()}:${endDate.toISOString()}`;
  }
  return periodType;
}

/**
 * Get trend data for a business within a period.
 *
 * Orchestrates CacheService, AggregationRepository, and PeriodService to:
 * 1. Resolve period boundaries.
 * 2. Check cache for existing trend data.
 * 3. On cache miss, determine granularity, query the database, and format results.
 * 4. Cache the computed result.
 *
 * @param pool - PostgreSQL connection pool.
 * @param redis - Redis client instance.
 * @param businessId - The business UUID.
 * @param period - The period type (defaults to 'this_month').
 * @param customStart - Required when period is 'custom'.
 * @param customEnd - Required when period is 'custom'.
 * @returns Trend data with granularity and formatted data points.
 *
 * Validates: Requirements 6.1, 6.5, 6.6, 6.7
 */
export async function getTrendData(
  pool: Pool,
  redis: Redis,
  businessId: string,
  period?: PeriodType,
  customStart?: Date,
  customEnd?: Date,
): Promise<TrendData> {
  // 1. Resolve period boundaries
  const bounds = calculatePeriodBounds(period, customStart, customEnd);
  const periodKey = buildPeriodKey(bounds.periodType, bounds.startDate, bounds.endDate);

  // 2. Try cache first
  const cached = await getCachedTrends(redis, businessId, periodKey);
  if (cached !== null) {
    return cached;
  }

  // 3. Determine granularity and fetch from database
  const granularity = determineGranularity(bounds.startDate, bounds.endDate);
  const rows = await getTrendAggregations(
    pool,
    businessId,
    bounds.startDate,
    bounds.endDate,
    granularity,
  );

  // 4. Format data points
  const dataPoints = formatTrendDataPoints(rows, granularity);

  const trendData: TrendData = {
    granularity,
    dataPoints,
    periodStart: bounds.startDate,
    periodEnd: bounds.endDate,
  };

  // 5. Cache the result (fire-and-forget; cache write failure should not block response)
  await cacheTrends(redis, businessId, periodKey, trendData);

  return trendData;
}
