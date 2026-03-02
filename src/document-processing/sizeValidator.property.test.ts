/**
 * Property-based tests for SizeValidator
 *
 * **Feature: document-processing, Property 2: File Size Limit Enforcement**
 *
 * For any file upload, if the file size exceeds 10MB (10,485,760 bytes), the upload
 * SHALL be rejected with a size limit error. For any batch upload, if the total size
 * of all files exceeds 50MB (52,428,800 bytes), the entire batch SHALL be rejected
 * with a batch size limit error.
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  MAX_BATCH_SIZE,
  MAX_FILE_SIZE,
  MULTIPART_THRESHOLD,
  shouldUseMultipart,
  validateBatchSize,
  validateFileSize,
} from './sizeValidator.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a file size within the 10MB limit (0 to MAX_FILE_SIZE inclusive). */
const validFileSizeArb = fc.integer({ min: 0, max: MAX_FILE_SIZE });

/** Generate a file size exceeding the 10MB limit. */
const oversizedFileSizeArb = fc.integer({ min: MAX_FILE_SIZE + 1, max: MAX_FILE_SIZE * 10 });

/** Generate a file size above the 5MB multipart threshold. */
const aboveMultipartArb = fc.integer({ min: MULTIPART_THRESHOLD + 1, max: MAX_FILE_SIZE * 5 });

/** Generate a file size at or below the 5MB multipart threshold. */
const belowMultipartArb = fc.integer({ min: 0, max: MULTIPART_THRESHOLD });

/**
 * Generate an array of file sizes whose total is at or below the 50MB batch limit.
 * Uses a constrained approach: generate 1-10 files, each capped so the sum stays valid.
 */
const validBatchArb = fc
  .integer({ min: 1, max: 10 })
  .chain((count) =>
    fc.array(fc.integer({ min: 0, max: Math.floor(MAX_BATCH_SIZE / count) }), {
      minLength: count,
      maxLength: count,
    }),
  )
  .filter((sizes) => sizes.reduce((sum, s) => sum + s, 0) <= MAX_BATCH_SIZE);

/**
 * Generate an array of file sizes whose total exceeds the 50MB batch limit.
 * Starts with a base that fills most of the limit, then adds an overflow amount.
 */
const oversizedBatchArb = fc
  .tuple(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 1, max: MAX_BATCH_SIZE }))
  .chain(([count, overflow]) =>
    fc
      .array(fc.integer({ min: 0, max: MAX_FILE_SIZE }), {
        minLength: count,
        maxLength: count,
      })
      .map((sizes) => {
        const total = sizes.reduce((sum, s) => sum + s, 0);
        const needed = MAX_BATCH_SIZE + overflow - total;
        if (needed > 0) {
          return [...sizes, needed];
        }
        return sizes;
      }),
  )
  .filter((sizes) => sizes.reduce((sum, s) => sum + s, 0) > MAX_BATCH_SIZE);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('File Size Limit Enforcement (Property 2)', () => {
  /**
   * **Validates: Requirements 4.1**
   * For any file size <= 10MB, validateFileSize returns valid: true.
   */
  it('accepts any file size at or below the 10MB limit', () => {
    fc.assert(
      fc.property(validFileSizeArb, (size) => {
        const result = validateFileSize(size);
        expect(result.valid).toBe(true);
        expect(result.size).toBe(size);
        expect(result.limit).toBe(MAX_FILE_SIZE);
        expect(result.error).toBeUndefined();
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 4.1, 4.3**
   * For any file size > 10MB, validateFileSize returns valid: false with an error.
   */
  it('rejects any file size exceeding the 10MB limit', () => {
    fc.assert(
      fc.property(oversizedFileSizeArb, (size) => {
        const result = validateFileSize(size);
        expect(result.valid).toBe(false);
        expect(result.size).toBe(size);
        expect(result.limit).toBe(MAX_FILE_SIZE);
        expect(result.error).toBeDefined();
        expect(result.error).toContain('exceeds');
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 4.2**
   * For any batch where the sum of sizes <= 50MB, validateBatchSize returns valid: true.
   */
  it('accepts any batch whose total size is at or below the 50MB limit', () => {
    fc.assert(
      fc.property(validBatchArb, (sizes) => {
        const result = validateBatchSize(sizes);
        const expectedTotal = sizes.reduce((sum, s) => sum + s, 0);
        expect(result.valid).toBe(true);
        expect(result.size).toBe(expectedTotal);
        expect(result.limit).toBe(MAX_BATCH_SIZE);
        expect(result.error).toBeUndefined();
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 4.2, 4.4**
   * For any batch where the sum of sizes > 50MB, validateBatchSize returns valid: false.
   */
  it('rejects any batch whose total size exceeds the 50MB limit', () => {
    fc.assert(
      fc.property(oversizedBatchArb, (sizes) => {
        const result = validateBatchSize(sizes);
        const expectedTotal = sizes.reduce((sum, s) => sum + s, 0);
        expect(result.valid).toBe(false);
        expect(result.size).toBe(expectedTotal);
        expect(result.limit).toBe(MAX_BATCH_SIZE);
        expect(result.error).toBeDefined();
        expect(result.error).toContain('exceeds');
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 4.1**
   * For any file size, validateFileSize always returns the correct size and limit values.
   */
  it('always returns correct size and limit values regardless of validity', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_FILE_SIZE * 10 }), (size) => {
        const result = validateFileSize(size);
        expect(result.size).toBe(size);
        expect(result.limit).toBe(MAX_FILE_SIZE);
        expect(typeof result.valid).toBe('boolean');
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 4.5 (via Property 3: Multipart Upload Threshold)**
   * For any file size > 5MB, shouldUseMultipart returns true.
   */
  it('recommends multipart upload for any file above 5MB', () => {
    fc.assert(
      fc.property(aboveMultipartArb, (size) => {
        expect(shouldUseMultipart(size)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 4.5 (via Property 3: Multipart Upload Threshold)**
   * For any file size <= 5MB, shouldUseMultipart returns false.
   */
  it('does not recommend multipart upload for any file at or below 5MB', () => {
    fc.assert(
      fc.property(belowMultipartArb, (size) => {
        expect(shouldUseMultipart(size)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
