import { describe, it, expect, beforeEach } from 'vitest';

import { createAnalyticsTracker } from './analyticsTracker.js';
import type { AnalyticsTracker } from './analyticsTracker.js';

describe('analyticsTracker', () => {
  let tracker: AnalyticsTracker;

  beforeEach(() => {
    tracker = createAnalyticsTracker();
  });

  describe('recordSend', () => {
    it('should increment send count for a channel+category', () => {
      tracker.recordSend('email', 'security');
      tracker.recordSend('email', 'security');

      const stats = tracker.getStats('email', 'security');
      expect(stats.sent).toBe(2);
    });

    it('should track sends independently per channel+category', () => {
      tracker.recordSend('email', 'security');
      tracker.recordSend('push', 'transactions');

      expect(tracker.getStats('email', 'security').sent).toBe(1);
      expect(tracker.getStats('push', 'transactions').sent).toBe(1);
    });
  });

  describe('recordDelivery', () => {
    it('should increment delivery count', () => {
      tracker.recordDelivery('email', 'insights');
      expect(tracker.getStats('email', 'insights').delivered).toBe(1);
    });
  });

  describe('recordOpen', () => {
    it('should increment open count for email opens', () => {
      tracker.recordOpen('email', 'marketing');
      expect(tracker.getStats('email', 'marketing').opened).toBe(1);
    });

    it('should increment open count for push interactions', () => {
      tracker.recordOpen('push', 'system');
      expect(tracker.getStats('push', 'system').opened).toBe(1);
    });
  });

  describe('recordClick', () => {
    it('should increment click count for email clicks', () => {
      tracker.recordClick('email', 'compliance');
      expect(tracker.getStats('email', 'compliance').clicked).toBe(1);
    });
  });

  describe('recordRead', () => {
    it('should increment read count for in-app reads', () => {
      tracker.recordRead('in_app', 'transactions');
      expect(tracker.getStats('in_app', 'transactions').read).toBe(1);
    });
  });

  describe('recordBounce', () => {
    it('should increment bounce count', () => {
      tracker.recordBounce('email', 'marketing');
      expect(tracker.getStats('email', 'marketing').bounced).toBe(1);
    });
  });

  describe('getStats', () => {
    it('should return zero stats when no data recorded', () => {
      const stats = tracker.getStats();
      expect(stats).toEqual({
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        read: 0,
        bounced: 0,
      });
    });

    it('should aggregate all stats when no filter provided', () => {
      tracker.recordSend('email', 'security');
      tracker.recordSend('push', 'transactions');
      tracker.recordDelivery('email', 'security');

      const stats = tracker.getStats();
      expect(stats.sent).toBe(2);
      expect(stats.delivered).toBe(1);
    });

    it('should filter by channel only', () => {
      tracker.recordSend('email', 'security');
      tracker.recordSend('email', 'transactions');
      tracker.recordSend('push', 'security');

      const stats = tracker.getStats('email');
      expect(stats.sent).toBe(2);
    });

    it('should filter by category only', () => {
      tracker.recordSend('email', 'security');
      tracker.recordSend('push', 'security');
      tracker.recordSend('email', 'transactions');

      const stats = tracker.getStats(undefined, 'security');
      expect(stats.sent).toBe(2);
    });

    it('should filter by both channel and category', () => {
      tracker.recordSend('email', 'security');
      tracker.recordSend('email', 'transactions');
      tracker.recordSend('push', 'security');

      const stats = tracker.getStats('email', 'security');
      expect(stats.sent).toBe(1);
    });
  });

  describe('getDeliveryRate', () => {
    it('should return 0 when no sends recorded', () => {
      expect(tracker.getDeliveryRate()).toBe(0);
    });

    it('should calculate delivered/sent ratio', () => {
      tracker.recordSend('email', 'security');
      tracker.recordSend('email', 'security');
      tracker.recordDelivery('email', 'security');

      expect(tracker.getDeliveryRate('email', 'security')).toBe(0.5);
    });

    it('should return 1 when all sent are delivered', () => {
      tracker.recordSend('email', 'security');
      tracker.recordDelivery('email', 'security');

      expect(tracker.getDeliveryRate('email', 'security')).toBe(1);
    });
  });

  describe('getOpenRate', () => {
    it('should return 0 when no deliveries recorded', () => {
      expect(tracker.getOpenRate()).toBe(0);
    });

    it('should calculate opened/delivered ratio', () => {
      tracker.recordDelivery('email', 'marketing');
      tracker.recordDelivery('email', 'marketing');
      tracker.recordOpen('email', 'marketing');

      expect(tracker.getOpenRate('email', 'marketing')).toBe(0.5);
    });
  });

  describe('getClickRate', () => {
    it('should return 0 when no opens recorded', () => {
      expect(tracker.getClickRate()).toBe(0);
    });

    it('should calculate clicked/opened ratio', () => {
      tracker.recordOpen('email', 'marketing');
      tracker.recordOpen('email', 'marketing');
      tracker.recordClick('email', 'marketing');

      expect(tracker.getClickRate('email', 'marketing')).toBe(0.5);
    });
  });

  describe('getReadRate', () => {
    it('should return 0 when no deliveries recorded', () => {
      expect(tracker.getReadRate()).toBe(0);
    });

    it('should calculate read/delivered ratio for in-app', () => {
      tracker.recordDelivery('in_app', 'transactions');
      tracker.recordDelivery('in_app', 'transactions');
      tracker.recordRead('in_app', 'transactions');

      expect(tracker.getReadRate('in_app', 'transactions')).toBe(0.5);
    });
  });

  describe('resetStats', () => {
    it('should clear all tracked stats', () => {
      tracker.recordSend('email', 'security');
      tracker.recordDelivery('email', 'security');
      tracker.recordOpen('email', 'security');

      tracker.resetStats();

      const stats = tracker.getStats();
      expect(stats).toEqual({
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        read: 0,
        bounced: 0,
      });
    });
  });
});
