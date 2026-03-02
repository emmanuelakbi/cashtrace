/**
 * Property-based tests for DashboardController.
 *
 * Feature: analytics-dashboard
 *
 * Tests Properties 15 and 16 from the design document.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import express from 'express';
import type { Express } from 'express';
import request from 'supertest';

import type { BusinessInfo, DashboardRouterDeps } from './dashboardController.js';
import { createDashboardRouter } from './dashboardController.js';

// ---------------------------------------------------------------------------
// Mock services — minimal stubs so the controller can run end-to-end
// ---------------------------------------------------------------------------

vi.mock('../services/summaryService.js', () => ({
  getSummaryWithComparison: vi.fn().mockResolvedValue({
    current: {
      totalRevenueKobo: 100000,
      totalExpensesKobo: 50000,
      netCashflowKobo: 50000,
      transactionCount: 5,
      averageTransactionKobo: 30000,
      periodStart: new Date('2024-01-01T00:00:00Z'),
      periodEnd: new Date('2024-01-31T23:59:59Z'),
    },
    previous: {
      totalRevenueKobo: 80000,
      totalExpensesKobo: 40000,
      netCashflowKobo: 40000,
      transactionCount: 4,
      averageTransactionKobo: 30000,
      periodStart: new Date('2023-12-01T00:00:00Z'),
      periodEnd: new Date('2023-12-31T23:59:59Z'),
    },
    comparison: {
      revenueChangePercent: 25,
      expensesChangePercent: 25,
      netCashflowChangePercent: 25,
      transactionCountChange: 1,
    },
  }),
}));

vi.mock('../services/trendService.js', () => ({
  getTrendData: vi.fn().mockResolvedValue({
    granularity: 'WEEKLY',
    dataPoints: [],
    periodStart: new Date('2024-01-01T00:00:00Z'),
    periodEnd: new Date('2024-01-31T23:59:59Z'),
  }),
}));

vi.mock('../services/categoryService.js', () => ({
  getTopExpenseCategories: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/counterpartyService.js', () => ({
  getTopCustomers: vi.fn().mockResolvedValue([]),
  getTopVendors: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Shared arbitraries
// ---------------------------------------------------------------------------

const userIdArb = fc.uuid();
const businessIdArb = fc.uuid();

const endpointArb = fc.constantFrom(
  '/api/dashboard/summary',
  '/api/dashboard/trends',
  '/api/dashboard/categories',
  '/api/dashboard/top-counterparties',
);

/**
 * Generate two distinct UUIDs guaranteed to be different.
 */
const distinctUserPairArb = fc.tuple(userIdArb, userIdArb).filter(([a, b]) => a !== b);

// ---------------------------------------------------------------------------
// Test app factory
// ---------------------------------------------------------------------------

function createIsolationApp(authenticatedUserId: string, business: BusinessInfo | null): Express {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    (req as Record<string, unknown>).user = { userId: authenticatedUserId };
    next();
  });

  const deps: DashboardRouterDeps = {
    pool: {} as DashboardRouterDeps['pool'],
    redis: {} as DashboardRouterDeps['redis'],
    getBusinessByUserId: vi.fn().mockResolvedValue(business),
  };

  app.use('/api/dashboard', createDashboardRouter(deps));
  return app;
}

// ---------------------------------------------------------------------------
// Property 15: Data Isolation Enforcement
// ---------------------------------------------------------------------------

describe('Feature: analytics-dashboard, Property 15: Data Isolation Enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Validates: Requirements 10.5, 10.6, 11.1, 11.2, 11.3
   *
   * For any pair of (authenticatedUserId, businessOwnerId) where they differ,
   * the system SHALL return 403 Forbidden and no data SHALL be leaked.
   */
  it('rejects requests when authenticated user does not own the business', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctUserPairArb,
        businessIdArb,
        endpointArb,
        async ([authenticatedUserId, businessOwnerId], bizId, endpoint) => {
          const business: BusinessInfo = {
            id: bizId,
            userId: businessOwnerId,
          };

          const app = createIsolationApp(authenticatedUserId, business);
          const res = await request(app).get(endpoint);

          expect(res.status).toBe(403);
          expect(res.body.success).toBe(false);
          expect(res.body.error.code).toBe('DASHBOARD_FORBIDDEN');
          expect(res.body.data).toBeUndefined();
          expect(res.body.requestId).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 10.5, 10.6, 11.1
   *
   * For any authenticated user who owns the business, the system SHALL
   * return 200 with data scoped to that business.
   */
  it('allows requests when authenticated user owns the business', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, businessIdArb, endpointArb, async (userId, bizId, endpoint) => {
        const business: BusinessInfo = {
          id: bizId,
          userId,
        };

        const app = createIsolationApp(userId, business);
        const res = await request(app).get(endpoint);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.requestId).toBeDefined();
        expect(res.body.data).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 10.7, 11.3
   *
   * For any authenticated user with no business, the system SHALL return
   * 404 Not Found.
   */
  it('returns 404 when user has no business', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, endpointArb, async (userId, endpoint) => {
        const app = createIsolationApp(userId, null);
        const res = await request(app).get(endpoint);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('DASHBOARD_BUSINESS_NOT_FOUND');
        expect(res.body.data).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 16: API Response Format Consistency
// ---------------------------------------------------------------------------

describe('Feature: analytics-dashboard, Property 16: API Response Format Consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Validates: Requirements 10.8, 12.1, 12.2, 12.3, 12.4, 12.5
   *
   * For any successful API response, it SHALL contain:
   * - success: true (boolean)
   * - data: object
   * - requestId: non-empty string
   * HTTP status SHALL be 200.
   */
  it('all success responses have consistent shape with success, data, and requestId', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, businessIdArb, endpointArb, async (userId, bizId, endpoint) => {
        const business: BusinessInfo = { id: bizId, userId };
        const app = createIsolationApp(userId, business);
        const res = await request(app).get(endpoint);

        expect(res.status).toBe(200);
        expect(typeof res.body.success).toBe('boolean');
        expect(res.body.success).toBe(true);
        expect(typeof res.body.data).toBe('object');
        expect(res.body.data).not.toBeNull();
        expect(typeof res.body.requestId).toBe('string');
        expect(res.body.requestId.length).toBeGreaterThan(0);
        expect(res.body.error).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 12.1, 12.2, 12.3, 12.4
   *
   * For any error response, it SHALL contain:
   * - success: false (boolean)
   * - error: { code: string, message: string }
   * - requestId: non-empty string
   * - No data field
   * HTTP status SHALL match the error type.
   */
  it('all error responses have consistent shape with success, error, and requestId', async () => {
    const errorScenarioArb = fc.constantFrom(
      {
        query: '?period=invalid_value',
        expectedStatus: 400,
        expectedCode: 'DASHBOARD_INVALID_PERIOD',
      },
      { query: '?period=custom', expectedStatus: 400, expectedCode: 'DASHBOARD_DATE_REQUIRED' },
      {
        query: '?period=custom&startDate=2024-12-31&endDate=2024-01-01',
        expectedStatus: 400,
        expectedCode: 'DASHBOARD_INVALID_DATE_RANGE',
      },
    );

    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        businessIdArb,
        endpointArb,
        errorScenarioArb,
        async (userId, bizId, endpoint, scenario) => {
          const business: BusinessInfo = { id: bizId, userId };
          const app = createIsolationApp(userId, business);
          const res = await request(app).get(`${endpoint}${scenario.query}`);

          expect(res.status).toBe(scenario.expectedStatus);
          expect(typeof res.body.success).toBe('boolean');
          expect(res.body.success).toBe(false);
          expect(typeof res.body.error).toBe('object');
          expect(res.body.error).not.toBeNull();
          expect(typeof res.body.error.code).toBe('string');
          expect(res.body.error.code.length).toBeGreaterThan(0);
          expect(typeof res.body.error.message).toBe('string');
          expect(res.body.error.message.length).toBeGreaterThan(0);
          expect(typeof res.body.requestId).toBe('string');
          expect(res.body.requestId.length).toBeGreaterThan(0);
          expect(res.body.data).toBeUndefined();
          expect(res.body.error.code).toBe(scenario.expectedCode);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 12.3, 12.4
   *
   * HTTP status codes SHALL match error types:
   * - 403 for forbidden access
   * - 404 for missing business
   */
  it('HTTP status codes match error types across all endpoints', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctUserPairArb,
        businessIdArb,
        endpointArb,
        async ([authUserId, ownerUserId], bizId, endpoint) => {
          const business: BusinessInfo = { id: bizId, userId: ownerUserId };
          const app = createIsolationApp(authUserId, business);
          const res = await request(app).get(endpoint);

          expect(res.status).toBe(403);
          expect(res.body.error.code).toBe('DASHBOARD_FORBIDDEN');
        },
      ),
      { numRuns: 100 },
    );
  });
});
