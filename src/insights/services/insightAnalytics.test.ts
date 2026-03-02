/**
 * Unit tests for InsightAnalytics.
 *
 * **Validates: Requirements 13.1, 13.2, 13.3, 13.4**
 *
 * @module insights/services/insightAnalytics.test
 */

import { describe, expect, it, beforeEach } from 'vitest';

import { makeInsight } from '../test/fixtures.js';

import { InsightAnalytics } from './insightAnalytics.js';

describe('InsightAnalytics', () => {
  let analytics: InsightAnalytics;

  beforeEach(() => {
    analytics = new InsightAnalytics();
  });

  // ─── Generation Counts (Requirement 13.1) ──────────────────────────────

  describe('calculateGenerationCounts', () => {
    it('should return zero counts for empty insights', () => {
      const counts = analytics.calculateGenerationCounts([]);

      expect(counts.total).toBe(0);
      expect(counts.byCategory['tax']).toBe(0);
      expect(counts.byPriority['critical']).toBe(0);
    });

    it('should count insights by category', () => {
      const insights = [
        makeInsight({ category: 'tax' }),
        makeInsight({ category: 'tax' }),
        makeInsight({ category: 'cashflow' }),
        makeInsight({ category: 'compliance' }),
      ];

      const counts = analytics.calculateGenerationCounts(insights);

      expect(counts.byCategory['tax']).toBe(2);
      expect(counts.byCategory['cashflow']).toBe(1);
      expect(counts.byCategory['compliance']).toBe(1);
      expect(counts.byCategory['spending']).toBe(0);
      expect(counts.total).toBe(4);
    });

    it('should count insights by priority', () => {
      const insights = [
        makeInsight({ priority: 'critical' }),
        makeInsight({ priority: 'high' }),
        makeInsight({ priority: 'high' }),
        makeInsight({ priority: 'low' }),
      ];

      const counts = analytics.calculateGenerationCounts(insights);

      expect(counts.byPriority['critical']).toBe(1);
      expect(counts.byPriority['high']).toBe(2);
      expect(counts.byPriority['low']).toBe(1);
      expect(counts.byPriority['medium']).toBe(0);
    });

    it('should count by category and priority combined', () => {
      const insights = [
        makeInsight({ category: 'tax', priority: 'high' }),
        makeInsight({ category: 'tax', priority: 'critical' }),
        makeInsight({ category: 'cashflow', priority: 'high' }),
      ];

      const counts = analytics.calculateGenerationCounts(insights);

      expect(counts.byCategoryAndPriority['tax']['high']).toBe(1);
      expect(counts.byCategoryAndPriority['tax']['critical']).toBe(1);
      expect(counts.byCategoryAndPriority['cashflow']['high']).toBe(1);
      expect(counts.byCategoryAndPriority['cashflow']['critical']).toBe(0);
    });
  });

  // ─── Engagement Rates (Requirement 13.2) ─────────────────────────────────

  describe('calculateEngagementRates', () => {
    it('should return zero rates for empty insights', () => {
      const rates = analytics.calculateEngagementRates([]);

      expect(rates.viewRate).toBe(0);
      expect(rates.acknowledgeRate).toBe(0);
      expect(rates.dismissRate).toBe(0);
      expect(rates.resolveRate).toBe(0);
      expect(rates.totalInsights).toBe(0);
    });

    it('should calculate acknowledge rate from insight statuses', () => {
      const insights = [
        makeInsight({ status: 'active' }),
        makeInsight({ status: 'acknowledged' }),
        makeInsight({ status: 'acknowledged' }),
        makeInsight({ status: 'active' }),
      ];

      const rates = analytics.calculateEngagementRates(insights);

      expect(rates.acknowledgeRate).toBe(0.5);
      expect(rates.acknowledged).toBe(2);
    });

    it('should calculate dismiss rate', () => {
      const insights = [
        makeInsight({ status: 'active' }),
        makeInsight({ status: 'dismissed' }),
        makeInsight({ status: 'active' }),
        makeInsight({ status: 'active' }),
      ];

      const rates = analytics.calculateEngagementRates(insights);

      expect(rates.dismissRate).toBe(0.25);
      expect(rates.dismissed).toBe(1);
    });

    it('should calculate resolve rate', () => {
      const insights = [
        makeInsight({ status: 'resolved' }),
        makeInsight({ status: 'resolved' }),
        makeInsight({ status: 'active' }),
        makeInsight({ status: 'active' }),
      ];

      const rates = analytics.calculateEngagementRates(insights);

      expect(rates.resolveRate).toBe(0.5);
      expect(rates.resolved).toBe(2);
    });

    it('should count resolved insights as acknowledged too', () => {
      const insights = [makeInsight({ status: 'resolved' }), makeInsight({ status: 'active' })];

      const rates = analytics.calculateEngagementRates(insights);

      // Resolved implies acknowledged
      expect(rates.acknowledgeRate).toBe(0.5);
      expect(rates.resolveRate).toBe(0.5);
    });

    it('should track view rate from recorded views', () => {
      const insight1 = makeInsight({ status: 'active' });
      const insight2 = makeInsight({ status: 'active' });
      const insight3 = makeInsight({ status: 'active' });

      analytics.recordView(insight1.id);
      analytics.recordView(insight2.id);

      const rates = analytics.calculateEngagementRates([insight1, insight2, insight3]);

      expect(rates.viewRate).toBeCloseTo(2 / 3);
      expect(rates.viewed).toBe(2);
    });
  });

  // ─── Resolution Times (Requirement 13.3) ─────────────────────────────────

  describe('calculateResolutionTimes', () => {
    it('should return empty map for no resolved insights', () => {
      const insights = [makeInsight({ status: 'active' }), makeInsight({ status: 'acknowledged' })];

      const times = analytics.calculateResolutionTimes(insights);

      expect(times.size).toBe(0);
    });

    it('should calculate resolution time for resolved insights', () => {
      const createdAt = new Date('2024-01-01T06:00:00+01:00');
      const resolvedAt = new Date('2024-01-03T06:00:00+01:00'); // 2 days later

      const insights = [
        makeInsight({
          type: 'vat_liability',
          status: 'resolved',
          createdAt,
          resolvedAt,
          resolvedBy: 'user-1',
        }),
      ];

      const times = analytics.calculateResolutionTimes(insights);

      expect(times.has('vat_liability')).toBe(true);
      const stats = times.get('vat_liability')!;
      expect(stats.count).toBe(1);
      expect(stats.averageMs).toBe(2 * 24 * 60 * 60 * 1000); // 2 days in ms
    });

    it('should calculate average across multiple resolved insights of same type', () => {
      const base = new Date('2024-01-01T06:00:00+01:00');
      const oneDay = 24 * 60 * 60 * 1000;

      const insights = [
        makeInsight({
          type: 'cashflow_risk',
          status: 'resolved',
          createdAt: base,
          resolvedAt: new Date(base.getTime() + oneDay), // 1 day
          resolvedBy: 'user-1',
        }),
        makeInsight({
          type: 'cashflow_risk',
          status: 'resolved',
          createdAt: base,
          resolvedAt: new Date(base.getTime() + 3 * oneDay), // 3 days
          resolvedBy: 'user-1',
        }),
      ];

      const times = analytics.calculateResolutionTimes(insights);
      const stats = times.get('cashflow_risk')!;

      expect(stats.count).toBe(2);
      expect(stats.averageMs).toBe(2 * oneDay); // average of 1 and 3 days
      expect(stats.minMs).toBe(oneDay);
      expect(stats.maxMs).toBe(3 * oneDay);
    });

    it('should group resolution times by insight type', () => {
      const base = new Date('2024-01-01T06:00:00+01:00');
      const oneHour = 60 * 60 * 1000;

      const insights = [
        makeInsight({
          type: 'vat_liability',
          status: 'resolved',
          createdAt: base,
          resolvedAt: new Date(base.getTime() + 2 * oneHour),
          resolvedBy: 'user-1',
        }),
        makeInsight({
          type: 'compliance_deadline',
          status: 'resolved',
          createdAt: base,
          resolvedAt: new Date(base.getTime() + 5 * oneHour),
          resolvedBy: 'user-1',
        }),
      ];

      const times = analytics.calculateResolutionTimes(insights);

      expect(times.size).toBe(2);
      expect(times.get('vat_liability')!.averageMs).toBe(2 * oneHour);
      expect(times.get('compliance_deadline')!.averageMs).toBe(5 * oneHour);
    });
  });

  // ─── Accuracy (Requirement 13.4) ──────────────────────────────────────────

  describe('calculateAccuracy', () => {
    it('should return zero accuracy for no feedback', () => {
      const accuracy = analytics.calculateAccuracy();

      expect(accuracy.totalFeedback).toBe(0);
      expect(accuracy.accuracyRate).toBe(0);
    });

    it('should calculate accuracy from positive and negative feedback', () => {
      analytics.recordFeedback({
        insightId: 'ins-1',
        businessId: 'biz-1',
        category: 'tax',
        type: 'vat_liability',
        positive: true,
        timestamp: new Date(),
      });
      analytics.recordFeedback({
        insightId: 'ins-2',
        businessId: 'biz-1',
        category: 'cashflow',
        type: 'cashflow_risk',
        positive: true,
        timestamp: new Date(),
      });
      analytics.recordFeedback({
        insightId: 'ins-3',
        businessId: 'biz-1',
        category: 'spending',
        type: 'personal_spending',
        positive: false,
        timestamp: new Date(),
      });

      const accuracy = analytics.calculateAccuracy();

      expect(accuracy.totalFeedback).toBe(3);
      expect(accuracy.positiveFeedback).toBe(2);
      expect(accuracy.negativeFeedback).toBe(1);
      expect(accuracy.accuracyRate).toBeCloseTo(2 / 3);
    });

    it('should filter accuracy by business ID', () => {
      analytics.recordFeedback({
        insightId: 'ins-1',
        businessId: 'biz-1',
        category: 'tax',
        type: 'vat_liability',
        positive: true,
        timestamp: new Date(),
      });
      analytics.recordFeedback({
        insightId: 'ins-2',
        businessId: 'biz-2',
        category: 'cashflow',
        type: 'cashflow_risk',
        positive: false,
        timestamp: new Date(),
      });

      const biz1Accuracy = analytics.calculateAccuracy('biz-1');
      const biz2Accuracy = analytics.calculateAccuracy('biz-2');

      expect(biz1Accuracy.accuracyRate).toBe(1);
      expect(biz1Accuracy.totalFeedback).toBe(1);
      expect(biz2Accuracy.accuracyRate).toBe(0);
      expect(biz2Accuracy.totalFeedback).toBe(1);
    });
  });

  // ─── Snapshot ─────────────────────────────────────────────────────────────

  describe('buildSnapshot', () => {
    it('should build a complete analytics snapshot', () => {
      const periodStart = new Date('2024-01-01T00:00:00+01:00');
      const periodEnd = new Date('2024-01-31T23:59:59+01:00');

      const insights = [
        makeInsight({
          category: 'tax',
          priority: 'high',
          status: 'resolved',
          createdAt: new Date('2024-01-05T06:00:00+01:00'),
          resolvedAt: new Date('2024-01-07T06:00:00+01:00'),
          resolvedBy: 'user-1',
        }),
        makeInsight({ category: 'cashflow', priority: 'critical', status: 'active' }),
        makeInsight({ category: 'tax', priority: 'medium', status: 'dismissed' }),
      ];

      analytics.recordView(insights[0].id);
      analytics.recordFeedback({
        insightId: insights[0].id,
        businessId: insights[0].businessId,
        category: 'tax',
        type: 'vat_liability',
        positive: true,
        timestamp: new Date(),
      });

      const snapshot = analytics.buildSnapshot(insights, periodStart, periodEnd);

      expect(snapshot.generationCounts.total).toBe(3);
      expect(snapshot.generationCounts.byCategory['tax']).toBe(2);
      expect(snapshot.engagementRates.totalInsights).toBe(3);
      expect(snapshot.engagementRates.viewed).toBe(1);
      expect(snapshot.accuracy.totalFeedback).toBe(1);
      expect(snapshot.accuracy.accuracyRate).toBe(1);
      expect(snapshot.periodStart).toBe(periodStart);
      expect(snapshot.periodEnd).toBe(periodEnd);
    });
  });

  // ─── View & Feedback Tracking ─────────────────────────────────────────────

  describe('recordView', () => {
    it('should track unique views', () => {
      analytics.recordView('ins-1');
      analytics.recordView('ins-1'); // duplicate
      analytics.recordView('ins-2');

      expect(analytics.viewCount).toBe(2);
    });
  });

  describe('recordFeedback', () => {
    it('should accumulate feedback entries', () => {
      analytics.recordFeedback({
        insightId: 'ins-1',
        businessId: 'biz-1',
        category: 'tax',
        type: 'vat_liability',
        positive: true,
        timestamp: new Date(),
      });

      expect(analytics.feedbackCount).toBe(1);
    });
  });
});
