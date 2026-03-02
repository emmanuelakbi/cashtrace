import { describe, it, expect, beforeEach } from 'vitest';

import { makeInsight } from '../test/fixtures.js';

import {
  bulkUpdateStatus,
  countActiveInsights,
  createInsightStore,
  deleteInsight,
  getActiveInsights,
  getExpiredInsights,
  getInsightById,
  getInsightsByBusiness,
  getInsightsByCategory,
  getInsightsByStatus,
  saveInsight,
  updateInsight,
} from './insightRepository.js';
import type { InsightStore } from './insightRepository.js';

describe('insightRepository', () => {
  let store: InsightStore;

  beforeEach(() => {
    store = createInsightStore();
  });

  // ─── saveInsight ───────────────────────────────────────────────────────

  describe('saveInsight', () => {
    it('stores and returns the insight', () => {
      const insight = makeInsight();
      const result = saveInsight(store, insight);

      expect(result).toEqual(insight);
      expect(store.insights.size).toBe(1);
    });

    it('overwrites an existing insight with the same ID', () => {
      const insight = makeInsight();
      saveInsight(store, insight);

      const updated = { ...insight, title: 'Updated title' };
      saveInsight(store, updated);

      expect(store.insights.size).toBe(1);
      expect(getInsightById(store, insight.id)?.title).toBe('Updated title');
    });
  });

  // ─── getInsightById ────────────────────────────────────────────────────

  describe('getInsightById', () => {
    it('retrieves an insight by ID', () => {
      const insight = makeInsight();
      saveInsight(store, insight);

      const result = getInsightById(store, insight.id);
      expect(result).toEqual(insight);
    });

    it('returns undefined for a missing ID', () => {
      expect(getInsightById(store, 'nonexistent')).toBeUndefined();
    });
  });

  // ─── updateInsight ─────────────────────────────────────────────────────

  describe('updateInsight', () => {
    it('applies partial updates and returns the updated insight', () => {
      const insight = makeInsight({ status: 'active' });
      saveInsight(store, insight);

      const result = updateInsight(store, insight.id, {
        status: 'acknowledged',
        acknowledgedAt: new Date(),
        acknowledgedBy: 'user-1',
      });

      expect(result?.status).toBe('acknowledged');
      expect(result?.acknowledgedBy).toBe('user-1');
      expect(result?.title).toBe(insight.title); // unchanged fields preserved
    });

    it('does not allow overriding the ID via updates', () => {
      const insight = makeInsight();
      saveInsight(store, insight);

      const result = updateInsight(store, insight.id, { id: 'sneaky-id' } as Partial<
        typeof insight
      >);
      expect(result?.id).toBe(insight.id);
    });

    it('returns undefined for a missing ID', () => {
      expect(updateInsight(store, 'nonexistent', { status: 'dismissed' })).toBeUndefined();
    });
  });

  // ─── deleteInsight ─────────────────────────────────────────────────────

  describe('deleteInsight', () => {
    it('removes an existing insight and returns true', () => {
      const insight = makeInsight();
      saveInsight(store, insight);

      expect(deleteInsight(store, insight.id)).toBe(true);
      expect(store.insights.size).toBe(0);
    });

    it('returns false for a missing ID', () => {
      expect(deleteInsight(store, 'nonexistent')).toBe(false);
    });
  });

  // ─── getInsightsByBusiness ─────────────────────────────────────────────

  describe('getInsightsByBusiness', () => {
    it('returns insights belonging to the given business', () => {
      const businessId = 'biz-1';
      saveInsight(store, makeInsight({ businessId }));
      saveInsight(store, makeInsight({ businessId }));
      saveInsight(store, makeInsight({ businessId: 'biz-other' }));

      const results = getInsightsByBusiness(store, businessId);
      expect(results).toHaveLength(2);
      expect(results.every((i) => i.businessId === businessId)).toBe(true);
    });

    it('returns an empty array when no insights match', () => {
      expect(getInsightsByBusiness(store, 'biz-none')).toEqual([]);
    });
  });

  // ─── getInsightsByStatus ───────────────────────────────────────────────

  describe('getInsightsByStatus', () => {
    it('filters by business and status', () => {
      const businessId = 'biz-1';
      saveInsight(store, makeInsight({ businessId, status: 'active' }));
      saveInsight(store, makeInsight({ businessId, status: 'dismissed' }));
      saveInsight(store, makeInsight({ businessId, status: 'active' }));

      const results = getInsightsByStatus(store, businessId, 'active');
      expect(results).toHaveLength(2);
      expect(results.every((i) => i.status === 'active')).toBe(true);
    });

    it('does not return insights from other businesses', () => {
      saveInsight(store, makeInsight({ businessId: 'biz-other', status: 'active' }));

      expect(getInsightsByStatus(store, 'biz-1', 'active')).toEqual([]);
    });
  });

  // ─── getInsightsByCategory ─────────────────────────────────────────────

  describe('getInsightsByCategory', () => {
    it('filters by business and category', () => {
      const businessId = 'biz-1';
      saveInsight(store, makeInsight({ businessId, category: 'tax' }));
      saveInsight(store, makeInsight({ businessId, category: 'cashflow' }));
      saveInsight(store, makeInsight({ businessId, category: 'tax' }));

      const results = getInsightsByCategory(store, businessId, 'tax');
      expect(results).toHaveLength(2);
      expect(results.every((i) => i.category === 'tax')).toBe(true);
    });

    it('does not return insights from other businesses', () => {
      saveInsight(store, makeInsight({ businessId: 'biz-other', category: 'tax' }));

      expect(getInsightsByCategory(store, 'biz-1', 'tax')).toEqual([]);
    });
  });

  // ─── getActiveInsights ─────────────────────────────────────────────────

  describe('getActiveInsights', () => {
    it('returns only active insights for the business', () => {
      const businessId = 'biz-1';
      saveInsight(store, makeInsight({ businessId, status: 'active' }));
      saveInsight(store, makeInsight({ businessId, status: 'resolved' }));
      saveInsight(store, makeInsight({ businessId, status: 'active' }));
      saveInsight(store, makeInsight({ businessId, status: 'expired' }));

      const results = getActiveInsights(store, businessId);
      expect(results).toHaveLength(2);
      expect(results.every((i) => i.status === 'active')).toBe(true);
    });
  });

  // ─── countActiveInsights ───────────────────────────────────────────────

  describe('countActiveInsights', () => {
    it('returns the correct count of active insights', () => {
      const businessId = 'biz-1';
      saveInsight(store, makeInsight({ businessId, status: 'active' }));
      saveInsight(store, makeInsight({ businessId, status: 'active' }));
      saveInsight(store, makeInsight({ businessId, status: 'dismissed' }));

      expect(countActiveInsights(store, businessId)).toBe(2);
    });

    it('returns 0 when no active insights exist', () => {
      expect(countActiveInsights(store, 'biz-empty')).toBe(0);
    });
  });

  // ─── getExpiredInsights ────────────────────────────────────────────────

  describe('getExpiredInsights', () => {
    it('returns insights whose expiresAt is before the given date', () => {
      const now = new Date();
      const pastDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const futureDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      saveInsight(store, makeInsight({ expiresAt: pastDate }));
      saveInsight(store, makeInsight({ expiresAt: futureDate }));
      saveInsight(store, makeInsight({ expiresAt: pastDate }));

      const results = getExpiredInsights(store, now);
      expect(results).toHaveLength(2);
    });

    it('returns an empty array when nothing is expired', () => {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      saveInsight(store, makeInsight({ expiresAt: futureDate }));

      expect(getExpiredInsights(store, now)).toEqual([]);
    });
  });

  // ─── bulkUpdateStatus ──────────────────────────────────────────────────

  describe('bulkUpdateStatus', () => {
    it('updates the status of multiple insights and returns the count', () => {
      const i1 = makeInsight({ status: 'active' });
      const i2 = makeInsight({ status: 'active' });
      const i3 = makeInsight({ status: 'active' });
      saveInsight(store, i1);
      saveInsight(store, i2);
      saveInsight(store, i3);

      const count = bulkUpdateStatus(store, [i1.id, i2.id], 'expired');
      expect(count).toBe(2);
      expect(getInsightById(store, i1.id)?.status).toBe('expired');
      expect(getInsightById(store, i2.id)?.status).toBe('expired');
      expect(getInsightById(store, i3.id)?.status).toBe('active');
    });

    it('skips missing IDs and returns only the count of updated records', () => {
      const i1 = makeInsight();
      saveInsight(store, i1);

      const count = bulkUpdateStatus(store, [i1.id, 'nonexistent'], 'dismissed');
      expect(count).toBe(1);
    });

    it('returns 0 when no IDs match', () => {
      expect(bulkUpdateStatus(store, ['a', 'b'], 'expired')).toBe(0);
    });
  });
});
