/**
 * Property-based tests for the document status state machine.
 *
 * **Feature: document-processing, Property 6: Document Status State Machine**
 *
 * For any newly uploaded document, its initial status SHALL be UPLOADED.
 * For any document, valid status transitions SHALL be:
 *   UPLOADED → PROCESSING, PROCESSING → PARSED, PROCESSING → PARTIAL,
 *   PROCESSING → ERROR, ERROR → PROCESSING (retry).
 * No other status transitions SHALL be allowed.
 *
 * **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 6.3**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { DocumentError } from './documentService.js';
import {
  getValidTransitions,
  INITIAL_STATUS,
  isValidTransition,
  validateTransition,
  VALID_TRANSITIONS,
} from './statusMachine.js';
import type { DocumentStatus } from './types.js';
import { DOC_ERROR_CODES } from './types.js';

// ─── Generators ──────────────────────────────────────────────────────────────

const ALL_STATUSES: DocumentStatus[] = ['UPLOADED', 'PROCESSING', 'PARSED', 'PARTIAL', 'ERROR'];

/** Generate a random DocumentStatus. */
const documentStatusArb: fc.Arbitrary<DocumentStatus> = fc.constantFrom(...ALL_STATUSES);

/** Generate a pair of statuses representing a valid transition. */
const validTransitionArb: fc.Arbitrary<[DocumentStatus, DocumentStatus]> = fc.constantFrom(
  ['UPLOADED', 'PROCESSING'] as [DocumentStatus, DocumentStatus],
  ['PROCESSING', 'PARSED'] as [DocumentStatus, DocumentStatus],
  ['PROCESSING', 'PARTIAL'] as [DocumentStatus, DocumentStatus],
  ['PROCESSING', 'ERROR'] as [DocumentStatus, DocumentStatus],
  ['ERROR', 'PROCESSING'] as [DocumentStatus, DocumentStatus],
);

/** Generate a pair of statuses representing an invalid transition. */
const invalidTransitionArb: fc.Arbitrary<[DocumentStatus, DocumentStatus]> = fc
  .tuple(documentStatusArb, documentStatusArb)
  .filter(([from, to]) => {
    const allowed = VALID_TRANSITIONS[from];
    return !allowed.includes(to);
  });

/**
 * Generate a random sequence of status transitions starting from UPLOADED.
 * Each step picks randomly from valid transitions for the current status.
 * If no valid transitions exist (terminal state), the sequence ends.
 */
const transitionSequenceArb: fc.Arbitrary<DocumentStatus[]> = fc
  .array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 20 })
  .map((randoms) => {
    const path: DocumentStatus[] = [INITIAL_STATUS];
    let current: DocumentStatus = INITIAL_STATUS;

    for (const rand of randoms) {
      const targets = getValidTransitions(current);
      if (targets.length === 0) break;
      const next = targets[rand % targets.length] as DocumentStatus;
      path.push(next);
      current = next;
    }

    return path;
  });

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Document Status State Machine (Property 6)', () => {
  /**
   * **Validates: Requirements 5.2**
   * The initial status for any newly uploaded document is always UPLOADED.
   */
  it('initial status is always UPLOADED', () => {
    expect(INITIAL_STATUS).toBe('UPLOADED');
  });

  /**
   * **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 6.3**
   * For any valid transition pair, isValidTransition returns true.
   */
  it('accepts all valid transitions', () => {
    fc.assert(
      fc.property(validTransitionArb, ([from, to]) => {
        expect(isValidTransition(from, to)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 6.3**
   * For any invalid transition pair, isValidTransition returns false.
   */
  it('rejects all invalid transitions', () => {
    fc.assert(
      fc.property(invalidTransitionArb, ([from, to]) => {
        expect(isValidTransition(from, to)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 6.3**
   * For any valid transition, validateTransition does not throw.
   */
  it('validateTransition does not throw for valid transitions', () => {
    fc.assert(
      fc.property(validTransitionArb, ([from, to]) => {
        expect(() => validateTransition(from, to)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 6.3**
   * For any invalid transition, validateTransition throws a DocumentError
   * with the DOC_INVALID_TRANSITION error code.
   */
  it('validateTransition throws DocumentError with correct code for invalid transitions', () => {
    fc.assert(
      fc.property(invalidTransitionArb, ([from, to]) => {
        try {
          validateTransition(from, to);
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(DocumentError);
          expect((err as DocumentError).code).toBe(DOC_ERROR_CODES.INVALID_TRANSITION);
          expect((err as DocumentError).message).toContain(from);
          expect((err as DocumentError).message).toContain(to);
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6**
   * For any random status transition sequence starting from UPLOADED,
   * every consecutive pair is a valid transition.
   */
  it('random transition sequences from UPLOADED contain only valid steps', () => {
    fc.assert(
      fc.property(transitionSequenceArb, (sequence) => {
        expect(sequence[0]).toBe('UPLOADED');
        for (let i = 0; i < sequence.length - 1; i++) {
          const from = sequence[i] as DocumentStatus;
          const to = sequence[i + 1] as DocumentStatus;
          expect(isValidTransition(from, to)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 6.3**
   * For any status, getValidTransitions returns exactly the statuses
   * for which isValidTransition returns true.
   */
  it('getValidTransitions is consistent with isValidTransition for any status', () => {
    fc.assert(
      fc.property(documentStatusArb, (from) => {
        const validTargets = getValidTransitions(from);
        for (const to of ALL_STATUSES) {
          if (validTargets.includes(to)) {
            expect(isValidTransition(from, to)).toBe(true);
          } else {
            expect(isValidTransition(from, to)).toBe(false);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6**
   * No self-transitions are allowed for any status.
   */
  it('self-transitions are never valid for any status', () => {
    fc.assert(
      fc.property(documentStatusArb, (status) => {
        expect(isValidTransition(status, status)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 5.4, 5.5**
   * PARSED and PARTIAL are terminal states — no transitions out.
   */
  it('terminal states (PARSED, PARTIAL) have no valid outgoing transitions', () => {
    const terminalStatuses: DocumentStatus[] = ['PARSED', 'PARTIAL'];
    fc.assert(
      fc.property(fc.constantFrom(...terminalStatuses), documentStatusArb, (from, to) => {
        expect(isValidTransition(from, to)).toBe(false);
        expect(getValidTransitions(from)).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});
