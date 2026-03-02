import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { DuplicatePair, Transaction, TransactionAudit } from './types.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetTransactionById = vi.fn();
const mockListTransactions = vi.fn();
const mockUpdateTransaction = vi.fn();
const mockBulkCreate = vi.fn();
const mockDeleteTransaction = vi.fn();
vi.mock('./transactionService.js', () => ({
  getTransactionById: mockGetTransactionById,
  listTransactions: mockListTransactions,
  updateTransaction: mockUpdateTransaction,
  bulkCreate: mockBulkCreate,
  deleteTransaction: mockDeleteTransaction,
}));

const mockGetAuditHistory = vi.fn();
const mockLogDuplicateResolve = vi.fn();
vi.mock('./auditService.js', () => ({
  getAuditHistory: mockGetAuditHistory,
  logDuplicateResolve: mockLogDuplicateResolve,
}));

const mockSearch = vi.fn();
vi.mock('./searchService.js', () => ({
  search: mockSearch,
}));

const mockGetUnresolvedDuplicates = vi.fn();
const mockMarkAsReviewed = vi.fn();
const mockResolveDuplicate = vi.fn();
vi.mock('./duplicateDetectionService.js', () => ({
  getUnresolvedDuplicates: mockGetUnresolvedDuplicates,
  markAsReviewed: mockMarkAsReviewed,
  resolveDuplicate: mockResolveDuplicate,
}));

const mockFindById = vi.fn();
vi.mock('./transactionRepository.js', () => ({
  findById: mockFindById,
}));

vi.mock('./normalizationService.js', () => ({
  formatAsNaira: (kobo: number): string => {
    const naira = kobo / 100;
    return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
  },
}));

const mockQuery = vi.fn();
vi.mock('../utils/db.js', () => ({
  query: mockQuery,
}));

// Import after mocks
const { createTransactionRouter } = await import('./transactionController.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'txn-1',
    businessId: 'biz-1',
    sourceDocumentId: 'doc-1',
    sourceType: 'RECEIPT',
    transactionType: 'OUTFLOW',
    transactionDate: new Date('2024-06-01'),
    description: 'Office supplies from Shoprite',
    amountKobo: 500000,
    counterparty: 'Shoprite',
    reference: 'REF-001',
    category: 'MISCELLANEOUS_EXPENSES',
    categorySource: 'AUTO',
    categoryConfidence: 75,
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

function makeAudit(overrides: Partial<TransactionAudit> = {}): TransactionAudit {
  return {
    id: 'audit-1',
    transactionId: 'txn-1',
    userId: 'user-1',
    action: 'CREATE',
    changes: [],
    ipAddress: '127.0.0.1',
    userAgent: 'test-agent',
    createdAt: new Date('2024-06-01T10:00:00Z'),
    ...overrides,
  };
}

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  // Inject userId via middleware for testing
  app.use((req, _res, next) => {
    const authReq = req as Record<string, unknown>;
    if (req.headers['x-user-id']) {
      authReq['userId'] = req.headers['x-user-id'] as string;
    }
    if (req.headers['x-business-id']) {
      authReq['businessId'] = req.headers['x-business-id'] as string;
    }
    next();
  });
  app.use('/api/transactions', createTransactionRouter());
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GET /api/transactions/:id', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('returns 401 when userId is missing', async () => {
    const res = await request(app).get('/api/transactions/txn-1');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
    expect(res.body.requestId).toBeDefined();
  });

  it('returns 404 when transaction is not found', async () => {
    const error = new Error('Transaction not found') as Error & { code: string };
    error.code = 'TXN_NOT_FOUND';
    mockGetTransactionById.mockRejectedValue(error);

    const res = await request(app).get('/api/transactions/txn-missing').set('x-user-id', 'user-1');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TXN_NOT_FOUND');
    expect(res.body.requestId).toBeDefined();
    expect(mockGetTransactionById).toHaveBeenCalledWith('txn-missing', 'user-1');
  });

  it('returns 403 when user does not own the transaction', async () => {
    const error = new Error('Forbidden: you do not own this transaction') as Error & {
      code: string;
    };
    error.code = 'TXN_FORBIDDEN';
    mockGetTransactionById.mockRejectedValue(error);

    const res = await request(app).get('/api/transactions/txn-1').set('x-user-id', 'other-user');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TXN_FORBIDDEN');
    expect(mockGetTransactionById).toHaveBeenCalledWith('txn-1', 'other-user');
  });

  it('returns transaction details with audit history on success', async () => {
    const txn = makeTransaction();
    const audits = [
      makeAudit({ id: 'audit-1', action: 'CREATE' }),
      makeAudit({
        id: 'audit-2',
        action: 'UPDATE',
        changes: [{ field: 'notes', previousValue: null, newValue: 'updated' }],
      }),
    ];

    mockGetTransactionById.mockResolvedValue(txn);
    mockGetAuditHistory.mockResolvedValue(audits);

    const res = await request(app).get('/api/transactions/txn-1').set('x-user-id', 'user-1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.requestId).toBeDefined();

    // Verify transaction public shape
    expect(res.body.transaction.id).toBe('txn-1');
    expect(res.body.transaction.sourceType).toBe('RECEIPT');
    expect(res.body.transaction.sourceTypeDisplay).toBe('Receipt');
    expect(res.body.transaction.sourceDocumentId).toBe('doc-1');
    expect(res.body.transaction.transactionType).toBe('OUTFLOW');
    expect(res.body.transaction.transactionTypeDisplay).toBe('Outflow');
    expect(res.body.transaction.description).toBe('Office supplies from Shoprite');
    expect(res.body.transaction.amountKobo).toBe(500000);
    expect(res.body.transaction.amountNaira).toBeDefined();
    expect(res.body.transaction.counterparty).toBe('Shoprite');
    expect(res.body.transaction.category).toBe('MISCELLANEOUS_EXPENSES');
    expect(res.body.transaction.categorySource).toBe('AUTO');
    expect(res.body.transaction.categoryConfidence).toBe(75);

    // Verify audit history
    expect(res.body.auditHistory).toHaveLength(2);
    expect(res.body.auditHistory[0].id).toBe('audit-1');
    expect(res.body.auditHistory[1].id).toBe('audit-2');

    expect(mockGetTransactionById).toHaveBeenCalledWith('txn-1', 'user-1');
    expect(mockGetAuditHistory).toHaveBeenCalledWith('txn-1');
  });

  it('uses x-request-id header when provided', async () => {
    mockGetTransactionById.mockResolvedValue(makeTransaction());
    mockGetAuditHistory.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/transactions/txn-1')
      .set('x-user-id', 'user-1')
      .set('x-request-id', 'custom-req-id');

    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe('custom-req-id');
  });

  it('handles service errors with code property', async () => {
    const error = new Error('Forbidden') as Error & { code: string };
    error.code = 'FORBIDDEN';
    mockGetTransactionById.mockRejectedValue(error);

    const res = await request(app).get('/api/transactions/txn-1').set('x-user-id', 'user-1');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('PUT /api/transactions/:id', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('returns 401 when userId is missing', async () => {
    const res = await request(app).put('/api/transactions/txn-1').send({ description: 'Updated' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
    expect(res.body.requestId).toBeDefined();
  });

  it('returns updated transaction on success', async () => {
    const updated = makeTransaction({
      description: 'Updated description',
      notes: 'Some notes',
      updatedAt: new Date('2024-06-02T12:00:00Z'),
    });
    mockUpdateTransaction.mockResolvedValue(updated);

    const res = await request(app)
      .put('/api/transactions/txn-1')
      .set('x-user-id', 'user-1')
      .send({ description: 'Updated description', notes: 'Some notes' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.requestId).toBeDefined();
    expect(res.body.transaction.id).toBe('txn-1');
    expect(res.body.transaction.description).toBe('Updated description');
    expect(res.body.transaction.notes).toBe('Some notes');
    expect(res.body.transaction.amountKobo).toBe(500000);
    expect(res.body.transaction.amountNaira).toBeDefined();

    expect(mockUpdateTransaction).toHaveBeenCalledWith(
      'txn-1',
      'user-1',
      { description: 'Updated description', notes: 'Some notes' },
      expect.any(String),
      undefined,
    );
  });

  it('returns 403 when user does not own the transaction', async () => {
    const error = new Error('Forbidden: you do not own this transaction') as Error & {
      code: string;
    };
    error.code = 'TXN_FORBIDDEN';
    mockUpdateTransaction.mockRejectedValue(error);

    const res = await request(app)
      .put('/api/transactions/txn-1')
      .set('x-user-id', 'other-user')
      .send({ description: 'Nope' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TXN_FORBIDDEN');
  });

  it('returns 404 when transaction not found', async () => {
    const error = new Error('Transaction not found') as Error & { code: string };
    error.code = 'TXN_NOT_FOUND';
    mockUpdateTransaction.mockRejectedValue(error);

    const res = await request(app)
      .put('/api/transactions/txn-missing')
      .set('x-user-id', 'user-1')
      .send({ description: 'Nope' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TXN_NOT_FOUND');
  });

  it('returns 400 for invalid category', async () => {
    const error = new Error('Invalid category') as Error & { code: string };
    error.code = 'TXN_INVALID_CATEGORY';
    mockUpdateTransaction.mockRejectedValue(error);

    const res = await request(app)
      .put('/api/transactions/txn-1')
      .set('x-user-id', 'user-1')
      .send({ category: 'INVALID_CATEGORY' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TXN_INVALID_CATEGORY');
  });

  it('converts transactionDate string to Date object', async () => {
    const updated = makeTransaction({
      transactionDate: new Date('2024-07-15'),
      updatedAt: new Date('2024-06-02T12:00:00Z'),
    });
    mockUpdateTransaction.mockResolvedValue(updated);

    const res = await request(app)
      .put('/api/transactions/txn-1')
      .set('x-user-id', 'user-1')
      .send({ transactionDate: '2024-07-15T00:00:00.000Z' });

    expect(res.status).toBe(200);

    // Verify the service was called with a Date object, not a string
    const callArgs = mockUpdateTransaction.mock.calls[0];
    const updates = callArgs[2] as { transactionDate?: Date };
    expect(updates.transactionDate).toBeInstanceOf(Date);
    expect(updates.transactionDate?.toISOString()).toBe('2024-07-15T00:00:00.000Z');
  });
});

describe('POST /api/transactions/bulk', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  const validPayload = {
    sourceDocumentId: 'doc-1',
    sourceType: 'RECEIPT',
    transactions: [
      {
        date: '2024-06-01',
        description: 'Office supplies from Shoprite',
        amount: 5000,
        type: 'debit',
      },
    ],
  };

  it('returns 401 when userId or businessId is missing', async () => {
    // No auth headers at all
    const res = await request(app).post('/api/transactions/bulk').send(validPayload);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
    expect(res.body.requestId).toBeDefined();

    // Only userId, no businessId
    const res2 = await request(app)
      .post('/api/transactions/bulk')
      .set('x-user-id', 'user-1')
      .send(validPayload);

    expect(res2.status).toBe(401);
    expect(res2.body.success).toBe(false);
    expect(res2.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('returns 400 when sourceDocumentId is missing', async () => {
    const res = await request(app)
      .post('/api/transactions/bulk')
      .set('x-user-id', 'user-1')
      .set('x-business-id', 'biz-1')
      .send({
        sourceType: 'RECEIPT',
        transactions: [{ date: '2024-06-01', description: 'Test', amount: 1000 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.requestId).toBeDefined();
  });

  it('returns 400 when transactions array is empty', async () => {
    const res = await request(app)
      .post('/api/transactions/bulk')
      .set('x-user-id', 'user-1')
      .set('x-business-id', 'biz-1')
      .send({
        sourceDocumentId: 'doc-1',
        sourceType: 'RECEIPT',
        transactions: [],
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.requestId).toBeDefined();
  });

  it('returns 201 with created transactions on success', async () => {
    const createdTxn = makeTransaction({ id: 'txn-new-1' });
    mockBulkCreate.mockResolvedValue({
      created: 1,
      transactions: [createdTxn],
      duplicatesDetected: 0,
    });

    const res = await request(app)
      .post('/api/transactions/bulk')
      .set('x-user-id', 'user-1')
      .set('x-business-id', 'biz-1')
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.created).toBe(1);
    expect(res.body.duplicatesDetected).toBe(0);
    expect(res.body.transactions).toHaveLength(1);
    expect(res.body.transactions[0].id).toBe('txn-new-1');
    expect(res.body.transactions[0].amountKobo).toBe(500000);
    expect(res.body.transactions[0].amountNaira).toBeDefined();
    expect(res.body.requestId).toBeDefined();

    expect(mockBulkCreate).toHaveBeenCalledWith(
      validPayload.transactions,
      'biz-1',
      'RECEIPT',
      'doc-1',
      'user-1',
      expect.any(String),
      undefined,
    );
  });

  it('returns error when bulk creation fails', async () => {
    const error = new Error('Invalid transaction data') as Error & { code: string };
    error.code = 'VALIDATION_ERROR';
    mockBulkCreate.mockRejectedValue(error);

    const res = await request(app)
      .post('/api/transactions/bulk')
      .set('x-user-id', 'user-1')
      .set('x-business-id', 'biz-1')
      .send(validPayload);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe('Invalid transaction data');
    expect(res.body.requestId).toBeDefined();
  });
});

describe('GET /api/transactions/search', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('returns 401 when businessId is missing', async () => {
    const res = await request(app).get('/api/transactions/search?query=shoprite');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
    expect(res.body.requestId).toBeDefined();
  });

  it('returns 400 when query parameter is missing', async () => {
    const res = await request(app).get('/api/transactions/search').set('x-business-id', 'biz-1');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.requestId).toBeDefined();
  });

  it('returns search results on success', async () => {
    const txn = makeTransaction({ description: 'Payment to Shoprite', counterparty: 'Shoprite' });
    mockSearch.mockResolvedValue({
      transactions: [
        { ...txn, relevanceScore: 0.85, matchedFields: ['description', 'counterparty'] },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    const res = await request(app)
      .get('/api/transactions/search?query=shoprite')
      .set('x-business-id', 'biz-1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.transactions).toHaveLength(1);
    expect(res.body.transactions[0].id).toBe('txn-1');
    expect(res.body.transactions[0].description).toBe('Payment to Shoprite');
    expect(res.body.transactions[0].amountKobo).toBe(500000);
    expect(res.body.transactions[0].amountNaira).toBeDefined();
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.pagination.totalPages).toBe(1);
    expect(res.body.pagination.hasNext).toBe(false);
    expect(res.body.pagination.hasPrevious).toBe(false);
    expect(res.body.requestId).toBeDefined();

    expect(mockSearch).toHaveBeenCalledWith('shoprite', 'biz-1', {
      startDate: undefined,
      endDate: undefined,
      category: undefined,
      transactionType: undefined,
      page: 1,
      pageSize: 20,
    });
  });

  it('passes filters to search service', async () => {
    mockSearch.mockResolvedValue({
      transactions: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
    });

    const res = await request(app)
      .get(
        '/api/transactions/search?query=fuel&startDate=2024-01-01&endDate=2024-06-30&category=TRANSPORTATION_LOGISTICS&transactionType=OUTFLOW&page=2&pageSize=10',
      )
      .set('x-business-id', 'biz-1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.transactions).toHaveLength(0);

    expect(mockSearch).toHaveBeenCalledWith('fuel', 'biz-1', {
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-06-30'),
      category: 'TRANSPORTATION_LOGISTICS',
      transactionType: 'OUTFLOW',
      page: 2,
      pageSize: 10,
    });
  });
});

// ─── Duplicate Helpers ───────────────────────────────────────────────────────

function makeDuplicatePair(overrides: Partial<DuplicatePair> = {}): DuplicatePair {
  return {
    id: 'dup-1',
    businessId: 'biz-1',
    transaction1Id: 'txn-1',
    transaction2Id: 'txn-2',
    similarityScore: 85,
    amountMatch: true,
    dateProximity: 1,
    descriptionSimilarity: 80,
    status: 'PENDING',
    resolvedBy: null,
    resolvedAt: null,
    keptTransactionId: null,
    createdAt: new Date('2024-06-01T10:00:00Z'),
    updatedAt: new Date('2024-06-01T10:00:00Z'),
    ...overrides,
  };
}

// ─── Duplicate Tests ─────────────────────────────────────────────────────────

describe('GET /api/transactions/duplicates', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('returns 401 when businessId is missing', async () => {
    const res = await request(app).get('/api/transactions/duplicates');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
    expect(res.body.requestId).toBeDefined();
  });

  it('returns empty list when no duplicates', async () => {
    mockGetUnresolvedDuplicates.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/transactions/duplicates')
      .set('x-business-id', 'biz-1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.duplicates).toHaveLength(0);
    expect(res.body.pagination).toEqual({
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 1,
      hasNext: false,
      hasPrevious: false,
    });
    expect(res.body.requestId).toBeDefined();
    expect(mockGetUnresolvedDuplicates).toHaveBeenCalledWith('biz-1');
  });

  it('returns duplicate pairs with transaction details on success', async () => {
    const pair = makeDuplicatePair();
    const txn1 = makeTransaction({ id: 'txn-1', description: 'Payment to Shoprite' });
    const txn2 = makeTransaction({ id: 'txn-2', description: 'Payment to Shoprite Lagos' });

    mockGetUnresolvedDuplicates.mockResolvedValue([pair]);
    mockFindById.mockImplementation((id: string) => {
      if (id === 'txn-1') return Promise.resolve(txn1);
      if (id === 'txn-2') return Promise.resolve(txn2);
      return Promise.resolve(null);
    });

    const res = await request(app)
      .get('/api/transactions/duplicates')
      .set('x-business-id', 'biz-1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.duplicates).toHaveLength(1);

    const dup = res.body.duplicates[0];
    expect(dup.id).toBe('dup-1');
    expect(dup.transaction1.id).toBe('txn-1');
    expect(dup.transaction1.description).toBe('Payment to Shoprite');
    expect(dup.transaction1.amountKobo).toBe(500000);
    expect(dup.transaction1.amountNaira).toBeDefined();
    expect(dup.transaction2.id).toBe('txn-2');
    expect(dup.transaction2.description).toBe('Payment to Shoprite Lagos');
    expect(dup.similarityScore).toBe(85);
    expect(dup.amountMatch).toBe(true);
    expect(dup.dateProximity).toBe(1);
    expect(dup.descriptionSimilarity).toBe(80);
    expect(dup.status).toBe('PENDING');
    expect(dup.createdAt).toBeDefined();

    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.requestId).toBeDefined();
  });
});

// ─── Resolve Duplicate Tests ─────────────────────────────────────────────────

describe('POST /api/transactions/duplicates/:id/resolve', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('returns 401 when userId is missing', async () => {
    const res = await request(app)
      .post('/api/transactions/duplicates/dup-1/resolve')
      .send({ action: 'NOT_DUPLICATE' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
    expect(res.body.requestId).toBeDefined();
  });

  it('returns 400 for invalid action', async () => {
    const res = await request(app)
      .post('/api/transactions/duplicates/dup-1/resolve')
      .set('x-user-id', 'user-1')
      .send({ action: 'INVALID_ACTION' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.requestId).toBeDefined();
  });

  it('returns 400 when action is missing', async () => {
    const res = await request(app)
      .post('/api/transactions/duplicates/dup-1/resolve')
      .set('x-user-id', 'user-1')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.requestId).toBeDefined();
  });

  it('returns 200 for NOT_DUPLICATE action and calls markAsReviewed', async () => {
    mockMarkAsReviewed.mockResolvedValue(undefined);
    mockLogDuplicateResolve.mockResolvedValue({});

    const res = await request(app)
      .post('/api/transactions/duplicates/dup-1/resolve')
      .set('x-user-id', 'user-1')
      .send({ action: 'NOT_DUPLICATE' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Duplicate pair marked as not duplicate');
    expect(res.body.requestId).toBeDefined();

    expect(mockMarkAsReviewed).toHaveBeenCalledWith('dup-1', 'user-1');
    expect(mockLogDuplicateResolve).toHaveBeenCalledWith(
      'dup-1',
      'user-1',
      'dup-1',
      'NOT_DUPLICATE',
      expect.any(String),
      undefined,
    );
  });

  it('returns 200 for KEEP_FIRST action and calls resolveDuplicate with transaction1_id', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ transaction1_id: 'txn-1', transaction2_id: 'txn-2' }],
    });
    mockResolveDuplicate.mockResolvedValue(undefined);
    mockLogDuplicateResolve.mockResolvedValue({});

    const res = await request(app)
      .post('/api/transactions/duplicates/dup-1/resolve')
      .set('x-user-id', 'user-1')
      .send({ action: 'KEEP_FIRST' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Duplicate resolved successfully');
    expect(res.body.requestId).toBeDefined();

    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT transaction1_id, transaction2_id FROM duplicate_pairs WHERE id = $1',
      ['dup-1'],
    );
    expect(mockResolveDuplicate).toHaveBeenCalledWith('dup-1', 'txn-1', 'user-1');
    expect(mockLogDuplicateResolve).toHaveBeenCalledWith(
      'txn-1',
      'user-1',
      'dup-1',
      'KEEP_FIRST',
      expect.any(String),
      undefined,
    );
  });

  it('returns 200 for KEEP_SECOND action and calls resolveDuplicate with transaction2_id', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ transaction1_id: 'txn-1', transaction2_id: 'txn-2' }],
    });
    mockResolveDuplicate.mockResolvedValue(undefined);
    mockLogDuplicateResolve.mockResolvedValue({});

    const res = await request(app)
      .post('/api/transactions/duplicates/dup-1/resolve')
      .set('x-user-id', 'user-1')
      .send({ action: 'KEEP_SECOND' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Duplicate resolved successfully');

    expect(mockResolveDuplicate).toHaveBeenCalledWith('dup-1', 'txn-2', 'user-1');
  });

  it('returns 404 when duplicate pair is not found', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post('/api/transactions/duplicates/dup-missing/resolve')
      .set('x-user-id', 'user-1')
      .send({ action: 'KEEP_FIRST' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('DUPLICATE_PAIR_NOT_FOUND');
    expect(res.body.requestId).toBeDefined();
  });
});

// ─── Delete Tests ────────────────────────────────────────────────────────────

describe('DELETE /api/transactions/:id', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('returns 401 when userId is missing', async () => {
    const res = await request(app).delete('/api/transactions/txn-1');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
    expect(res.body.requestId).toBeDefined();
  });

  it('returns 200 on successful soft delete', async () => {
    mockDeleteTransaction.mockResolvedValue(undefined);

    const res = await request(app).delete('/api/transactions/txn-1').set('x-user-id', 'user-1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Transaction deleted successfully');
    expect(res.body.requestId).toBeDefined();

    expect(mockDeleteTransaction).toHaveBeenCalledWith(
      'txn-1',
      'user-1',
      expect.any(String),
      undefined,
    );
  });

  it('returns 403 when user does not own the transaction', async () => {
    const error = new Error('Forbidden: you do not own this transaction') as Error & {
      code: string;
    };
    error.code = 'TXN_FORBIDDEN';
    mockDeleteTransaction.mockRejectedValue(error);

    const res = await request(app).delete('/api/transactions/txn-1').set('x-user-id', 'other-user');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TXN_FORBIDDEN');
  });

  it('returns 404 when transaction not found', async () => {
    const error = new Error('Transaction not found') as Error & { code: string };
    error.code = 'TXN_NOT_FOUND';
    mockDeleteTransaction.mockRejectedValue(error);

    const res = await request(app)
      .delete('/api/transactions/txn-missing')
      .set('x-user-id', 'user-1');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TXN_NOT_FOUND');
  });

  it('uses x-request-id header when provided', async () => {
    mockDeleteTransaction.mockResolvedValue(undefined);

    const res = await request(app)
      .delete('/api/transactions/txn-1')
      .set('x-user-id', 'user-1')
      .set('x-request-id', 'custom-req-id');

    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe('custom-req-id');
  });
});
