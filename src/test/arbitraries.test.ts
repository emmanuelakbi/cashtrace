/**
 * Smoke tests for the fast-check arbitraries.
 *
 * Verifies that the test data generators produce values
 * matching expected constraints. This also validates that
 * fast-check is properly configured in the project.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  validEmailArb,
  validPasswordArb,
  invalidPasswordArb,
  tooShortPasswordArb,
  noDigitPasswordArb,
  deviceFingerprintArb,
  signupRequestArb,
  uuidArb,
  ipv4Arb,
} from './arbitraries.js';

describe('test arbitraries', () => {
  it('validEmailArb generates strings containing @', () => {
    fc.assert(
      fc.property(validEmailArb, (email) => {
        expect(email).toContain('@');
      }),
      { numRuns: 50 },
    );
  });

  it('validPasswordArb generates passwords with >= 8 chars and at least 1 digit', () => {
    fc.assert(
      fc.property(validPasswordArb, (password) => {
        expect(password.length).toBeGreaterThanOrEqual(8);
        expect(/\d/.test(password)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('tooShortPasswordArb generates passwords with < 8 chars', () => {
    fc.assert(
      fc.property(tooShortPasswordArb, (password) => {
        expect(password.length).toBeLessThanOrEqual(7);
      }),
      { numRuns: 50 },
    );
  });

  it('noDigitPasswordArb generates passwords with >= 8 chars and no digits', () => {
    fc.assert(
      fc.property(noDigitPasswordArb, (password) => {
        expect(password.length).toBeGreaterThanOrEqual(8);
        expect(/\d/.test(password)).toBe(false);
      }),
      { numRuns: 50 },
    );
  });

  it('deviceFingerprintArb generates 64-char hex strings', () => {
    fc.assert(
      fc.property(deviceFingerprintArb, (fp) => {
        expect(fp).toHaveLength(64);
        expect(/^[0-9a-f]+$/i.test(fp)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it('signupRequestArb generates valid signup payloads', () => {
    fc.assert(
      fc.property(signupRequestArb, (req) => {
        expect(req.email).toContain('@');
        expect(req.password.length).toBeGreaterThanOrEqual(8);
        expect(/\d/.test(req.password)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it('uuidArb generates valid UUID strings', () => {
    fc.assert(
      fc.property(uuidArb, (id) => {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      }),
      { numRuns: 50 },
    );
  });

  it('ipv4Arb generates valid IPv4 addresses', () => {
    fc.assert(
      fc.property(ipv4Arb, (ip) => {
        const parts = ip.split('.');
        expect(parts).toHaveLength(4);
        for (const part of parts) {
          const num = parseInt(part, 10);
          expect(num).toBeGreaterThanOrEqual(0);
          expect(num).toBeLessThanOrEqual(255);
        }
      }),
      { numRuns: 50 },
    );
  });
});
