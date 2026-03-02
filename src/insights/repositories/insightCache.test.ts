/**
 * Unit tests for the Redis caching layer.
 *
 * Validates: Requirements 11.5 — cache frequently accessed data for performance.
 *
 * Uses a minimal in-memory Redis mock to test cache behavior without
 * requiring a running Redis instance.
 */

import type { Redis } from 'ioredis';
import { beforeEach, describe, expect, it } from 'vitest';

import { makeInsight } from '../test/fixtures.js';
import type { Insight, InsightCategory, InsightStatus } from '../types/index.js';

import {
  cachedCountActiveInsights,
  cachedDeleteInsight,
  cachedGetActiveInsights,
  cachedGetInsightById,
  cachedGetInsightsByBusiness,
  cachedGetInsightsByCategory,
  cachedGetInsightsByStatus,
  cachedSaveInsight,
  cachedUpdateInsight,
  cachedBulkUpdateStatus,
  createCachedInsightStore,
  deserializeInsight,
  deserializeInsights,
  invalidateBusinessCache,
  invalidateInsightCache,
  keyForActiveCount,
  keyForActiveInsights,
  keyForBusinessInsights,
  keyForCategoryInsights,
  keyForInsight,
  keyForStatusInsights,
  serializeInsight,
  serializeInsights,
} from './insightCache.js';
import type { CachedInsightStore } from './insightCache.js';
import { createInsightStore, saveInsight } from './insightRepository.js';
import type { InsightStore } from './insightRepository.js';

// ─── Minimal Redis Mock ────────────────────────────────────────────────────

interface MockRedis extends Partial<Redis> {
  _store: Map<string, string>;
  _deletedKeys: string[];
}

function createMockRedis(): MockRedis {
  const store = new Map<string, string>();
  const deletedKeys: string[] = [];

  const mock: MockRedis = {
    _store: store,
    _deletedKeys: deletedKeys,

    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },

    async set(key: string, value: string, ..._args: unknown[]): Promise<'OK'> {
      store.set(key, value);
      return 'OK';
    },

    async del(...keys: (string | string[])[]): Promise<number> {
      let count = 0;
      const flatKeys = keys.flat() as string[];
      for (const key of flatKeys) {
        deletedKeys.push(key);
        if (store.delete(key)) {
          count++;
        }
      }
      return count;
    },
  } as MockRedis;

  return mock;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('insightCache', () => {
  let store: InsightStore;
  let redis: MockRedis;
  let cached: CachedInsightStore;

  beforeEach(() => {
    store = createInsightStore();
    redis = createMockRedis();
    cached = createCachedInsightStore(store, redis as unknown as Redis, { ttlSeconds: 60 });
  });

  // ─── Key Helpers ───────────────────────────────────────────────────────

  describe('key helpers', () => {
    it('generates correct key for insight by ID', () => {
      expect(keyForInsight('abc-123')).toBe('insights:id:abc-123');
    });

    it('generates correct key for active insights', () => {
      expect(keyForActiveInsights('biz-1')).toBe('insights:active:biz-1');
    });

    it('generates correct key for active count', () => {
      expect(keyForActiveCount('biz-1')).toBe('insights:active-count:biz-1');
    });

    it('generates correct key for business insights', () => {
      expect(keyForBusinessInsights('biz-1')).toBe('insights:biz:biz-1');
    });

    it('generates correct key for status insights', () => {
      expect(keyForStatusInsights('biz-1', 'active')).toBe('insights:status:biz-1:active');
    });

    it('generates correct key for category insights', () => {
      expect(keyForCategoryInsights('biz-1', 'tax')).toBe('insights:cat:biz-1:tax');
    });
  });

  // ─── Serialization ────────────────────────────────────────────────────

  describe('serialization', () => {
    it('round-trips a single insight through serialize/deserialize', () => {
      const insight = makeInsight();
      const json = serializeInsight(insight);
      const restored = deserializeInsight(json);

      expect(restored.id).toBe(insight.id);
      expect(restored.businessId).toBe(insight.businessId);
      expect(restored.category).toBe(insight.category);
      expect(restored.status).toBe(insight.status);
      expect(restored.createdAt).toEqual(insight.createdAt);
      expect(restored.expiresAt).toEqual(insight.expiresAt);
      expect(restored.acknowledgedAt).toBeNull();
      expect(restored.dismissedAt).toBeNull();
      expect(restored.resolvedAt).toBeNull();
    });

    it('round-trips an insight with non-null date fields', () => {
      const now = new Date();
      const insight = makeInsight({
        status: 'acknowledged',
        acknowledgedAt: now,
        acknowledgedBy: 'user-1',
      });
      const restored = deserializeInsight(serializeInsight(insight));

      expect(restored.acknowledgedAt).toEqual(now);
    });

    it('round-trips an array of insights', () => {
      const insights = [makeInsight(), makeInsight(), makeInsight()];
      const json = serializeInsights(insights);
      const restored = deserializeInsights(json);

      expect(restored).toHaveLength(3);
      expect(restored[0]?.id).toBe(insights[0]?.id);
      expect(restored[2]?.id).toBe(insights[2]?.id);
    });

    it('round-trips an empty array', () => {
      const restored = deserializeInsights(serializeInsights([]));
      expect(restored).toEqual([]);
    });
  });

  // ─── createCachedInsightStore ─────────────────────────────────────────

  describe('createCachedInsightStore', () => {
    it('uses default TTL when no config is provided', () => {
      const defaultCached = createCachedInsightStore(store, redis as unknown as Redis);
      expect(defaultCached.config.ttlSeconds).toBe(300);
    });

    it('allows overriding TTL', () => {
      expect(cached.config.ttlSeconds).toBe(60);
    });
  });

  // ─── cachedGetInsightById ─────────────────────────────────────────────

  describe('cachedGetInsightById', () => {
    it('returns from cache on hit', async () => {
      const insight = makeInsight();
      // Pre-populate cache only (not the store)
      redis._store.set(keyForInsight(insight.id), serializeInsight(insight));

      const result = await cachedGetInsightById(cached, insight.id);
      expect(result?.id).toBe(insight.id);
    });

    it('falls through to store on cache miss and populates cache', async () => {
      const insight = makeInsight();
      saveInsight(store, insight);

      const result = await cachedGetInsightById(cached, insight.id);
      expect(result?.id).toBe(insight.id);

      // Cache should now be populated
      const cacheEntry = redis._store.get(keyForInsight(insight.id));
      expect(cacheEntry).toBeDefined();
    });

    it('returns undefined for missing insight and does not cache', async () => {
      const result = await cachedGetInsightById(cached, 'nonexistent');
      expect(result).toBeUndefined();
      expect(redis._store.has(keyForInsight('nonexistent'))).toBe(false);
    });
  });

  // ─── cachedGetActiveInsights ──────────────────────────────────────────

  describe('cachedGetActiveInsights', () => {
    it('returns from cache on hit', async () => {
      const businessId = 'biz-1';
      const insights = [makeInsight({ businessId, status: 'active' })];
      redis._store.set(keyForActiveInsights(businessId), serializeInsights(insights));

      const result = await cachedGetActiveInsights(cached, businessId);
      expect(result).toHaveLength(1);
      expect(result[0]?.businessId).toBe(businessId);
    });

    it('falls through to store on miss and populates cache', async () => {
      const businessId = 'biz-1';
      saveInsight(store, makeInsight({ businessId, status: 'active' }));
      saveInsight(store, makeInsight({ businessId, status: 'dismissed' }));

      const result = await cachedGetActiveInsights(cached, businessId);
      expect(result).toHaveLength(1);
      expect(result[0]?.status).toBe('active');

      expect(redis._store.has(keyForActiveInsights(businessId))).toBe(true);
    });
  });

  // ─── cachedCountActiveInsights ────────────────────────────────────────

  describe('cachedCountActiveInsights', () => {
    it('returns cached count on hit', async () => {
      const businessId = 'biz-1';
      redis._store.set(keyForActiveCount(businessId), '5');

      const result = await cachedCountActiveInsights(cached, businessId);
      expect(result).toBe(5);
    });

    it('falls through to store on miss and caches the count', async () => {
      const businessId = 'biz-1';
      saveInsight(store, makeInsight({ businessId, status: 'active' }));
      saveInsight(store, makeInsight({ businessId, status: 'active' }));

      const result = await cachedCountActiveInsights(cached, businessId);
      expect(result).toBe(2);

      expect(redis._store.get(keyForActiveCount(businessId))).toBe('2');
    });
  });

  // ─── cachedGetInsightsByBusiness ──────────────────────────────────────

  describe('cachedGetInsightsByBusiness', () => {
    it('returns from cache on hit', async () => {
      const businessId = 'biz-1';
      const insights = [makeInsight({ businessId }), makeInsight({ businessId })];
      redis._store.set(keyForBusinessInsights(businessId), serializeInsights(insights));

      const result = await cachedGetInsightsByBusiness(cached, businessId);
      expect(result).toHaveLength(2);
    });

    it('falls through to store on miss', async () => {
      const businessId = 'biz-1';
      saveInsight(store, makeInsight({ businessId }));

      const result = await cachedGetInsightsByBusiness(cached, businessId);
      expect(result).toHaveLength(1);
      expect(redis._store.has(keyForBusinessInsights(businessId))).toBe(true);
    });
  });

  // ─── cachedGetInsightsByStatus ────────────────────────────────────────

  describe('cachedGetInsightsByStatus', () => {
    it('returns from cache on hit', async () => {
      const businessId = 'biz-1';
      const status: InsightStatus = 'dismissed';
      const insights = [makeInsight({ businessId, status })];
      redis._store.set(keyForStatusInsights(businessId, status), serializeInsights(insights));

      const result = await cachedGetInsightsByStatus(cached, businessId, status);
      expect(result).toHaveLength(1);
      expect(result[0]?.status).toBe(status);
    });

    it('falls through to store on miss', async () => {
      const businessId = 'biz-1';
      saveInsight(store, makeInsight({ businessId, status: 'resolved' }));

      const result = await cachedGetInsightsByStatus(cached, businessId, 'resolved');
      expect(result).toHaveLength(1);
    });
  });

  // ─── cachedGetInsightsByCategory ──────────────────────────────────────

  describe('cachedGetInsightsByCategory', () => {
    it('returns from cache on hit', async () => {
      const businessId = 'biz-1';
      const category: InsightCategory = 'cashflow';
      const insights = [makeInsight({ businessId, category })];
      redis._store.set(keyForCategoryInsights(businessId, category), serializeInsights(insights));

      const result = await cachedGetInsightsByCategory(cached, businessId, category);
      expect(result).toHaveLength(1);
      expect(result[0]?.category).toBe(category);
    });

    it('falls through to store on miss', async () => {
      const businessId = 'biz-1';
      saveInsight(store, makeInsight({ businessId, category: 'tax' }));

      const result = await cachedGetInsightsByCategory(cached, businessId, 'tax');
      expect(result).toHaveLength(1);
    });
  });

  // ─── cachedSaveInsight ────────────────────────────────────────────────

  describe('cachedSaveInsight', () => {
    it('saves to store and writes through to cache', async () => {
      const insight = makeInsight();
      const result = await cachedSaveInsight(cached, insight);

      expect(result.id).toBe(insight.id);
      // Individual insight cached
      expect(redis._store.has(keyForInsight(insight.id))).toBe(true);
    });

    it('invalidates business-level list caches after save', async () => {
      const businessId = 'biz-1';
      // Pre-populate list caches
      redis._store.set(keyForActiveInsights(businessId), '[]');
      redis._store.set(keyForActiveCount(businessId), '0');
      redis._store.set(keyForBusinessInsights(businessId), '[]');

      await cachedSaveInsight(cached, makeInsight({ businessId }));

      // List caches should be invalidated
      expect(redis._store.has(keyForActiveInsights(businessId))).toBe(false);
      expect(redis._store.has(keyForActiveCount(businessId))).toBe(false);
      expect(redis._store.has(keyForBusinessInsights(businessId))).toBe(false);
    });
  });

  // ─── cachedUpdateInsight ──────────────────────────────────────────────

  describe('cachedUpdateInsight', () => {
    it('updates the store and refreshes the cache entry', async () => {
      const insight = makeInsight({ status: 'active' });
      saveInsight(store, insight);

      const result = await cachedUpdateInsight(cached, insight.id, {
        status: 'acknowledged',
        acknowledgedAt: new Date(),
        acknowledgedBy: 'user-1',
      });

      expect(result?.status).toBe('acknowledged');
      // Cache should have the updated version
      const cacheEntry = redis._store.get(keyForInsight(insight.id));
      expect(cacheEntry).toBeDefined();
      const deserialized = deserializeInsight(cacheEntry!);
      expect(deserialized.status).toBe('acknowledged');
    });

    it('invalidates business caches after update', async () => {
      const businessId = 'biz-1';
      const insight = makeInsight({ businessId });
      saveInsight(store, insight);
      redis._store.set(keyForActiveInsights(businessId), '[]');

      await cachedUpdateInsight(cached, insight.id, { status: 'dismissed' });

      expect(redis._store.has(keyForActiveInsights(businessId))).toBe(false);
    });

    it('invalidates insight cache when update target is missing', async () => {
      const result = await cachedUpdateInsight(cached, 'nonexistent', { status: 'dismissed' });
      expect(result).toBeUndefined();
      // Should have attempted to delete the key
      expect(redis._deletedKeys).toContain(keyForInsight('nonexistent'));
    });
  });

  // ─── cachedDeleteInsight ──────────────────────────────────────────────

  describe('cachedDeleteInsight', () => {
    it('deletes from store and invalidates caches', async () => {
      const businessId = 'biz-1';
      const insight = makeInsight({ businessId });
      saveInsight(store, insight);
      redis._store.set(keyForInsight(insight.id), serializeInsight(insight));
      redis._store.set(keyForActiveInsights(businessId), '[]');

      const result = await cachedDeleteInsight(cached, insight.id);
      expect(result).toBe(true);

      // Individual cache invalidated
      expect(redis._store.has(keyForInsight(insight.id))).toBe(false);
      // Business caches invalidated
      expect(redis._store.has(keyForActiveInsights(businessId))).toBe(false);
    });

    it('returns false for missing insight', async () => {
      const result = await cachedDeleteInsight(cached, 'nonexistent');
      expect(result).toBe(false);
    });
  });

  // ─── cachedBulkUpdateStatus ───────────────────────────────────────────

  describe('cachedBulkUpdateStatus', () => {
    it('updates multiple insights and invalidates all affected business caches', async () => {
      const biz1 = 'biz-1';
      const biz2 = 'biz-2';
      const i1 = makeInsight({ businessId: biz1, status: 'active' });
      const i2 = makeInsight({ businessId: biz2, status: 'active' });
      saveInsight(store, i1);
      saveInsight(store, i2);

      redis._store.set(keyForActiveInsights(biz1), '[]');
      redis._store.set(keyForActiveInsights(biz2), '[]');

      const count = await cachedBulkUpdateStatus(cached, [i1.id, i2.id], 'expired');
      expect(count).toBe(2);

      // Both business caches invalidated
      expect(redis._store.has(keyForActiveInsights(biz1))).toBe(false);
      expect(redis._store.has(keyForActiveInsights(biz2))).toBe(false);
    });

    it('returns 0 when no IDs match', async () => {
      const count = await cachedBulkUpdateStatus(cached, ['a', 'b'], 'expired');
      expect(count).toBe(0);
    });
  });

  // ─── invalidateBusinessCache ──────────────────────────────────────────

  describe('invalidateBusinessCache', () => {
    it('deletes all business-related cache keys', async () => {
      const businessId = 'biz-1';
      // Populate various cache keys
      redis._store.set(keyForActiveInsights(businessId), '[]');
      redis._store.set(keyForActiveCount(businessId), '0');
      redis._store.set(keyForBusinessInsights(businessId), '[]');
      redis._store.set(keyForStatusInsights(businessId, 'active'), '[]');
      redis._store.set(keyForCategoryInsights(businessId, 'tax'), '[]');

      await invalidateBusinessCache(cached, businessId);

      expect(redis._store.has(keyForActiveInsights(businessId))).toBe(false);
      expect(redis._store.has(keyForActiveCount(businessId))).toBe(false);
      expect(redis._store.has(keyForBusinessInsights(businessId))).toBe(false);
      expect(redis._store.has(keyForStatusInsights(businessId, 'active'))).toBe(false);
      expect(redis._store.has(keyForCategoryInsights(businessId, 'tax'))).toBe(false);
    });
  });

  // ─── invalidateInsightCache ───────────────────────────────────────────

  describe('invalidateInsightCache', () => {
    it('deletes the individual insight cache key', async () => {
      const id = 'insight-123';
      redis._store.set(keyForInsight(id), '{}');

      await invalidateInsightCache(cached, id);

      expect(redis._store.has(keyForInsight(id))).toBe(false);
    });
  });
});
