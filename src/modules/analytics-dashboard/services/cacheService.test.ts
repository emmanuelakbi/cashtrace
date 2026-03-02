/**
 * Unit tests for CacheService — key generation, get/set operations,
 * and cache invalidation.
 *
 * @module modules/analytics-dashboard/services/cacheService.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CACHE_TTL_SECONDS } from '../types/index.js';

import {
  cacheCategories,
  cacheCounterparties,
  cacheSummary,
  cacheTrends,
  generateCacheKey,
  getAffectedPeriodKeys,
  getCachedCategories,
  getCachedCounterparties,
  getCachedSummary,
  getCachedTrends,
  invalidateAffectedPeriods,
  invalidateBusinessCache,
} from './cacheService.js';

// ---------------------------------------------------------------------------
// Redis mock
// ---------------------------------------------------------------------------

function createRedisMock(): {
  get: ReturnType<typeof vi.fn>;
  setex: ReturnType<typeof vi.fn>;
  keys: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
    keys: vi.fn().mockResolvedValue([]),
    del: vi.fn().mockResolvedValue(0),
  };
}

// Cast helper — the mock satisfies the subset of Redis methods we use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asRedis = (mock: ReturnType<typeof createRedisMock>): any => mock;

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

const BUSINESS_ID = '550e8400-e29b-41d4-a716-446655440000';
const PERIOD = 'this_month';

function makeSummaryData(): {
  totalRevenueKobo: number;
  totalExpensesKobo: number;
  netCashflowKobo: number;
  transactionCount: number;
  averageTransactionKobo: number;
  periodStart: Date;
  periodEnd: Date;
} {
  return {
    totalRevenueKobo: 500_000,
    totalExpensesKobo: 300_000,
    netCashflowKobo: 200_000,
    transactionCount: 10,
    averageTransactionKobo: 80_000,
    periodStart: new Date('2024-06-01T00:00:00Z'),
    periodEnd: new Date('2024-06-30T23:59:59Z'),
  };
}

function makeTrendData(): {
  granularity: 'DAILY';
  dataPoints: never[];
  periodStart: Date;
  periodEnd: Date;
} {
  return {
    granularity: 'DAILY' as const,
    dataPoints: [],
    periodStart: new Date('2024-06-01T00:00:00Z'),
    periodEnd: new Date('2024-06-07T23:59:59Z'),
  };
}

// ---------------------------------------------------------------------------
// 6.1 — Cache key generation
// ---------------------------------------------------------------------------

describe('generateCacheKey', () => {
  it('generates a summary key with businessId and period', () => {
    const key = generateCacheKey('summary', BUSINESS_ID, PERIOD);
    expect(key).toBe(`dashboard:summary:${BUSINESS_ID}:this_month`);
  });

  it('generates a trends key', () => {
    const key = generateCacheKey('trends', BUSINESS_ID, 'this_week');
    expect(key).toBe(`dashboard:trends:${BUSINESS_ID}:this_week`);
  });

  it('generates a categories key', () => {
    const key = generateCacheKey('categories', BUSINESS_ID, 'today');
    expect(key).toBe(`dashboard:categories:${BUSINESS_ID}:today`);
  });

  it('generates a counterparties key with subtype', () => {
    const key = generateCacheKey('counterparties', BUSINESS_ID, PERIOD, 'INFLOW');
    expect(key).toBe(`dashboard:counterparties:${BUSINESS_ID}:this_month:INFLOW`);
  });

  it('leaves {type} placeholder when no subtype is provided for counterparties', () => {
    const key = generateCacheKey('counterparties', BUSINESS_ID, PERIOD);
    expect(key).toBe(`dashboard:counterparties:${BUSINESS_ID}:this_month:{type}`);
  });
});

// ---------------------------------------------------------------------------
// 6.2 — Cache get/set operations
// ---------------------------------------------------------------------------

describe('cache get/set operations', () => {
  let redis: ReturnType<typeof createRedisMock>;

  beforeEach(() => {
    redis = createRedisMock();
  });

  // -- Summary --

  describe('getCachedSummary / cacheSummary', () => {
    it('returns null on cache miss', async () => {
      const result = await getCachedSummary(asRedis(redis), BUSINESS_ID, PERIOD);
      expect(result).toBeNull();
      expect(redis.get).toHaveBeenCalledWith(`dashboard:summary:${BUSINESS_ID}:this_month`);
    });

    it('returns parsed data on cache hit', async () => {
      const data = makeSummaryData();
      redis.get.mockResolvedValueOnce(JSON.stringify(data));

      const result = await getCachedSummary(asRedis(redis), BUSINESS_ID, PERIOD);
      // JSON round-trip turns Date objects into ISO strings
      expect(result).toEqual(JSON.parse(JSON.stringify(data)));
    });

    it('sets data with correct TTL', async () => {
      const data = makeSummaryData();
      await cacheSummary(asRedis(redis), BUSINESS_ID, PERIOD, data);

      expect(redis.setex).toHaveBeenCalledWith(
        `dashboard:summary:${BUSINESS_ID}:this_month`,
        CACHE_TTL_SECONDS,
        JSON.stringify(data),
      );
    });
  });

  // -- Trends --

  describe('getCachedTrends / cacheTrends', () => {
    it('returns null on cache miss', async () => {
      const result = await getCachedTrends(asRedis(redis), BUSINESS_ID, PERIOD);
      expect(result).toBeNull();
    });

    it('returns parsed data on cache hit', async () => {
      const data = makeTrendData();
      redis.get.mockResolvedValueOnce(JSON.stringify(data));

      const result = await getCachedTrends(asRedis(redis), BUSINESS_ID, PERIOD);
      // JSON round-trip turns Date objects into ISO strings
      expect(result).toEqual(JSON.parse(JSON.stringify(data)));
    });

    it('sets data with correct TTL', async () => {
      const data = makeTrendData();
      await cacheTrends(asRedis(redis), BUSINESS_ID, PERIOD, data);

      expect(redis.setex).toHaveBeenCalledWith(
        `dashboard:trends:${BUSINESS_ID}:this_month`,
        CACHE_TTL_SECONDS,
        JSON.stringify(data),
      );
    });
  });

  // -- Categories --

  describe('getCachedCategories / cacheCategories', () => {
    const categoryData = [
      {
        category: 'RENT_UTILITIES',
        categoryDisplay: 'Rent & Utilities',
        totalAmountKobo: 100_000,
        transactionCount: 3,
        percentageOfTotal: 50,
      },
    ];

    it('returns null on cache miss', async () => {
      const result = await getCachedCategories(asRedis(redis), BUSINESS_ID, PERIOD);
      expect(result).toBeNull();
    });

    it('returns parsed data on cache hit', async () => {
      redis.get.mockResolvedValueOnce(JSON.stringify(categoryData));
      const result = await getCachedCategories(asRedis(redis), BUSINESS_ID, PERIOD);
      expect(result).toEqual(categoryData);
    });

    it('sets data with correct TTL', async () => {
      await cacheCategories(asRedis(redis), BUSINESS_ID, PERIOD, categoryData);
      expect(redis.setex).toHaveBeenCalledWith(
        `dashboard:categories:${BUSINESS_ID}:this_month`,
        CACHE_TTL_SECONDS,
        JSON.stringify(categoryData),
      );
    });
  });

  // -- Counterparties --

  describe('getCachedCounterparties / cacheCounterparties', () => {
    const counterpartyData = [
      {
        counterparty: 'Acme Corp',
        totalAmountKobo: 200_000,
        transactionCount: 5,
        percentageOfTotal: 40,
      },
    ];

    it('returns null on cache miss', async () => {
      const result = await getCachedCounterparties(asRedis(redis), BUSINESS_ID, PERIOD, 'INFLOW');
      expect(result).toBeNull();
    });

    it('returns parsed data on cache hit', async () => {
      redis.get.mockResolvedValueOnce(JSON.stringify(counterpartyData));
      const result = await getCachedCounterparties(asRedis(redis), BUSINESS_ID, PERIOD, 'OUTFLOW');
      expect(result).toEqual(counterpartyData);
    });

    it('sets data with correct TTL and includes type in key', async () => {
      await cacheCounterparties(asRedis(redis), BUSINESS_ID, PERIOD, 'INFLOW', counterpartyData);
      expect(redis.setex).toHaveBeenCalledWith(
        `dashboard:counterparties:${BUSINESS_ID}:this_month:INFLOW`,
        CACHE_TTL_SECONDS,
        JSON.stringify(counterpartyData),
      );
    });
  });

  // -- TTL verification --

  it('all set operations use 300-second TTL', async () => {
    await cacheSummary(asRedis(redis), BUSINESS_ID, PERIOD, makeSummaryData());
    await cacheTrends(asRedis(redis), BUSINESS_ID, PERIOD, makeTrendData());
    await cacheCategories(asRedis(redis), BUSINESS_ID, PERIOD, []);
    await cacheCounterparties(asRedis(redis), BUSINESS_ID, PERIOD, 'INFLOW', []);

    for (const call of redis.setex.mock.calls) {
      expect(call[1]).toBe(300);
    }
  });
});

// ---------------------------------------------------------------------------
// 6.3 — Cache invalidation
// ---------------------------------------------------------------------------

describe('invalidateBusinessCache', () => {
  let redis: ReturnType<typeof createRedisMock>;

  beforeEach(() => {
    redis = createRedisMock();
  });

  it('deletes all keys matching the business pattern', async () => {
    const matchingKeys = [
      `dashboard:summary:${BUSINESS_ID}:this_month`,
      `dashboard:trends:${BUSINESS_ID}:this_week`,
    ];
    redis.keys.mockResolvedValueOnce(matchingKeys);

    await invalidateBusinessCache(asRedis(redis), BUSINESS_ID);

    expect(redis.keys).toHaveBeenCalledWith(`dashboard:*:${BUSINESS_ID}:*`);
    expect(redis.del).toHaveBeenCalledWith(...matchingKeys);
  });

  it('does not call del when no keys match', async () => {
    redis.keys.mockResolvedValueOnce([]);

    await invalidateBusinessCache(asRedis(redis), BUSINESS_ID);

    expect(redis.del).not.toHaveBeenCalled();
  });
});

describe('getAffectedPeriodKeys', () => {
  it('returns "today" when transaction date is today in WAT', () => {
    const now = new Date();
    const affected = getAffectedPeriodKeys(now);
    expect(affected).toContain('today');
  });

  it('does not return "today" for a date far in the past', () => {
    const pastDate = new Date('2020-01-01T00:00:00Z');
    const affected = getAffectedPeriodKeys(pastDate);
    expect(affected).not.toContain('today');
  });

  it('returns "this_year" for a date in the current year', () => {
    const now = new Date();
    const affected = getAffectedPeriodKeys(now);
    expect(affected).toContain('this_year');
  });

  it('returns all standard periods for the current moment', () => {
    const now = new Date();
    const affected = getAffectedPeriodKeys(now);
    // The current moment should be in today, this_week, this_month, this_quarter, this_year
    expect(affected).toContain('today');
    expect(affected).toContain('this_week');
    expect(affected).toContain('this_month');
    expect(affected).toContain('this_quarter');
    expect(affected).toContain('this_year');
  });
});

describe('invalidateAffectedPeriods', () => {
  let redis: ReturnType<typeof createRedisMock>;

  beforeEach(() => {
    redis = createRedisMock();
  });

  it('deletes keys for all affected periods and cache types', async () => {
    const now = new Date();
    await invalidateAffectedPeriods(asRedis(redis), BUSINESS_ID, now);

    // Current moment affects all 5 standard periods.
    // Each period produces: summary, trends, categories, counterparties(INFLOW), counterparties(OUTFLOW)
    // = 5 keys per period × 5 periods = 25 keys
    expect(redis.del).toHaveBeenCalledTimes(1);
    const deletedKeys = redis.del.mock.calls[0] as string[];
    expect(deletedKeys.length).toBe(25);
  });

  it('does not call del when no periods are affected', async () => {
    const pastDate = new Date('2010-01-01T00:00:00Z');
    await invalidateAffectedPeriods(asRedis(redis), BUSINESS_ID, pastDate);

    expect(redis.del).not.toHaveBeenCalled();
  });
});
