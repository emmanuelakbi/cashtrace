/**
 * Property-based tests for Log Retention Compliance (Property 7).
 * Validates: Requirements 8.2
 *
 * Verifies that log entries are classified into the correct storage tier
 * (hot / cold / expired) based on their age relative to the configured
 * retention periods.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createRetentionManager } from './retention';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Fixed reference point to avoid flaky edge cases around Date.now()
const NOW = new Date('2025-01-15T12:00:00Z');

describe('Property 7: Log Retention Compliance', () => {
  const manager = createRetentionManager(); // defaults: 30 hot, 365 cold

  // ── 1. Hot entries: younger than hotDays ──────────────────────────────────

  it('entries younger than hotDays are classified as hot and not archived or deleted', () => {
    fc.assert(
      fc.property(
        // age in [0, 30 days) expressed as fraction of hot period
        fc.double({ min: 0, max: 1 - 1e-9, noNaN: true, noDefaultInfinity: true }),
        (fraction) => {
          const ageMs = fraction * 30 * MS_PER_DAY;
          const entryDate = new Date(NOW.getTime() - ageMs);
          const result = manager.classify(entryDate, NOW);

          expect(result.tier).toBe('hot');
          expect(result.shouldArchive).toBe(false);
          expect(result.shouldDelete).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  // ── 2. Cold entries: between hotDays and hotDays+coldDays ─────────────────

  it('entries between hotDays and hotDays+coldDays are classified as cold and marked for archival', () => {
    fc.assert(
      fc.property(
        // age in [30 days, 395 days) — use a safe margin to avoid fp boundary issues
        fc.double({ min: 30, max: 394.99, noNaN: true, noDefaultInfinity: true }),
        (ageDays) => {
          const entryDate = new Date(NOW.getTime() - ageDays * MS_PER_DAY);
          const result = manager.classify(entryDate, NOW);

          expect(result.tier).toBe('cold');
          expect(result.shouldArchive).toBe(true);
          expect(result.shouldDelete).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  // ── 3. Expired entries: older than hotDays+coldDays ───────────────────────

  it('entries older than hotDays+coldDays are classified as expired and marked for deletion', () => {
    fc.assert(
      fc.property(
        // age in [395 days, 3000 days]
        fc.double({ min: 395, max: 3000, noNaN: true, noDefaultInfinity: true }),
        (ageDays) => {
          const entryDate = new Date(NOW.getTime() - ageDays * MS_PER_DAY);
          const result = manager.classify(entryDate, NOW);

          expect(result.tier).toBe('expired');
          expect(result.shouldArchive).toBe(false);
          expect(result.shouldDelete).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  // ── 4. Classification depends only on age, not specific timestamp ─────────

  it('classification is consistent regardless of the specific timestamp (only age matters)', () => {
    fc.assert(
      fc.property(
        // Two different "now" reference points
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
        // Same age offset in days
        fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }),
        (now1, now2, ageDays) => {
          const entry1 = new Date(now1.getTime() - ageDays * MS_PER_DAY);
          const entry2 = new Date(now2.getTime() - ageDays * MS_PER_DAY);

          const r1 = manager.classify(entry1, now1);
          const r2 = manager.classify(entry2, now2);

          expect(r1.tier).toBe(r2.tier);
          expect(r1.shouldArchive).toBe(r2.shouldArchive);
          expect(r1.shouldDelete).toBe(r2.shouldDelete);
        },
      ),
      { numRuns: 200 },
    );
  });

  // ── 5. Custom retention configs are respected ─────────────────────────────

  it('custom retention configs are respected', () => {
    fc.assert(
      fc.property(
        // Custom hot days [1, 90], custom cold days [30, 730]
        fc.integer({ min: 1, max: 90 }),
        fc.integer({ min: 30, max: 730 }),
        fc.double({ min: 0, max: 1000, noNaN: true, noDefaultInfinity: true }),
        (hotDays, coldDays, ageDays) => {
          const custom = createRetentionManager({ hotDays, coldDays });
          const entryDate = new Date(NOW.getTime() - ageDays * MS_PER_DAY);
          const result = custom.classify(entryDate, NOW);

          const totalDays = hotDays + coldDays;

          if (ageDays < hotDays) {
            expect(result.tier).toBe('hot');
            expect(result.shouldArchive).toBe(false);
            expect(result.shouldDelete).toBe(false);
          } else if (ageDays < totalDays) {
            expect(result.tier).toBe('cold');
            expect(result.shouldArchive).toBe(true);
            expect(result.shouldDelete).toBe(false);
          } else {
            expect(result.tier).toBe('expired');
            expect(result.shouldArchive).toBe(false);
            expect(result.shouldDelete).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
