/**
 * Property-Based Tests — Deduplication
 *
 * **Property 7: Deduplication**
 * For any identical notification (same user, template, variables) within 1 hour,
 * only one SHALL be delivered.
 *
 * **Validates: Requirements 9.3**
 *
 * @module notifications/services/deduplication.property.test
 */

import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeduplicationService, generateDedupKey } from './deduplication.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const userIdArb = fc.string({ minLength: 1, maxLength: 50 });
const templateIdArb = fc.string({ minLength: 1, maxLength: 50 });
const variablesArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 20 }),
  fc.oneof(fc.string(), fc.integer(), fc.boolean()),
  { minKeys: 0, maxKeys: 5 },
);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DeduplicationService — Property 7: Deduplication', () => {
  /**
   * Dedup key determinism: For any userId, templateId, and variables,
   * generateDedupKey always produces the same hash.
   *
   * **Validates: Requirements 9.3**
   */
  it('generateDedupKey is deterministic — same inputs always produce the same hash', () => {
    fc.assert(
      fc.property(userIdArb, templateIdArb, variablesArb, (userId, templateId, variables) => {
        const key1 = generateDedupKey(userId, templateId, variables);
        const key2 = generateDedupKey(userId, templateId, variables);
        expect(key1).toBe(key2);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Dedup key uniqueness: For any two different (userId, templateId, variables)
   * tuples, the keys should differ (with high probability).
   *
   * **Validates: Requirements 9.3**
   */
  it('generateDedupKey produces different keys for different inputs', () => {
    fc.assert(
      fc.property(
        userIdArb,
        templateIdArb,
        variablesArb,
        userIdArb,
        templateIdArb,
        variablesArb,
        (userId1, templateId1, vars1, userId2, templateId2, vars2) => {
          const sameInputs =
            userId1 === userId2 &&
            templateId1 === templateId2 &&
            JSON.stringify(vars1) === JSON.stringify(vars2);

          // Only assert uniqueness when inputs actually differ
          fc.pre(!sameInputs);

          const key1 = generateDedupKey(userId1, templateId1, vars1);
          const key2 = generateDedupKey(userId2, templateId2, vars2);
          expect(key1).not.toBe(key2);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Duplicate detection within window: For any notification recorded via
   * recordSent, isDuplicate returns true for the same inputs within the window.
   *
   * **Validates: Requirements 9.3**
   */
  it('isDuplicate returns true for recorded notifications within the window', () => {
    fc.assert(
      fc.property(userIdArb, templateIdArb, variablesArb, (userId, templateId, variables) => {
        const service = createDeduplicationService();
        service.recordSent(userId, templateId, variables);
        expect(service.isDuplicate(userId, templateId, variables)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * No false positives: For any notification NOT recorded, isDuplicate
   * returns false.
   *
   * **Validates: Requirements 9.3**
   */
  it('isDuplicate returns false for notifications never recorded', () => {
    fc.assert(
      fc.property(userIdArb, templateIdArb, variablesArb, (userId, templateId, variables) => {
        const service = createDeduplicationService();
        expect(service.isDuplicate(userId, templateId, variables)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Expiry correctness: After the window elapses, previously recorded
   * notifications are no longer flagged as duplicates.
   *
   * **Validates: Requirements 9.3**
   */
  describe('expiry correctness', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('recorded notifications expire after the dedup window', () => {
      const WINDOW_MS = 60 * 60 * 1000; // 1 hour

      fc.assert(
        fc.property(userIdArb, templateIdArb, variablesArb, (userId, templateId, variables) => {
          vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
          const service = createDeduplicationService(WINDOW_MS);

          service.recordSent(userId, templateId, variables);
          expect(service.isDuplicate(userId, templateId, variables)).toBe(true);

          // Advance time past the window
          vi.advanceTimersByTime(WINDOW_MS);

          expect(service.isDuplicate(userId, templateId, variables)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });
  });
});
