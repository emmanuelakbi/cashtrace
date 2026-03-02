/**
 * Counterparty service for top customers and vendors analytics.
 *
 * Provides counterparty aggregation with cache-first retrieval and
 * percentage calculations for identifying top revenue sources and
 * expense destinations.
 *
 * All monetary values are in kobo (integers) to avoid floating-point errors.
 * Null counterparties are grouped under "Unknown" at the SQL level
 * (COALESCE in the aggregation repository).
 *
 * @module modules/analytics-dashboard/services/counterpartyService
 */

import type { Pool } from 'pg';
import type { Redis } from 'ioredis';

import type {
  CounterpartyBreakdown,
  PeriodType,
  RawCounterpartyAggregation,
} from '../types/index.js';
import { getCounterpartyAggregations } from '../repositories/aggregationRepository.js';
import { calculatePeriodBounds } from '../utils/periodService.js';

import { cacheCounterparties, getCachedCounterparties } from './cacheService.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default number of top counterparties to return. */
const DEFAULT_LIMIT = 5;

/** Maximum number of counterparties allowed. */
const MAX_LIMIT = 10;

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Convert raw counterparty aggregation rows into CounterpartyBreakdown objects.
 *
 * Percentages are initially set to 0 — use {@link calculateCounterpartyPercentages}
 * to populate them against the total.
 *
 * @param rows - Raw aggregation rows from the repository.
 * @returns Counterparty breakdowns with zero percentages.
 */
export function mapRawToBreakdowns(rows: RawCounterpartyAggregation[]): CounterpartyBreakdown[] {
  return rows.map((row) => ({
    counterparty: row.counterparty ?? 'Unknown',
    totalAmountKobo: Number(row.totalAmountKobo),
    transactionCount: row.transactionCount,
    percentageOfTotal: 0,
  }));
}

/**
 * Calculate the percentage of total for each counterparty.
 *
 * When totalAmount is 0 (no transactions), all percentages are set to 0.
 * Percentages are rounded to 2 decimal places.
 *
 * @param counterparties - Counterparty breakdowns to update.
 * @param totalAmount - Total amount in kobo to calculate percentages against.
 * @returns New array of counterparty breakdowns with populated percentages.
 */
export function calculateCounterpartyPercentages(
  counterparties: CounterpartyBreakdown[],
  totalAmount: number,
): CounterpartyBreakdown[] {
  if (totalAmount === 0 || counterparties.length === 0) {
    return counterparties.map((c) => ({ ...c, percentageOfTotal: 0 }));
  }

  return counterparties.map((c) => ({
    ...c,
    percentageOfTotal: Math.round((c.totalAmountKobo / totalAmount) * 10000) / 100,
  }));
}

// ---------------------------------------------------------------------------
// Cache-integrated helpers
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
 * Shared implementation for fetching top counterparties by transaction type.
 *
 * Orchestrates CacheService, AggregationRepository, and PeriodService to:
 * 1. Resolve period boundaries.
 * 2. Check cache for existing counterparty data.
 * 3. On cache miss, query the database for counterparty aggregations.
 * 4. Calculate percentages against the total for that transaction type.
 * 5. Cache the computed result.
 *
 * @param pool - PostgreSQL connection pool.
 * @param redis - Redis client instance.
 * @param businessId - The business UUID.
 * @param transactionType - 'INFLOW' for customers, 'OUTFLOW' for vendors.
 * @param period - The period type (defaults to 'this_month').
 * @param customStart - Required when period is 'custom'.
 * @param customEnd - Required when period is 'custom'.
 * @param limit - Maximum counterparties to return (default 5, max 10).
 * @returns Top counterparties with percentages.
 */
async function getTopCounterparties(
  pool: Pool,
  redis: Redis,
  businessId: string,
  transactionType: 'INFLOW' | 'OUTFLOW',
  period?: PeriodType,
  customStart?: Date,
  customEnd?: Date,
  limit?: number,
): Promise<CounterpartyBreakdown[]> {
  // 1. Resolve period boundaries
  const bounds = calculatePeriodBounds(period, customStart, customEnd);
  const periodKey = buildPeriodKey(bounds.periodType, bounds.startDate, bounds.endDate);

  // 2. Try cache first
  const cached = await getCachedCounterparties(redis, businessId, periodKey, transactionType);
  if (cached !== null) {
    return cached;
  }

  // 3. Clamp limit to valid range
  const effectiveLimit = Math.min(Math.max(1, limit ?? DEFAULT_LIMIT), MAX_LIMIT);

  // 4. Fetch counterparty aggregations from database
  const rows = await getCounterpartyAggregations(
    pool,
    businessId,
    bounds.startDate,
    bounds.endDate,
    transactionType,
    effectiveLimit,
  );

  // 5. Convert to breakdowns
  const breakdowns = mapRawToBreakdowns(rows);

  // 6. Calculate total for percentage computation
  const total = breakdowns.reduce((sum, c) => sum + c.totalAmountKobo, 0);

  // 7. Calculate percentages
  const result = calculateCounterpartyPercentages(breakdowns, total);

  // 8. Cache the result (fire-and-forget; cache write failure should not block response)
  await cacheCounterparties(redis, businessId, periodKey, transactionType, result);

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the top revenue sources (customers) for a business within a period.
 *
 * Fetches INFLOW counterparty aggregations and calculates percentages
 * against total revenue.
 *
 * @param pool - PostgreSQL connection pool.
 * @param redis - Redis client instance.
 * @param businessId - The business UUID.
 * @param period - The period type (defaults to 'this_month').
 * @param customStart - Required when period is 'custom'.
 * @param customEnd - Required when period is 'custom'.
 * @param limit - Maximum counterparties to return (default 5, max 10).
 * @returns Top customers with percentages of total revenue.
 *
 * Validates: Requirements 5.1, 5.2, 5.3
 */
export async function getTopCustomers(
  pool: Pool,
  redis: Redis,
  businessId: string,
  period?: PeriodType,
  customStart?: Date,
  customEnd?: Date,
  limit?: number,
): Promise<CounterpartyBreakdown[]> {
  return getTopCounterparties(
    pool,
    redis,
    businessId,
    'INFLOW',
    period,
    customStart,
    customEnd,
    limit,
  );
}

/**
 * Get the top expense destinations (vendors) for a business within a period.
 *
 * Fetches OUTFLOW counterparty aggregations and calculates percentages
 * against total expenses.
 *
 * @param pool - PostgreSQL connection pool.
 * @param redis - Redis client instance.
 * @param businessId - The business UUID.
 * @param period - The period type (defaults to 'this_month').
 * @param customStart - Required when period is 'custom'.
 * @param customEnd - Required when period is 'custom'.
 * @param limit - Maximum counterparties to return (default 5, max 10).
 * @returns Top vendors with percentages of total expenses.
 *
 * Validates: Requirements 5.6
 */
export async function getTopVendors(
  pool: Pool,
  redis: Redis,
  businessId: string,
  period?: PeriodType,
  customStart?: Date,
  customEnd?: Date,
  limit?: number,
): Promise<CounterpartyBreakdown[]> {
  return getTopCounterparties(
    pool,
    redis,
    businessId,
    'OUTFLOW',
    period,
    customStart,
    customEnd,
    limit,
  );
}
