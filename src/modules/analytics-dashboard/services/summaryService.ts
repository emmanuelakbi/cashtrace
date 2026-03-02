/**
 * Summary service for dashboard KPI calculations.
 *
 * Provides pure calculation functions for summary aggregation, period
 * comparison, and a cache-integrated orchestrator that ties together
 * PeriodService, AggregationRepository, and CacheService.
 *
 * All monetary values are in kobo (integers) to avoid floating-point errors.
 *
 * @module modules/analytics-dashboard/services/summaryService
 */

import type { Pool } from 'pg';
import type { Redis } from 'ioredis';

import type {
  ComparisonData,
  PeriodType,
  RawSummaryAggregation,
  SummaryData,
  SummaryWithComparison,
} from '../types/index.js';
import { calculatePeriodBounds, calculatePreviousPeriod } from '../utils/periodService.js';
import { getSummaryAggregations } from '../repositories/aggregationRepository.js';
import { cacheSummary, getCachedSummary } from './cacheService.js';

// ---------------------------------------------------------------------------
// Pure calculation functions
// ---------------------------------------------------------------------------

/**
 * Calculate summary KPIs from raw aggregation results.
 *
 * Converts bigint totals to numbers, derives net cashflow, transaction
 * count, and average transaction value. Handles the zero-count edge case
 * by returning 0 for the average.
 *
 * @param aggregation - Raw summary aggregation from the database.
 * @param periodStart - Inclusive start of the period.
 * @param periodEnd - Exclusive end of the period.
 * @returns Computed summary data.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
 */
export function calculateSummary(
  aggregation: RawSummaryAggregation,
  periodStart: Date,
  periodEnd: Date,
): SummaryData {
  const totalRevenueKobo = Number(aggregation.totalInflowKobo);
  const totalExpensesKobo = Number(aggregation.totalOutflowKobo);
  const netCashflowKobo = totalRevenueKobo - totalExpensesKobo;
  const transactionCount = aggregation.inflowCount + aggregation.outflowCount;
  const averageTransactionKobo =
    transactionCount > 0
      ? Math.round((totalRevenueKobo + totalExpensesKobo) / transactionCount)
      : 0;

  return {
    totalRevenueKobo,
    totalExpensesKobo,
    netCashflowKobo,
    transactionCount,
    averageTransactionKobo,
    periodStart,
    periodEnd,
  };
}

/**
 * Calculate the percentage change between a current and previous value.
 *
 * - Both zero → 0
 * - Previous zero, current non-zero → +Infinity or -Infinity
 * - Otherwise → ((current - previous) / |previous|) × 100
 *
 * @param current - Current period value.
 * @param previous - Previous period value.
 * @returns Percentage change.
 */
function calculatePercentageChange(current: number, previous: number): number {
  if (previous === 0 && current === 0) return 0;
  if (previous === 0) return current > 0 ? Infinity : -Infinity;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Calculate comparison metrics between current and previous period summaries.
 *
 * Computes percentage changes for revenue, expenses, and net cashflow,
 * plus the absolute change in transaction count.
 *
 * @param current - Current period summary.
 * @param previous - Previous period summary.
 * @returns Comparison data with percentage changes.
 *
 * Validates: Requirements 3.2
 */
export function calculateComparison(current: SummaryData, previous: SummaryData): ComparisonData {
  return {
    revenueChangePercent: calculatePercentageChange(
      current.totalRevenueKobo,
      previous.totalRevenueKobo,
    ),
    expensesChangePercent: calculatePercentageChange(
      current.totalExpensesKobo,
      previous.totalExpensesKobo,
    ),
    netCashflowChangePercent: calculatePercentageChange(
      current.netCashflowKobo,
      previous.netCashflowKobo,
    ),
    transactionCountChange: current.transactionCount - previous.transactionCount,
  };
}

// ---------------------------------------------------------------------------
// Cache-integrated orchestrator
// ---------------------------------------------------------------------------

/**
 * Build a period cache key from a period type and optional custom dates.
 *
 * @param periodType - The period type.
 * @param startDate - Start date (used for custom periods).
 * @param endDate - End date (used for custom periods).
 * @returns A string suitable for use as a cache key segment.
 */
function buildPeriodKey(periodType: PeriodType, startDate: Date, endDate: Date): string {
  if (periodType === 'custom') {
    return `custom:${startDate.toISOString()}:${endDate.toISOString()}`;
  }
  return periodType;
}

/**
 * Fetch or compute a summary for a single period, using cache when available.
 *
 * @param pool - PostgreSQL connection pool.
 * @param redis - Redis client instance.
 * @param businessId - The business UUID.
 * @param periodKey - Cache key segment for the period.
 * @param startDate - Inclusive start of the period.
 * @param endDate - Exclusive end of the period.
 * @returns Summary data (from cache or freshly computed).
 */
async function fetchOrComputeSummary(
  pool: Pool,
  redis: Redis,
  businessId: string,
  periodKey: string,
  startDate: Date,
  endDate: Date,
): Promise<SummaryData> {
  // Try cache first
  const cached = await getCachedSummary(redis, businessId, periodKey);
  if (cached !== null) {
    return cached;
  }

  // Cache miss — compute from database
  const aggregation = await getSummaryAggregations(pool, businessId, startDate, endDate);
  const summary = calculateSummary(aggregation, startDate, endDate);

  // Store in cache (fire-and-forget; cache write failure should not block response)
  await cacheSummary(redis, businessId, periodKey, summary);

  return summary;
}

/**
 * Get a complete summary with period comparison.
 *
 * Orchestrates PeriodService, CacheService, and AggregationRepository to:
 * 1. Resolve current and previous period boundaries.
 * 2. Retrieve or compute summaries for both periods (cache-first).
 * 3. Calculate comparison metrics.
 *
 * @param pool - PostgreSQL connection pool.
 * @param redis - Redis client instance.
 * @param businessId - The business UUID.
 * @param period - The period type (defaults to 'this_month').
 * @param customStart - Required when period is 'custom'.
 * @param customEnd - Required when period is 'custom'.
 * @returns Summary with comparison data for both periods.
 *
 * Validates: Requirements 1.8, 3.1
 */
export async function getSummaryWithComparison(
  pool: Pool,
  redis: Redis,
  businessId: string,
  period?: PeriodType,
  customStart?: Date,
  customEnd?: Date,
): Promise<SummaryWithComparison> {
  // 1. Resolve period boundaries
  const currentBounds = calculatePeriodBounds(period, customStart, customEnd);
  const previousBounds = calculatePreviousPeriod(currentBounds);

  // 2. Build cache keys
  const currentKey = buildPeriodKey(
    currentBounds.periodType,
    currentBounds.startDate,
    currentBounds.endDate,
  );
  const previousKey = buildPeriodKey(
    previousBounds.periodType,
    previousBounds.startDate,
    previousBounds.endDate,
  );

  // 3. Fetch or compute both summaries
  const [current, previous] = await Promise.all([
    fetchOrComputeSummary(
      pool,
      redis,
      businessId,
      currentKey,
      currentBounds.startDate,
      currentBounds.endDate,
    ),
    fetchOrComputeSummary(
      pool,
      redis,
      businessId,
      previousKey,
      previousBounds.startDate,
      previousBounds.endDate,
    ),
  ]);

  // 4. Calculate comparison
  const comparison = calculateComparison(current, previous);

  return { current, previous, comparison };
}
