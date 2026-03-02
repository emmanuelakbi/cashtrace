/**
 * Redis caching layer for the Insight Repository.
 *
 * Wraps the in-memory InsightStore with a Redis-backed cache for frequently
 * accessed queries: active insights per business, insight counts, and
 * individual insight lookups.
 *
 * Validates: Requirements 11.5
 *
 * @module insights/repositories/insightCache
 */

import type { Redis } from 'ioredis';

import type { Insight, InsightCategory, InsightStatus } from '../types/index.js';

import type { InsightStore } from './insightRepository.js';
import {
  countActiveInsights as repoCountActive,
  getActiveInsights as repoGetActive,
  getInsightById as repoGetById,
  getInsightsByBusiness as repoGetByBusiness,
  getInsightsByCategory as repoGetByCategory,
  getInsightsByStatus as repoGetByStatus,
  saveInsight as repoSave,
  updateInsight as repoUpdate,
  deleteInsight as repoDelete,
  bulkUpdateStatus as repoBulkUpdate,
} from './insightRepository.js';

// ─── Cache Key Helpers ─────────────────────────────────────────────────────

const PREFIX = 'insights' as const;

export function keyForInsight(id: string): string {
  return `${PREFIX}:id:${id}`;
}

export function keyForActiveInsights(businessId: string): string {
  return `${PREFIX}:active:${businessId}`;
}

export function keyForActiveCount(businessId: string): string {
  return `${PREFIX}:active-count:${businessId}`;
}

export function keyForBusinessInsights(businessId: string): string {
  return `${PREFIX}:biz:${businessId}`;
}

export function keyForStatusInsights(businessId: string, status: InsightStatus): string {
  return `${PREFIX}:status:${businessId}:${status}`;
}

export function keyForCategoryInsights(businessId: string, category: InsightCategory): string {
  return `${PREFIX}:cat:${businessId}:${category}`;
}

// ─── Serialization ─────────────────────────────────────────────────────────

/** Serialize an Insight to a JSON string for Redis storage. */
export function serializeInsight(insight: Insight): string {
  return JSON.stringify(insight);
}

/** Deserialize a JSON string from Redis back into an Insight. */
export function deserializeInsight(json: string): Insight {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  return {
    ...parsed,
    createdAt: new Date(parsed['createdAt'] as string),
    expiresAt: new Date(parsed['expiresAt'] as string),
    acknowledgedAt: parsed['acknowledgedAt'] ? new Date(parsed['acknowledgedAt'] as string) : null,
    dismissedAt: parsed['dismissedAt'] ? new Date(parsed['dismissedAt'] as string) : null,
    resolvedAt: parsed['resolvedAt'] ? new Date(parsed['resolvedAt'] as string) : null,
  } as Insight;
}

/** Serialize an array of Insights. */
export function serializeInsights(insights: Insight[]): string {
  return JSON.stringify(insights);
}

/** Deserialize a JSON string into an array of Insights. */
export function deserializeInsights(json: string): Insight[] {
  const parsed = JSON.parse(json) as unknown[];
  return parsed.map((item) => {
    const record = item as Record<string, unknown>;
    return {
      ...record,
      createdAt: new Date(record['createdAt'] as string),
      expiresAt: new Date(record['expiresAt'] as string),
      acknowledgedAt: record['acknowledgedAt']
        ? new Date(record['acknowledgedAt'] as string)
        : null,
      dismissedAt: record['dismissedAt'] ? new Date(record['dismissedAt'] as string) : null,
      resolvedAt: record['resolvedAt'] ? new Date(record['resolvedAt'] as string) : null,
    } as Insight;
  });
}

// ─── Cache Configuration ───────────────────────────────────────────────────

export interface InsightCacheConfig {
  /** TTL in seconds for cached entries. Defaults to 300 (5 minutes). */
  ttlSeconds: number;
}

const DEFAULT_CONFIG: InsightCacheConfig = {
  ttlSeconds: 300,
};

// ─── Cached Insight Store ──────────────────────────────────────────────────

export interface CachedInsightStore {
  store: InsightStore;
  redis: Redis;
  config: InsightCacheConfig;
}

/** Create a cached insight store wrapping the underlying store with Redis. */
export function createCachedInsightStore(
  store: InsightStore,
  redis: Redis,
  config: Partial<InsightCacheConfig> = {},
): CachedInsightStore {
  return {
    store,
    redis,
    config: { ...DEFAULT_CONFIG, ...config },
  };
}

// ─── Cache Invalidation ────────────────────────────────────────────────────

/** Invalidate all cached entries related to a business. */
export async function invalidateBusinessCache(
  cached: CachedInsightStore,
  businessId: string,
): Promise<void> {
  const keys = [
    keyForActiveInsights(businessId),
    keyForActiveCount(businessId),
    keyForBusinessInsights(businessId),
  ];

  const statusKeys: InsightStatus[] = [
    'active',
    'acknowledged',
    'dismissed',
    'resolved',
    'expired',
  ];
  for (const status of statusKeys) {
    keys.push(keyForStatusInsights(businessId, status));
  }

  const categoryKeys: InsightCategory[] = [
    'tax',
    'compliance',
    'cashflow',
    'spending',
    'revenue',
    'operational',
  ];
  for (const cat of categoryKeys) {
    keys.push(keyForCategoryInsights(businessId, cat));
  }

  await cached.redis.del(...keys);
}

/** Invalidate a single insight entry from cache. */
export async function invalidateInsightCache(
  cached: CachedInsightStore,
  insightId: string,
): Promise<void> {
  await cached.redis.del(keyForInsight(insightId));
}

// ─── Cached Read Operations ────────────────────────────────────────────────

/** Get an insight by ID, checking cache first. */
export async function cachedGetInsightById(
  cached: CachedInsightStore,
  id: string,
): Promise<Insight | undefined> {
  const key = keyForInsight(id);
  const hit = await cached.redis.get(key);

  if (hit !== null) {
    return deserializeInsight(hit);
  }

  const insight = repoGetById(cached.store, id);
  if (insight) {
    await cached.redis.set(key, serializeInsight(insight), 'EX', cached.config.ttlSeconds);
  }
  return insight;
}

/** Get active insights for a business, checking cache first. */
export async function cachedGetActiveInsights(
  cached: CachedInsightStore,
  businessId: string,
): Promise<Insight[]> {
  const key = keyForActiveInsights(businessId);
  const hit = await cached.redis.get(key);

  if (hit !== null) {
    return deserializeInsights(hit);
  }

  const insights = repoGetActive(cached.store, businessId);
  await cached.redis.set(key, serializeInsights(insights), 'EX', cached.config.ttlSeconds);
  return insights;
}

/** Count active insights for a business, checking cache first. */
export async function cachedCountActiveInsights(
  cached: CachedInsightStore,
  businessId: string,
): Promise<number> {
  const key = keyForActiveCount(businessId);
  const hit = await cached.redis.get(key);

  if (hit !== null) {
    return parseInt(hit, 10);
  }

  const count = repoCountActive(cached.store, businessId);
  await cached.redis.set(key, count.toString(), 'EX', cached.config.ttlSeconds);
  return count;
}

/** Get all insights for a business, checking cache first. */
export async function cachedGetInsightsByBusiness(
  cached: CachedInsightStore,
  businessId: string,
): Promise<Insight[]> {
  const key = keyForBusinessInsights(businessId);
  const hit = await cached.redis.get(key);

  if (hit !== null) {
    return deserializeInsights(hit);
  }

  const insights = repoGetByBusiness(cached.store, businessId);
  await cached.redis.set(key, serializeInsights(insights), 'EX', cached.config.ttlSeconds);
  return insights;
}

/** Get insights by status for a business, checking cache first. */
export async function cachedGetInsightsByStatus(
  cached: CachedInsightStore,
  businessId: string,
  status: InsightStatus,
): Promise<Insight[]> {
  const key = keyForStatusInsights(businessId, status);
  const hit = await cached.redis.get(key);

  if (hit !== null) {
    return deserializeInsights(hit);
  }

  const insights = repoGetByStatus(cached.store, businessId, status);
  await cached.redis.set(key, serializeInsights(insights), 'EX', cached.config.ttlSeconds);
  return insights;
}

/** Get insights by category for a business, checking cache first. */
export async function cachedGetInsightsByCategory(
  cached: CachedInsightStore,
  businessId: string,
  category: InsightCategory,
): Promise<Insight[]> {
  const key = keyForCategoryInsights(businessId, category);
  const hit = await cached.redis.get(key);

  if (hit !== null) {
    return deserializeInsights(hit);
  }

  const insights = repoGetByCategory(cached.store, businessId, category);
  await cached.redis.set(key, serializeInsights(insights), 'EX', cached.config.ttlSeconds);
  return insights;
}

// ─── Cached Write Operations (write-through + invalidate) ──────────────────

/** Save an insight and invalidate related caches. */
export async function cachedSaveInsight(
  cached: CachedInsightStore,
  insight: Insight,
): Promise<Insight> {
  const result = repoSave(cached.store, insight);

  // Write-through: cache the individual insight
  await cached.redis.set(
    keyForInsight(insight.id),
    serializeInsight(result),
    'EX',
    cached.config.ttlSeconds,
  );

  // Invalidate list caches for the business
  await invalidateBusinessCache(cached, insight.businessId);

  return result;
}

/** Update an insight and invalidate related caches. */
export async function cachedUpdateInsight(
  cached: CachedInsightStore,
  id: string,
  updates: Partial<Insight>,
): Promise<Insight | undefined> {
  const result = repoUpdate(cached.store, id, updates);

  if (result) {
    await cached.redis.set(
      keyForInsight(id),
      serializeInsight(result),
      'EX',
      cached.config.ttlSeconds,
    );
    await invalidateBusinessCache(cached, result.businessId);
  } else {
    await invalidateInsightCache(cached, id);
  }

  return result;
}

/** Delete an insight and invalidate related caches. */
export async function cachedDeleteInsight(
  cached: CachedInsightStore,
  id: string,
): Promise<boolean> {
  // Look up the insight first so we know which business cache to invalidate
  const existing = repoGetById(cached.store, id);
  const result = repoDelete(cached.store, id);

  await invalidateInsightCache(cached, id);
  if (existing) {
    await invalidateBusinessCache(cached, existing.businessId);
  }

  return result;
}

/** Bulk update status and invalidate caches for affected businesses. */
export async function cachedBulkUpdateStatus(
  cached: CachedInsightStore,
  ids: string[],
  status: InsightStatus,
): Promise<number> {
  // Collect affected business IDs before the update
  const affectedBusinessIds = new Set<string>();
  for (const id of ids) {
    const insight = repoGetById(cached.store, id);
    if (insight) {
      affectedBusinessIds.add(insight.businessId);
    }
  }

  const count = repoBulkUpdate(cached.store, ids, status);

  // Invalidate individual insight caches
  for (const id of ids) {
    await invalidateInsightCache(cached, id);
  }

  // Invalidate business-level caches
  for (const businessId of affectedBusinessIds) {
    await invalidateBusinessCache(cached, businessId);
  }

  return count;
}
