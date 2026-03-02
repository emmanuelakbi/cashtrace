/**
 * Unit tests for the LifecycleManager.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4
 *
 * @module insights/services/lifecycleManager.test
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { makeScoredInsight } from '../test/fixtures.js';

import {
  INSIGHT_ALREADY_RESOLVED,
  INSIGHT_INVALID_TRANSITION,
  InsightLifecycleError,
  LifecycleManager,
} from './lifecycleManager.js';

describe('LifecycleManager', () => {
  let manager: LifecycleManager;

  beforeEach(() => {
    manager = new LifecycleManager();
  });

  // ─── create ────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should create an insight in active status', async () => {
      const scored = makeScoredInsight();
      const insight = await manager.create(scored);

      expect(insight.status).toBe('active');
      expect(insight.id).toBeDefined();
      expect(insight.category).toBe(scored.category);
      expect(insight.type).toBe(scored.type);
      expect(insight.priority).toBe(scored.priority);
      expect(insight.score).toBe(scored.score);
      expect(insight.financialImpactKobo).toBe(scored.financialImpact);
      expect(insight.createdAt).toBeInstanceOf(Date);
      expect(insight.expiresAt).toBeInstanceOf(Date);
      expect(insight.expiresAt.getTime()).toBeGreaterThan(insight.createdAt.getTime());
    });

    it('should set all lifecycle timestamps to null on creation', async () => {
      const insight = await manager.create(makeScoredInsight());

      expect(insight.acknowledgedAt).toBeNull();
      expect(insight.acknowledgedBy).toBeNull();
      expect(insight.dismissedAt).toBeNull();
      expect(insight.dismissedBy).toBeNull();
      expect(insight.dismissReason).toBeNull();
      expect(insight.resolvedAt).toBeNull();
      expect(insight.resolvedBy).toBeNull();
      expect(insight.resolutionNotes).toBeNull();
    });

    it('should store the insight for later retrieval', async () => {
      const insight = await manager.create(makeScoredInsight());
      const retrieved = manager.get(insight.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(insight.id);
    });
  });

  // ─── acknowledge ───────────────────────────────────────────────────────

  describe('acknowledge', () => {
    it('should transition active insight to acknowledged (Req 8.1)', async () => {
      const insight = await manager.create(makeScoredInsight());
      await manager.acknowledge(insight.id, 'user-1');

      const updated = manager.getOrThrow(insight.id);
      expect(updated.status).toBe('acknowledged');
      expect(updated.acknowledgedAt).toBeInstanceOf(Date);
      expect(updated.acknowledgedBy).toBe('user-1');
    });

    it('should reject acknowledging a dismissed insight', async () => {
      const insight = await manager.create(makeScoredInsight());
      await manager.dismiss(insight.id, 'user-1', 'not relevant');

      await expect(manager.acknowledge(insight.id, 'user-1')).rejects.toThrow(
        InsightLifecycleError,
      );
    });

    it('should reject acknowledging an already acknowledged insight', async () => {
      const insight = await manager.create(makeScoredInsight());
      await manager.acknowledge(insight.id, 'user-1');

      await expect(manager.acknowledge(insight.id, 'user-2')).rejects.toThrow(
        InsightLifecycleError,
      );
    });
  });

  // ─── dismiss ───────────────────────────────────────────────────────────

  describe('dismiss', () => {
    it('should transition active insight to dismissed with reason (Req 8.2)', async () => {
      const insight = await manager.create(makeScoredInsight());
      await manager.dismiss(insight.id, 'user-1', 'Not applicable to my business');

      const updated = manager.getOrThrow(insight.id);
      expect(updated.status).toBe('dismissed');
      expect(updated.dismissedAt).toBeInstanceOf(Date);
      expect(updated.dismissedBy).toBe('user-1');
      expect(updated.dismissReason).toBe('Not applicable to my business');
    });

    it('should reject dismissing an acknowledged insight', async () => {
      const insight = await manager.create(makeScoredInsight());
      await manager.acknowledge(insight.id, 'user-1');

      await expect(manager.dismiss(insight.id, 'user-1', 'changed my mind')).rejects.toThrow(
        InsightLifecycleError,
      );
    });

    it('should reject dismissing a resolved insight', async () => {
      const insight = await manager.create(makeScoredInsight());
      await manager.acknowledge(insight.id, 'user-1');
      await manager.resolve(insight.id, 'user-1', 'done');

      await expect(manager.dismiss(insight.id, 'user-1', 'too late')).rejects.toThrow(
        InsightLifecycleError,
      );
    });
  });

  // ─── resolve ───────────────────────────────────────────────────────────

  describe('resolve', () => {
    it('should transition acknowledged insight to resolved (Req 8.3)', async () => {
      const insight = await manager.create(makeScoredInsight());
      await manager.acknowledge(insight.id, 'user-1');
      await manager.resolve(insight.id, 'user-1', 'Filed VAT return');

      const updated = manager.getOrThrow(insight.id);
      expect(updated.status).toBe('resolved');
      expect(updated.resolvedAt).toBeInstanceOf(Date);
      expect(updated.resolvedBy).toBe('user-1');
      expect(updated.resolutionNotes).toBe('Filed VAT return');
    });

    it('should reject resolving an active insight directly', async () => {
      const insight = await manager.create(makeScoredInsight());

      await expect(manager.resolve(insight.id, 'user-1', 'skip acknowledge')).rejects.toThrow(
        InsightLifecycleError,
      );
    });

    it('should throw INSIGHT_ALREADY_RESOLVED for resolved insight', async () => {
      const insight = await manager.create(makeScoredInsight());
      await manager.acknowledge(insight.id, 'user-1');
      await manager.resolve(insight.id, 'user-1', 'done');

      try {
        await manager.resolve(insight.id, 'user-1', 'again');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(InsightLifecycleError);
        expect((err as InsightLifecycleError).code).toBe(INSIGHT_ALREADY_RESOLVED);
      }
    });
  });

  // ─── expire ────────────────────────────────────────────────────────────

  describe('expire', () => {
    it('should expire an active insight (Req 8.4)', async () => {
      const insight = await manager.create(makeScoredInsight());
      await manager.expire(insight.id);

      const updated = manager.getOrThrow(insight.id);
      expect(updated.status).toBe('expired');
    });

    it('should expire an acknowledged insight', async () => {
      const insight = await manager.create(makeScoredInsight());
      await manager.acknowledge(insight.id, 'user-1');
      await manager.expire(insight.id);

      const updated = manager.getOrThrow(insight.id);
      expect(updated.status).toBe('expired');
    });

    it('should reject expiring a dismissed insight', async () => {
      const insight = await manager.create(makeScoredInsight());
      await manager.dismiss(insight.id, 'user-1', 'nope');

      await expect(manager.expire(insight.id)).rejects.toThrow(InsightLifecycleError);
    });

    it('should reject expiring a resolved insight', async () => {
      const insight = await manager.create(makeScoredInsight());
      await manager.acknowledge(insight.id, 'user-1');
      await manager.resolve(insight.id, 'user-1', 'done');

      await expect(manager.expire(insight.id)).rejects.toThrow(InsightLifecycleError);
    });
  });

  // ─── checkExpiration ───────────────────────────────────────────────────

  describe('checkExpiration', () => {
    it('should expire insights past their expiresAt date', async () => {
      const pastDate = new Date(Date.now() - 1000);
      const scored = makeScoredInsight({ data: { businessId: 'biz-1' } });
      const insight = await manager.create(scored);

      // Manually set expiresAt to the past
      const stored = manager.getOrThrow(insight.id);
      stored.expiresAt = pastDate;

      await manager.checkExpiration(stored.businessId);

      expect(manager.getOrThrow(insight.id).status).toBe('expired');
    });

    it('should not expire insights that have not reached expiresAt', async () => {
      const scored = makeScoredInsight({ data: { businessId: 'biz-2' } });
      const insight = await manager.create(scored);

      await manager.checkExpiration(manager.getOrThrow(insight.id).businessId);

      expect(manager.getOrThrow(insight.id).status).toBe('active');
    });

    it('should not expire dismissed or resolved insights', async () => {
      const scored1 = makeScoredInsight({ data: { businessId: 'biz-3' } });
      const scored2 = makeScoredInsight({ data: { businessId: 'biz-3' } });

      const dismissed = await manager.create(scored1);
      const resolved = await manager.create(scored2);

      await manager.dismiss(dismissed.id, 'user-1', 'nope');
      await manager.acknowledge(resolved.id, 'user-1');
      await manager.resolve(resolved.id, 'user-1', 'done');

      // Set expiresAt to the past
      manager.getOrThrow(dismissed.id).expiresAt = new Date(Date.now() - 1000);
      manager.getOrThrow(resolved.id).expiresAt = new Date(Date.now() - 1000);

      await manager.checkExpiration('biz-3');

      expect(manager.getOrThrow(dismissed.id).status).toBe('dismissed');
      expect(manager.getOrThrow(resolved.id).status).toBe('resolved');
    });

    it('should only expire insights for the specified business', async () => {
      const scored1 = makeScoredInsight({ data: { businessId: 'biz-a' } });
      const scored2 = makeScoredInsight({ data: { businessId: 'biz-b' } });

      const insightA = await manager.create(scored1);
      const insightB = await manager.create(scored2);

      manager.getOrThrow(insightA.id).expiresAt = new Date(Date.now() - 1000);
      manager.getOrThrow(insightB.id).expiresAt = new Date(Date.now() - 1000);

      await manager.checkExpiration(manager.getOrThrow(insightA.id).businessId);

      expect(manager.getOrThrow(insightA.id).status).toBe('expired');
      expect(manager.getOrThrow(insightB.id).status).toBe('active');
    });
  });

  // ─── Invalid transition error codes ────────────────────────────────────

  describe('error codes', () => {
    it('should use INSIGHT_INVALID_TRANSITION for invalid transitions', async () => {
      const insight = await manager.create(makeScoredInsight());
      await manager.dismiss(insight.id, 'user-1', 'nope');

      try {
        await manager.acknowledge(insight.id, 'user-1');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(InsightLifecycleError);
        expect((err as InsightLifecycleError).code).toBe(INSIGHT_INVALID_TRANSITION);
      }
    });

    it('should throw for non-existent insight ID', async () => {
      await expect(manager.acknowledge('non-existent', 'user-1')).rejects.toThrow(
        InsightLifecycleError,
      );
    });
  });
});
