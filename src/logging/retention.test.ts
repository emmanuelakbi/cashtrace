import { describe, it, expect } from 'vitest';
import { createRetentionManager } from './retention.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number, ref: Date = new Date('2024-06-15T00:00:00.000Z')): Date {
  return new Date(ref.getTime() - days * MS_PER_DAY);
}

const NOW = new Date('2024-06-15T00:00:00.000Z');

describe('RetentionManager', () => {
  describe('classify', () => {
    it('classifies recent entries as hot', () => {
      const mgr = createRetentionManager();
      const result = mgr.classify(daysAgo(5, NOW), NOW);
      expect(result.tier).toBe('hot');
      expect(result.shouldArchive).toBe(false);
      expect(result.shouldDelete).toBe(false);
      expect(result.compressed).toBe(false);
    });

    it('classifies entries older than 30 days as cold', () => {
      const mgr = createRetentionManager();
      const result = mgr.classify(daysAgo(60, NOW), NOW);
      expect(result.tier).toBe('cold');
      expect(result.shouldArchive).toBe(true);
      expect(result.shouldDelete).toBe(false);
      expect(result.compressed).toBe(true);
    });

    it('classifies entries older than 30 + 365 days as expired', () => {
      const mgr = createRetentionManager();
      const result = mgr.classify(daysAgo(400, NOW), NOW);
      expect(result.tier).toBe('expired');
      expect(result.shouldArchive).toBe(false);
      expect(result.shouldDelete).toBe(true);
    });

    it('uses default config of 30 hot / 365 cold', () => {
      const mgr = createRetentionManager();
      expect(mgr.config.hotDays).toBe(30);
      expect(mgr.config.coldDays).toBe(365);
      expect(mgr.config.compressArchived).toBe(true);
    });
  });

  describe('boundary cases', () => {
    it('entry exactly at hot boundary is still hot', () => {
      const mgr = createRetentionManager();
      // Age = 29.999... days → hot
      const almostBoundary = new Date(NOW.getTime() - 30 * MS_PER_DAY + 1);
      const result = mgr.classify(almostBoundary, NOW);
      expect(result.tier).toBe('hot');
    });

    it('entry exactly at hot duration is cold', () => {
      const mgr = createRetentionManager();
      const exactBoundary = new Date(NOW.getTime() - 30 * MS_PER_DAY);
      const result = mgr.classify(exactBoundary, NOW);
      expect(result.tier).toBe('cold');
    });

    it('entry exactly at total retention is expired', () => {
      const mgr = createRetentionManager();
      const exactExpiry = new Date(NOW.getTime() - (30 + 365) * MS_PER_DAY);
      const result = mgr.classify(exactExpiry, NOW);
      expect(result.tier).toBe('expired');
    });

    it('entry 1ms before total retention is cold', () => {
      const mgr = createRetentionManager();
      const justBefore = new Date(NOW.getTime() - (30 + 365) * MS_PER_DAY + 1);
      const result = mgr.classify(justBefore, NOW);
      expect(result.tier).toBe('cold');
    });
  });

  describe('custom retention periods', () => {
    it('supports custom hot/cold durations', () => {
      const mgr = createRetentionManager({ hotDays: 7, coldDays: 90 });
      expect(mgr.config.hotDays).toBe(7);
      expect(mgr.config.coldDays).toBe(90);

      const result = mgr.classify(daysAgo(10, NOW), NOW);
      expect(result.tier).toBe('cold');

      const expired = mgr.classify(daysAgo(100, NOW), NOW);
      expect(expired.tier).toBe('expired');
    });

    it('supports disabling compression', () => {
      const mgr = createRetentionManager({ compressArchived: false });
      const result = mgr.classify(daysAgo(60, NOW), NOW);
      expect(result.tier).toBe('cold');
      expect(result.compressed).toBe(false);
    });
  });

  describe('getArchivable', () => {
    it('returns entries eligible for archival', () => {
      const mgr = createRetentionManager();
      const entries = [
        { timestamp: daysAgo(5, NOW).toISOString(), id: 'hot' },
        { timestamp: daysAgo(60, NOW).toISOString(), id: 'cold' },
        { timestamp: daysAgo(400, NOW).toISOString(), id: 'expired' },
      ];
      const archivable = mgr.getArchivable(entries, NOW);
      expect(archivable).toHaveLength(1);
      expect(archivable[0].id).toBe('cold');
    });

    it('returns empty array when no entries are archivable', () => {
      const mgr = createRetentionManager();
      const entries = [{ timestamp: daysAgo(5, NOW).toISOString(), id: 'hot' }];
      expect(mgr.getArchivable(entries, NOW)).toHaveLength(0);
    });

    it('handles empty collections', () => {
      const mgr = createRetentionManager();
      expect(mgr.getArchivable([], NOW)).toEqual([]);
    });
  });

  describe('getDeletable', () => {
    it('returns entries eligible for deletion', () => {
      const mgr = createRetentionManager();
      const entries = [
        { timestamp: daysAgo(5, NOW).toISOString(), id: 'hot' },
        { timestamp: daysAgo(60, NOW).toISOString(), id: 'cold' },
        { timestamp: daysAgo(400, NOW).toISOString(), id: 'expired' },
      ];
      const deletable = mgr.getDeletable(entries, NOW);
      expect(deletable).toHaveLength(1);
      expect(deletable[0].id).toBe('expired');
    });

    it('returns empty array when no entries are deletable', () => {
      const mgr = createRetentionManager();
      const entries = [{ timestamp: daysAgo(5, NOW).toISOString(), id: 'hot' }];
      expect(mgr.getDeletable(entries, NOW)).toHaveLength(0);
    });

    it('handles empty collections', () => {
      const mgr = createRetentionManager();
      expect(mgr.getDeletable([], NOW)).toEqual([]);
    });
  });

  describe('ageMs tracking', () => {
    it('reports correct age in milliseconds', () => {
      const mgr = createRetentionManager();
      const tenDaysMs = 10 * MS_PER_DAY;
      const result = mgr.classify(daysAgo(10, NOW), NOW);
      expect(result.ageMs).toBe(tenDaysMs);
    });
  });
});
