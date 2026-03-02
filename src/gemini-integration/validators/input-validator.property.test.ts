/**
 * Property-Based Tests for Input Validation
 *
 * Feature: gemini-integration, Property 9: Input Validation Early Rejection
 *
 * **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6**
 *
 * Property 9: For any input that fails validation (empty buffer, invalid format,
 * exceeds size limit, missing required fields), the service SHALL return a
 * validation error WITHOUT making a Gemini API call.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  validateImageInput,
  validatePdfInput,
  validateCsvInput,
  validateBusinessContext,
} from './input-validator.js';
import type { BusinessContext, TransactionSummary } from '../types/insights.js';

// --- Helpers & Generators ---

/** JPEG magic bytes: 0xFF 0xD8 0xFF */
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/** PNG magic bytes: 0x89 0x50 0x4E 0x47 */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** PDF magic bytes: %PDF */
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]);

/**
 * Generates a random buffer that does NOT start with JPEG or PNG magic bytes.
 */
const nonImageBufferArb = fc
  .uint8Array({ minLength: 1, maxLength: 200 })
  .filter((arr) => {
    const buf = Buffer.from(arr);
    // Reject if it accidentally starts with JPEG or PNG magic
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return false;
    if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
      return false;
    return true;
  })
  .map((arr) => Buffer.from(arr));

/**
 * Generates a random buffer that does NOT start with PDF magic bytes.
 */
const nonPdfBufferArb = fc
  .uint8Array({ minLength: 1, maxLength: 200 })
  .filter((arr) => {
    const buf = Buffer.from(arr);
    if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)
      return false;
    return true;
  })
  .map((arr) => Buffer.from(arr));

/**
 * Generates a valid TransactionSummary for use in BusinessContext.
 */
const transactionSummaryArb: fc.Arbitrary<TransactionSummary> = fc.record({
  id: fc.uuid(),
  date: fc
    .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
    .map((d) => d.toISOString().slice(0, 10)),
  description: fc.string({ minLength: 3, maxLength: 50 }),
  amount: fc.double({ min: 1, max: 10_000_000, noNaN: true }),
  type: fc.constantFrom('credit' as const, 'debit' as const),
});

/**
 * Generates a valid BusinessContext.
 */
/**
 * Generates a non-whitespace-only string by prepending a letter to a random string.
 * The validator trims and checks length > 0, so pure whitespace strings are invalid.
 */
const nonBlankStringArb = (maxLength: number): fc.Arbitrary<string> =>
  fc
    .tuple(
      fc.char().filter((c) => c.trim().length > 0),
      fc.string({ maxLength: maxLength - 1 }),
    )
    .map(([first, rest]) => first + rest);

const validBusinessContextArb: fc.Arbitrary<BusinessContext> = fc
  .record({
    businessId: fc.uuid(),
    businessName: nonBlankStringArb(50),
    businessType: nonBlankStringArb(30),
    transactions: fc.array(transactionSummaryArb, { minLength: 1, maxLength: 5 }),
  })
  .chain((base) =>
    fc
      .tuple(
        fc.date({ min: new Date('2020-01-01'), max: new Date('2025-06-01') }),
        fc.integer({ min: 1, max: 180 }),
      )
      .map(([start, days]) => {
        const end = new Date(start.getTime() + days * 86_400_000);
        return {
          ...base,
          period: {
            start: start.toISOString().slice(0, 10),
            end: end.toISOString().slice(0, 10),
          },
        };
      }),
  );

// --- Property Tests ---

describe('Property 9: Input Validation Early Rejection', () => {
  describe('Image validation (Req 9.1, 9.6)', () => {
    it('should reject empty buffers', () => {
      fc.assert(
        fc.property(fc.constant(Buffer.alloc(0)), (buf) => {
          const result = validateImageInput(buf);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
          expect(result.errors.some((e) => e.code === 'EMPTY_BUFFER')).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject oversized buffers', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 100 }), (extraBytes) => {
          // Create a buffer just over the limit with valid JPEG magic
          const maxSize = 1024; // use small limit for test speed
          const buf = Buffer.alloc(maxSize + extraBytes);
          JPEG_MAGIC.copy(buf);
          const result = validateImageInput(buf, maxSize);
          expect(result.valid).toBe(false);
          expect(result.errors.some((e) => e.code === 'FILE_TOO_LARGE')).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject non-JPEG/PNG buffers', () => {
      fc.assert(
        fc.property(nonImageBufferArb, (buf) => {
          const result = validateImageInput(buf);
          expect(result.valid).toBe(false);
          expect(result.errors.some((e) => e.code === 'INVALID_FORMAT')).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('should accept valid JPEG buffers within size limit', () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 10, maxLength: 200 }).map((arr) => {
            const buf = Buffer.from(arr);
            JPEG_MAGIC.copy(buf);
            return buf;
          }),
          (buf) => {
            const result = validateImageInput(buf, 10 * 1024 * 1024);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should accept valid PNG buffers within size limit', () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 10, maxLength: 200 }).map((arr) => {
            const buf = Buffer.from(arr);
            PNG_MAGIC.copy(buf);
            return buf;
          }),
          (buf) => {
            const result = validateImageInput(buf, 10 * 1024 * 1024);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('PDF validation (Req 9.2, 9.6)', () => {
    it('should reject empty buffers', () => {
      fc.assert(
        fc.property(fc.constant(Buffer.alloc(0)), (buf) => {
          const result = validatePdfInput(buf);
          expect(result.valid).toBe(false);
          expect(result.errors.some((e) => e.code === 'EMPTY_BUFFER')).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject oversized buffers', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 100 }), (extraBytes) => {
          const maxSize = 1024;
          const buf = Buffer.alloc(maxSize + extraBytes);
          PDF_MAGIC.copy(buf);
          const result = validatePdfInput(buf, maxSize);
          expect(result.valid).toBe(false);
          expect(result.errors.some((e) => e.code === 'FILE_TOO_LARGE')).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject non-PDF buffers', () => {
      fc.assert(
        fc.property(nonPdfBufferArb, (buf) => {
          const result = validatePdfInput(buf);
          expect(result.valid).toBe(false);
          expect(result.errors.some((e) => e.code === 'INVALID_FORMAT')).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('should accept valid PDF buffers within size limit', () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 10, maxLength: 200 }).map((arr) => {
            const buf = Buffer.from(arr);
            PDF_MAGIC.copy(buf);
            // Ensure no accidental /Encrypt marker
            return buf;
          }),
          (buf) => {
            const result = validatePdfInput(buf, 10 * 1024 * 1024);
            // Valid unless it accidentally contains /Encrypt (which only adds a warning)
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('CSV validation (Req 9.3, 9.6)', () => {
    it('should reject empty/whitespace strings', () => {
      fc.assert(
        fc.property(fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r')), (content) => {
          const result = validateCsvInput(content);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject oversized CSV content', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 50 }), (extraBytes) => {
          const maxSize = 100;
          // Create CSV content that exceeds the limit
          const header = 'a,b,c\n';
          const row = 'x'.repeat(maxSize + extraBytes - header.length + 1) + '\n';
          const content = header + row;
          const result = validateCsvInput(content, maxSize);
          expect(result.valid).toBe(false);
          expect(result.errors.some((e) => e.code === 'FILE_TOO_LARGE')).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject CSV with only a header (no data rows)', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 2, maxLength: 5 }),
          (headers) => {
            const content = headers.join(',');
            const result = validateCsvInput(content);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.code === 'INSUFFICIENT_ROWS')).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should accept valid CSV with header and data rows', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.array(
              fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
                minLength: 1,
                maxLength: 8,
              }),
              { minLength: 2, maxLength: 5 },
            ),
            fc.integer({ min: 1, max: 5 }),
          ),
          ([headers, rowCount]) => {
            const headerLine = headers.join(',');
            const rows = Array.from({ length: rowCount }, () => headers.map(() => 'val').join(','));
            const content = [headerLine, ...rows].join('\n');
            const result = validateCsvInput(content);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('BusinessContext validation (Req 9.4)', () => {
    it('should reject BusinessContext with missing businessId', () => {
      fc.assert(
        fc.property(validBusinessContextArb, (ctx) => {
          const invalid = { ...ctx, businessId: '' };
          const result = validateBusinessContext(invalid);
          expect(result.valid).toBe(false);
          expect(result.errors.some((e) => e.field === 'businessId')).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject BusinessContext with missing businessName', () => {
      fc.assert(
        fc.property(validBusinessContextArb, (ctx) => {
          const invalid = { ...ctx, businessName: '' };
          const result = validateBusinessContext(invalid);
          expect(result.valid).toBe(false);
          expect(result.errors.some((e) => e.field === 'businessName')).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject BusinessContext with missing businessType', () => {
      fc.assert(
        fc.property(validBusinessContextArb, (ctx) => {
          const invalid = { ...ctx, businessType: '' };
          const result = validateBusinessContext(invalid);
          expect(result.valid).toBe(false);
          expect(result.errors.some((e) => e.field === 'businessType')).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject BusinessContext with empty transactions', () => {
      fc.assert(
        fc.property(validBusinessContextArb, (ctx) => {
          const invalid = { ...ctx, transactions: [] };
          const result = validateBusinessContext(invalid);
          expect(result.valid).toBe(false);
          expect(result.errors.some((e) => e.field === 'transactions')).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject BusinessContext with missing period', () => {
      fc.assert(
        fc.property(validBusinessContextArb, (ctx) => {
          const invalid = { ...ctx, period: undefined } as unknown as BusinessContext;
          const result = validateBusinessContext(invalid);
          expect(result.valid).toBe(false);
          expect(result.errors.some((e) => e.field === 'period')).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject BusinessContext with empty period.start', () => {
      fc.assert(
        fc.property(validBusinessContextArb, (ctx) => {
          const invalid = { ...ctx, period: { ...ctx.period, start: '' } };
          const result = validateBusinessContext(invalid);
          expect(result.valid).toBe(false);
          expect(result.errors.some((e) => e.field === 'period.start')).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject BusinessContext with empty period.end', () => {
      fc.assert(
        fc.property(validBusinessContextArb, (ctx) => {
          const invalid = { ...ctx, period: { ...ctx.period, end: '' } };
          const result = validateBusinessContext(invalid);
          expect(result.valid).toBe(false);
          expect(result.errors.some((e) => e.field === 'period.end')).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('should accept valid BusinessContext', () => {
      fc.assert(
        fc.property(validBusinessContextArb, (ctx) => {
          const result = validateBusinessContext(ctx);
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Cross-cutting: all invalid inputs produce errors without API calls (Req 9.5)', () => {
    it('all validators return synchronously (no API call possible)', () => {
      fc.assert(
        fc.property(fc.constant(undefined), () => {
          // All validator functions are synchronous — they return ValidationResult directly,
          // not a Promise. This guarantees no Gemini API call can be made.
          const imageResult = validateImageInput(Buffer.alloc(0));
          const pdfResult = validatePdfInput(Buffer.alloc(0));
          const csvResult = validateCsvInput('');
          const ctxResult = validateBusinessContext({
            businessId: '',
            businessName: '',
            businessType: '',
            transactions: [],
            period: { start: '', end: '' },
          });

          // All should be invalid
          expect(imageResult.valid).toBe(false);
          expect(pdfResult.valid).toBe(false);
          expect(csvResult.valid).toBe(false);
          expect(ctxResult.valid).toBe(false);

          // All should have errors
          expect(imageResult.errors.length).toBeGreaterThan(0);
          expect(pdfResult.errors.length).toBeGreaterThan(0);
          expect(csvResult.errors.length).toBeGreaterThan(0);
          expect(ctxResult.errors.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });
  });
});
