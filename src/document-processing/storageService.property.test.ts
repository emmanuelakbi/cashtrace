/**
 * Property-based tests for StorageService — S3 Key Generation
 *
 * **Feature: document-processing, Property 4: Unique S3 Key Generation**
 *
 * For any two documents uploaded to the system (regardless of having the same filename
 * or content), their S3 keys SHALL be different. For any document, its S3 key SHALL
 * contain the business ID as a path component.
 *
 * **Validates: Requirements 1.4, 2.4, 3.3, 8.5**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { generateS3Key, PRESIGNED_URL_EXPIRY } from './storageService.js';
import type { DocumentType } from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const DOCUMENT_TYPES: DocumentType[] = ['RECEIPT_IMAGE', 'BANK_STATEMENT', 'POS_EXPORT'];

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid DocumentType. */
const documentTypeArb = fc.constantFrom<DocumentType>(...DOCUMENT_TYPES);

/** Generate a realistic filename with extension. */
const filenameArb = fc
  .tuple(
    fc.stringMatching(/^[a-zA-Z0-9_ -]{1,30}$/),
    fc.constantFrom('.jpg', '.png', '.pdf', '.csv'),
  )
  .map(([name, ext]) => `${name}${ext}`);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Unique S3 Key Generation (Property 4)', () => {
  /**
   * **Validates: Requirements 1.4, 2.4, 3.3**
   * For any two different documentIds with the same businessId, documentType,
   * and filename, the generated S3 keys SHALL be different.
   */
  it('generates unique keys for different documentIds with same filename', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        documentTypeArb,
        fc.uuid(),
        fc.uuid(),
        filenameArb,
        (businessId, documentType, documentId1, documentId2, filename) => {
          fc.pre(documentId1 !== documentId2);

          const key1 = generateS3Key(businessId, documentType, documentId1, filename);
          const key2 = generateS3Key(businessId, documentType, documentId2, filename);

          expect(key1).not.toBe(key2);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 8.5**
   * For any document, its S3 key SHALL contain the businessId as a path component.
   */
  it('S3 key contains businessId as a path component', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        documentTypeArb,
        fc.uuid(),
        filenameArb,
        (businessId, documentType, documentId, filename) => {
          const key = generateS3Key(businessId, documentType, documentId, filename);

          expect(key).toContain(`/${businessId}/`);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.4, 2.4, 3.3, 8.5**
   * For any generated key, it SHALL start with `documents/{businessId}/`.
   */
  it('S3 key starts with documents/{businessId}/', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        documentTypeArb,
        fc.uuid(),
        filenameArb,
        (businessId, documentType, documentId, filename) => {
          const key = generateS3Key(businessId, documentType, documentId, filename);

          expect(key.startsWith(`documents/${businessId}/`)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.4, 2.4, 3.3, 8.5**
   * For any generated key, it SHALL follow the expected path structure:
   * documents/{businessId}/{documentType}/{year}/{month}/{documentId}_{sanitizedFilename}
   */
  it('S3 key follows the expected path structure', () => {
    const s3KeyPattern =
      /^documents\/[0-9a-f-]+\/(RECEIPT_IMAGE|BANK_STATEMENT|POS_EXPORT)\/\d{4}\/\d{2}\/[0-9a-f-]+_.+$/;

    fc.assert(
      fc.property(
        fc.uuid(),
        documentTypeArb,
        fc.uuid(),
        filenameArb,
        (businessId, documentType, documentId, filename) => {
          const key = generateS3Key(businessId, documentType, documentId, filename);

          expect(key).toMatch(s3KeyPattern);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.4, 2.4, 3.3**
   * For any set of uploads with the same filename, all generated S3 keys SHALL be unique
   * when documentIds are unique.
   */
  it('batch of uploads with same filename produces all unique keys', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        documentTypeArb,
        fc.uniqueArray(fc.uuid(), { minLength: 2, maxLength: 10 }),
        filenameArb,
        (businessId, documentType, documentIds, filename) => {
          const keys = documentIds.map((docId) =>
            generateS3Key(businessId, documentType, docId, filename),
          );
          const uniqueKeys = new Set(keys);

          expect(uniqueKeys.size).toBe(keys.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.5**
   * For any generated key, the documentType component in the path SHALL match
   * the input documentType.
   */
  it('S3 key contains the correct documentType in the path', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        documentTypeArb,
        fc.uuid(),
        filenameArb,
        (businessId, documentType, documentId, filename) => {
          const key = generateS3Key(businessId, documentType, documentId, filename);

          expect(key).toContain(`/${documentType}/`);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 13: Presigned URL Expiration ───────────────────────────────────

/**
 * **Feature: document-processing, Property 13: Presigned URL Expiration**
 *
 * For any presigned URL generated for document download, the URL SHALL have
 * an expiration time of exactly 15 minutes from generation.
 *
 * **Validates: Requirements 8.3**
 */
describe('Presigned URL Expiration (Property 13)', () => {
  /**
   * **Validates: Requirements 8.3**
   * The PRESIGNED_URL_EXPIRY constant SHALL be exactly 900 seconds (15 minutes).
   */
  it('PRESIGNED_URL_EXPIRY is exactly 15 minutes in seconds', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), (_arbitraryInput) => {
        expect(PRESIGNED_URL_EXPIRY).toBe(15 * 60);
        expect(PRESIGNED_URL_EXPIRY).toBe(900);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.3**
   * For any positive number of minutes, only 15 minutes (900 seconds) SHALL
   * match the configured presigned URL expiry.
   */
  it('only 15 minutes matches the presigned URL expiry', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), (minutes) => {
        const seconds = minutes * 60;
        if (minutes === 15) {
          expect(seconds).toBe(PRESIGNED_URL_EXPIRY);
        } else {
          expect(seconds).not.toBe(PRESIGNED_URL_EXPIRY);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.3**
   * The presigned URL expiry SHALL be a positive integer representing seconds,
   * and SHALL be within a reasonable range (greater than 0, at most 1 hour).
   */
  it('PRESIGNED_URL_EXPIRY is a positive integer within reasonable bounds', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), (_arbitraryInput) => {
        expect(Number.isInteger(PRESIGNED_URL_EXPIRY)).toBe(true);
        expect(PRESIGNED_URL_EXPIRY).toBeGreaterThan(0);
        expect(PRESIGNED_URL_EXPIRY).toBeLessThanOrEqual(3600);
      }),
      { numRuns: 100 },
    );
  });
});
