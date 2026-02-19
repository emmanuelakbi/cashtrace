/**
 * Log Retention Policy Manager
 *
 * Classifies log entries into hot/cold storage tiers and determines
 * archive and deletion eligibility based on configurable retention periods.
 *
 * Requirements: 8.2 (support log retention policies - 30 days hot, 1 year cold)
 *
 * @module logging/retention
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RetentionTier {
  /** Tier name */
  name: 'hot' | 'cold';
  /** Duration in milliseconds */
  durationMs: number;
}

export interface RetentionConfig {
  /** Hot storage duration in days (default: 30) */
  hotDays: number;
  /** Cold storage duration in days (default: 365) */
  coldDays: number;
  /** Whether to flag archived logs for compression (default: true) */
  compressArchived: boolean;
}

export type StorageTier = 'hot' | 'cold' | 'expired';

export interface RetentionClassification {
  tier: StorageTier;
  ageMs: number;
  shouldArchive: boolean;
  shouldDelete: boolean;
  compressed: boolean;
}

export interface RetentionManager {
  /** Classify a single log entry by its timestamp */
  classify(entryTimestamp: Date, now?: Date): RetentionClassification;
  /** Filter entries eligible for archival (hot → cold) */
  getArchivable<T extends { timestamp: string }>(entries: T[], now?: Date): T[];
  /** Filter entries eligible for deletion (expired cold) */
  getDeletable<T extends { timestamp: string }>(entries: T[], now?: Date): T[];
  /** Current retention config */
  config: Readonly<RetentionConfig>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysToMs(days: number): number {
  return days * MS_PER_DAY;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createRetentionManager(overrides: Partial<RetentionConfig> = {}): RetentionManager {
  const config: RetentionConfig = {
    hotDays: overrides.hotDays ?? 30,
    coldDays: overrides.coldDays ?? 365,
    compressArchived: overrides.compressArchived ?? true,
  };

  const hotMs = daysToMs(config.hotDays);
  const totalMs = hotMs + daysToMs(config.coldDays);

  function classify(entryTimestamp: Date, now?: Date): RetentionClassification {
    const ref = now ?? new Date();
    const ageMs = ref.getTime() - entryTimestamp.getTime();

    if (ageMs < hotMs) {
      return { tier: 'hot', ageMs, shouldArchive: false, shouldDelete: false, compressed: false };
    }

    if (ageMs < totalMs) {
      return {
        tier: 'cold',
        ageMs,
        shouldArchive: true,
        shouldDelete: false,
        compressed: config.compressArchived,
      };
    }

    return { tier: 'expired', ageMs, shouldArchive: false, shouldDelete: true, compressed: false };
  }

  function getArchivable<T extends { timestamp: string }>(entries: T[], now?: Date): T[] {
    const ref = now ?? new Date();
    return entries.filter((e) => {
      const c = classify(new Date(e.timestamp), ref);
      return c.shouldArchive;
    });
  }

  function getDeletable<T extends { timestamp: string }>(entries: T[], now?: Date): T[] {
    const ref = now ?? new Date();
    return entries.filter((e) => {
      const c = classify(new Date(e.timestamp), ref);
      return c.shouldDelete;
    });
  }

  return { classify, getArchivable, getDeletable, config };
}
