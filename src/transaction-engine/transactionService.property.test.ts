/**
 * Property-based tests for Ownership Enforcement
 *
 * **Property 7: Ownership Enforcement**
 * For any transactionId and userId:
 * 1. verifyOwnership returns true if and only if the transaction exists AND
 *    the user has a business AND transaction.businessId === business.id
 * 2. verifyOwnership returns false when transaction is null (for any userId)
 * 3. verifyOwnership returns false when business is null (for any transactionId)
 * 4. verifyOwnership returns false when businessIds don't match
 *
 * **Validates: Requirements 3.5, 7.5, 10.5, 11.5**
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFindById = vi.fn();
const mockCreateInRepo = vi.fn();
const mockBulkCreateInRepo = vi.fn();
const mockFindWithFilters = vi.fn();
const mockUpdateInRepo = vi.fn();
const mockSoftDelete = vi.fn();
vi.mock('./transactionRepository.js', () => ({
  findById: mockFindById,
  create: mockCreateInRepo,
  bulkCreate: mockBulkCreateInRepo,
  findWithFilters: mockFindWithFilters,
  update: mockUpdateInRepo,
  softDelete: mockSoftDelete,
}));

const mockGetBusinessByUserId = vi.fn();
vi.mock('../modules/business/services/businessService.js', () => ({
  getBusinessByUserId: mockGetBusinessByUserId,
}));

const mockQuery = vi.fn();
vi.mock('../utils/db.js', () => ({
  query: mockQuery,
}));

const mockNormalize = vi.fn();
const mockNormalizeBatch = vi.fn();
vi.mock('./normalizationService.js', () => ({
  normalize: mockNormalize,
  normalizeBatch: mockNormalizeBatch,
}));

const mockCategorize = vi.fn();
const mockValidateCategory = vi.fn();
vi.mock('./categorizationService.js', () => ({
  categorize: mockCategorize,
  validateCategory: mockValidateCategory,
}));

const mockDetectDuplicates = vi.fn();
vi.mock('./duplicateDetectionService.js', () => ({ detectDuplicates: mockDetectDuplicates }));

const mockLogCreate = vi.fn();
const mockLogUpdate = vi.fn();
const mockLogDelete = vi.fn();
const mockLogCategoryChange = vi.fn();
const mockGetAuditHistory = vi.fn();
vi.mock('./auditService.js', () => ({
  logCreate: mockLogCreate,
  logUpdate: mockLogUpdate,
  logDelete: mockLogDelete,
  logCategoryChange: mockLogCategoryChange,
  getAuditHistory: mockGetAuditHistory,
}));

// ─── Generators ──────────────────────────────────────────────────────────────

const uuidArb = fc.uuid();

const businessIdArb = fc.uuid();

const sourceTypeArb = fc.constantFrom('RECEIPT', 'BANK_STATEMENT', 'POS_EXPORT', 'MANUAL');

const transactionTypeArb = fc.constantFrom('INFLOW', 'OUTFLOW');

const categoryArb = fc.constantFrom(
  'INVENTORY_STOCK',
  'RENT_UTILITIES',
  'SALARIES_WAGES',
  'TRANSPORTATION_LOGISTICS',
  'MARKETING_ADVERTISING',
  'PROFESSIONAL_SERVICES',
  'EQUIPMENT_MAINTENANCE',
  'BANK_CHARGES_FEES',
  'TAXES_LEVIES',
  'MISCELLANEOUS_EXPENSES',
  'PRODUCT_SALES',
  'SERVICE_REVENUE',
  'OTHER_INCOME',
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTransaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'txn-default',
    businessId: 'biz-default',
    sourceDocumentId: null,
    sourceType: 'MANUAL',
    transactionType: 'OUTFLOW',
    transactionDate: new Date('2024-06-01'),
    description: 'Test transaction',
    amountKobo: 100000,
    counterparty: null,
    reference: null,
    category: 'MISCELLANEOUS_EXPENSES',
    categorySource: 'AUTO',
    categoryConfidence: 50,
    originalCategory: 'MISCELLANEOUS_EXPENSES',
    isPersonal: false,
    isDuplicate: false,
    duplicateOfId: null,
    notes: null,
    rawMetadata: {},
    searchVector: null,
    createdAt: new Date('2024-06-01T10:00:00Z'),
    updatedAt: new Date('2024-06-01T10:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeBusiness(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'biz-default',
    userId: 'user-default',
    name: 'Test Business',
    sector: 'RETAIL',
    currency: 'NGN',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    deletedAt: null,
    hardDeleteAt: null,
    ...overrides,
  };
}

async function loadModule(): Promise<typeof import('./transactionService.js')> {
  return import('./transactionService.js');
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 7: Ownership Enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true iff transaction exists AND business exists AND businessIds match', async () => {
    const { verifyOwnership } = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        businessIdArb,
        sourceTypeArb,
        transactionTypeArb,
        categoryArb,
        async (transactionId, userId, sharedBusinessId, sourceType, txnType, category) => {
          mockFindById.mockResolvedValueOnce(
            makeTransaction({
              id: transactionId,
              businessId: sharedBusinessId,
              sourceType,
              transactionType: txnType,
              category,
            }),
          );
          mockGetBusinessByUserId.mockResolvedValueOnce(
            makeBusiness({ id: sharedBusinessId, userId }),
          );

          const result = await verifyOwnership(transactionId, userId);

          expect(result).toBe(true);
          expect(mockFindById).toHaveBeenCalledWith(transactionId);
          expect(mockGetBusinessByUserId).toHaveBeenCalledWith(userId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns false when transaction is null for any userId', async () => {
    const { verifyOwnership } = await loadModule();

    await fc.assert(
      fc.asyncProperty(uuidArb, uuidArb, async (transactionId, userId) => {
        mockFindById.mockResolvedValueOnce(null);
        mockGetBusinessByUserId.mockResolvedValueOnce(makeBusiness({ id: 'biz-any', userId }));

        const result = await verifyOwnership(transactionId, userId);

        expect(result).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('returns false when business is null for any transactionId', async () => {
    const { verifyOwnership } = await loadModule();

    await fc.assert(
      fc.asyncProperty(uuidArb, uuidArb, async (transactionId, userId) => {
        mockFindById.mockResolvedValueOnce(
          makeTransaction({ id: transactionId, businessId: 'biz-some' }),
        );
        mockGetBusinessByUserId.mockResolvedValueOnce(null);

        const result = await verifyOwnership(transactionId, userId);

        expect(result).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('returns false when businessIds do not match', async () => {
    const { verifyOwnership } = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        businessIdArb,
        businessIdArb,
        async (transactionId, userId, txnBusinessId, userBusinessId) => {
          // Ensure the two business IDs are different
          fc.pre(txnBusinessId !== userBusinessId);

          mockFindById.mockResolvedValueOnce(
            makeTransaction({ id: transactionId, businessId: txnBusinessId }),
          );
          mockGetBusinessByUserId.mockResolvedValueOnce(
            makeBusiness({ id: userBusinessId, userId }),
          );

          const result = await verifyOwnership(transactionId, userId);

          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns false when both transaction and business are null', async () => {
    const { verifyOwnership } = await loadModule();

    await fc.assert(
      fc.asyncProperty(uuidArb, uuidArb, async (transactionId, userId) => {
        mockFindById.mockResolvedValueOnce(null);
        mockGetBusinessByUserId.mockResolvedValueOnce(null);

        const result = await verifyOwnership(transactionId, userId);

        expect(result).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Generators for Property 8 ──────────────────────────────────────────────

const rawTransactionArb = fc.record({
  date: fc.oneof(
    fc
      .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
      .map((d) => d.toISOString()),
    fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
  ),
  description: fc.string({ minLength: 1, maxLength: 200 }),
  amount: fc.double({ min: 0.01, max: 1_000_000, noNaN: true }),
  type: fc.option(fc.constantFrom('credit' as const, 'debit' as const), { nil: undefined }),
  reference: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  counterparty: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
  metadata: fc.option(fc.constant({} as Record<string, unknown>), { nil: undefined }),
});

const ipAddressArb = fc.ipV4();

const userAgentArb = fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null });

// ─── Property 8 Tests ───────────────────────────────────────────────────────

/**
 * Property 8: Default Personal Flag
 *
 * For any valid raw transaction input, the isPersonal field passed to the
 * repository create is always false, and the created transaction always has
 * isPersonal === false regardless of input variations.
 *
 * **Validates: Requirements 4.2**
 */
describe('Property 8: Default Personal Flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('always passes isPersonal=false to the repository regardless of input', async () => {
    const { createTransaction } = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        rawTransactionArb,
        businessIdArb,
        sourceTypeArb,
        fc.option(uuidArb, { nil: null }),
        uuidArb,
        ipAddressArb,
        userAgentArb,
        async (raw, businessId, sourceType, sourceDocumentId, userId, ipAddress, userAgent) => {
          const normalizedStub = {
            transactionDate: new Date('2024-06-01'),
            description: raw.description,
            amountKobo: Math.round(raw.amount * 100),
            transactionType: 'OUTFLOW' as const,
            counterparty: raw.counterparty ?? null,
            reference: raw.reference ?? null,
            rawMetadata: raw.metadata ?? {},
          };

          const categorizationStub = {
            category: 'MISCELLANEOUS_EXPENSES' as const,
            confidence: 50,
            source: 'AUTO' as const,
            alternativeCategories: [],
          };

          const savedTransaction = makeTransaction({
            id: 'txn-new',
            businessId,
            sourceType,
            sourceDocumentId,
            description: raw.description,
            amountKobo: normalizedStub.amountKobo,
            isPersonal: false,
          });

          mockNormalize.mockReturnValueOnce(normalizedStub);
          mockCategorize.mockReturnValueOnce(categorizationStub);
          mockCreateInRepo.mockResolvedValueOnce(savedTransaction);
          mockDetectDuplicates.mockResolvedValueOnce([]);
          mockLogCreate.mockResolvedValueOnce(undefined);

          const result = await createTransaction(
            raw,
            businessId,
            sourceType,
            sourceDocumentId,
            userId,
            ipAddress,
            userAgent,
          );

          // Verify isPersonal=false was passed to the repository
          const createArg = mockCreateInRepo.mock.calls[0][0] as Record<string, unknown>;
          expect(createArg.isPersonal).toBe(false);

          // Verify the returned transaction has isPersonal=false
          expect(result.isPersonal).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('created transaction has isPersonal=false for all source types', async () => {
    const { createTransaction } = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        rawTransactionArb,
        businessIdArb,
        sourceTypeArb,
        uuidArb,
        uuidArb,
        ipAddressArb,
        async (raw, businessId, sourceType, userId, sourceDocId, ipAddress) => {
          const normalizedStub = {
            transactionDate: new Date('2024-06-01'),
            description: raw.description,
            amountKobo: Math.round(raw.amount * 100),
            transactionType: 'INFLOW' as const,
            counterparty: raw.counterparty ?? null,
            reference: raw.reference ?? null,
            rawMetadata: raw.metadata ?? {},
          };

          const categorizationStub = {
            category: 'OTHER_INCOME' as const,
            confidence: 80,
            source: 'AUTO' as const,
            alternativeCategories: [],
          };

          const savedTransaction = makeTransaction({
            id: 'txn-new-2',
            businessId,
            sourceType,
            sourceDocumentId: sourceDocId,
            transactionType: 'INFLOW',
            description: raw.description,
            amountKobo: normalizedStub.amountKobo,
            isPersonal: false,
            category: 'OTHER_INCOME',
          });

          mockNormalize.mockReturnValueOnce(normalizedStub);
          mockCategorize.mockReturnValueOnce(categorizationStub);
          mockCreateInRepo.mockResolvedValueOnce(savedTransaction);
          mockDetectDuplicates.mockResolvedValueOnce([]);
          mockLogCreate.mockResolvedValueOnce(undefined);

          const result = await createTransaction(
            raw,
            businessId,
            sourceType,
            sourceDocId,
            userId,
            ipAddress,
          );

          expect(result.isPersonal).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Generators for Property 16 & 17 ────────────────────────────────────────

const bulkRawTransactionArb = fc.record({
  date: fc.oneof(
    fc
      .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
      .map((d) => d.toISOString()),
    fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
  ),
  description: fc.string({ minLength: 1, maxLength: 200 }),
  amount: fc.double({ min: 0.01, max: 1_000_000, noNaN: true }),
  type: fc.option(fc.constantFrom('credit' as const, 'debit' as const), { nil: undefined }),
  reference: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  counterparty: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
  metadata: fc.option(fc.constant({} as Record<string, unknown>), { nil: undefined }),
});

const bulkRawTransactionsArb = fc.array(bulkRawTransactionArb, { minLength: 1, maxLength: 20 });

// ─── Property 16 Tests ──────────────────────────────────────────────────────

/**
 * Property 16: Bulk Creation Atomicity
 *
 * For any batch of N raw transactions, bulkCreateInRepo is called exactly once
 * with exactly N items. This verifies atomicity — all transactions go through
 * a single DB transaction call.
 *
 * **Validates: Requirements 8.2, 8.3**
 */
describe('Property 16: Bulk Creation Atomicity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls bulkCreateInRepo exactly once with exactly N items for any batch of N raw transactions', async () => {
    const { bulkCreate } = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        bulkRawTransactionsArb,
        businessIdArb,
        sourceTypeArb,
        uuidArb,
        uuidArb,
        ipAddressArb,
        userAgentArb,
        async (
          rawTransactions,
          businessId,
          sourceType,
          sourceDocumentId,
          userId,
          ipAddress,
          userAgent,
        ) => {
          // Reset mocks between fast-check iterations
          vi.clearAllMocks();

          const n = rawTransactions.length;

          // Stub normalizeBatch to return N normalized transactions
          const normalizedStubs = rawTransactions.map((raw, i) => ({
            transactionDate: new Date('2024-06-01'),
            description: raw.description,
            amountKobo: Math.round(raw.amount * 100),
            transactionType: (i % 2 === 0 ? 'OUTFLOW' : 'INFLOW') as const,
            counterparty: raw.counterparty ?? null,
            reference: raw.reference ?? null,
            rawMetadata: raw.metadata ?? {},
          }));
          mockNormalizeBatch.mockReturnValueOnce(normalizedStubs);

          // Stub categorize for each normalized transaction
          normalizedStubs.forEach(() => {
            mockCategorize.mockReturnValueOnce({
              category: 'MISCELLANEOUS_EXPENSES' as const,
              confidence: 50,
              source: 'AUTO' as const,
              alternativeCategories: [],
            });
          });

          // Stub bulkCreateInRepo to return N saved transactions
          const savedTransactions = normalizedStubs.map((norm, i) =>
            makeTransaction({
              id: `txn-bulk-${i}`,
              businessId,
              sourceType,
              sourceDocumentId,
              description: norm.description,
              amountKobo: norm.amountKobo,
              transactionType: norm.transactionType,
            }),
          );
          mockBulkCreateInRepo.mockResolvedValueOnce(savedTransactions);

          // Stub duplicate detection and audit logging
          mockDetectDuplicates.mockResolvedValueOnce([]);
          savedTransactions.forEach(() => {
            mockLogCreate.mockResolvedValueOnce(undefined);
          });

          await bulkCreate(
            rawTransactions,
            businessId,
            sourceType,
            sourceDocumentId,
            userId,
            ipAddress,
            userAgent,
          );

          // bulkCreateInRepo must be called exactly once (atomicity)
          expect(mockBulkCreateInRepo).toHaveBeenCalledTimes(1);

          // The single call must receive exactly N items
          const callArgs = mockBulkCreateInRepo.mock.calls[0][0] as unknown[];
          expect(callArgs).toHaveLength(n);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 17 Tests ──────────────────────────────────────────────────────

/**
 * Property 17: Bulk Creation Count Accuracy
 *
 * For any batch of N raw transactions, the returned BulkCreateResult.created
 * equals the number of transactions returned by bulkCreateInRepo, and
 * BulkCreateResult.transactions.length equals created.
 *
 * **Validates: Requirements 8.4, 8.6**
 */
describe('Property 17: Bulk Creation Count Accuracy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns created === transactions.length === number of items from bulkCreateInRepo', async () => {
    const { bulkCreate } = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        bulkRawTransactionsArb,
        businessIdArb,
        sourceTypeArb,
        uuidArb,
        uuidArb,
        ipAddressArb,
        userAgentArb,
        async (
          rawTransactions,
          businessId,
          sourceType,
          sourceDocumentId,
          userId,
          ipAddress,
          userAgent,
        ) => {
          // Reset mocks between fast-check iterations
          vi.clearAllMocks();

          const n = rawTransactions.length;

          // Stub normalizeBatch to return N normalized transactions
          const normalizedStubs = rawTransactions.map((raw, i) => ({
            transactionDate: new Date('2024-06-01'),
            description: raw.description,
            amountKobo: Math.round(raw.amount * 100),
            transactionType: (i % 2 === 0 ? 'OUTFLOW' : 'INFLOW') as const,
            counterparty: raw.counterparty ?? null,
            reference: raw.reference ?? null,
            rawMetadata: raw.metadata ?? {},
          }));
          mockNormalizeBatch.mockReturnValueOnce(normalizedStubs);

          // Stub categorize for each normalized transaction
          normalizedStubs.forEach(() => {
            mockCategorize.mockReturnValueOnce({
              category: 'MISCELLANEOUS_EXPENSES' as const,
              confidence: 50,
              source: 'AUTO' as const,
              alternativeCategories: [],
            });
          });

          // Stub bulkCreateInRepo to return N saved transactions
          const savedTransactions = normalizedStubs.map((norm, i) =>
            makeTransaction({
              id: `txn-bulk-${i}`,
              businessId,
              sourceType,
              sourceDocumentId,
              description: norm.description,
              amountKobo: norm.amountKobo,
              transactionType: norm.transactionType,
            }),
          );
          mockBulkCreateInRepo.mockResolvedValueOnce(savedTransactions);

          // Stub duplicate detection and audit logging
          mockDetectDuplicates.mockResolvedValueOnce([]);
          savedTransactions.forEach(() => {
            mockLogCreate.mockResolvedValueOnce(undefined);
          });

          const result = await bulkCreate(
            rawTransactions,
            businessId,
            sourceType,
            sourceDocumentId,
            userId,
            ipAddress,
            userAgent,
          );

          // created count must equal the number of transactions returned by repo
          expect(result.created).toBe(n);

          // transactions array length must equal created count
          expect(result.transactions).toHaveLength(result.created);

          // transactions array length must equal N (the input batch size)
          expect(result.transactions).toHaveLength(n);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 15 Tests ──────────────────────────────────────────────────────

/**
 * Property 15: Transaction Details Completeness
 *
 * For any valid transactionId and userId where ownership is verified:
 * 1. getTransactionById returns a transaction with ALL required fields present
 *    (id, businessId, sourceType, transactionType, transactionDate, description,
 *    amountKobo, category, categorySource, isPersonal, createdAt, updatedAt)
 * 2. When ownership fails, getTransactionById always returns null
 * 3. The returned transaction includes sourceDocumentId and sourceType for
 *    source document linkage (Req 7.2)
 * 4. The returned transaction includes both category and originalCategory
 *    with categorySource (Req 7.3)
 *
 * **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
 */

const categorySourceArb = fc.constantFrom('AUTO' as const, 'MANUAL' as const);

const sourceDocumentIdArb = fc.option(uuidArb, { nil: null });

const confidenceArb = fc.option(fc.integer({ min: 0, max: 100 }), { nil: null });

describe('Property 15: Transaction Details Completeness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a transaction with ALL required fields when ownership is verified', async () => {
    const { getTransactionById } = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        businessIdArb,
        sourceTypeArb,
        transactionTypeArb,
        categoryArb,
        categorySourceArb,
        confidenceArb,
        sourceDocumentIdArb,
        async (
          transactionId,
          userId,
          sharedBusinessId,
          sourceType,
          txnType,
          category,
          catSource,
          confidence,
          sourceDocId,
        ) => {
          const transaction = makeTransaction({
            id: transactionId,
            businessId: sharedBusinessId,
            sourceDocumentId: sourceDocId,
            sourceType,
            transactionType: txnType,
            category,
            categorySource: catSource,
            categoryConfidence: confidence,
            originalCategory: category,
          });

          const business = makeBusiness({ id: sharedBusinessId, userId });

          // getTransactionById calls findById + getBusinessByUserId in parallel
          mockFindById.mockResolvedValueOnce(transaction);
          mockGetBusinessByUserId.mockResolvedValueOnce(business);

          const result = await getTransactionById(transactionId, userId);

          expect(result).not.toBeNull();

          // Req 7.1: All required fields must be present
          const requiredFields = [
            'id',
            'businessId',
            'sourceType',
            'transactionType',
            'transactionDate',
            'description',
            'amountKobo',
            'category',
            'categorySource',
            'isPersonal',
            'createdAt',
            'updatedAt',
          ] as const;

          for (const field of requiredFields) {
            expect(result).toHaveProperty(field);
            expect((result as Record<string, unknown>)[field]).not.toBeUndefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('throws TXN_FORBIDDEN when ownership verification fails', async () => {
    const { getTransactionById } = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        businessIdArb,
        businessIdArb,
        async (transactionId, userId, txnBusinessId, userBusinessId) => {
          // Ensure business IDs differ so ownership fails
          fc.pre(txnBusinessId !== userBusinessId);

          mockFindById.mockResolvedValueOnce(
            makeTransaction({ id: transactionId, businessId: txnBusinessId }),
          );
          mockGetBusinessByUserId.mockResolvedValueOnce(
            makeBusiness({ id: userBusinessId, userId }),
          );

          const err = await getTransactionById(transactionId, userId).catch(
            (e: Error & { code: string }) => e,
          );
          expect(err).toBeInstanceOf(Error);
          expect((err as Error & { code: string }).code).toBe('TXN_FORBIDDEN');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('includes sourceDocumentId and sourceType for source document linkage (Req 7.2)', async () => {
    const { getTransactionById } = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        businessIdArb,
        sourceTypeArb,
        sourceDocumentIdArb,
        async (transactionId, userId, sharedBusinessId, sourceType, sourceDocId) => {
          const transaction = makeTransaction({
            id: transactionId,
            businessId: sharedBusinessId,
            sourceDocumentId: sourceDocId,
            sourceType,
          });

          const business = makeBusiness({ id: sharedBusinessId, userId });

          // getTransactionById: findById + getBusinessByUserId in parallel
          mockFindById.mockResolvedValueOnce(transaction);
          mockGetBusinessByUserId.mockResolvedValueOnce(business);

          const result = await getTransactionById(transactionId, userId);

          expect(result).not.toBeNull();
          expect(result).toHaveProperty('sourceDocumentId');
          expect(result).toHaveProperty('sourceType');
          expect((result as Record<string, unknown>).sourceType).toBe(sourceType);
          expect((result as Record<string, unknown>).sourceDocumentId).toBe(sourceDocId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('includes category, originalCategory, and categorySource (Req 7.3)', async () => {
    const { getTransactionById } = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        businessIdArb,
        categoryArb,
        categoryArb,
        categorySourceArb,
        async (
          transactionId,
          userId,
          sharedBusinessId,
          currentCategory,
          origCategory,
          catSource,
        ) => {
          const transaction = makeTransaction({
            id: transactionId,
            businessId: sharedBusinessId,
            category: currentCategory,
            originalCategory: origCategory,
            categorySource: catSource,
          });

          const business = makeBusiness({ id: sharedBusinessId, userId });

          // getTransactionById: findById + getBusinessByUserId in parallel
          mockFindById.mockResolvedValueOnce(transaction);
          mockGetBusinessByUserId.mockResolvedValueOnce(business);

          const result = await getTransactionById(transactionId, userId);

          expect(result).not.toBeNull();
          expect((result as Record<string, unknown>).category).toBe(currentCategory);
          expect((result as Record<string, unknown>).originalCategory).toBe(origCategory);
          expect((result as Record<string, unknown>).categorySource).toBe(catSource);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Generators for Property 22 & 24 ────────────────────────────────────────

const immutableFieldArb = fc.constantFrom(
  'amount',
  'amountKobo',
  'sourceType',
  'sourceDocumentId',
  'transactionType',
);

const allowedCategoryArb = fc.constantFrom(
  'INVENTORY_STOCK',
  'RENT_UTILITIES',
  'SALARIES_WAGES',
  'TRANSPORTATION_LOGISTICS',
  'MARKETING_ADVERTISING',
  'PROFESSIONAL_SERVICES',
  'EQUIPMENT_MAINTENANCE',
  'BANK_CHARGES_FEES',
  'TAXES_LEVIES',
  'MISCELLANEOUS_EXPENSES',
  'PRODUCT_SALES',
  'SERVICE_REVENUE',
  'OTHER_INCOME',
);

const updatesArb = fc.record(
  {
    description: fc.string({ minLength: 1, maxLength: 200 }),
    transactionDate: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
    category: allowedCategoryArb,
    isPersonal: fc.boolean(),
    notes: fc.string({ minLength: 0, maxLength: 500 }),
  },
  { requiredKeys: [] },
);

// ─── Property 22 Tests ──────────────────────────────────────────────────────

/**
 * Property 22: Immutable Fields Protection
 *
 * For any update attempt, the repository update call NEVER includes amount,
 * sourceType, sourceDocumentId, or transactionType fields. Only allowed fields
 * (description, transactionDate, category, isPersonal, notes, categorySource)
 * are passed.
 *
 * **Validates: Requirements 11.2**
 */
describe('Property 22: Immutable Fields Protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never passes immutable fields (amount, sourceType, sourceDocumentId, transactionType) to the repository update', async () => {
    const { updateTransaction } = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        businessIdArb,
        updatesArb,
        ipAddressArb,
        userAgentArb,
        async (transactionId, userId, sharedBusinessId, updates, ipAddress, userAgent) => {
          vi.clearAllMocks();

          const existingTxn = makeTransaction({
            id: transactionId,
            businessId: sharedBusinessId,
            category: 'MISCELLANEOUS_EXPENSES',
            transactionType: 'OUTFLOW',
          });

          const business = makeBusiness({ id: sharedBusinessId, userId });

          // verifyOwnership: findById + getBusinessByUserId
          mockFindById.mockResolvedValueOnce(existingTxn);
          mockGetBusinessByUserId.mockResolvedValueOnce(business);
          // updateTransaction fetches current: findById again
          mockFindById.mockResolvedValueOnce(existingTxn);

          // If category is changing, validateCategory must return true
          if (updates.category !== undefined && updates.category !== existingTxn.category) {
            mockValidateCategory.mockReturnValueOnce(true);
            mockLogCategoryChange.mockResolvedValueOnce(undefined);
          }

          // updateInRepo returns the updated transaction
          const updatedTxn = makeTransaction({
            ...existingTxn,
            ...updates,
            updatedAt: new Date(),
          });
          mockUpdateInRepo.mockResolvedValueOnce(updatedTxn);
          mockLogUpdate.mockResolvedValueOnce(undefined);

          await updateTransaction(transactionId, userId, updates, ipAddress, userAgent);

          // Verify updateInRepo was called
          expect(mockUpdateInRepo).toHaveBeenCalledTimes(1);

          const repoUpdatePayload = mockUpdateInRepo.mock.calls[0]![1] as Record<string, unknown>;

          // Immutable fields must NEVER appear in the repo update payload
          const immutableFields = [
            'amount',
            'amountKobo',
            'sourceType',
            'sourceDocumentId',
            'transactionType',
          ];

          for (const field of immutableFields) {
            expect(repoUpdatePayload).not.toHaveProperty(field);
          }

          // Only allowed fields should be present
          const allowedFields = new Set([
            'description',
            'transactionDate',
            'category',
            'categorySource',
            'isPersonal',
            'notes',
          ]);

          for (const key of Object.keys(repoUpdatePayload)) {
            expect(allowedFields.has(key)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('strips immutable fields even if caller sneaks them into the updates object', async () => {
    const { updateTransaction } = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        businessIdArb,
        immutableFieldArb,
        fc.oneof(fc.integer({ min: 1, max: 999999 }), fc.string({ minLength: 1, maxLength: 50 })),
        ipAddressArb,
        async (transactionId, userId, sharedBusinessId, immutableField, immutableValue, ip) => {
          vi.clearAllMocks();

          const existingTxn = makeTransaction({
            id: transactionId,
            businessId: sharedBusinessId,
            category: 'MISCELLANEOUS_EXPENSES',
            transactionType: 'OUTFLOW',
          });

          const business = makeBusiness({ id: sharedBusinessId, userId });

          // verifyOwnership
          mockFindById.mockResolvedValueOnce(existingTxn);
          mockGetBusinessByUserId.mockResolvedValueOnce(business);
          // fetch current
          mockFindById.mockResolvedValueOnce(existingTxn);

          const updatedTxn = makeTransaction({
            ...existingTxn,
            updatedAt: new Date(),
          });
          mockUpdateInRepo.mockResolvedValueOnce(updatedTxn);
          mockLogUpdate.mockResolvedValueOnce(undefined);

          // Sneak an immutable field into the updates
          const sneakyUpdates = {
            description: 'Updated description',
            [immutableField]: immutableValue,
          } as Record<string, unknown>;

          await updateTransaction(transactionId, userId, sneakyUpdates as never, ip);

          expect(mockUpdateInRepo).toHaveBeenCalledTimes(1);

          const repoPayload = mockUpdateInRepo.mock.calls[0]![1] as Record<string, unknown>;

          // The immutable field must not appear in the repo payload
          const immutableFields = [
            'amount',
            'amountKobo',
            'sourceType',
            'sourceDocumentId',
            'transactionType',
          ];

          for (const field of immutableFields) {
            expect(repoPayload).not.toHaveProperty(field);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 24 Tests ──────────────────────────────────────────────────────

/**
 * Property 24: Updated Timestamp Invariant
 *
 * For any successful update, the returned transaction's updatedAt is always
 * a Date instance (the repository handles setting it).
 *
 * **Validates: Requirements 11.4**
 */
describe('Property 24: Updated Timestamp Invariant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returned transaction always has updatedAt as a Date instance after any update', async () => {
    const { updateTransaction } = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        businessIdArb,
        updatesArb,
        ipAddressArb,
        userAgentArb,
        async (transactionId, userId, sharedBusinessId, updates, ipAddress, userAgent) => {
          vi.clearAllMocks();

          const existingTxn = makeTransaction({
            id: transactionId,
            businessId: sharedBusinessId,
            category: 'MISCELLANEOUS_EXPENSES',
            transactionType: 'OUTFLOW',
          });

          const business = makeBusiness({ id: sharedBusinessId, userId });

          // verifyOwnership
          mockFindById.mockResolvedValueOnce(existingTxn);
          mockGetBusinessByUserId.mockResolvedValueOnce(business);
          // fetch current
          mockFindById.mockResolvedValueOnce(existingTxn);

          // If category is changing, validateCategory must return true
          if (updates.category !== undefined && updates.category !== existingTxn.category) {
            mockValidateCategory.mockReturnValueOnce(true);
            mockLogCategoryChange.mockResolvedValueOnce(undefined);
          }

          // The repo returns a transaction with updatedAt set to a new Date
          const updatedTxn = makeTransaction({
            ...existingTxn,
            ...updates,
            updatedAt: new Date(),
          });
          mockUpdateInRepo.mockResolvedValueOnce(updatedTxn);
          mockLogUpdate.mockResolvedValueOnce(undefined);

          const result = await updateTransaction(
            transactionId,
            userId,
            updates,
            ipAddress,
            userAgent,
          );

          // updatedAt must always be a Date instance
          expect(result.updatedAt).toBeInstanceOf(Date);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 21 Tests ──────────────────────────────────────────────────────

/**
 * Property 21: Soft Delete Behavior
 *
 * For any valid transactionId and userId where ownership is verified,
 * deleteTransaction calls softDelete (not hard delete) and logDelete.
 * When ownership fails, it throws 403.
 *
 * **Validates: Requirements 10.1, 10.2, 10.3**
 */
describe('Property 21: Soft Delete Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls softDelete and logDelete when ownership is verified', async () => {
    const { deleteTransaction } = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        businessIdArb,
        ipAddressArb,
        userAgentArb,
        async (transactionId, userId, sharedBusinessId, ipAddress, userAgent) => {
          vi.clearAllMocks();

          const transaction = makeTransaction({
            id: transactionId,
            businessId: sharedBusinessId,
          });
          const business = makeBusiness({ id: sharedBusinessId, userId });

          // verifyOwnership: findById + getBusinessByUserId
          mockFindById.mockResolvedValueOnce(transaction);
          mockGetBusinessByUserId.mockResolvedValueOnce(business);

          // softDelete returns the deleted transaction (not null)
          const deletedTxn = makeTransaction({
            ...transaction,
            deletedAt: new Date(),
          });
          mockSoftDelete.mockResolvedValueOnce(deletedTxn);
          mockLogDelete.mockResolvedValueOnce(undefined);

          await deleteTransaction(transactionId, userId, ipAddress, userAgent);

          // softDelete must be called (not a hard delete)
          expect(mockSoftDelete).toHaveBeenCalledWith(transactionId);
          expect(mockSoftDelete).toHaveBeenCalledTimes(1);

          // logDelete must be called for audit trail
          expect(mockLogDelete).toHaveBeenCalledWith(transactionId, userId, ipAddress, userAgent);
          expect(mockLogDelete).toHaveBeenCalledTimes(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('throws 403 when ownership verification fails', async () => {
    const { deleteTransaction } = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        businessIdArb,
        businessIdArb,
        ipAddressArb,
        async (transactionId, userId, txnBusinessId, userBusinessId, ipAddress) => {
          fc.pre(txnBusinessId !== userBusinessId);
          vi.clearAllMocks();

          mockFindById.mockResolvedValueOnce(
            makeTransaction({ id: transactionId, businessId: txnBusinessId }),
          );
          mockGetBusinessByUserId.mockResolvedValueOnce(
            makeBusiness({ id: userBusinessId, userId }),
          );

          await expect(deleteTransaction(transactionId, userId, ipAddress)).rejects.toThrow(
            'Forbidden',
          );

          // softDelete and logDelete must NOT be called
          expect(mockSoftDelete).not.toHaveBeenCalled();
          expect(mockLogDelete).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 9 Tests ───────────────────────────────────────────────────────

/**
 * Property 9: Personal Transaction Exclusion
 *
 * For any set of transactions where some are marked isPersonal=true,
 * calculateBusinessTotals excludes personal transactions from the totals.
 * The function queries with isPersonal=false filter, so the repository
 * only returns non-personal transactions.
 *
 * **Validates: Requirements 4.4**
 */

const amountKoboArb = fc.integer({ min: 1, max: 100_000_000 });

describe('Property 9: Personal Transaction Exclusion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('totals only include non-personal transactions (isPersonal=false filter is applied)', async () => {
    const { calculateBusinessTotals } = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        businessIdArb,
        fc.array(
          fc.record({
            type: transactionTypeArb,
            amount: amountKoboArb,
          }),
          { minLength: 0, maxLength: 20 },
        ),
        async (businessId, txnSpecs) => {
          vi.clearAllMocks();

          // Calculate expected totals
          let expectedInflow = 0;
          let expectedOutflow = 0;
          for (const spec of txnSpecs) {
            if (spec.type === 'INFLOW') {
              expectedInflow += spec.amount;
            } else {
              expectedOutflow += spec.amount;
            }
          }

          // Build SQL aggregate rows
          const rows: { transaction_type: string; total: string }[] = [];
          if (expectedInflow > 0) {
            rows.push({ transaction_type: 'INFLOW', total: String(expectedInflow) });
          }
          if (expectedOutflow > 0) {
            rows.push({ transaction_type: 'OUTFLOW', total: String(expectedOutflow) });
          }

          mockQuery.mockResolvedValueOnce({ rows });

          const result = await calculateBusinessTotals(businessId);

          // Verify the SQL query filters by business_id and is_personal=false
          expect(mockQuery).toHaveBeenCalledTimes(1);
          expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('is_personal = false'), [
            businessId,
          ]);

          expect(result.totalInflow).toBe(expectedInflow);
          expect(result.totalOutflow).toBe(expectedOutflow);
          expect(result.netCashflow).toBe(expectedInflow - expectedOutflow);
        },
      ),
      { numRuns: 100 },
    );
  });
});
