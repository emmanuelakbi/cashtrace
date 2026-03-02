/**
 * Unit tests for the document status state machine.
 *
 * Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 6.3
 */
import { describe, expect, it } from 'vitest';

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

const ALL_STATUSES: DocumentStatus[] = ['UPLOADED', 'PROCESSING', 'PARSED', 'PARTIAL', 'ERROR'];

describe('statusMachine', () => {
  describe('INITIAL_STATUS', () => {
    it('is UPLOADED', () => {
      expect(INITIAL_STATUS).toBe('UPLOADED');
    });
  });

  describe('VALID_TRANSITIONS', () => {
    it('defines transitions for every status', () => {
      for (const status of ALL_STATUSES) {
        expect(VALID_TRANSITIONS).toHaveProperty(status);
        expect(Array.isArray(VALID_TRANSITIONS[status])).toBe(true);
      }
    });

    it('allows UPLOADED → PROCESSING only', () => {
      expect(VALID_TRANSITIONS.UPLOADED).toEqual(['PROCESSING']);
    });

    it('allows PROCESSING → PARSED, PARTIAL, ERROR', () => {
      expect(VALID_TRANSITIONS.PROCESSING).toEqual(['PARSED', 'PARTIAL', 'ERROR']);
    });

    it('allows ERROR → PROCESSING (retry)', () => {
      expect(VALID_TRANSITIONS.ERROR).toEqual(['PROCESSING']);
    });

    it('allows no transitions from PARSED', () => {
      expect(VALID_TRANSITIONS.PARSED).toEqual([]);
    });

    it('allows no transitions from PARTIAL', () => {
      expect(VALID_TRANSITIONS.PARTIAL).toEqual([]);
    });
  });

  describe('isValidTransition', () => {
    it('returns true for UPLOADED → PROCESSING', () => {
      expect(isValidTransition('UPLOADED', 'PROCESSING')).toBe(true);
    });

    it('returns true for PROCESSING → PARSED', () => {
      expect(isValidTransition('PROCESSING', 'PARSED')).toBe(true);
    });

    it('returns true for PROCESSING → PARTIAL', () => {
      expect(isValidTransition('PROCESSING', 'PARTIAL')).toBe(true);
    });

    it('returns true for PROCESSING → ERROR', () => {
      expect(isValidTransition('PROCESSING', 'ERROR')).toBe(true);
    });

    it('returns true for ERROR → PROCESSING (retry)', () => {
      expect(isValidTransition('ERROR', 'PROCESSING')).toBe(true);
    });

    it('returns false for UPLOADED → PARSED (skip processing)', () => {
      expect(isValidTransition('UPLOADED', 'PARSED')).toBe(false);
    });

    it('returns false for PARSED → PROCESSING (terminal state)', () => {
      expect(isValidTransition('PARSED', 'PROCESSING')).toBe(false);
    });

    it('returns false for PARTIAL → PROCESSING (terminal state)', () => {
      expect(isValidTransition('PARTIAL', 'PROCESSING')).toBe(false);
    });

    it('returns false for self-transitions', () => {
      for (const status of ALL_STATUSES) {
        expect(isValidTransition(status, status)).toBe(false);
      }
    });
  });

  describe('getValidTransitions', () => {
    it('returns [PROCESSING] for UPLOADED', () => {
      expect(getValidTransitions('UPLOADED')).toEqual(['PROCESSING']);
    });

    it('returns [PARSED, PARTIAL, ERROR] for PROCESSING', () => {
      expect(getValidTransitions('PROCESSING')).toEqual(['PARSED', 'PARTIAL', 'ERROR']);
    });

    it('returns [] for PARSED', () => {
      expect(getValidTransitions('PARSED')).toEqual([]);
    });

    it('returns [] for PARTIAL', () => {
      expect(getValidTransitions('PARTIAL')).toEqual([]);
    });

    it('returns [PROCESSING] for ERROR', () => {
      expect(getValidTransitions('ERROR')).toEqual(['PROCESSING']);
    });
  });

  describe('validateTransition', () => {
    it('does not throw for valid transitions', () => {
      expect(() => validateTransition('UPLOADED', 'PROCESSING')).not.toThrow();
      expect(() => validateTransition('PROCESSING', 'PARSED')).not.toThrow();
      expect(() => validateTransition('PROCESSING', 'PARTIAL')).not.toThrow();
      expect(() => validateTransition('PROCESSING', 'ERROR')).not.toThrow();
      expect(() => validateTransition('ERROR', 'PROCESSING')).not.toThrow();
    });

    it('throws DocumentError for invalid transitions', () => {
      expect(() => validateTransition('UPLOADED', 'PARSED')).toThrow(DocumentError);
    });

    it('throws with DOC_INVALID_TRANSITION error code', () => {
      try {
        validateTransition('PARSED', 'UPLOADED');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(DocumentError);
        expect((err as DocumentError).code).toBe(DOC_ERROR_CODES.INVALID_TRANSITION);
      }
    });

    it('includes from/to statuses in error message', () => {
      try {
        validateTransition('PARTIAL', 'ERROR');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(DocumentError);
        const message = (err as DocumentError).message;
        expect(message).toContain('PARTIAL');
        expect(message).toContain('ERROR');
      }
    });

    it('includes allowed transitions in error message', () => {
      try {
        validateTransition('PROCESSING', 'UPLOADED');
        expect.fail('Should have thrown');
      } catch (err) {
        const message = (err as DocumentError).message;
        expect(message).toContain('PARSED');
        expect(message).toContain('PARTIAL');
        expect(message).toContain('ERROR');
      }
    });
  });
});
