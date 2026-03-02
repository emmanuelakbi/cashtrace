/**
 * Analytics Tracker - Tracks notification send volume, delivery rates,
 * open rates, click rates, read rates, and bounce rates.
 *
 * Uses an in-memory store for fast aggregation. Stats can be filtered
 * by channel and/or category.
 *
 * @module notifications/services/analyticsTracker
 */

import type { NotificationCategory, NotificationChannel } from '../types/index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Aggregated stats for a channel+category combination. */
export interface AnalyticsStats {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  read: number;
  bounced: number;
}

/** Analytics tracker for notification metrics. */
export interface AnalyticsTracker {
  recordSend(channel: NotificationChannel, category: NotificationCategory): void;
  recordDelivery(channel: NotificationChannel, category: NotificationCategory): void;
  recordOpen(channel: NotificationChannel, category: NotificationCategory): void;
  recordClick(channel: NotificationChannel, category: NotificationCategory): void;
  recordRead(channel: NotificationChannel, category: NotificationCategory): void;
  recordBounce(channel: NotificationChannel, category: NotificationCategory): void;
  getStats(channel?: NotificationChannel, category?: NotificationCategory): AnalyticsStats;
  getDeliveryRate(channel?: NotificationChannel, category?: NotificationCategory): number;
  getOpenRate(channel?: NotificationChannel, category?: NotificationCategory): number;
  getClickRate(channel?: NotificationChannel, category?: NotificationCategory): number;
  getReadRate(channel?: NotificationChannel, category?: NotificationCategory): number;
  resetStats(): void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeKey(channel: NotificationChannel, category: NotificationCategory): string {
  return `${channel}:${category}`;
}

function emptyStats(): AnalyticsStats {
  return { sent: 0, delivered: 0, opened: 0, clicked: 0, read: 0, bounced: 0 };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create an analytics tracker with an in-memory store.
 *
 * Tracks send volume, delivery rates, open rates, click rates,
 * read rates, and bounce rates by channel and category.
 */
export function createAnalyticsTracker(): AnalyticsTracker {
  const store = new Map<string, AnalyticsStats>();

  function getOrCreate(
    channel: NotificationChannel,
    category: NotificationCategory,
  ): AnalyticsStats {
    const key = makeKey(channel, category);
    let stats = store.get(key);
    if (!stats) {
      stats = emptyStats();
      store.set(key, stats);
    }
    return stats;
  }

  function aggregate(
    channel?: NotificationChannel,
    category?: NotificationCategory,
  ): AnalyticsStats {
    const result = emptyStats();

    for (const [key, stats] of store) {
      const [ch, cat] = key.split(':') as [NotificationChannel, NotificationCategory];
      if (channel && ch !== channel) continue;
      if (category && cat !== category) continue;

      result.sent += stats.sent;
      result.delivered += stats.delivered;
      result.opened += stats.opened;
      result.clicked += stats.clicked;
      result.read += stats.read;
      result.bounced += stats.bounced;
    }

    return result;
  }

  function safeRate(numerator: number, denominator: number): number {
    return denominator === 0 ? 0 : numerator / denominator;
  }

  function increment(
    channel: NotificationChannel,
    category: NotificationCategory,
    field: keyof AnalyticsStats,
  ): void {
    const stats = getOrCreate(channel, category);
    stats[field]++;
  }

  return {
    recordSend(channel, category): void {
      increment(channel, category, 'sent');
    },

    recordDelivery(channel, category): void {
      increment(channel, category, 'delivered');
    },

    recordOpen(channel, category): void {
      increment(channel, category, 'opened');
    },

    recordClick(channel, category): void {
      increment(channel, category, 'clicked');
    },

    recordRead(channel, category): void {
      increment(channel, category, 'read');
    },

    recordBounce(channel, category): void {
      increment(channel, category, 'bounced');
    },

    getStats(channel?, category?): AnalyticsStats {
      return aggregate(channel, category);
    },

    getDeliveryRate(channel?, category?): number {
      const stats = aggregate(channel, category);
      return safeRate(stats.delivered, stats.sent);
    },

    getOpenRate(channel?, category?): number {
      const stats = aggregate(channel, category);
      return safeRate(stats.opened, stats.delivered);
    },

    getClickRate(channel?, category?): number {
      const stats = aggregate(channel, category);
      return safeRate(stats.clicked, stats.opened);
    },

    getReadRate(channel?, category?): number {
      const stats = aggregate(channel, category);
      return safeRate(stats.read, stats.delivered);
    },

    resetStats(): void {
      store.clear();
    },
  };
}
