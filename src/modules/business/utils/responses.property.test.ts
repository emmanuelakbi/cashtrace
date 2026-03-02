/**
 * Property-based tests for API response formatters.
 *
 * **Property 12: API Response Consistency**
 * For any API response, it SHALL be valid JSON containing either a success response
 * with the expected data structure (including requestId) OR an error response with
 * error code, message, field-specific details (if applicable), and requestId.
 * HTTP status codes SHALL match the response type.
 *
 * **Validates: Requirements 1.6, 1.7, 3.5, 4.3, 8.1, 8.2, 8.3, 8.4**
 *
 * Tag: Feature: business-management, Property 12: API Response Consistency
 *
 * @module modules/business/utils/responses.property.test
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  type Business,
  type BusinessErrorCode,
  BusinessSector,
  Currency,
  BUSINESS_ERROR_CODES,
  SECTOR_DISPLAY_NAMES,
} from '../types/index.js';

import { BusinessError } from '../services/businessService.js';

import { formatBusinessResponse, formatErrorResponse, getHttpStatusForError } from './responses.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** ISO 8601 date pattern */
const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;

/** Generate a valid Business object with random fields */
const businessArb: fc.Arbitrary<Business> = fc.record({
  id: fc.uuid(),
  userId: fc.uuid(),
  name: fc.string({ minLength: 2, maxLength: 100 }).filter((s) => s.trim().length >= 2),
  sector: fc.constantFrom(...Object.values(BusinessSector)),
  currency: fc.constantFrom(...Object.values(Currency)),
  createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
  updatedAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
  deletedAt: fc.constant(null),
  hardDeleteAt: fc.constant(null),
});

/** Generate a valid request ID (UUID) */
const requestIdArb = fc.uuid();

/** Generate a random business error code */
const errorCodeArb: fc.Arbitrary<BusinessErrorCode> = fc.constantFrom(
  ...Object.values(BUSINESS_ERROR_CODES),
);

/** Generate optional field-specific validation errors */
const fieldsArb: fc.Arbitrary<Record<string, string[]> | undefined> = fc.option(
  fc.dictionary(
    fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length >= 1),
    fc.array(
      fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length >= 1),
      { minLength: 1, maxLength: 3 },
    ),
    { minKeys: 1, maxKeys: 5 },
  ),
  { nil: undefined },
);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 12: API Response Consistency', () => {
  /**
   * **Validates: Requirements 1.6, 3.5, 4.3, 8.1, 8.4**
   *
   * For any Business and requestId, formatBusinessResponse always produces
   * a valid success response with the expected data structure.
   */
  it('formatBusinessResponse always produces valid success response structure', () => {
    fc.assert(
      fc.property(businessArb, requestIdArb, (business, requestId) => {
        const result = formatBusinessResponse(business, requestId);

        // success flag
        expect(result.success).toBe(true);

        // requestId is a string matching the input
        expect(typeof result.requestId).toBe('string');
        expect(result.requestId).toBe(requestId);

        // business public fields are present
        const bp = result.business;
        expect(bp.id).toBe(business.id);
        expect(bp.name).toBe(business.name);
        expect(bp.sector).toBe(business.sector);
        expect(bp.currency).toBe(business.currency);

        // sectorDisplay matches the SECTOR_DISPLAY_NAMES mapping
        expect(bp.sectorDisplay).toBe(SECTOR_DISPLAY_NAMES[business.sector]);

        // createdAt and updatedAt are valid ISO 8601 strings
        expect(typeof bp.createdAt).toBe('string');
        expect(typeof bp.updatedAt).toBe('string');
        expect(bp.createdAt).toMatch(ISO_8601_REGEX);
        expect(bp.updatedAt).toMatch(ISO_8601_REGEX);

        // round-trip: parsing the ISO string back gives the same timestamp
        expect(new Date(bp.createdAt).getTime()).toBe(business.createdAt.getTime());
        expect(new Date(bp.updatedAt).getTime()).toBe(business.updatedAt.getTime());

        // serialisable to valid JSON
        const json = JSON.stringify(result);
        const parsed = JSON.parse(json) as typeof result;
        expect(parsed.success).toBe(true);
        expect(parsed.requestId).toBe(requestId);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 1.7, 8.1, 8.2, 8.4**
   *
   * For any error code, message, optional fields, and requestId,
   * formatErrorResponse always produces a valid error response structure.
   */
  it('formatErrorResponse always produces valid error response structure', () => {
    fc.assert(
      fc.property(
        errorCodeArb,
        fc.string({ minLength: 1, maxLength: 200 }),
        fieldsArb,
        requestIdArb,
        (code, message, fields, requestId) => {
          const error = new BusinessError(code, message, fields);
          const result = formatErrorResponse(error, requestId);

          // success is always false
          expect(result.success).toBe(false);

          // requestId is a string matching the input
          expect(typeof result.requestId).toBe('string');
          expect(result.requestId).toBe(requestId);

          // error object has code and message
          expect(result.error.code).toBe(code);
          expect(result.error.message).toBe(message);

          // fields are included only when provided
          if (fields !== undefined) {
            expect(result.error.fields).toEqual(fields);
          } else {
            expect(result.error.fields).toBeUndefined();
          }

          // serialisable to valid JSON
          const json = JSON.stringify(result);
          const parsed = JSON.parse(json) as typeof result;
          expect(parsed.success).toBe(false);
          expect(parsed.error.code).toBe(code);
          expect(parsed.requestId).toBe(requestId);
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 8.3**
   *
   * For any business error code, getHttpStatusForError returns a valid
   * HTTP status code that matches the response type.
   */
  it('getHttpStatusForError returns valid HTTP status for all error codes', () => {
    fc.assert(
      fc.property(errorCodeArb, (code) => {
        const status = getHttpStatusForError(code);

        // result is a number
        expect(typeof status).toBe('number');

        // result is one of the valid HTTP status codes
        expect([400, 403, 404, 500]).toContain(status);

        // specific mappings: 403 only for FORBIDDEN, 404 for NOT_FOUND/DELETED, 500 for INTERNAL
        if (code === BUSINESS_ERROR_CODES.FORBIDDEN) {
          expect(status).toBe(403);
        }
        if (code === BUSINESS_ERROR_CODES.NOT_FOUND || code === BUSINESS_ERROR_CODES.DELETED) {
          expect(status).toBe(404);
        }
        if (code === BUSINESS_ERROR_CODES.INTERNAL_ERROR) {
          expect(status).toBe(500);
        }
      }),
      { numRuns: 100, verbose: true },
    );
  });
});
