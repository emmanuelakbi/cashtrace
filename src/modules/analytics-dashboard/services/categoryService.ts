/**
 * Category service for expense breakdown analytics.
 *
 * Provides category aggregation with cache-first retrieval and
 * percentage calculations for pie chart visualization.
 *
 * All monetary values are in kobo (integers) to avoid floating-point errors.
 *
 * @module modules/analytics-dashboard/services/categoryService
 */

import type { Pool } from 'pg';
import type { Redis } from 'ioredis';

import type { CategoryBreakdown, PeriodType, RawCategoryAggregation } from '../types/index.js';
import { getCategoryAggregations } from '../repositories/aggregationRepository.js';
import { calculatePeriodBounds } from '../utils/periodService.js';

import { cacheCategories, getCachedCategories } from './cacheService.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default number of top categories to return. */
const DEFAULT_LIMIT = 5;

/** Maximum number of categories allowed. */
const MAX_LIMIT = 10;

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Convert a snake_case or kebab-case category key to Title Case.
 *
 * Examples:
 * - "food_and_drink" → "Food And Drink"
 * - "rent-utilities"  → "Rent Utilities"
 *
 * @param category - Raw category key.
 * @returns Human-readable category display name.
 */
export function formatCategoryDisplay(category: string): string {
  return category.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Convert raw category aggregation rows into CategoryBreakdown objects.
 *
 * Percentages are initially set to 0 — use {@link calculatePercentages}
 * to populate them against the total.
 *
 * @param rows - Raw aggregation rows from the repository.
 * @returns Category breakdowns with zero percentages.
 */
function mapRawToBreakdowns(rows: RawCategoryAggregation[]): CategoryBreakdown[] {
  return rows.map((row) => ({
    category: row.category,
    categoryDisplay: formatCategoryDisplay(row.category),
    totalAmountKobo: Number(row.totalAmountKobo),
    transactionCount: row.transactionCount,
    percentageOfTotal: 0,
  }));
}

/**
 * Calculate the percentage of total for each category.
 *
 * When totalAmount is 0 (no expenses), all percentages are set to 0.
 * Percentages are rounded to 2 decimal places and should sum to ~100%
 * within floating-point tolerance (±0.1%).
 *
 * @param categories - Category breakdowns to update.
 * @param totalAmount - Total amount in kobo to calculate percentages against.
 * @returns New array of category breakdowns with populated percentages.
 *
 * Validates: Requirements 4.5
 */
export function calculatePercentages(
  categories: CategoryBreakdown[],
  totalAmount: number,
): CategoryBreakdown[] {
  if (totalAmount === 0 || categories.length === 0) {
    return categories.map((c) => ({ ...c, percentageOfTotal: 0 }));
  }

  return categories.map((c) => ({
    ...c,
    percentageOfTotal: Math.round((c.totalAmountKobo / totalAmount) * 10000) / 100,
  }));
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
 * Get the top expense categories for a business within a period.
 *
 * Orchestrates CacheService, AggregationRepository, and PeriodService to:
 * 1. Resolve period boundaries.
 * 2. Check cache for existing category data.
 * 3. On cache miss, query the database for OUTFLOW category aggregations.
 * 4. Calculate percentages against total expenses.
 * 5. Cache the computed result.
 *
 * @param pool - PostgreSQL connection pool.
 * @param redis - Redis client instance.
 * @param businessId - The business UUID.
 * @param period - The period type (defaults to 'this_month').
 * @param customStart - Required when period is 'custom'.
 * @param customEnd - Required when period is 'custom'.
 * @param limit - Maximum categories to return (default 5, max 10).
 * @returns Top expense categories with percentages.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.6
 */
export async function getTopExpenseCategories(
  pool: Pool,
  redis: Redis,
  businessId: string,
  period?: PeriodType,
  customStart?: Date,
  customEnd?: Date,
  limit?: number,
): Promise<CategoryBreakdown[]> {
  // 1. Resolve period boundaries
  const bounds = calculatePeriodBounds(period, customStart, customEnd);
  const periodKey = buildPeriodKey(bounds.periodType, bounds.startDate, bounds.endDate);

  // 2. Try cache first
  const cached = await getCachedCategories(redis, businessId, periodKey);
  if (cached !== null) {
    return cached;
  }

  // 3. Clamp limit to valid range
  const effectiveLimit = Math.min(Math.max(1, limit ?? DEFAULT_LIMIT), MAX_LIMIT);

  // 4. Fetch OUTFLOW category aggregations from database
  const rows = await getCategoryAggregations(
    pool,
    businessId,
    bounds.startDate,
    bounds.endDate,
    'OUTFLOW',
    effectiveLimit,
  );

  // 5. Convert to breakdowns
  const breakdowns = mapRawToBreakdowns(rows);

  // 6. Calculate total expenses for percentage computation
  const totalExpenses = breakdowns.reduce((sum, c) => sum + c.totalAmountKobo, 0);

  // 7. Calculate percentages
  const result = calculatePercentages(breakdowns, totalExpenses);

  // 8. Cache the result (fire-and-forget; cache write failure should not block response)
  await cacheCategories(redis, businessId, periodKey, result);

  return result;
}
