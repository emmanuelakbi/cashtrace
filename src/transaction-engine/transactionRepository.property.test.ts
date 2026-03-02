/**
 * Property-based tests for TransactionRepository — findWithFilters
 *
 * **Property 10: Filter Correctness**
 * For any combination of filters, the generated SQL WHERE clause always
 * includes `business_id = $1` and `deleted_at IS NULL`. Each provided
 * filter adds exactly one condition, and parameters are passed in order.
 *
 * **Property 11: Pagination Correctness**
 * For any page/pageSize combination: pageSize is clamped between 1 and 100,
 * page is always >= 1, OFFSET = (page - 1) * pageSize,
 * totalPages = ceil(total / pageSize), hasNext iff page < totalPages,
 * hasPrevious iff page > 1.
 *
 * **Property 12: Default Sort Order**
 * When no sortBy/sortOrder is specified (use defaults), SQL always contains
 * ORDER BY transaction_date DESC.
 *
 * **Validates: Requirements 5.1-5.8**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { QueryResult } from 'pg';

import type {
  TransactionCategory,
  TransactionFilters,
  TransactionType,
  SourceType,
} from './types.js';

// ─── Mock the db module ──────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  getPool: () => ({
    connect: vi.fn(),
  }),
}));

const { findWithFilters } = await import('./transactionRepository.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pgResult(rows: Record<string, unknown>[]): QueryResult {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] };
}

interface CapturedCall {
  sql: string;
  params: unknown[];
}

/**
 * Set up mockQuery to capture calls per-invocation of findWithFilters.
 * Each call to findWithFilters makes exactly 2 query calls (COUNT + SELECT).
 * We track them in a shared array and return appropriate results.
 */
function setupMock(total: number): CapturedCall[] {
  const captured: CapturedCall[] = [];
  mockQuery.mockImplementation((sql: string, params: unknown[]) => {
    const idx = captured.length;
    captured.push({ sql, params });
    if (idx % 2 === 0) {
      return Promise.resolve(pgResult([{ count: String(total) }]));
    }
    return Promise.resolve(pgResult([]));
  });
  return captured;
}

// ─── Generators ──────────────────────────────────────────────────────────────

const ALL_CATEGORIES: TransactionCategory[] = [
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
];

const ALL_SOURCE_TYPES: SourceType[] = ['RECEIPT', 'BANK_STATEMENT', 'POS_EXPORT', 'MANUAL'];
const ALL_TRANSACTION_TYPES: TransactionType[] = ['INFLOW', 'OUTFLOW'];

const businessIdArb = fc.uuid();

const optionalDateArb = fc.option(
  fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
  { nil: undefined },
);

const optionalAmountArb = fc.option(fc.integer({ min: 1, max: 1_000_000_000 }), {
  nil: undefined,
});

const optionalCategoryArb = fc.option(fc.constantFrom(...ALL_CATEGORIES), { nil: undefined });
const optionalSourceTypeArb = fc.option(fc.constantFrom(...ALL_SOURCE_TYPES), { nil: undefined });
const optionalTransactionTypeArb = fc.option(fc.constantFrom(...ALL_TRANSACTION_TYPES), {
  nil: undefined,
});
const optionalBoolArb = fc.option(fc.boolean(), { nil: undefined });

const sortByArb = fc.constantFrom<TransactionFilters['sortBy']>(
  'transactionDate',
  'amount',
  'createdAt',
);
const sortOrderArb = fc.constantFrom<TransactionFilters['sortOrder']>('asc', 'desc');

const filtersArb: fc.Arbitrary<TransactionFilters> = fc.record({
  startDate: optionalDateArb,
  endDate: optionalDateArb,
  minAmount: optionalAmountArb,
  maxAmount: optionalAmountArb,
  category: optionalCategoryArb,
  sourceType: optionalSourceTypeArb,
  transactionType: optionalTransactionTypeArb,
  isPersonal: optionalBoolArb,
  page: fc.integer({ min: -10, max: 200 }),
  pageSize: fc.integer({ min: -10, max: 500 }),
  sortBy: sortByArb,
  sortOrder: sortOrderArb,
});

/** Optional filter keys in the order the implementation processes them. */
const OPTIONAL_FILTER_KEYS: (keyof TransactionFilters)[] = [
  'startDate',
  'endDate',
  'minAmount',
  'maxAmount',
  'category',
  'sourceType',
  'transactionType',
  'isPersonal',
];

// ─── Reset mocks ─────────────────────────────────────────────────────────────

beforeEach(() => {
  mockQuery.mockReset();
});

// ─── Property 10: Filter Correctness ─────────────────────────────────────────

describe('Property 10: Filter Correctness', () => {
  /**
   * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**
   *
   * The WHERE clause always includes business_id = $1 and deleted_at IS NULL,
   * regardless of which optional filters are provided.
   */
  it('always includes business_id and deleted_at IS NULL in WHERE clause', async () => {
    await fc.assert(
      fc.asyncProperty(businessIdArb, filtersArb, async (bizId, filters) => {
        const captured = setupMock(0);

        await findWithFilters(bizId, filters);

        const countSql = captured[0]!.sql;
        expect(countSql).toContain('business_id = $1');
        expect(countSql).toContain('deleted_at IS NULL');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 5.1-5.6**
   *
   * Each defined optional filter adds exactly one condition to the WHERE clause.
   * The total number of AND-joined conditions equals 2 (business_id + deleted_at)
   * plus the count of defined optional filters.
   */
  it('each provided filter adds exactly one WHERE condition', async () => {
    await fc.assert(
      fc.asyncProperty(businessIdArb, filtersArb, async (bizId, filters) => {
        const captured = setupMock(0);

        await findWithFilters(bizId, filters);

        const countSql = captured[0]!.sql;

        const definedCount = OPTIONAL_FILTER_KEYS.filter((k) => filters[k] !== undefined).length;

        const whereMatch = countSql.match(/WHERE\s+(.+)/i);
        expect(whereMatch).not.toBeNull();
        const whereClause = whereMatch![1]!;

        const conditions = whereClause.split(/\s+AND\s+/i);
        expect(conditions.length).toBe(2 + definedCount);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 5.1-5.6**
   *
   * Filter parameters are passed in the correct positional order:
   * $1 is always businessId, then each defined filter gets the next index.
   */
  it('filter parameters are passed in correct positional order', async () => {
    await fc.assert(
      fc.asyncProperty(businessIdArb, filtersArb, async (bizId, filters) => {
        const captured = setupMock(0);

        await findWithFilters(bizId, filters);

        const countParams = captured[0]!.params;

        expect(countParams[0]).toBe(bizId);

        const expectedParams: unknown[] = [bizId];
        if (filters.startDate !== undefined) expectedParams.push(filters.startDate.toISOString());
        if (filters.endDate !== undefined) expectedParams.push(filters.endDate.toISOString());
        if (filters.minAmount !== undefined) expectedParams.push(filters.minAmount);
        if (filters.maxAmount !== undefined) expectedParams.push(filters.maxAmount);
        if (filters.category !== undefined) expectedParams.push(filters.category);
        if (filters.sourceType !== undefined) expectedParams.push(filters.sourceType);
        if (filters.transactionType !== undefined) expectedParams.push(filters.transactionType);
        if (filters.isPersonal !== undefined) expectedParams.push(filters.isPersonal);

        expect(countParams).toEqual(expectedParams);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 11: Pagination Correctness ─────────────────────────────────────

describe('Property 11: Pagination Correctness', () => {
  const paginationArb = fc.record({
    page: fc.integer({ min: -50, max: 500 }),
    pageSize: fc.integer({ min: -50, max: 500 }),
  });

  const totalArb = fc.integer({ min: 0, max: 10_000 });

  const baseFilters: Omit<TransactionFilters, 'page' | 'pageSize'> = {
    sortBy: 'transactionDate',
    sortOrder: 'desc',
  };

  /**
   * **Validates: Requirements 5.7**
   *
   * pageSize is always clamped between 1 and 100 in the result.
   */
  it('pageSize is clamped between 1 and 100', async () => {
    await fc.assert(
      fc.asyncProperty(paginationArb, totalArb, async ({ page, pageSize }, total) => {
        setupMock(total);

        const result = await findWithFilters('biz-id', {
          ...baseFilters,
          page,
          pageSize,
        });

        expect(result.pagination.pageSize).toBeGreaterThanOrEqual(1);
        expect(result.pagination.pageSize).toBeLessThanOrEqual(100);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 5.7**
   *
   * page is always >= 1 in the result.
   */
  it('page is always >= 1', async () => {
    await fc.assert(
      fc.asyncProperty(paginationArb, totalArb, async ({ page, pageSize }, total) => {
        setupMock(total);

        const result = await findWithFilters('biz-id', {
          ...baseFilters,
          page,
          pageSize,
        });

        expect(result.pagination.page).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 5.7**
   *
   * OFFSET passed to the SELECT query equals (effectivePage - 1) * effectivePageSize.
   */
  it('OFFSET = (page - 1) * pageSize', async () => {
    await fc.assert(
      fc.asyncProperty(paginationArb, totalArb, async ({ page, pageSize }, total) => {
        const captured = setupMock(total);

        const result = await findWithFilters('biz-id', {
          ...baseFilters,
          page,
          pageSize,
        });

        const effectivePage = result.pagination.page;
        const effectivePageSize = result.pagination.pageSize;
        const expectedOffset = (effectivePage - 1) * effectivePageSize;

        const selectParams = captured[1]!.params;
        const offsetParam = selectParams[selectParams.length - 1];
        expect(offsetParam).toBe(expectedOffset);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 5.7**
   *
   * totalPages = Math.ceil(total / pageSize), and is 0 when total is 0.
   */
  it('totalPages = ceil(total / pageSize)', async () => {
    await fc.assert(
      fc.asyncProperty(paginationArb, totalArb, async ({ page, pageSize }, total) => {
        setupMock(total);

        const result = await findWithFilters('biz-id', {
          ...baseFilters,
          page,
          pageSize,
        });

        const effectivePageSize = result.pagination.pageSize;
        const expectedTotalPages = Math.ceil(total / effectivePageSize);
        expect(result.pagination.totalPages).toBe(expectedTotalPages);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 5.7**
   *
   * hasNext is true iff page < totalPages.
   */
  it('hasNext is true iff page < totalPages', async () => {
    await fc.assert(
      fc.asyncProperty(paginationArb, totalArb, async ({ page, pageSize }, total) => {
        setupMock(total);

        const result = await findWithFilters('biz-id', {
          ...baseFilters,
          page,
          pageSize,
        });

        const { page: p, totalPages, hasNext } = result.pagination;
        expect(hasNext).toBe(p < totalPages);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 5.7**
   *
   * hasPrevious is true iff page > 1.
   */
  it('hasPrevious is true iff page > 1', async () => {
    await fc.assert(
      fc.asyncProperty(paginationArb, totalArb, async ({ page, pageSize }, total) => {
        setupMock(total);

        const result = await findWithFilters('biz-id', {
          ...baseFilters,
          page,
          pageSize,
        });

        const { page: p, hasPrevious } = result.pagination;
        expect(hasPrevious).toBe(p > 1);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 12: Default Sort Order ─────────────────────────────────────────

describe('Property 12: Default Sort Order', () => {
  /**
   * **Validates: Requirements 5.8**
   *
   * When sortBy is 'transactionDate' and sortOrder is 'desc' (the defaults),
   * the SQL SELECT always contains ORDER BY transaction_date DESC.
   */
  it('SQL contains ORDER BY transaction_date DESC with default sort', async () => {
    await fc.assert(
      fc.asyncProperty(businessIdArb, async (bizId) => {
        const captured = setupMock(0);

        await findWithFilters(bizId, {
          page: 1,
          pageSize: 20,
          sortBy: 'transactionDate',
          sortOrder: 'desc',
        });

        const selectSql = captured[1]!.sql;
        expect(selectSql).toContain('ORDER BY transaction_date DESC');
      }),
      { numRuns: 100 },
    );
  });
});
