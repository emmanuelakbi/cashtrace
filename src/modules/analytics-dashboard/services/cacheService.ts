/**
 * Cache service for analytics dashboard Redis caching.
 *
 * Provides typed get/set operations for dashboard aggregations,
 * cache key generation, and targeted cache invalidation.
 *
 * Each function takes a Redis instance as the first parameter
 * for dependency injection.
 *
 * @module modules/analytics-dashboard/services/cacheService
 */

import type { Redis } from 'ioredis';

import type {
  CategoryBreakdown,
  CounterpartyBreakdown,
  SummaryData,
  TrendData,
} from '../types/index.js';
import { CACHE_KEYS, CACHE_TTL_SECONDS } from '../types/index.js';
import {
  getStartOfDayWAT,
  getStartOfMonthWAT,
  getStartOfQuarterWAT,
  getStartOfWeekWAT,
  getStartOfYearWAT,
  toWAT,
} from '../utils/periodService.js';

// ---------------------------------------------------------------------------
// Cache key generation
// ---------------------------------------------------------------------------

/**
 * Generate a Redis cache key by replacing placeholders in the key pattern.
 *
 * @param type - The cache key type ('summary' | 'trends' | 'categories' | 'counterparties').
 * @param businessId - The business UUID.
 * @param period - The period key (e.g. 'this_month', 'custom:2024-01-01:2024-01-31').
 * @param subtype - Optional subtype for counterparties ('INFLOW' | 'OUTFLOW').
 * @returns The fully resolved cache key.
 *
 * Validates: Requirements 8.2
 */
export function generateCacheKey(
  type: keyof typeof CACHE_KEYS,
  businessId: string,
  period: string,
  subtype?: string,
): string {
  let key = CACHE_KEYS[type] as string;
  key = key.replace('{businessId}', businessId);
  key = key.replace('{periodKey}', period);
  if (subtype !== undefined) {
    key = key.replace('{type}', subtype);
  }
  return key;
}

// ---------------------------------------------------------------------------
// Cache get/set operations
// ---------------------------------------------------------------------------

/**
 * Retrieve a cached dashboard summary for a business and period.
 *
 * @param redis - The Redis client instance.
 * @param businessId - The business UUID.
 * @param period - The period key.
 * @returns The cached summary data, or `null` on cache miss.
 *
 * Validates: Requirements 8.2
 */
export async function getCachedSummary(
  redis: Redis,
  businessId: string,
  period: string,
): Promise<SummaryData | null> {
  const key = generateCacheKey('summary', businessId, period);
  const raw = await redis.get(key);
  if (raw === null) return null;
  return JSON.parse(raw) as SummaryData;
}

/**
 * Cache a dashboard summary with the configured TTL.
 *
 * @param redis - The Redis client instance.
 * @param businessId - The business UUID.
 * @param period - The period key.
 * @param data - The summary data to cache.
 *
 * Validates: Requirements 8.2, 8.6
 */
export async function cacheSummary(
  redis: Redis,
  businessId: string,
  period: string,
  data: SummaryData,
): Promise<void> {
  const key = generateCacheKey('summary', businessId, period);
  await redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(data));
}

/**
 * Retrieve cached trend data for a business and period.
 *
 * @param redis - The Redis client instance.
 * @param businessId - The business UUID.
 * @param period - The period key.
 * @returns The cached trend data, or `null` on cache miss.
 *
 * Validates: Requirements 8.2
 */
export async function getCachedTrends(
  redis: Redis,
  businessId: string,
  period: string,
): Promise<TrendData | null> {
  const key = generateCacheKey('trends', businessId, period);
  const raw = await redis.get(key);
  if (raw === null) return null;
  return JSON.parse(raw) as TrendData;
}

/**
 * Cache trend data with the configured TTL.
 *
 * @param redis - The Redis client instance.
 * @param businessId - The business UUID.
 * @param period - The period key.
 * @param data - The trend data to cache.
 *
 * Validates: Requirements 8.2, 8.6
 */
export async function cacheTrends(
  redis: Redis,
  businessId: string,
  period: string,
  data: TrendData,
): Promise<void> {
  const key = generateCacheKey('trends', businessId, period);
  await redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(data));
}

/**
 * Retrieve cached category breakdown for a business and period.
 *
 * @param redis - The Redis client instance.
 * @param businessId - The business UUID.
 * @param period - The period key.
 * @returns The cached category data, or `null` on cache miss.
 *
 * Validates: Requirements 8.2
 */
export async function getCachedCategories(
  redis: Redis,
  businessId: string,
  period: string,
): Promise<CategoryBreakdown[] | null> {
  const key = generateCacheKey('categories', businessId, period);
  const raw = await redis.get(key);
  if (raw === null) return null;
  return JSON.parse(raw) as CategoryBreakdown[];
}

/**
 * Cache category breakdown data with the configured TTL.
 *
 * @param redis - The Redis client instance.
 * @param businessId - The business UUID.
 * @param period - The period key.
 * @param data - The category data to cache.
 *
 * Validates: Requirements 8.2, 8.6
 */
export async function cacheCategories(
  redis: Redis,
  businessId: string,
  period: string,
  data: CategoryBreakdown[],
): Promise<void> {
  const key = generateCacheKey('categories', businessId, period);
  await redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(data));
}

/**
 * Retrieve cached counterparty breakdown for a business, period, and type.
 *
 * @param redis - The Redis client instance.
 * @param businessId - The business UUID.
 * @param period - The period key.
 * @param type - The transaction type ('INFLOW' | 'OUTFLOW').
 * @returns The cached counterparty data, or `null` on cache miss.
 *
 * Validates: Requirements 8.2
 */
export async function getCachedCounterparties(
  redis: Redis,
  businessId: string,
  period: string,
  type: string,
): Promise<CounterpartyBreakdown[] | null> {
  const key = generateCacheKey('counterparties', businessId, period, type);
  const raw = await redis.get(key);
  if (raw === null) return null;
  return JSON.parse(raw) as CounterpartyBreakdown[];
}

/**
 * Cache counterparty breakdown data with the configured TTL.
 *
 * @param redis - The Redis client instance.
 * @param businessId - The business UUID.
 * @param period - The period key.
 * @param type - The transaction type ('INFLOW' | 'OUTFLOW').
 * @param data - The counterparty data to cache.
 *
 * Validates: Requirements 8.2, 8.6
 */
export async function cacheCounterparties(
  redis: Redis,
  businessId: string,
  period: string,
  type: string,
  data: CounterpartyBreakdown[],
): Promise<void> {
  const key = generateCacheKey('counterparties', businessId, period, type);
  await redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

/**
 * Invalidate all cached dashboard aggregations for a business.
 *
 * Uses `redis.keys()` with a wildcard pattern to find all keys for the
 * given business, then deletes them in a single `redis.del()` call.
 *
 * @param redis - The Redis client instance.
 * @param businessId - The business UUID whose caches should be cleared.
 *
 * Validates: Requirements 8.3, 8.4
 */
export async function invalidateBusinessCache(redis: Redis, businessId: string): Promise<void> {
  const pattern = `dashboard:*:${businessId}:*`;
  const keys = await redis.keys(pattern);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

/**
 * Determine which standard period keys are affected by a transaction
 * on the given date.
 *
 * A transaction date affects a period if the date falls within the
 * period's current boundaries (computed in WAT). For simplicity and
 * correctness, we check each standard period against the WAT-aware
 * boundary functions.
 *
 * @param transactionDate - The date of the transaction.
 * @returns An array of period keys that include the transaction date.
 *
 * Validates: Requirements 9.1, 9.2, 9.3
 */
export function getAffectedPeriodKeys(transactionDate: Date): string[] {
  const now = new Date();
  const affected: string[] = [];

  // Check 'today': transaction date is on the same WAT calendar day as now
  const todayStart = getStartOfDayWAT(now);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  if (transactionDate >= todayStart && transactionDate < tomorrowStart) {
    affected.push('today');
  }

  // Check 'this_week': transaction date is in the current WAT week (Mon–Sun)
  const weekStart = getStartOfWeekWAT(now);
  const nextWeekStart = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (transactionDate >= weekStart && transactionDate < nextWeekStart) {
    affected.push('this_week');
  }

  // Check 'this_month': transaction date is in the current WAT month
  const monthStart = getStartOfMonthWAT(now);
  const watNow = toWAT(now);
  const nextMonthStart = new Date(
    Date.UTC(watNow.getUTCFullYear(), watNow.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
  const nextMonthStartUTC = new Date(nextMonthStart.getTime() - WAT_OFFSET_MS);
  if (transactionDate >= monthStart && transactionDate < nextMonthStartUTC) {
    affected.push('this_month');
  }

  // Check 'this_quarter': transaction date is in the current WAT quarter
  const quarterStart = getStartOfQuarterWAT(now);
  const quarterStartMonth = Math.floor(watNow.getUTCMonth() / 3) * 3;
  const nextQuarterStart = new Date(
    Date.UTC(watNow.getUTCFullYear(), quarterStartMonth + 3, 1, 0, 0, 0, 0),
  );
  const nextQuarterStartUTC = new Date(nextQuarterStart.getTime() - WAT_OFFSET_MS);
  if (transactionDate >= quarterStart && transactionDate < nextQuarterStartUTC) {
    affected.push('this_quarter');
  }

  // Check 'this_year': transaction date is in the current WAT year
  const yearStart = getStartOfYearWAT(now);
  const nextYearStart = new Date(Date.UTC(watNow.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0));
  const nextYearStartUTC = new Date(nextYearStart.getTime() - WAT_OFFSET_MS);
  if (transactionDate >= yearStart && transactionDate < nextYearStartUTC) {
    affected.push('this_year');
  }

  return affected;
}

/** WAT offset in ms — re-exported from periodService for internal use. */
const WAT_OFFSET_MS = 60 * 60 * 1000;

/**
 * Invalidate cached aggregations for periods affected by a specific
 * transaction date.
 *
 * Determines which standard periods contain the transaction date, then
 * deletes all cache key types (summary, trends, categories, counterparties)
 * for each affected period.
 *
 * @param redis - The Redis client instance.
 * @param businessId - The business UUID.
 * @param transactionDate - The date of the created/updated/deleted transaction.
 *
 * Validates: Requirements 8.3, 8.4, 9.1, 9.2, 9.3
 */
export async function invalidateAffectedPeriods(
  redis: Redis,
  businessId: string,
  transactionDate: Date,
): Promise<void> {
  const affectedPeriods = getAffectedPeriodKeys(transactionDate);

  const keysToDelete: string[] = [];
  const cacheTypes: (keyof typeof CACHE_KEYS)[] = [
    'summary',
    'trends',
    'categories',
    'counterparties',
  ];

  for (const period of affectedPeriods) {
    for (const cacheType of cacheTypes) {
      if (cacheType === 'counterparties') {
        // Counterparties have subtypes — delete both INFLOW and OUTFLOW
        keysToDelete.push(generateCacheKey(cacheType, businessId, period, 'INFLOW'));
        keysToDelete.push(generateCacheKey(cacheType, businessId, period, 'OUTFLOW'));
      } else {
        keysToDelete.push(generateCacheKey(cacheType, businessId, period));
      }
    }
  }

  if (keysToDelete.length > 0) {
    await redis.del(...keysToDelete);
  }
}
