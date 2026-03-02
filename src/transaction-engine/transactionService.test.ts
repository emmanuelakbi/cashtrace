import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Transaction } from './types.js';

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
vi.mock('./duplicateDetectionService.js', () => ({
  detectDuplicates: mockDetectDuplicates,
}));

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'txn-1',
    businessId: 'biz-1',
    sourceDocumentId: null,
    sourceType: 'MANUAL',
    transactionType: 'OUTFLOW',
    transactionDate: new Date('2024-06-01'),
    description: 'Office supplies',
    amountKobo: 500000,
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
    id: 'biz-1',
    userId: 'user-1',
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('transactionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('verifyOwnership', () => {
    it('should return true when the user business owns the transaction', async () => {
      mockFindById.mockResolvedValueOnce(makeTransaction({ businessId: 'biz-1' }));
      mockGetBusinessByUserId.mockResolvedValueOnce(makeBusiness({ id: 'biz-1' }));

      const { verifyOwnership } = await import('./transactionService.js');
      const result = await verifyOwnership('txn-1', 'user-1');

      expect(result).toBe(true);
      expect(mockFindById).toHaveBeenCalledWith('txn-1');
      expect(mockGetBusinessByUserId).toHaveBeenCalledWith('user-1');
    });

    it('should return false when the transaction is not found', async () => {
      mockFindById.mockResolvedValueOnce(null);
      mockGetBusinessByUserId.mockResolvedValueOnce(makeBusiness());

      const { verifyOwnership } = await import('./transactionService.js');
      const result = await verifyOwnership('txn-nonexistent', 'user-1');

      expect(result).toBe(false);
    });

    it('should return false when the user has no business', async () => {
      mockFindById.mockResolvedValueOnce(makeTransaction());
      mockGetBusinessByUserId.mockResolvedValueOnce(null);

      const { verifyOwnership } = await import('./transactionService.js');
      const result = await verifyOwnership('txn-1', 'user-no-biz');

      expect(result).toBe(false);
    });

    it('should return false when the businessId does not match', async () => {
      mockFindById.mockResolvedValueOnce(makeTransaction({ businessId: 'biz-other' }));
      mockGetBusinessByUserId.mockResolvedValueOnce(makeBusiness({ id: 'biz-1' }));

      const { verifyOwnership } = await import('./transactionService.js');
      const result = await verifyOwnership('txn-1', 'user-1');

      expect(result).toBe(false);
    });

    it('should return false when both transaction and business are not found', async () => {
      mockFindById.mockResolvedValueOnce(null);
      mockGetBusinessByUserId.mockResolvedValueOnce(null);

      const { verifyOwnership } = await import('./transactionService.js');
      const result = await verifyOwnership('txn-1', 'user-1');

      expect(result).toBe(false);
    });

    it('should fetch transaction and business in parallel', async () => {
      mockFindById.mockResolvedValueOnce(makeTransaction());
      mockGetBusinessByUserId.mockResolvedValueOnce(makeBusiness());

      const { verifyOwnership } = await import('./transactionService.js');
      await verifyOwnership('txn-1', 'user-1');

      // Both should be called (Promise.all fires them concurrently)
      expect(mockFindById).toHaveBeenCalledOnce();
      expect(mockGetBusinessByUserId).toHaveBeenCalledOnce();
    });
  });

  describe('createTransaction', () => {
    const rawTransaction = {
      date: '2024-06-15',
      description: 'Payment for fuel at Total station',
      amount: 5000,
      type: 'debit' as const,
      reference: 'REF-001',
      counterparty: 'Total Nigeria',
    };

    const normalizedTransaction = {
      transactionDate: new Date('2024-06-15'),
      description: 'Payment for fuel at Total station',
      amountKobo: 500000,
      transactionType: 'OUTFLOW' as const,
      counterparty: 'Total Nigeria',
      reference: 'REF-001',
      rawMetadata: {},
    };

    const categorizationResult = {
      category: 'TRANSPORTATION_LOGISTICS' as const,
      confidence: 85,
      source: 'AUTO' as const,
      alternativeCategories: [],
    };

    const savedTransaction = makeTransaction({
      id: 'txn-new',
      businessId: 'biz-1',
      sourceType: 'RECEIPT',
      sourceDocumentId: 'doc-1',
      transactionType: 'OUTFLOW',
      transactionDate: new Date('2024-06-15'),
      description: 'Payment for fuel at Total station',
      amountKobo: 500000,
      counterparty: 'Total Nigeria',
      reference: 'REF-001',
      category: 'TRANSPORTATION_LOGISTICS',
      categorySource: 'AUTO',
      categoryConfidence: 85,
      originalCategory: 'TRANSPORTATION_LOGISTICS',
      isPersonal: false,
    });

    beforeEach(() => {
      mockNormalize.mockReturnValue(normalizedTransaction);
      mockCategorize.mockReturnValue(categorizationResult);
      mockCreateInRepo.mockResolvedValue(savedTransaction);
      mockDetectDuplicates.mockResolvedValue([]);
      mockLogCreate.mockResolvedValue({
        id: 'audit-1',
        transactionId: 'txn-new',
        userId: 'user-1',
        action: 'CREATE',
        changes: [],
        ipAddress: '127.0.0.1',
        userAgent: null,
        createdAt: new Date(),
      });
    });

    it('should normalize, categorize, save, detect duplicates, and log creation', async () => {
      const { createTransaction } = await import('./transactionService.js');

      const result = await createTransaction(
        rawTransaction,
        'biz-1',
        'RECEIPT',
        'doc-1',
        'user-1',
        '127.0.0.1',
      );

      expect(result).toEqual(savedTransaction);

      // 1. Normalize called with raw + sourceType
      expect(mockNormalize).toHaveBeenCalledWith(rawTransaction, 'RECEIPT');

      // 2. Categorize called with normalized transaction
      expect(mockCategorize).toHaveBeenCalledWith(normalizedTransaction);

      // 3. Repository create called with correct data
      expect(mockCreateInRepo).toHaveBeenCalledWith({
        businessId: 'biz-1',
        sourceDocumentId: 'doc-1',
        sourceType: 'RECEIPT',
        transactionType: 'OUTFLOW',
        transactionDate: new Date('2024-06-15'),
        description: 'Payment for fuel at Total station',
        amountKobo: 500000,
        counterparty: 'Total Nigeria',
        reference: 'REF-001',
        category: 'TRANSPORTATION_LOGISTICS',
        categorySource: 'AUTO',
        categoryConfidence: 85,
        originalCategory: 'TRANSPORTATION_LOGISTICS',
        isPersonal: false,
        isDuplicate: false,
        duplicateOfId: null,
        notes: null,
        rawMetadata: {},
      });

      // 4. Duplicate detection called with new transaction ID
      expect(mockDetectDuplicates).toHaveBeenCalledWith(['txn-new'], 'biz-1');

      // 5. Audit log called
      expect(mockLogCreate).toHaveBeenCalledWith('txn-new', 'user-1', '127.0.0.1', undefined);
    });

    it('should set isPersonal to false by default', async () => {
      const { createTransaction } = await import('./transactionService.js');

      await createTransaction(rawTransaction, 'biz-1', 'MANUAL', null, 'user-1', '10.0.0.1');

      const createCall = mockCreateInRepo.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(createCall.isPersonal).toBe(false);
    });

    it('should pass sourceDocumentId as null for manual transactions', async () => {
      const { createTransaction } = await import('./transactionService.js');

      await createTransaction(rawTransaction, 'biz-1', 'MANUAL', null, 'user-1', '10.0.0.1');

      const createCall = mockCreateInRepo.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(createCall.sourceDocumentId).toBeNull();
    });

    it('should store the auto-assigned category as originalCategory', async () => {
      const { createTransaction } = await import('./transactionService.js');

      await createTransaction(rawTransaction, 'biz-1', 'RECEIPT', 'doc-1', 'user-1', '127.0.0.1');

      const createCall = mockCreateInRepo.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(createCall.originalCategory).toBe('TRANSPORTATION_LOGISTICS');
      expect(createCall.category).toBe('TRANSPORTATION_LOGISTICS');
    });

    it('should pass userAgent to audit log when provided', async () => {
      const { createTransaction } = await import('./transactionService.js');

      await createTransaction(
        rawTransaction,
        'biz-1',
        'RECEIPT',
        'doc-1',
        'user-1',
        '127.0.0.1',
        'Mozilla/5.0',
      );

      expect(mockLogCreate).toHaveBeenCalledWith('txn-new', 'user-1', '127.0.0.1', 'Mozilla/5.0');
    });

    it('should use default category when confidence is low', async () => {
      mockCategorize.mockReturnValue({
        category: 'MISCELLANEOUS_EXPENSES',
        confidence: 0,
        source: 'AUTO',
        alternativeCategories: [],
      });

      const { createTransaction } = await import('./transactionService.js');

      await createTransaction(rawTransaction, 'biz-1', 'RECEIPT', 'doc-1', 'user-1', '127.0.0.1');

      const createCall = mockCreateInRepo.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(createCall.category).toBe('MISCELLANEOUS_EXPENSES');
      expect(createCall.categoryConfidence).toBe(0);
    });
  });

  describe('bulkCreate', () => {
    const rawTransactions = [
      {
        date: '2024-06-10',
        description: 'Fuel purchase at Total',
        amount: 5000,
        type: 'debit' as const,
        reference: 'REF-B1',
        counterparty: 'Total Nigeria',
      },
      {
        date: '2024-06-11',
        description: 'Customer payment received',
        amount: 25000,
        type: 'credit' as const,
        reference: 'REF-B2',
        counterparty: 'Ade Stores',
      },
    ];

    const normalizedBatch = [
      {
        transactionDate: new Date('2024-06-10'),
        description: 'Fuel purchase at Total',
        amountKobo: 500000,
        transactionType: 'OUTFLOW' as const,
        counterparty: 'Total Nigeria',
        reference: 'REF-B1',
        rawMetadata: {},
      },
      {
        transactionDate: new Date('2024-06-11'),
        description: 'Customer payment received',
        amountKobo: 2500000,
        transactionType: 'INFLOW' as const,
        counterparty: 'Ade Stores',
        reference: 'REF-B2',
        rawMetadata: {},
      },
    ];

    const categorizationResults = [
      {
        category: 'TRANSPORTATION_LOGISTICS' as const,
        confidence: 90,
        source: 'AUTO' as const,
        alternativeCategories: [],
      },
      {
        category: 'PRODUCT_SALES' as const,
        confidence: 80,
        source: 'AUTO' as const,
        alternativeCategories: [],
      },
    ];

    const savedTransactions = [
      makeTransaction({
        id: 'txn-b1',
        businessId: 'biz-1',
        sourceType: 'BANK_STATEMENT',
        sourceDocumentId: 'doc-bulk',
        transactionType: 'OUTFLOW',
        description: 'Fuel purchase at Total',
        amountKobo: 500000,
        category: 'TRANSPORTATION_LOGISTICS',
      }),
      makeTransaction({
        id: 'txn-b2',
        businessId: 'biz-1',
        sourceType: 'BANK_STATEMENT',
        sourceDocumentId: 'doc-bulk',
        transactionType: 'INFLOW',
        description: 'Customer payment received',
        amountKobo: 2500000,
        category: 'PRODUCT_SALES',
      }),
    ];

    beforeEach(() => {
      mockNormalizeBatch.mockReturnValue(normalizedBatch);
      mockCategorize
        .mockReturnValueOnce(categorizationResults[0])
        .mockReturnValueOnce(categorizationResults[1]);
      mockBulkCreateInRepo.mockResolvedValue(savedTransactions);
      mockDetectDuplicates.mockResolvedValue([]);
      mockLogCreate.mockResolvedValue({
        id: 'audit-1',
        transactionId: 'txn-b1',
        userId: 'user-1',
        action: 'CREATE',
        changes: [],
        ipAddress: '127.0.0.1',
        userAgent: null,
        createdAt: new Date(),
      });
    });

    it('should normalize, categorize, bulk-insert, detect duplicates, and audit all', async () => {
      const { bulkCreate } = await import('./transactionService.js');

      const result = await bulkCreate(
        rawTransactions,
        'biz-1',
        'BANK_STATEMENT',
        'doc-bulk',
        'user-1',
        '127.0.0.1',
      );

      expect(result.created).toBe(2);
      expect(result.transactions).toEqual(savedTransactions);
      expect(result.duplicatesDetected).toBe(0);

      // normalizeBatch called with all raw transactions
      expect(mockNormalizeBatch).toHaveBeenCalledWith(rawTransactions, 'BANK_STATEMENT');

      // categorize called once per normalized transaction
      expect(mockCategorize).toHaveBeenCalledTimes(2);
      expect(mockCategorize).toHaveBeenCalledWith(normalizedBatch[0]);
      expect(mockCategorize).toHaveBeenCalledWith(normalizedBatch[1]);

      // bulkCreateInRepo called with correct data array
      expect(mockBulkCreateInRepo).toHaveBeenCalledWith([
        {
          businessId: 'biz-1',
          sourceDocumentId: 'doc-bulk',
          sourceType: 'BANK_STATEMENT',
          transactionType: 'OUTFLOW',
          transactionDate: new Date('2024-06-10'),
          description: 'Fuel purchase at Total',
          amountKobo: 500000,
          counterparty: 'Total Nigeria',
          reference: 'REF-B1',
          category: 'TRANSPORTATION_LOGISTICS',
          categorySource: 'AUTO',
          categoryConfidence: 90,
          originalCategory: 'TRANSPORTATION_LOGISTICS',
          isPersonal: false,
          isDuplicate: false,
          duplicateOfId: null,
          notes: null,
          rawMetadata: {},
        },
        {
          businessId: 'biz-1',
          sourceDocumentId: 'doc-bulk',
          sourceType: 'BANK_STATEMENT',
          transactionType: 'INFLOW',
          transactionDate: new Date('2024-06-11'),
          description: 'Customer payment received',
          amountKobo: 2500000,
          counterparty: 'Ade Stores',
          reference: 'REF-B2',
          category: 'PRODUCT_SALES',
          categorySource: 'AUTO',
          categoryConfidence: 80,
          originalCategory: 'PRODUCT_SALES',
          isPersonal: false,
          isDuplicate: false,
          duplicateOfId: null,
          notes: null,
          rawMetadata: {},
        },
      ]);

      // duplicate detection called with all new IDs
      expect(mockDetectDuplicates).toHaveBeenCalledWith(['txn-b1', 'txn-b2'], 'biz-1');

      // audit logged for each transaction
      expect(mockLogCreate).toHaveBeenCalledTimes(2);
      expect(mockLogCreate).toHaveBeenCalledWith('txn-b1', 'user-1', '127.0.0.1', undefined);
      expect(mockLogCreate).toHaveBeenCalledWith('txn-b2', 'user-1', '127.0.0.1', undefined);
    });

    it('should return duplicatesDetected count from detectDuplicates result', async () => {
      const fakePairs = [
        { id: 'dup-1', transaction1Id: 'txn-b1', transaction2Id: 'txn-old' },
        { id: 'dup-2', transaction1Id: 'txn-b2', transaction2Id: 'txn-old2' },
      ];
      mockDetectDuplicates.mockResolvedValueOnce(fakePairs);

      const { bulkCreate } = await import('./transactionService.js');

      const result = await bulkCreate(
        rawTransactions,
        'biz-1',
        'BANK_STATEMENT',
        'doc-bulk',
        'user-1',
        '127.0.0.1',
      );

      expect(result.duplicatesDetected).toBe(2);
    });

    it('should set isPersonal to false for all bulk-created transactions', async () => {
      const { bulkCreate } = await import('./transactionService.js');

      await bulkCreate(
        rawTransactions,
        'biz-1',
        'BANK_STATEMENT',
        'doc-bulk',
        'user-1',
        '127.0.0.1',
      );

      const createData = mockBulkCreateInRepo.mock.calls[0]?.[0] as Record<string, unknown>[];
      for (const data of createData) {
        expect(data.isPersonal).toBe(false);
      }
    });

    it('should pass userAgent to audit logs when provided', async () => {
      const { bulkCreate } = await import('./transactionService.js');

      await bulkCreate(
        rawTransactions,
        'biz-1',
        'BANK_STATEMENT',
        'doc-bulk',
        'user-1',
        '127.0.0.1',
        'BulkAgent/1.0',
      );

      expect(mockLogCreate).toHaveBeenCalledWith('txn-b1', 'user-1', '127.0.0.1', 'BulkAgent/1.0');
      expect(mockLogCreate).toHaveBeenCalledWith('txn-b2', 'user-1', '127.0.0.1', 'BulkAgent/1.0');
    });

    it('should handle empty batch and return zero counts', async () => {
      mockNormalizeBatch.mockReturnValue([]);
      mockBulkCreateInRepo.mockResolvedValue([]);
      mockDetectDuplicates.mockResolvedValue([]);

      const { bulkCreate } = await import('./transactionService.js');

      const result = await bulkCreate(
        [],
        'biz-1',
        'BANK_STATEMENT',
        'doc-bulk',
        'user-1',
        '127.0.0.1',
      );

      expect(result.created).toBe(0);
      expect(result.transactions).toEqual([]);
      expect(result.duplicatesDetected).toBe(0);
    });

    it('should propagate errors from bulkCreateInRepo for atomicity', async () => {
      mockBulkCreateInRepo.mockRejectedValueOnce(new Error('DB transaction failed'));

      const { bulkCreate } = await import('./transactionService.js');

      await expect(
        bulkCreate(rawTransactions, 'biz-1', 'BANK_STATEMENT', 'doc-bulk', 'user-1', '127.0.0.1'),
      ).rejects.toThrow('DB transaction failed');
    });

    it('should propagate errors from normalizeBatch to reject entire batch', async () => {
      mockNormalizeBatch.mockImplementation(() => {
        throw new Error('Invalid date format');
      });

      const { bulkCreate } = await import('./transactionService.js');

      await expect(
        bulkCreate(rawTransactions, 'biz-1', 'BANK_STATEMENT', 'doc-bulk', 'user-1', '127.0.0.1'),
      ).rejects.toThrow('Invalid date format');

      // Repository should never be called if normalization fails
      expect(mockBulkCreateInRepo).not.toHaveBeenCalled();
    });
  });

  describe('getTransactionById', () => {
    it('should return the transaction when the user owns it', async () => {
      const txn = makeTransaction({ id: 'txn-1', businessId: 'biz-1' });
      // getTransactionById calls findById + getBusinessByUserId in parallel
      mockFindById.mockResolvedValueOnce(txn);
      mockGetBusinessByUserId.mockResolvedValueOnce(makeBusiness({ id: 'biz-1' }));

      const { getTransactionById } = await import('./transactionService.js');
      const result = await getTransactionById('txn-1', 'user-1');

      expect(result).toEqual(txn);
      expect(mockFindById).toHaveBeenCalledTimes(1);
      expect(mockGetBusinessByUserId).toHaveBeenCalledWith('user-1');
    });

    it('should throw TXN_FORBIDDEN when the user does not own the transaction', async () => {
      mockFindById.mockResolvedValueOnce(makeTransaction({ businessId: 'biz-other' }));
      mockGetBusinessByUserId.mockResolvedValueOnce(makeBusiness({ id: 'biz-1' }));

      const { getTransactionById } = await import('./transactionService.js');

      const err = await getTransactionById('txn-1', 'user-1').catch(
        (e: Error & { code: string }) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch('Forbidden');
      expect((err as Error & { code: string }).code).toBe('TXN_FORBIDDEN');
    });

    it('should throw TXN_NOT_FOUND when the transaction does not exist', async () => {
      mockFindById.mockResolvedValueOnce(null);
      mockGetBusinessByUserId.mockResolvedValueOnce(makeBusiness());

      const { getTransactionById } = await import('./transactionService.js');

      await expect(getTransactionById('txn-nonexistent', 'user-1')).rejects.toThrow(
        'Transaction not found',
      );
    });

    it('should throw TXN_FORBIDDEN when the user has no business', async () => {
      mockFindById.mockResolvedValueOnce(makeTransaction());
      mockGetBusinessByUserId.mockResolvedValueOnce(null);

      const { getTransactionById } = await import('./transactionService.js');

      await expect(getTransactionById('txn-1', 'user-no-biz')).rejects.toThrow('Forbidden');
    });
  });

  describe('listTransactions', () => {
    const defaultFilters = {
      page: 1,
      pageSize: 20,
      sortBy: 'transactionDate' as const,
      sortOrder: 'desc' as const,
    };

    it('should delegate to findWithFilters and return the result', async () => {
      const txns = [makeTransaction({ id: 'txn-1' }), makeTransaction({ id: 'txn-2' })];
      const repoResult = {
        transactions: txns,
        pagination: {
          page: 1,
          pageSize: 20,
          total: 2,
          totalPages: 1,
          hasNext: false,
          hasPrevious: false,
        },
      };
      mockFindWithFilters.mockResolvedValueOnce(repoResult);

      const { listTransactions } = await import('./transactionService.js');
      const result = await listTransactions('biz-1', defaultFilters);

      expect(result).toEqual(repoResult);
      expect(mockFindWithFilters).toHaveBeenCalledWith('biz-1', defaultFilters);
    });

    it('should pass all filters through to the repository', async () => {
      const filters = {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-30'),
        minAmount: 100000,
        maxAmount: 5000000,
        category: 'RENT_UTILITIES' as const,
        sourceType: 'BANK_STATEMENT' as const,
        transactionType: 'OUTFLOW' as const,
        isPersonal: false,
        page: 2,
        pageSize: 50,
        sortBy: 'amount' as const,
        sortOrder: 'asc' as const,
      };
      mockFindWithFilters.mockResolvedValueOnce({
        transactions: [],
        pagination: {
          page: 2,
          pageSize: 50,
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrevious: true,
        },
      });

      const { listTransactions } = await import('./transactionService.js');
      await listTransactions('biz-1', filters);

      expect(mockFindWithFilters).toHaveBeenCalledWith('biz-1', filters);
    });

    it('should return empty results when no transactions match', async () => {
      mockFindWithFilters.mockResolvedValueOnce({
        transactions: [],
        pagination: {
          page: 1,
          pageSize: 20,
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrevious: false,
        },
      });

      const { listTransactions } = await import('./transactionService.js');
      const result = await listTransactions('biz-1', defaultFilters);

      expect(result.transactions).toEqual([]);
      expect(result.pagination.total).toBe(0);
    });

    it('should propagate errors from the repository', async () => {
      mockFindWithFilters.mockRejectedValueOnce(new Error('DB connection lost'));

      const { listTransactions } = await import('./transactionService.js');

      await expect(listTransactions('biz-1', defaultFilters)).rejects.toThrow('DB connection lost');
    });
  });

  describe('updateTransaction', () => {
    const existingTxn = makeTransaction({
      id: 'txn-1',
      businessId: 'biz-1',
      description: 'Old description',
      category: 'MISCELLANEOUS_EXPENSES',
      categorySource: 'AUTO',
      originalCategory: 'MISCELLANEOUS_EXPENSES',
      transactionType: 'OUTFLOW',
      isPersonal: false,
      notes: null,
      transactionDate: new Date('2024-06-01'),
    });

    function setupOwnershipSuccess(): void {
      // verifyOwnership: findById + getBusinessByUserId
      mockFindById.mockResolvedValueOnce(existingTxn);
      mockGetBusinessByUserId.mockResolvedValueOnce(makeBusiness({ id: 'biz-1' }));
      // findById for fetching current transaction
      mockFindById.mockResolvedValueOnce(existingTxn);
    }

    beforeEach(() => {
      mockLogUpdate.mockResolvedValue({
        id: 'audit-u1',
        transactionId: 'txn-1',
        userId: 'user-1',
        action: 'UPDATE',
        changes: [],
        ipAddress: '127.0.0.1',
        userAgent: null,
        createdAt: new Date(),
      });
      mockLogCategoryChange.mockResolvedValue({
        id: 'audit-c1',
        transactionId: 'txn-1',
        userId: 'user-1',
        action: 'CATEGORIZE',
        changes: [],
        ipAddress: '127.0.0.1',
        userAgent: null,
        createdAt: new Date(),
      });
    });

    it('should update description and log changes in audit trail', async () => {
      setupOwnershipSuccess();
      const updatedTxn = makeTransaction({
        ...existingTxn,
        description: 'New description',
        updatedAt: new Date('2024-06-02T10:00:00Z'),
      });
      mockUpdateInRepo.mockResolvedValueOnce(updatedTxn);

      const { updateTransaction } = await import('./transactionService.js');
      const result = await updateTransaction(
        'txn-1',
        'user-1',
        { description: 'New description' },
        '127.0.0.1',
      );

      expect(result).toEqual(updatedTxn);
      expect(mockUpdateInRepo).toHaveBeenCalledWith('txn-1', {
        description: 'New description',
      });
      expect(mockLogUpdate).toHaveBeenCalledWith(
        'txn-1',
        'user-1',
        [{ field: 'description', previousValue: 'Old description', newValue: 'New description' }],
        '127.0.0.1',
        undefined,
      );
    });

    it('should throw 403 when user does not own the transaction', async () => {
      // verifyOwnership returns false
      mockFindById.mockResolvedValueOnce(makeTransaction({ businessId: 'biz-other' }));
      mockGetBusinessByUserId.mockResolvedValueOnce(makeBusiness({ id: 'biz-1' }));

      const { updateTransaction } = await import('./transactionService.js');

      await expect(
        updateTransaction('txn-1', 'user-1', { description: 'test' }, '127.0.0.1'),
      ).rejects.toThrow('Forbidden');

      expect(mockUpdateInRepo).not.toHaveBeenCalled();
    });

    it('should throw 404 when transaction is not found after ownership check', async () => {
      // verifyOwnership passes but findById returns null
      mockFindById.mockResolvedValueOnce(existingTxn);
      mockGetBusinessByUserId.mockResolvedValueOnce(makeBusiness({ id: 'biz-1' }));
      mockFindById.mockResolvedValueOnce(null);

      const { updateTransaction } = await import('./transactionService.js');

      await expect(
        updateTransaction('txn-1', 'user-1', { description: 'test' }, '127.0.0.1'),
      ).rejects.toThrow('Transaction not found');

      expect(mockUpdateInRepo).not.toHaveBeenCalled();
    });

    it('should set categorySource to MANUAL and log category change when category is updated', async () => {
      setupOwnershipSuccess();
      mockValidateCategory.mockReturnValueOnce(true);
      const updatedTxn = makeTransaction({
        ...existingTxn,
        category: 'RENT_UTILITIES',
        categorySource: 'MANUAL',
      });
      mockUpdateInRepo.mockResolvedValueOnce(updatedTxn);

      const { updateTransaction } = await import('./transactionService.js');
      const result = await updateTransaction(
        'txn-1',
        'user-1',
        { category: 'RENT_UTILITIES' },
        '127.0.0.1',
        'TestAgent/1.0',
      );

      expect(result.category).toBe('RENT_UTILITIES');

      // Repo should receive category + categorySource
      expect(mockUpdateInRepo).toHaveBeenCalledWith('txn-1', {
        category: 'RENT_UTILITIES',
        categorySource: 'MANUAL',
      });

      // Category change logged separately
      expect(mockLogCategoryChange).toHaveBeenCalledWith(
        'txn-1',
        'user-1',
        'MISCELLANEOUS_EXPENSES',
        'RENT_UTILITIES',
        '127.0.0.1',
        'TestAgent/1.0',
      );

      // validateCategory called with new category and transaction type
      expect(mockValidateCategory).toHaveBeenCalledWith('RENT_UTILITIES', 'OUTFLOW');
    });

    it('should throw 400 when category is invalid for the transaction type', async () => {
      setupOwnershipSuccess();
      mockValidateCategory.mockReturnValueOnce(false);

      const { updateTransaction } = await import('./transactionService.js');

      await expect(
        updateTransaction('txn-1', 'user-1', { category: 'PRODUCT_SALES' }, '127.0.0.1'),
      ).rejects.toThrow('Invalid category');

      expect(mockUpdateInRepo).not.toHaveBeenCalled();
      expect(mockLogCategoryChange).not.toHaveBeenCalled();
    });

    it('should preserve originalCategory when category is changed', async () => {
      setupOwnershipSuccess();
      mockValidateCategory.mockReturnValueOnce(true);
      const updatedTxn = makeTransaction({
        ...existingTxn,
        category: 'RENT_UTILITIES',
        categorySource: 'MANUAL',
        originalCategory: 'MISCELLANEOUS_EXPENSES',
      });
      mockUpdateInRepo.mockResolvedValueOnce(updatedTxn);

      const { updateTransaction } = await import('./transactionService.js');
      const result = await updateTransaction(
        'txn-1',
        'user-1',
        { category: 'RENT_UTILITIES' },
        '127.0.0.1',
      );

      // originalCategory should remain unchanged
      expect(result.originalCategory).toBe('MISCELLANEOUS_EXPENSES');

      // The repo update should NOT include originalCategory
      const repoCall = mockUpdateInRepo.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(repoCall).not.toHaveProperty('originalCategory');
    });

    it('should not log category change when category is the same', async () => {
      setupOwnershipSuccess();
      const updatedTxn = makeTransaction({
        ...existingTxn,
        notes: 'Added a note',
      });
      mockUpdateInRepo.mockResolvedValueOnce(updatedTxn);

      const { updateTransaction } = await import('./transactionService.js');
      await updateTransaction(
        'txn-1',
        'user-1',
        { category: 'MISCELLANEOUS_EXPENSES', notes: 'Added a note' },
        '127.0.0.1',
      );

      // Category didn't actually change, so no category change log
      expect(mockLogCategoryChange).not.toHaveBeenCalled();
      expect(mockValidateCategory).not.toHaveBeenCalled();
    });

    it('should update multiple fields at once', async () => {
      setupOwnershipSuccess();
      const newDate = new Date('2024-07-01');
      const updatedTxn = makeTransaction({
        ...existingTxn,
        description: 'Updated desc',
        transactionDate: newDate,
        isPersonal: true,
        notes: 'Some notes',
      });
      mockUpdateInRepo.mockResolvedValueOnce(updatedTxn);

      const { updateTransaction } = await import('./transactionService.js');
      await updateTransaction(
        'txn-1',
        'user-1',
        {
          description: 'Updated desc',
          transactionDate: newDate,
          isPersonal: true,
          notes: 'Some notes',
        },
        '127.0.0.1',
      );

      expect(mockUpdateInRepo).toHaveBeenCalledWith('txn-1', {
        description: 'Updated desc',
        transactionDate: newDate,
        isPersonal: true,
        notes: 'Some notes',
      });

      // All 4 fields should appear in audit changes
      const auditChanges = mockLogUpdate.mock.calls[0]?.[2] as Array<Record<string, unknown>>;
      expect(auditChanges).toHaveLength(4);
      const fields = auditChanges.map((c) => c.field);
      expect(fields).toContain('description');
      expect(fields).toContain('transactionDate');
      expect(fields).toContain('isPersonal');
      expect(fields).toContain('notes');
    });

    it('should not log audit when no fields actually changed', async () => {
      setupOwnershipSuccess();
      // Pass the same values as the existing transaction
      mockUpdateInRepo.mockResolvedValueOnce(existingTxn);

      const { updateTransaction } = await import('./transactionService.js');
      await updateTransaction('txn-1', 'user-1', { description: 'Old description' }, '127.0.0.1');

      expect(mockLogUpdate).not.toHaveBeenCalled();
    });

    it('should pass userAgent through to audit functions', async () => {
      setupOwnershipSuccess();
      mockValidateCategory.mockReturnValueOnce(true);
      const updatedTxn = makeTransaction({
        ...existingTxn,
        description: 'Changed',
        category: 'RENT_UTILITIES',
        categorySource: 'MANUAL',
      });
      mockUpdateInRepo.mockResolvedValueOnce(updatedTxn);

      const { updateTransaction } = await import('./transactionService.js');
      await updateTransaction(
        'txn-1',
        'user-1',
        { description: 'Changed', category: 'RENT_UTILITIES' },
        '10.0.0.1',
        'Mozilla/5.0',
      );

      expect(mockLogCategoryChange).toHaveBeenCalledWith(
        'txn-1',
        'user-1',
        'MISCELLANEOUS_EXPENSES',
        'RENT_UTILITIES',
        '10.0.0.1',
        'Mozilla/5.0',
      );
      expect(mockLogUpdate).toHaveBeenCalledWith(
        'txn-1',
        'user-1',
        expect.arrayContaining([
          { field: 'description', previousValue: 'Old description', newValue: 'Changed' },
        ]),
        '10.0.0.1',
        'Mozilla/5.0',
      );
    });
  });

  describe('deleteTransaction', () => {
    function setupOwnershipForDelete(): void {
      mockFindById.mockResolvedValueOnce(makeTransaction({ id: 'txn-1', businessId: 'biz-1' }));
      mockGetBusinessByUserId.mockResolvedValueOnce(makeBusiness({ id: 'biz-1' }));
    }

    it('should soft-delete the transaction and log audit when ownership passes', async () => {
      setupOwnershipForDelete();
      const deletedTxn = makeTransaction({ id: 'txn-1', deletedAt: new Date() });
      mockSoftDelete.mockResolvedValueOnce(deletedTxn);
      mockLogDelete.mockResolvedValueOnce(undefined);

      const { deleteTransaction } = await import('./transactionService.js');
      await deleteTransaction('txn-1', 'user-1', '127.0.0.1');

      expect(mockSoftDelete).toHaveBeenCalledWith('txn-1');
      expect(mockLogDelete).toHaveBeenCalledWith('txn-1', 'user-1', '127.0.0.1', undefined);
    });

    it('should throw 403 when user does not own the transaction', async () => {
      mockFindById.mockResolvedValueOnce(makeTransaction({ businessId: 'biz-other' }));
      mockGetBusinessByUserId.mockResolvedValueOnce(makeBusiness({ id: 'biz-1' }));

      const { deleteTransaction } = await import('./transactionService.js');

      await expect(deleteTransaction('txn-1', 'user-1', '127.0.0.1')).rejects.toThrow('Forbidden');

      expect(mockSoftDelete).not.toHaveBeenCalled();
      expect(mockLogDelete).not.toHaveBeenCalled();
    });

    it('should throw 404 when softDelete returns null', async () => {
      setupOwnershipForDelete();
      mockSoftDelete.mockResolvedValueOnce(null);

      const { deleteTransaction } = await import('./transactionService.js');

      await expect(deleteTransaction('txn-1', 'user-1', '127.0.0.1')).rejects.toThrow(
        'Transaction not found',
      );

      expect(mockLogDelete).not.toHaveBeenCalled();
    });

    it('should pass userAgent to logDelete when provided', async () => {
      setupOwnershipForDelete();
      mockSoftDelete.mockResolvedValueOnce(makeTransaction({ deletedAt: new Date() }));
      mockLogDelete.mockResolvedValueOnce(undefined);

      const { deleteTransaction } = await import('./transactionService.js');
      await deleteTransaction('txn-1', 'user-1', '10.0.0.1', 'TestAgent/1.0');

      expect(mockLogDelete).toHaveBeenCalledWith('txn-1', 'user-1', '10.0.0.1', 'TestAgent/1.0');
    });
  });

  describe('calculateBusinessTotals', () => {
    it('should sum inflows and outflows excluding personal transactions', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { transaction_type: 'INFLOW', total: '300000' },
          { transaction_type: 'OUTFLOW', total: '50000' },
        ],
      });

      const { calculateBusinessTotals } = await import('./transactionService.js');
      const result = await calculateBusinessTotals('biz-1');

      expect(result.totalInflow).toBe(300000);
      expect(result.totalOutflow).toBe(50000);
      expect(result.netCashflow).toBe(250000);

      // Verify the SQL query uses proper filters
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('is_personal = false'), [
        'biz-1',
      ]);
    });

    it('should return zeros when no transactions exist', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const { calculateBusinessTotals } = await import('./transactionService.js');
      const result = await calculateBusinessTotals('biz-1');

      expect(result.totalInflow).toBe(0);
      expect(result.totalOutflow).toBe(0);
      expect(result.netCashflow).toBe(0);
    });

    it('should handle negative netCashflow when outflows exceed inflows', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { transaction_type: 'INFLOW', total: '50000' },
          { transaction_type: 'OUTFLOW', total: '200000' },
        ],
      });

      const { calculateBusinessTotals } = await import('./transactionService.js');
      const result = await calculateBusinessTotals('biz-1');

      expect(result.totalInflow).toBe(50000);
      expect(result.totalOutflow).toBe(200000);
      expect(result.netCashflow).toBe(-150000);
    });
  });
});
