/**
 * Property-based tests for SearchService
 *
 * **Property 13: Search Field Coverage**
 * For any non-empty search query, the generated SQL searches across both
 * description and counterparty fields (via the search_vector which includes
 * both). The buildSearchVector function always produces weighted tsvector SQL
 * covering description (weight 'A') and counterparty (weight 'B').
 *
 * **Property 14: Search and Filter Combination**
 * When filters are combined with search, both the text search condition AND
 * all filter conditions appear in the WHERE clause. The number of AND-joined
 * conditions equals the base conditions (business_id, deleted_at IS NULL,
 * search_vector @@) plus one for each defined optional filter.
 *
 * **Validates: Requirements 6.1, 6.3, 6.5**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { QueryResult } from 'pg';

import type { TransactionCategory, TransactionType } from './types.js';

// ─── Mock the db module ──────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const { buildSearchVector, search, rankResults } = await import('./searchService.js');
import type { SearchFilters } from './searchService.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pgResult(rows: Record<string, unknown>[]): QueryResult {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] };
}

interface CapturedCall {
  sql: string;
  params: unknown[];
}

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

const ALL_TRANSACTION_TYPES: TransactionType[] = ['INFLOW', 'OUTFLOW'];

/** Non-empty alphanumeric search queries (at least one word with letters/digits). */
const searchQueryArb = fc
  .array(fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,14}$/), { minLength: 1, maxLength: 4 })
  .map((words) => words.join(' '));

/** Description strings — non-empty printable text. */
const descriptionArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{0,49}$/);

/** Optional counterparty — either a name or null. */
const counterpartyArb = fc.option(fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{0,29}$/), {
  nil: null,
});

const businessIdArb = fc.uuid();

const optionalDateArb = fc.option(
  fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
  { nil: undefined },
);

const optionalCategoryArb = fc.option(fc.constantFrom(...ALL_CATEGORIES), { nil: undefined });
const optionalTransactionTypeArb = fc.option(fc.constantFrom(...ALL_TRANSACTION_TYPES), {
  nil: undefined,
});

const searchFiltersArb: fc.Arbitrary<SearchFilters> = fc.record({
  startDate: optionalDateArb,
  endDate: optionalDateArb,
  category: optionalCategoryArb,
  transactionType: optionalTransactionTypeArb,
  page: fc.option(fc.integer({ min: 1, max: 50 }), { nil: undefined }),
  pageSize: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
});

/** Keys of optional filters in the order the search implementation processes them. */
const OPTIONAL_FILTER_KEYS: (keyof SearchFilters)[] = [
  'startDate',
  'endDate',
  'category',
  'transactionType',
];

// ─── Reset mocks ─────────────────────────────────────────────────────────────

beforeEach(() => {
  mockQuery.mockReset();
});

// ─── Property 13: Search Field Coverage ──────────────────────────────────────

describe('Property 13: Search Field Coverage', () => {
  /**
   * **Validates: Requirements 6.1**
   *
   * buildSearchVector always produces SQL that includes both a description
   * tsvector (weight 'A') and a counterparty tsvector (weight 'B'),
   * ensuring search covers both fields.
   */
  it('buildSearchVector always includes description (A) and counterparty (B) weights', () => {
    fc.assert(
      fc.property(descriptionArb, counterpartyArb, (description, counterparty) => {
        const vector = buildSearchVector(description, counterparty);

        // Description is always weighted 'A'
        expect(vector).toContain("'A'");
        expect(vector).toContain("to_tsvector('english'");

        // Counterparty is always weighted 'B' (even when null → empty string)
        expect(vector).toContain("'B'");

        // Both parts are joined with ||
        expect(vector).toContain('||');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.1, 6.3**
   *
   * For any non-empty search query, the SQL generated by search() uses
   * search_vector @@ to_tsquery, which covers both description and
   * counterparty via the database trigger. The tsquery uses prefix
   * matching (:*) for partial word support.
   */
  it('search SQL always queries the search_vector covering both fields', async () => {
    await fc.assert(
      fc.asyncProperty(searchQueryArb, businessIdArb, async (queryStr, bizId) => {
        const captured = setupMock(0);

        await search(queryStr, bizId);

        // Should have made 2 queries (count + data)
        expect(captured.length).toBe(2);

        const countSql = captured[0]!.sql;
        const dataSql = captured[1]!.sql;

        // Both queries use the search_vector @@ to_tsquery condition
        expect(countSql).toContain('search_vector @@');
        expect(countSql).toContain("to_tsquery('english'");

        // Data query also checks individual field matches for matched_fields
        expect(dataSql).toContain('description');
        expect(dataSql).toContain('counterparty');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.3**
   *
   * The tsquery parameter always uses prefix matching (:*) for each term,
   * enabling partial word matching.
   */
  it('search query uses prefix matching (:*) for partial word support', async () => {
    await fc.assert(
      fc.asyncProperty(searchQueryArb, businessIdArb, async (queryStr, bizId) => {
        const captured = setupMock(0);

        await search(queryStr, bizId);

        // The tsquery param should contain :* for prefix matching
        const tsQueryParam = captured[0]!.params[1] as string;
        const terms = tsQueryParam.split(' & ');
        for (const term of terms) {
          expect(term).toMatch(/:?\*$/);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.1**
   *
   * rankResults (client-side ranking) checks both description and
   * counterparty fields. For any transaction where the query appears
   * in the description, 'description' is in matchedFields. Similarly
   * for counterparty.
   */
  it('rankResults checks both description and counterparty fields', () => {
    fc.assert(
      fc.property(searchQueryArb, (queryStr) => {
        const term = queryStr.split(' ')[0]!.toLowerCase();

        const transactions = [
          {
            id: 'txn-desc',
            businessId: 'biz-1',
            sourceDocumentId: null,
            sourceType: 'RECEIPT' as const,
            transactionType: 'OUTFLOW' as const,
            transactionDate: new Date('2024-01-01'),
            description: `Payment to ${term} store`,
            amountKobo: 10000,
            counterparty: null,
            reference: null,
            category: 'MISCELLANEOUS_EXPENSES' as const,
            categorySource: 'AUTO' as const,
            categoryConfidence: 50,
            originalCategory: null,
            isPersonal: false,
            isDuplicate: false,
            duplicateOfId: null,
            notes: null,
            rawMetadata: {},
            searchVector: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          },
          {
            id: 'txn-cp',
            businessId: 'biz-1',
            sourceDocumentId: null,
            sourceType: 'RECEIPT' as const,
            transactionType: 'OUTFLOW' as const,
            transactionDate: new Date('2024-01-01'),
            description: 'Some unrelated expense',
            amountKobo: 10000,
            counterparty: `${term} Ltd`,
            reference: null,
            category: 'MISCELLANEOUS_EXPENSES' as const,
            categorySource: 'AUTO' as const,
            categoryConfidence: 50,
            originalCategory: null,
            isPersonal: false,
            isDuplicate: false,
            duplicateOfId: null,
            notes: null,
            rawMetadata: {},
            searchVector: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          },
        ];

        const ranked = rankResults(transactions, term);

        const descResult = ranked.find((r) => r.id === 'txn-desc')!;
        const cpResult = ranked.find((r) => r.id === 'txn-cp')!;

        expect(descResult.matchedFields).toContain('description');
        expect(cpResult.matchedFields).toContain('counterparty');
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 14: Search and Filter Combination ──────────────────────────────

describe('Property 14: Search and Filter Combination', () => {
  /**
   * **Validates: Requirements 6.5**
   *
   * The WHERE clause always includes the 3 base conditions (business_id,
   * deleted_at IS NULL, search_vector @@) plus one condition per defined
   * optional filter.
   */
  it('WHERE clause has base conditions plus one per optional filter', async () => {
    await fc.assert(
      fc.asyncProperty(
        searchQueryArb,
        businessIdArb,
        searchFiltersArb,
        async (queryStr, bizId, filters) => {
          const captured = setupMock(0);

          await search(queryStr, bizId, filters);

          const countSql = captured[0]!.sql;

          const definedCount = OPTIONAL_FILTER_KEYS.filter((k) => filters[k] !== undefined).length;

          const whereMatch = countSql.match(/WHERE\s+(.+)/i);
          expect(whereMatch).not.toBeNull();
          const whereClause = whereMatch![1]!;

          const conditions = whereClause.split(/\s+AND\s+/i);
          // 3 base conditions: business_id, deleted_at IS NULL, search_vector @@
          expect(conditions.length).toBe(3 + definedCount);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.5**
   *
   * When filters are provided alongside a search query, the SQL always
   * contains both the full-text search condition AND the filter-specific
   * conditions.
   */
  it('SQL always contains both search_vector @@ and filter conditions', async () => {
    await fc.assert(
      fc.asyncProperty(
        searchQueryArb,
        businessIdArb,
        searchFiltersArb,
        async (queryStr, bizId, filters) => {
          const captured = setupMock(0);

          await search(queryStr, bizId, filters);

          const countSql = captured[0]!.sql;

          // Always has the text search condition
          expect(countSql).toContain('search_vector @@');

          // Always scoped to business
          expect(countSql).toContain('business_id =');

          // Always excludes soft-deleted
          expect(countSql).toContain('deleted_at IS NULL');

          // Each defined filter adds its condition
          if (filters.startDate !== undefined) {
            expect(countSql).toContain('transaction_date >=');
          }
          if (filters.endDate !== undefined) {
            expect(countSql).toContain('transaction_date <=');
          }
          if (filters.category !== undefined) {
            expect(countSql).toContain('category =');
          }
          if (filters.transactionType !== undefined) {
            expect(countSql).toContain('transaction_type =');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.5**
   *
   * Filter parameters are passed in the correct positional order:
   * $1 = businessId, $2 = tsquery, then each defined filter gets the
   * next index.
   */
  it('filter parameters are passed in correct positional order', async () => {
    await fc.assert(
      fc.asyncProperty(
        searchQueryArb,
        businessIdArb,
        searchFiltersArb,
        async (queryStr, bizId, filters) => {
          const captured = setupMock(0);

          await search(queryStr, bizId, filters);

          const countParams = captured[0]!.params;

          // $1 is always businessId
          expect(countParams[0]).toBe(bizId);

          // $2 is always the tsquery string
          expect(typeof countParams[1]).toBe('string');
          expect(countParams[1] as string).toContain(':*');

          // Remaining params follow the filter order
          const expectedParams: unknown[] = [countParams[0], countParams[1]];
          if (filters.startDate !== undefined) {
            expectedParams.push(filters.startDate.toISOString());
          }
          if (filters.endDate !== undefined) {
            expectedParams.push(filters.endDate.toISOString());
          }
          if (filters.category !== undefined) {
            expectedParams.push(filters.category);
          }
          if (filters.transactionType !== undefined) {
            expectedParams.push(filters.transactionType);
          }

          expect(countParams).toEqual(expectedParams);
        },
      ),
      { numRuns: 100 },
    );
  });
});
