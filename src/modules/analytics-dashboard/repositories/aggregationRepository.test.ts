import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getCategoryAggregations,
  getCounterpartyAggregations,
  getSummaryAggregations,
  getTrendAggregations,
  shouldIncludeTransaction,
} from './aggregationRepository.js';

// ---------------------------------------------------------------------------
// Mock pg.Pool
// ---------------------------------------------------------------------------

interface MockPool {
  query: ReturnType<typeof vi.fn>;
}

function createMockPool(): MockPool {
  return { query: vi.fn() };
}

describe('getSummaryAggregations', () => {
  let pool: MockPool;
  const businessId = 'biz-001';
  const startDate = new Date('2024-01-01T00:00:00Z');
  const endDate = new Date('2024-02-01T00:00:00Z');

  beforeEach(() => {
    pool = createMockPool();
  });

  it('executes the correct SQL with proper parameters', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          total_inflow_kobo: '500000',
          total_outflow_kobo: '200000',
          inflow_count: '10',
          outflow_count: '5',
        },
      ],
    });

    await getSummaryAggregations(pool as never, businessId, startDate, endDate);

    expect(pool.query).toHaveBeenCalledOnce();
    const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('is_personal = false');
    expect(sql).toContain('deleted_at IS NULL');
    expect(sql).toContain("transaction_type = 'INFLOW'");
    expect(sql).toContain("transaction_type = 'OUTFLOW'");
    expect(params).toEqual([businessId, startDate, endDate]);
  });

  it('maps snake_case results to camelCase with BigInt', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          total_inflow_kobo: '1234567890',
          total_outflow_kobo: '987654321',
          inflow_count: '42',
          outflow_count: '18',
        },
      ],
    });

    const result = await getSummaryAggregations(pool as never, businessId, startDate, endDate);

    expect(result).toEqual({
      totalInflowKobo: BigInt('1234567890'),
      totalOutflowKobo: BigInt('987654321'),
      inflowCount: 42,
      outflowCount: 18,
    });
  });

  it('handles zero values from COALESCE', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          total_inflow_kobo: '0',
          total_outflow_kobo: '0',
          inflow_count: '0',
          outflow_count: '0',
        },
      ],
    });

    const result = await getSummaryAggregations(pool as never, businessId, startDate, endDate);

    expect(result.totalInflowKobo).toBe(0n);
    expect(result.totalOutflowKobo).toBe(0n);
    expect(result.inflowCount).toBe(0);
    expect(result.outflowCount).toBe(0);
  });
});

describe('getTrendAggregations', () => {
  let pool: MockPool;
  const businessId = 'biz-001';
  const startDate = new Date('2024-01-01T00:00:00Z');
  const endDate = new Date('2024-01-08T00:00:00Z');

  beforeEach(() => {
    pool = createMockPool();
  });

  it('passes the correct interval for DAILY granularity', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await getTrendAggregations(pool as never, businessId, startDate, endDate, 'DAILY');

    const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('DATE_TRUNC($1');
    expect(sql).toContain("AT TIME ZONE 'Africa/Lagos'");
    expect(params![0]).toBe('day');
    expect(params![1]).toBe(businessId);
  });

  it('passes the correct interval for WEEKLY granularity', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await getTrendAggregations(pool as never, businessId, startDate, endDate, 'WEEKLY');

    const [_sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(params![0]).toBe('week');
  });

  it('passes the correct interval for MONTHLY granularity', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await getTrendAggregations(pool as never, businessId, startDate, endDate, 'MONTHLY');

    const [_sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(params![0]).toBe('month');
  });

  it('maps rows to RawTrendAggregation with BigInt', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          time_bucket: '2024-01-01T00:00:00Z',
          total_inflow_kobo: '100000',
          total_outflow_kobo: '50000',
          transaction_count: '7',
        },
        {
          time_bucket: '2024-01-02T00:00:00Z',
          total_inflow_kobo: '200000',
          total_outflow_kobo: '75000',
          transaction_count: '3',
        },
      ],
    });

    const result = await getTrendAggregations(
      pool as never,
      businessId,
      startDate,
      endDate,
      'DAILY',
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      timeBucket: new Date('2024-01-01T00:00:00Z'),
      totalInflowKobo: 100000n,
      totalOutflowKobo: 50000n,
      transactionCount: 7,
    });
    expect(result[1]!.totalInflowKobo).toBe(200000n);
  });

  it('returns empty array when no transactions match', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await getTrendAggregations(
      pool as never,
      businessId,
      startDate,
      endDate,
      'DAILY',
    );

    expect(result).toEqual([]);
  });
});

describe('getCategoryAggregations', () => {
  let pool: MockPool;
  const businessId = 'biz-001';
  const startDate = new Date('2024-01-01T00:00:00Z');
  const endDate = new Date('2024-02-01T00:00:00Z');

  beforeEach(() => {
    pool = createMockPool();
  });

  it('passes transaction type and limit as parameters', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await getCategoryAggregations(pool as never, businessId, startDate, endDate, 'OUTFLOW', 5);

    const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('transaction_type = $4');
    expect(sql).toContain('LIMIT $5');
    expect(params).toEqual([businessId, startDate, endDate, 'OUTFLOW', 5]);
  });

  it('maps rows to RawCategoryAggregation with BigInt', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { category: 'RENT_UTILITIES', total_amount_kobo: '500000', transaction_count: '3' },
        { category: 'SALARIES_WAGES', total_amount_kobo: '300000', transaction_count: '2' },
      ],
    });

    const result = await getCategoryAggregations(
      pool as never,
      businessId,
      startDate,
      endDate,
      'OUTFLOW',
      5,
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      category: 'RENT_UTILITIES',
      totalAmountKobo: 500000n,
      transactionCount: 3,
    });
  });
});

describe('getCounterpartyAggregations', () => {
  let pool: MockPool;
  const businessId = 'biz-001';
  const startDate = new Date('2024-01-01T00:00:00Z');
  const endDate = new Date('2024-02-01T00:00:00Z');

  beforeEach(() => {
    pool = createMockPool();
  });

  it('uses COALESCE for null counterparties in SQL', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await getCounterpartyAggregations(pool as never, businessId, startDate, endDate, 'INFLOW', 5);

    const [sql] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("COALESCE(counterparty, 'Unknown')");
  });

  it('passes transaction type and limit as parameters', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await getCounterpartyAggregations(pool as never, businessId, startDate, endDate, 'INFLOW', 10);

    const [_sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([businessId, startDate, endDate, 'INFLOW', 10]);
  });

  it('maps rows to RawCounterpartyAggregation with BigInt', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { counterparty: 'Acme Corp', total_amount_kobo: '1000000', transaction_count: '5' },
        { counterparty: 'Unknown', total_amount_kobo: '200000', transaction_count: '2' },
      ],
    });

    const result = await getCounterpartyAggregations(
      pool as never,
      businessId,
      startDate,
      endDate,
      'INFLOW',
      5,
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      counterparty: 'Acme Corp',
      totalAmountKobo: 1000000n,
      transactionCount: 5,
    });
    expect(result[1]!.counterparty).toBe('Unknown');
  });
});

describe('shouldIncludeTransaction', () => {
  it('includes non-personal, non-deleted transactions', () => {
    expect(shouldIncludeTransaction({ isPersonal: false, deletedAt: null })).toBe(true);
  });

  it('excludes personal transactions', () => {
    expect(shouldIncludeTransaction({ isPersonal: true, deletedAt: null })).toBe(false);
  });

  it('excludes soft-deleted transactions', () => {
    expect(shouldIncludeTransaction({ isPersonal: false, deletedAt: new Date('2024-01-15') })).toBe(
      false,
    );
  });

  it('excludes transactions that are both personal and deleted', () => {
    expect(shouldIncludeTransaction({ isPersonal: true, deletedAt: new Date('2024-01-15') })).toBe(
      false,
    );
  });
});
