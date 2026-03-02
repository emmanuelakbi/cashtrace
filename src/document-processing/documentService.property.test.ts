/**
 * Property-based tests for DocumentService.
 *
 * Tests Properties 9–12 from the document-processing design:
 *
 * **Property 9: Document Listing Business Isolation**
 * For any document listing request, the returned documents SHALL contain
 * only documents belonging to that user's business.
 *
 * **Property 10: Pagination Correctness**
 * For any paginated listing, pages SHALL not overlap and complete
 * pagination SHALL cover all documents.
 *
 * **Property 11: Default Sort Order**
 * For any listing without explicit sort, documents SHALL be sorted
 * by uploadedAt descending (newest first).
 *
 * **Property 12: Ownership Enforcement**
 * For any cross-business access attempt, the operation SHALL be rejected
 * with DOC_FORBIDDEN.
 *
 * @module document-processing/documentService.property.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

import type {
  Document,
  DocumentStatus,
  DocumentType,
  ListOptions,
  PaginatedDocuments,
} from './types.js';
import { DOC_ERROR_CODES } from './types.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const documentTypeArb: fc.Arbitrary<DocumentType> = fc.constantFrom(
  'RECEIPT_IMAGE',
  'BANK_STATEMENT',
  'POS_EXPORT',
);

const documentStatusArb: fc.Arbitrary<DocumentStatus> = fc.constantFrom(
  'UPLOADED',
  'PROCESSING',
  'PARSED',
  'PARTIAL',
  'ERROR',
);

/**
 * Generate a complete Document object for a given businessId.
 * uploadedAt is drawn from the provided arbitrary so tests can control ordering.
 */
const makeDocumentArb = (
  businessId: fc.Arbitrary<string>,
  uploadedAt?: fc.Arbitrary<Date>,
): fc.Arbitrary<Document> =>
  fc.record({
    id: fc.uuid(),
    businessId,
    userId: fc.uuid(),
    filename: fc.string({ minLength: 1, maxLength: 50 }).map((s) => s.replace(/[/\\]/g, '_')),
    originalFilename: fc
      .string({ minLength: 1, maxLength: 50 })
      .map((s) => s.replace(/[/\\]/g, '_')),
    documentType: documentTypeArb,
    mimeType: fc.constantFrom('image/jpeg', 'image/png', 'application/pdf', 'text/csv'),
    fileSize: fc.integer({ min: 1, max: 10_485_760 }),
    s3Key: fc.uuid().map((id) => `documents/${id}`),
    s3Bucket: fc.constant('cashtrace-docs'),
    status: documentStatusArb,
    processingStartedAt: fc.constant(null),
    processingCompletedAt: fc.constant(null),
    processingDurationMs: fc.constant(null),
    transactionsExtracted: fc.constant(null),
    processingWarnings: fc.constant([] as string[]),
    processingErrors: fc.constant([] as string[]),
    idempotencyKey: fc.constant(null),
    uploadedAt: uploadedAt ?? fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
    updatedAt: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
  });

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFindDocumentById = vi.fn<(id: string) => Promise<Document | null>>();
const mockFindDocumentsByBusinessId =
  vi.fn<(businessId: string, options: ListOptions) => Promise<PaginatedDocuments>>();
const mockDeleteDocument = vi.fn<(id: string) => Promise<boolean>>();

vi.mock('./documentRepository.js', () => ({
  findDocumentById: (...args: unknown[]) => mockFindDocumentById(args[0] as string),
  findDocumentsByBusinessId: (...args: unknown[]) =>
    mockFindDocumentsByBusinessId(args[0] as string, args[1] as ListOptions),
  deleteDocument: (...args: unknown[]) => mockDeleteDocument(args[0] as string),
  createDocument: vi.fn(),
  updateDocumentStatus: vi.fn(),
  countDocumentsByBusinessId: vi.fn(),
}));

// ─── Import Under Test ──────────────────────────────────────────────────────

const { DocumentService, DocumentError } = await import('./documentService.js');

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Property 9: Document Listing Business Isolation', () => {
  beforeEach(() => {
    mockFindDocumentsByBusinessId.mockReset();
  });

  /**
   * **Validates: Requirements 7.1**
   *
   * For any set of documents across multiple businesses, listing documents
   * for a specific business SHALL return only documents belonging to that business.
   */
  it('should return only documents belonging to the requesting business', async () => {
    const service = new DocumentService();

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.array(makeDocumentArb(fc.uuid()), { minLength: 0, maxLength: 20 }).chain((mixedDocs) =>
          fc.uuid().map((targetBiz) => {
            const targetDocs = mixedDocs.map((d, i) =>
              i % 2 === 0 ? { ...d, businessId: targetBiz } : d,
            );
            return { targetBiz, allDocs: targetDocs };
          }),
        ),
        async (_bizA, _bizB, { targetBiz, allDocs }) => {
          const docsForBusiness = allDocs.filter((d) => d.businessId === targetBiz);

          const options: ListOptions = {
            page: 1,
            pageSize: 100,
            sortBy: 'uploadedAt',
            sortOrder: 'desc',
          };

          mockFindDocumentsByBusinessId.mockResolvedValueOnce({
            documents: docsForBusiness,
            total: docsForBusiness.length,
            page: 1,
            pageSize: 100,
            totalPages: Math.max(1, Math.ceil(docsForBusiness.length / 100)),
          });

          const result = await service.listDocuments(targetBiz, options);

          // Every returned document must belong to the target business
          for (const doc of result.documents) {
            expect(doc.businessId).toBe(targetBiz);
          }

          // No documents from other businesses should appear
          expect(result.documents.length).toBe(docsForBusiness.length);

          // Repository was called with the correct businessId
          expect(mockFindDocumentsByBusinessId).toHaveBeenCalledWith(targetBiz, options);
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });
});

describe('Property 10: Pagination Correctness', () => {
  beforeEach(() => {
    mockFindDocumentsByBusinessId.mockReset();
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * For any document set and page size, paginating through all pages SHALL:
   * - Return at most pageSize documents per page
   * - Have no overlap between pages
   * - Cover all documents when all pages are combined
   */
  it('should paginate without overlap and with complete coverage', async () => {
    const service = new DocumentService();

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 1, max: 10 }),
        fc.array(makeDocumentArb(fc.constant('biz-fixed')), { minLength: 0, maxLength: 30 }),
        async (businessId, pageSize, allDocs) => {
          // Assign all docs to the same business
          const docs = allDocs.map((d) => ({ ...d, businessId }));
          const totalPages = Math.max(1, Math.ceil(docs.length / pageSize));

          // Simulate paginated responses from the repository
          const collectedIds: string[] = [];

          for (let page = 1; page <= totalPages; page++) {
            const offset = (page - 1) * pageSize;
            const pageDocs = docs.slice(offset, offset + pageSize);

            const options: ListOptions = {
              page,
              pageSize,
              sortBy: 'uploadedAt',
              sortOrder: 'desc',
            };

            mockFindDocumentsByBusinessId.mockResolvedValueOnce({
              documents: pageDocs,
              total: docs.length,
              page,
              pageSize,
              totalPages,
            });

            const result = await service.listDocuments(businessId, options);

            // Each page returns at most pageSize documents
            expect(result.documents.length).toBeLessThanOrEqual(pageSize);

            // Pagination metadata is correct
            expect(result.total).toBe(docs.length);
            expect(result.totalPages).toBe(totalPages);

            collectedIds.push(...result.documents.map((d) => d.id));
          }

          // No overlap: all collected IDs are unique
          const uniqueIds = new Set(collectedIds);
          expect(uniqueIds.size).toBe(collectedIds.length);

          // Complete coverage: all documents are accounted for
          expect(collectedIds.length).toBe(docs.length);
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });
});

describe('Property 11: Default Sort Order', () => {
  beforeEach(() => {
    mockFindDocumentsByBusinessId.mockReset();
  });

  /**
   * **Validates: Requirements 7.5**
   *
   * For any document listing with default sort parameters (sortBy: 'uploadedAt',
   * sortOrder: 'desc'), the returned documents SHALL be sorted by uploadedAt
   * in descending order (newest first).
   */
  it('should return documents sorted by uploadedAt descending by default', async () => {
    const service = new DocumentService();

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.array(
          makeDocumentArb(
            fc.constant('biz-sort'),
            fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
          ),
          { minLength: 2, maxLength: 20 },
        ),
        async (businessId, rawDocs) => {
          const docs = rawDocs.map((d) => ({ ...d, businessId }));

          // Sort documents by uploadedAt descending (as the repository should)
          const sorted = [...docs].sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());

          const options: ListOptions = {
            page: 1,
            pageSize: 100,
            sortBy: 'uploadedAt',
            sortOrder: 'desc',
          };

          mockFindDocumentsByBusinessId.mockResolvedValueOnce({
            documents: sorted,
            total: sorted.length,
            page: 1,
            pageSize: 100,
            totalPages: 1,
          });

          const result = await service.listDocuments(businessId, options);

          // Verify descending order: each document's uploadedAt >= next document's
          for (let i = 0; i < result.documents.length - 1; i++) {
            const current = result.documents[i]!;
            const next = result.documents[i + 1]!;
            expect(current.uploadedAt.getTime()).toBeGreaterThanOrEqual(next.uploadedAt.getTime());
          }

          // Verify the service passed the correct default sort options
          expect(mockFindDocumentsByBusinessId).toHaveBeenCalledWith(businessId, options);
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });
});

describe('Property 12: Ownership Enforcement', () => {
  beforeEach(() => {
    mockFindDocumentById.mockReset();
    mockDeleteDocument.mockReset();
  });

  /**
   * **Validates: Requirements 8.4, 9.1, 9.5**
   *
   * For any cross-business access attempt on getDocumentById,
   * the service SHALL throw DocumentError with DOC_FORBIDDEN.
   */
  it('getDocumentById should reject access from a different business', async () => {
    const service = new DocumentService();

    const distinctBizArb = fc.tuple(fc.uuid(), fc.uuid()).filter(([a, b]) => a !== b);

    await fc.assert(
      fc.asyncProperty(
        distinctBizArb,
        makeDocumentArb(fc.constant('owner-biz')),
        async ([ownerBiz, requestingBiz], docTemplate) => {
          const doc: Document = { ...docTemplate, businessId: ownerBiz };

          mockFindDocumentById.mockResolvedValueOnce(doc);

          try {
            await service.getDocumentById(doc.id, requestingBiz);
            // Should not reach here
            expect.unreachable('Expected DocumentError to be thrown');
          } catch (err: unknown) {
            expect(err).toBeInstanceOf(DocumentError);
            expect((err as InstanceType<typeof DocumentError>).code).toBe(
              DOC_ERROR_CODES.FORBIDDEN,
            );
          }
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 9.1, 9.5**
   *
   * For any cross-business access attempt on deleteDocument,
   * the service SHALL throw DocumentError with DOC_FORBIDDEN
   * and the document SHALL remain unchanged (not deleted).
   */
  it('deleteDocument should reject deletion from a different business', async () => {
    const service = new DocumentService();

    const distinctBizArb = fc.tuple(fc.uuid(), fc.uuid()).filter(([a, b]) => a !== b);

    await fc.assert(
      fc.asyncProperty(
        distinctBizArb,
        makeDocumentArb(fc.constant('owner-biz')),
        async ([ownerBiz, requestingBiz], docTemplate) => {
          const doc: Document = { ...docTemplate, businessId: ownerBiz };

          mockFindDocumentById.mockResolvedValueOnce(doc);

          try {
            await service.deleteDocument(doc.id, requestingBiz);
            expect.unreachable('Expected DocumentError to be thrown');
          } catch (err: unknown) {
            expect(err).toBeInstanceOf(DocumentError);
            expect((err as InstanceType<typeof DocumentError>).code).toBe(
              DOC_ERROR_CODES.FORBIDDEN,
            );
          }

          // The repository delete should NOT have been called
          expect(mockDeleteDocument).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 8.4, 9.1**
   *
   * For any cross-business access attempt on verifyOwnership,
   * the service SHALL return false.
   */
  it('verifyOwnership should return false for a different business', async () => {
    const service = new DocumentService();

    const distinctBizArb = fc.tuple(fc.uuid(), fc.uuid()).filter(([a, b]) => a !== b);

    await fc.assert(
      fc.asyncProperty(
        distinctBizArb,
        makeDocumentArb(fc.constant('owner-biz')),
        async ([ownerBiz, requestingBiz], docTemplate) => {
          const doc: Document = { ...docTemplate, businessId: ownerBiz };

          mockFindDocumentById.mockResolvedValueOnce(doc);

          const result = await service.verifyOwnership(doc.id, requestingBiz);

          expect(result).toBe(false);
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 8.4, 9.1**
   *
   * For any access attempt by the owning business, getDocumentById
   * SHALL return the document successfully.
   */
  it('getDocumentById should allow access from the owning business', async () => {
    const service = new DocumentService();

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        makeDocumentArb(fc.constant('owner-biz')),
        async (ownerBiz, docTemplate) => {
          const doc: Document = { ...docTemplate, businessId: ownerBiz };

          mockFindDocumentById.mockResolvedValueOnce(doc);

          const result = await service.getDocumentById(doc.id, ownerBiz);

          expect(result.id).toBe(doc.id);
          expect(result.businessId).toBe(ownerBiz);
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });
});
