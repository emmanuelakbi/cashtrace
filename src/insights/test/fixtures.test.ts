import { describe, expect, it } from 'vitest';

import {
  makeActionItem,
  makeAnalysisContext,
  makeBusinessProfile,
  makeInsight,
  makeRawInsight,
  makeScoredInsight,
  makeTransaction,
} from './index.js';

describe('Insights test fixtures', () => {
  describe('makeBusinessProfile', () => {
    it('creates a profile with Nigerian defaults', () => {
      const profile = makeBusinessProfile();
      expect(profile.id).toBeDefined();
      expect(profile.sector).toBe('retail');
      expect(profile.state).toBe('Lagos');
      expect(Number.isInteger(profile.annualRevenueKobo)).toBe(true);
    });

    it('accepts partial overrides', () => {
      const profile = makeBusinessProfile({
        sector: 'technology',
        size: 'medium',
        vatRegistered: true,
      });
      expect(profile.sector).toBe('technology');
      expect(profile.size).toBe('medium');
      expect(profile.vatRegistered).toBe(true);
      expect(profile.state).toBe('Lagos'); // default preserved
    });
  });

  describe('makeTransaction', () => {
    it('creates a transaction with Kobo amounts', () => {
      const tx = makeTransaction();
      expect(tx.id).toBeDefined();
      expect(Number.isInteger(tx.amountKobo)).toBe(true);
      expect(tx.amountKobo).toBe(250_000_00);
    });

    it('accepts partial overrides', () => {
      const tx = makeTransaction({ type: 'debit', amountKobo: 50_000_00 });
      expect(tx.type).toBe('debit');
      expect(tx.amountKobo).toBe(50_000_00);
    });
  });

  describe('makeInsight', () => {
    it('creates an insight with all required fields', () => {
      const insight = makeInsight();
      expect(insight.id).toBeDefined();
      expect(insight.category).toBe('tax');
      expect(insight.status).toBe('active');
      expect(insight.priority).toBe('high');
      expect(Number.isInteger(insight.financialImpactKobo)).toBe(true);
      expect(insight.acknowledgedAt).toBeNull();
      expect(insight.dismissedAt).toBeNull();
      expect(insight.resolvedAt).toBeNull();
      expect(insight.actionItems.length).toBeGreaterThan(0);
    });

    it('accepts partial overrides', () => {
      const insight = makeInsight({
        category: 'compliance',
        priority: 'critical',
        status: 'acknowledged',
      });
      expect(insight.category).toBe('compliance');
      expect(insight.priority).toBe('critical');
      expect(insight.status).toBe('acknowledged');
    });
  });

  describe('makeRawInsight', () => {
    it('creates a raw insight with scoring inputs', () => {
      const raw = makeRawInsight();
      expect(raw.category).toBe('cashflow');
      expect(raw.urgency).toBeGreaterThanOrEqual(0);
      expect(raw.urgency).toBeLessThanOrEqual(100);
      expect(raw.confidence).toBeGreaterThanOrEqual(0);
      expect(raw.confidence).toBeLessThanOrEqual(100);
      expect(Number.isInteger(raw.financialImpact)).toBe(true);
    });
  });

  describe('makeScoredInsight', () => {
    it('creates a scored insight with priority and factors', () => {
      const scored = makeScoredInsight();
      expect(scored.score).toBeDefined();
      expect(scored.priority).toBeDefined();
      expect(scored.factors.length).toBeGreaterThan(0);
      expect(scored.factors.every((f) => f.weight > 0)).toBe(true);
    });

    it('accepts partial overrides including raw fields', () => {
      const scored = makeScoredInsight({ category: 'tax', score: 95 });
      expect(scored.category).toBe('tax');
      expect(scored.score).toBe(95);
    });
  });

  describe('makeAnalysisContext', () => {
    it('creates a context with linked business data', () => {
      const ctx = makeAnalysisContext();
      expect(ctx.businessId).toBeDefined();
      expect(ctx.businessProfile.id).toBe(ctx.businessId);
      expect(ctx.transactions.length).toBe(3);
      expect(ctx.dateRange.start < ctx.dateRange.end).toBe(true);
      expect(ctx.previousInsights).toEqual([]);
    });

    it('propagates businessId to nested objects', () => {
      const businessId = 'test-biz-123';
      const ctx = makeAnalysisContext({ businessId });
      expect(ctx.businessProfile.id).toBe(businessId);
      expect(ctx.transactions.every((tx) => tx.businessId === businessId)).toBe(true);
    });
  });

  describe('makeActionItem', () => {
    it('creates an action item with defaults', () => {
      const item = makeActionItem();
      expect(item.id).toBeDefined();
      expect(item.actionType).toBe('external_link');
      expect(item.completed).toBe(false);
    });
  });
});
