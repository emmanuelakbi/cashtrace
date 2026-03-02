/**
 * Property-based tests for Transaction Controller API response consistency.
 *
 * Property 25: API Response Consistency
 * For any API response, it SHALL be valid JSON containing either a success response
 * with the expected data structure (including requestId) OR an error response with
 * error code, message, and requestId. For any transaction amount in a response,
 * both amountKobo (integer) and amountNaira (formatted string) SHALL be present.
 *
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5
 *
 * @module transaction-engine/transactionController.property.test
 */

import express from 'express';
import * as fc from 'fast-check';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Transaction } from './types.js';

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

vi.mock('../utils/db.js', () => ({
  query: vi.fn(),
}));

const { createTransactionRouter } = await import('./transactionController.js');

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const sourceTypeArb = fc.constantFrom('RECEIPT', 'BANK_STATEMENT', 'POS_EXPORT', 'MANUAL' as const);
const transactionTypeArb = fc.constantFrom('INFLOW', 'OUTFLOW' as const);
const expenseCategoryArb = fc.constantFrom(
  'INVENTORY_STOCK',
  'RENT_UTILITIES',
  'SALARIES_WAGES',
  'TRANSPORTATION_LOGISTICS',
  'MARKETING_ADVERTISING',
  'PROFESSIONAL_SERVICES',
  'EQUIPMENT_MAINTENANCE',
  'BANK_CHARGES_FEES',
  'TAXES_LEVIES',
  'MISCELLANEOUS_EXPENSES' as const,
);
const revenueCategoryArb = fc.constantFrom(
  'PRODUCT_SALES',
  'SERVICE_REVENUE',
  'OTHER_INCOME' as const,
);
const categoryArb = fc.oneof(expenseCategoryArb, revenueCategoryArb);
const koboAmountArb = fc.integer({ min: 1, max: 1_000_000_000 });

const transactionArb = fc
  .record({
    id: fc.uuid(),
    businessId: fc.uuid(),
    sourceDocumentId: fc.option(fc.uuid(), { nil: null }),
    sourceType: sourceTypeArb,
    transactionType: transactionTypeArb,
    transactionDate: fc.date({
      min: new Date('2023-01-01'),
      max: new Date('2025-12-31'),
    }),
    description: fc.string({ minLength: 1, maxLength: 200 }),
    amountKobo: koboAmountArb,
    counterparty: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
    reference: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
    category: categoryArb,
    categorySource: fc.constantFrom('AUTO', 'MANUAL' as const),
    categoryConfidence: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
    isPersonal: fc.boolean(),
    isDuplicate: fc.boolean(),
    notes: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: null }),
  })
  .map(
    (r): Transaction => ({
      ...r,
      originalCategory: r.category,
      duplicateOfId: null,
      rawMetadata: {},
      searchVector: null,
      createdAt: new Date('2024-06-01T10:00:00Z'),
      updatedAt: new Date('2024-06-01T10:00:00Z'),
      deletedAt: null,
    }),
  );

const errorCodeArb = fc.constantFrom(
  'TXN_FORBIDDEN',
  'TXN_NOT_FOUND',
  'FORBIDDEN',
  'TRANSACTION_NOT_FOUND',
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
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

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 25: API Response Consistency', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('success responses from GET /:id always contain requestId and transaction with both amount fields', async () => {
    await fc.assert(
      fc.asyncProperty(transactionArb, async (txn) => {
        mockGetTransactionById.mockResolvedValue(txn);
        mockGetAuditHistory.mockResolvedValue([]);

        const res = await request(app)
          .get(`/api/transactions/${txn.id}`)
          .set('x-user-id', 'user-1');

        expect(res.status).toBe(200);
        const body = res.body as Record<string, unknown>;

        // Must be valid JSON with success and requestId
        expect(body['success']).toBe(true);
        expect(typeof body['requestId']).toBe('string');
        expect((body['requestId'] as string).length).toBeGreaterThan(0);

        // Transaction must have both amount fields
        const transaction = body['transaction'] as Record<string, unknown>;
        expect(typeof transaction['amountKobo']).toBe('number');
        expect(Number.isInteger(transaction['amountKobo'])).toBe(true);
        expect(typeof transaction['amountNaira']).toBe('string');
        expect((transaction['amountNaira'] as string).startsWith('₦')).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('error responses always contain success=false, error.code, error.message, and requestId', async () => {
    await fc.assert(
      fc.asyncProperty(errorCodeArb, async (errorCode) => {
        const error = new Error('Test error') as Error & { code: string };
        error.code = errorCode;
        mockGetTransactionById.mockRejectedValue(error);

        const res = await request(app).get('/api/transactions/txn-err').set('x-user-id', 'user-1');

        const body = res.body as Record<string, unknown>;

        // Must have consistent error structure
        expect(body['success']).toBe(false);
        expect(typeof body['requestId']).toBe('string');
        expect((body['requestId'] as string).length).toBeGreaterThan(0);

        const errObj = body['error'] as Record<string, unknown>;
        expect(typeof errObj['code']).toBe('string');
        expect(typeof errObj['message']).toBe('string');
        expect((errObj['code'] as string).length).toBeGreaterThan(0);
        expect((errObj['message'] as string).length).toBeGreaterThan(0);

        // HTTP status must be appropriate
        expect([400, 403, 404, 500]).toContain(res.status);
      }),
      { numRuns: 100 },
    );
  });

  it('auth error responses (no userId) always have consistent structure', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (txnId) => {
        const res = await request(app).get(`/api/transactions/${txnId}`);

        expect(res.status).toBe(401);
        const body = res.body as Record<string, unknown>;

        expect(body['success']).toBe(false);
        expect(typeof body['requestId']).toBe('string');

        const errObj = body['error'] as Record<string, unknown>;
        expect(errObj['code']).toBe('AUTH_REQUIRED');
        expect(typeof errObj['message']).toBe('string');
      }),
      { numRuns: 100 },
    );
  });

  it('list responses always contain transactions array with both amount fields and pagination', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(transactionArb, { minLength: 0, maxLength: 3 }), async (txns) => {
        mockListTransactions.mockResolvedValue({
          transactions: txns,
          pagination: {
            page: 1,
            pageSize: 20,
            total: txns.length,
            totalPages: 1,
            hasNext: false,
            hasPrevious: false,
          },
        });

        const res = await request(app).get('/api/transactions').set('x-business-id', 'biz-1');

        expect(res.status).toBe(200);
        const body = res.body as Record<string, unknown>;

        expect(body['success']).toBe(true);
        expect(typeof body['requestId']).toBe('string');

        // Pagination must be present
        const pagination = body['pagination'] as Record<string, unknown>;
        expect(typeof pagination['page']).toBe('number');
        expect(typeof pagination['pageSize']).toBe('number');
        expect(typeof pagination['total']).toBe('number');
        expect(typeof pagination['totalPages']).toBe('number');
        expect(typeof pagination['hasNext']).toBe('boolean');
        expect(typeof pagination['hasPrevious']).toBe('boolean');

        // Every transaction must have both amount fields
        const transactions = body['transactions'] as Record<string, unknown>[];
        expect(Array.isArray(transactions)).toBe(true);
        for (const t of transactions) {
          expect(typeof t['amountKobo']).toBe('number');
          expect(Number.isInteger(t['amountKobo'])).toBe(true);
          expect(typeof t['amountNaira']).toBe('string');
          expect((t['amountNaira'] as string).startsWith('₦')).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  }, 60000);

  it('delete success responses always contain success=true, message, and requestId', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (txnId) => {
        mockDeleteTransaction.mockResolvedValue(undefined);

        const res = await request(app)
          .delete(`/api/transactions/${txnId}`)
          .set('x-user-id', 'user-1');

        expect(res.status).toBe(200);
        const body = res.body as Record<string, unknown>;

        expect(body['success']).toBe(true);
        expect(typeof body['message']).toBe('string');
        expect((body['message'] as string).length).toBeGreaterThan(0);
        expect(typeof body['requestId']).toBe('string');
        expect((body['requestId'] as string).length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});
