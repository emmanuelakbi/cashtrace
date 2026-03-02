/**
 * Unit tests for DashboardController.
 *
 * Tests parameter parsing, authentication, business ownership verification,
 * error handling, and response formatting using mocked dependencies.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import type { Express } from 'express';
import request from 'supertest';

import type { BusinessInfo, DashboardRouterDeps } from './dashboardController.js';
import { createDashboardRouter, DashboardError } from './dashboardController.js';
import { DASHBOARD_ERROR_CODES } from '../types/index.js';

// ---------------------------------------------------------------------------
// Mock services — we mock the service modules so the controller tests
// exercise only the controller logic (parsing, auth, formatting, errors).
// ---------------------------------------------------------------------------

vi.mock('../services/summaryService.js', () => ({
  getSummaryWithComparison: vi.fn().mockResolvedValue({
    current: {
      totalRevenueKobo: 500000,
      totalExpensesKobo: 300000,
      netCashflowKobo: 200000,
      transactionCount: 10,
      averageTransactionKobo: 80000,
      periodStart: new Date('2024-01-01T00:00:00Z'),
      periodEnd: new Date('2024-01-31T23:59:59Z'),
    },
    previous: {
      totalRevenueKobo: 400000,
      totalExpensesKobo: 250000,
      netCashflowKobo: 150000,
      transactionCount: 8,
      averageTransactionKobo: 81250,
      periodStart: new Date('2023-12-01T00:00:00Z'),
      periodEnd: new Date('2023-12-31T23:59:59Z'),
    },
    comparison: {
      revenueChangePercent: 25,
      expensesChangePercent: 20,
      netCashflowChangePercent: 33.33,
      transactionCountChange: 2,
    },
  }),
}));

vi.mock('../services/trendService.js', () => ({
  getTrendData: vi.fn().mockResolvedValue({
    granularity: 'WEEKLY',
    dataPoints: [
      {
        date: new Date('2024-01-01T00:00:00Z'),
        label: 'Week 1',
        inflowsKobo: 100000,
        outflowsKobo: 50000,
        netCashflowKobo: 50000,
        transactionCount: 3,
      },
    ],
    periodStart: new Date('2024-01-01T00:00:00Z'),
    periodEnd: new Date('2024-01-31T23:59:59Z'),
  }),
}));

vi.mock('../services/categoryService.js', () => ({
  getTopExpenseCategories: vi.fn().mockResolvedValue([
    {
      category: 'RENT_UTILITIES',
      categoryDisplay: 'Rent Utilities',
      totalAmountKobo: 150000,
      transactionCount: 3,
      percentageOfTotal: 50,
    },
    {
      category: 'SALARIES_WAGES',
      categoryDisplay: 'Salaries Wages',
      totalAmountKobo: 150000,
      transactionCount: 2,
      percentageOfTotal: 50,
    },
  ]),
}));

vi.mock('../services/counterpartyService.js', () => ({
  getTopCustomers: vi.fn().mockResolvedValue([
    {
      counterparty: 'Customer A',
      totalAmountKobo: 300000,
      transactionCount: 5,
      percentageOfTotal: 60,
    },
  ]),
  getTopVendors: vi.fn().mockResolvedValue([
    {
      counterparty: 'Vendor X',
      totalAmountKobo: 200000,
      transactionCount: 4,
      percentageOfTotal: 66.67,
    },
  ]),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const defaultBusiness: BusinessInfo = {
  id: 'biz-001',
  userId: 'user-001',
};

function createTestApp(overrides?: Partial<DashboardRouterDeps>): Express {
  const app = express();
  app.use(express.json());

  // Simulate auth middleware setting req.user
  app.use((req, _res, next) => {
    (req as Record<string, unknown>).user = { userId: 'user-001' };
    next();
  });

  const deps: DashboardRouterDeps = {
    pool: {} as DashboardRouterDeps['pool'],
    redis: {} as DashboardRouterDeps['redis'],
    getBusinessByUserId: vi.fn().mockResolvedValue(defaultBusiness),
    ...overrides,
  };

  app.use('/api/dashboard', createDashboardRouter(deps));
  return app;
}

function createUnauthenticatedApp(overrides?: Partial<DashboardRouterDeps>): Express {
  const app = express();
  app.use(express.json());
  // No auth middleware — req.user is undefined

  const deps: DashboardRouterDeps = {
    pool: {} as DashboardRouterDeps['pool'],
    redis: {} as DashboardRouterDeps['redis'],
    getBusinessByUserId: vi.fn().mockResolvedValue(defaultBusiness),
    ...overrides,
  };

  app.use('/api/dashboard', createDashboardRouter(deps));
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DashboardController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // GET /api/dashboard/summary
  // -----------------------------------------------------------------------

  describe('GET /summary', () => {
    it('returns 200 with summary data for default period', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/dashboard/summary');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.requestId).toBeDefined();
      expect(res.body.data.current.totalRevenue.kobo).toBe(500000);
      expect(res.body.data.current.totalRevenue.formatted).toContain('₦');
      expect(res.body.data.comparison.revenueChange.percentage).toBe(25);
      expect(res.body.data.period.type).toBe('this_month');
    });

    it('accepts valid period parameter', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/dashboard/summary?period=today');

      expect(res.status).toBe(200);
      expect(res.body.data.period.type).toBe('today');
    });

    it('returns 400 for invalid period', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/dashboard/summary?period=invalid');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(DASHBOARD_ERROR_CODES.INVALID_PERIOD);
      expect(res.body.requestId).toBeDefined();
    });

    it('returns 400 when custom period missing dates', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/dashboard/summary?period=custom');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(DASHBOARD_ERROR_CODES.DATE_REQUIRED);
    });

    it('returns 403 when not authenticated', async () => {
      const app = createUnauthenticatedApp();
      const res = await request(app).get('/api/dashboard/summary');

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(DASHBOARD_ERROR_CODES.FORBIDDEN);
    });

    it('returns 404 when user has no business', async () => {
      const app = createTestApp({
        getBusinessByUserId: vi.fn().mockResolvedValue(null),
      });
      const res = await request(app).get('/api/dashboard/summary');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(DASHBOARD_ERROR_CODES.BUSINESS_NOT_FOUND);
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/dashboard/trends
  // -----------------------------------------------------------------------

  describe('GET /trends', () => {
    it('returns 200 with trend data', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/dashboard/trends');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.granularity).toBe('WEEKLY');
      expect(res.body.data.dataPoints).toHaveLength(1);
      expect(res.body.data.dataPoints[0].inflows.kobo).toBe(100000);
      expect(res.body.requestId).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/dashboard/categories
  // -----------------------------------------------------------------------

  describe('GET /categories', () => {
    it('returns 200 with category data', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/dashboard/categories');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.categories).toHaveLength(2);
      expect(res.body.data.totalExpenses.kobo).toBe(300000);
      expect(res.body.requestId).toBeDefined();
    });

    it('returns 400 for invalid limit', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/dashboard/categories?limit=99');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(DASHBOARD_ERROR_CODES.LIMIT_EXCEEDED);
    });

    it('returns 400 for non-integer limit', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/dashboard/categories?limit=abc');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(DASHBOARD_ERROR_CODES.LIMIT_EXCEEDED);
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/dashboard/top-counterparties
  // -----------------------------------------------------------------------

  describe('GET /top-counterparties', () => {
    it('returns 200 with customers and vendors', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/dashboard/top-counterparties');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.customers.topCounterparties).toHaveLength(1);
      expect(res.body.data.vendors.topCounterparties).toHaveLength(1);
      expect(res.body.data.customers.topCounterparties[0].name).toBe('Customer A');
      expect(res.body.data.vendors.topCounterparties[0].name).toBe('Vendor X');
      expect(res.body.requestId).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe('Error handling', () => {
    it('returns 400 for invalid date range (start > end)', async () => {
      const app = createTestApp();
      const res = await request(app).get(
        '/api/dashboard/summary?period=custom&startDate=2024-12-31&endDate=2024-01-01',
      );

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(DASHBOARD_ERROR_CODES.INVALID_DATE_RANGE);
    });

    it('includes requestId in all error responses', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/dashboard/summary?period=invalid');

      expect(res.body.requestId).toBeDefined();
      expect(typeof res.body.requestId).toBe('string');
      expect(res.body.requestId.length).toBeGreaterThan(0);
    });

    it('returns 500 for unexpected errors', async () => {
      const app = createTestApp({
        getBusinessByUserId: vi.fn().mockRejectedValue(new Error('DB connection failed')),
      });
      const res = await request(app).get('/api/dashboard/summary');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(DASHBOARD_ERROR_CODES.INTERNAL_ERROR);
      expect(res.body.requestId).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // DashboardError class
  // -----------------------------------------------------------------------

  describe('DashboardError', () => {
    it('creates error with code and message', () => {
      const err = new DashboardError(DASHBOARD_ERROR_CODES.BUSINESS_NOT_FOUND, 'No business found');
      expect(err.code).toBe('DASHBOARD_BUSINESS_NOT_FOUND');
      expect(err.message).toBe('No business found');
      expect(err.name).toBe('DashboardError');
      expect(err.fields).toBeUndefined();
    });

    it('creates error with fields', () => {
      const err = new DashboardError(DASHBOARD_ERROR_CODES.VALIDATION_ERROR, 'Validation failed', {
        period: ['Invalid period'],
      });
      expect(err.fields).toEqual({ period: ['Invalid period'] });
    });
  });
});
