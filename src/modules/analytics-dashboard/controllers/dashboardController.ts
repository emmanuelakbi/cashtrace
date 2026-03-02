/**
 * Dashboard controller — Express router factory for analytics endpoints.
 *
 * Uses dependency injection via `createDashboardRouter(deps)` to receive
 * the PostgreSQL pool, Redis client, and a business-lookup function.
 *
 * Each handler follows the pattern:
 * 1. Parse and validate query parameters.
 * 2. Verify authentication and business ownership.
 * 3. Call the appropriate service.
 * 4. Format and return the response with a requestId.
 *
 * @module modules/analytics-dashboard/controllers/dashboardController
 */

import crypto from 'node:crypto';

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';

import type {
  CategoryDisplay,
  CategoryResponse,
  ComparisonKPIs,
  CounterpartyDisplay,
  CounterpartyResponse,
  DashboardErrorCode,
  ErrorResponse,
  PeriodInfo,
  PeriodType,
  SummaryKPIs,
  SummaryResponse,
  SummaryWithComparison,
  TrendDataPointDisplay,
  TrendResponse,
} from '../types/index.js';
import { DASHBOARD_ERROR_CODES } from '../types/index.js';
import { getSummaryWithComparison } from '../services/summaryService.js';
import { getTrendData } from '../services/trendService.js';
import { getTopExpenseCategories } from '../services/categoryService.js';
import { getTopCustomers, getTopVendors } from '../services/counterpartyService.js';
import { calculatePeriodBounds, calculatePreviousPeriod } from '../utils/periodService.js';
import {
  createAmountDisplay,
  formatPercentage,
  formatPercentageChange,
} from '../utils/formatterService.js';

// ---------------------------------------------------------------------------
// Valid period types for validation
// ---------------------------------------------------------------------------

const VALID_PERIOD_TYPES: ReadonlySet<string> = new Set<string>([
  'today',
  'this_week',
  'this_month',
  'this_quarter',
  'this_year',
  'custom',
]);

// ---------------------------------------------------------------------------
// DashboardError
// ---------------------------------------------------------------------------

/**
 * Custom error class for dashboard-specific errors.
 * Carries a machine-readable error code and optional field-level details.
 */
export class DashboardError extends Error {
  readonly code: DashboardErrorCode;
  readonly fields?: Record<string, string[]>;

  constructor(code: DashboardErrorCode, message: string, fields?: Record<string, string[]>) {
    super(message);
    this.name = 'DashboardError';
    this.code = code;
    this.fields = fields;
  }
}

// ---------------------------------------------------------------------------
// Dependency injection types
// ---------------------------------------------------------------------------

/** Business entity returned by the lookup function. */
export interface BusinessInfo {
  id: string;
  userId: string;
}

/** Dependencies injected into the dashboard router factory. */
export interface DashboardRouterDeps {
  pool: Pool;
  redis: Redis;
  getBusinessByUserId: (userId: string) => Promise<BusinessInfo | null>;
}

/** Extended Express Request with authenticated user context. */
interface AuthenticatedRequest extends Request {
  user?: { userId: string };
}

// ---------------------------------------------------------------------------
// Parameter parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse and validate the `period` query parameter.
 *
 * @param raw - Raw query string value.
 * @returns A valid PeriodType, defaulting to 'this_month'.
 * @throws DashboardError when the value is not a recognised period type.
 */
function parsePeriod(raw: unknown): PeriodType {
  if (raw === undefined || raw === null || raw === '') {
    return 'this_month';
  }
  const value = String(raw);
  if (!VALID_PERIOD_TYPES.has(value)) {
    throw new DashboardError(
      DASHBOARD_ERROR_CODES.INVALID_PERIOD,
      `Invalid period type: ${value}. Must be one of: ${[...VALID_PERIOD_TYPES].join(', ')}`,
      { period: [`Invalid period type: ${value}`] },
    );
  }
  return value as PeriodType;
}

/**
 * Parse optional ISO 8601 date strings for custom periods.
 *
 * @param period - The resolved period type.
 * @param rawStart - Raw startDate query param.
 * @param rawEnd - Raw endDate query param.
 * @returns Tuple of [startDate, endDate] or [undefined, undefined].
 * @throws DashboardError for missing or invalid dates.
 */
function parseCustomDates(
  period: PeriodType,
  rawStart: unknown,
  rawEnd: unknown,
): [Date | undefined, Date | undefined] {
  if (period !== 'custom') {
    return [undefined, undefined];
  }

  if (!rawStart || !rawEnd) {
    throw new DashboardError(
      DASHBOARD_ERROR_CODES.DATE_REQUIRED,
      'Custom period requires both startDate and endDate',
      {
        ...(rawStart ? {} : { startDate: ['startDate is required for custom period'] }),
        ...(rawEnd ? {} : { endDate: ['endDate is required for custom period'] }),
      },
    );
  }

  const startDate = new Date(String(rawStart));
  const endDate = new Date(String(rawEnd));

  if (isNaN(startDate.getTime())) {
    throw new DashboardError(
      DASHBOARD_ERROR_CODES.INVALID_DATE_RANGE,
      'Invalid startDate format. Use ISO 8601.',
      { startDate: ['Invalid date format'] },
    );
  }
  if (isNaN(endDate.getTime())) {
    throw new DashboardError(
      DASHBOARD_ERROR_CODES.INVALID_DATE_RANGE,
      'Invalid endDate format. Use ISO 8601.',
      { endDate: ['Invalid date format'] },
    );
  }
  if (startDate > endDate) {
    throw new DashboardError(
      DASHBOARD_ERROR_CODES.INVALID_DATE_RANGE,
      'startDate must be before or equal to endDate',
      { startDate: ['Must be before endDate'] },
    );
  }

  return [startDate, endDate];
}

/**
 * Parse and validate the `limit` query parameter.
 *
 * @param raw - Raw query string value.
 * @returns A valid limit integer (1–10), defaulting to 5.
 * @throws DashboardError when the value is out of range.
 */
function parseLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') {
    return 5;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new DashboardError(
      DASHBOARD_ERROR_CODES.LIMIT_EXCEEDED,
      'limit must be an integer between 1 and 10',
      { limit: ['Must be an integer between 1 and 10'] },
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Auth & business verification
// ---------------------------------------------------------------------------

/**
 * Extract the authenticated userId from the request.
 *
 * @param req - Express request (expected to have `req.user.userId`).
 * @returns The authenticated user's ID.
 * @throws DashboardError (FORBIDDEN) when not authenticated.
 */
function getAuthenticatedUserId(req: AuthenticatedRequest): string {
  const userId = req.user?.userId;
  if (!userId) {
    throw new DashboardError(DASHBOARD_ERROR_CODES.FORBIDDEN, 'Authentication required');
  }
  return userId;
}

/**
 * Look up the business for the authenticated user and verify ownership.
 *
 * @param getBusinessByUserId - Dependency-injected lookup function.
 * @param userId - The authenticated user's ID.
 * @returns The business info.
 * @throws DashboardError (BUSINESS_NOT_FOUND or FORBIDDEN).
 */
async function verifyBusinessOwnership(
  getBusinessByUserId: DashboardRouterDeps['getBusinessByUserId'],
  userId: string,
): Promise<BusinessInfo> {
  const business = await getBusinessByUserId(userId);
  if (!business) {
    throw new DashboardError(
      DASHBOARD_ERROR_CODES.BUSINESS_NOT_FOUND,
      'No business found for the authenticated user',
    );
  }
  if (business.userId !== userId) {
    throw new DashboardError(
      DASHBOARD_ERROR_CODES.FORBIDDEN,
      'You do not have access to this business',
    );
  }
  return business;
}

// ---------------------------------------------------------------------------
// Response formatting helpers
// ---------------------------------------------------------------------------

/**
 * Build PeriodInfo for API responses.
 */
function buildPeriodInfo(period: PeriodType, customStart?: Date, customEnd?: Date): PeriodInfo {
  const bounds = calculatePeriodBounds(period, customStart, customEnd);
  const previous = calculatePreviousPeriod(bounds);

  return {
    type: bounds.periodType,
    startDate: bounds.startDate.toISOString(),
    endDate: bounds.endDate.toISOString(),
    daysInPeriod: bounds.daysInPeriod,
    previousStartDate: previous.startDate.toISOString(),
    previousEndDate: previous.endDate.toISOString(),
  };
}

/**
 * Format SummaryData into SummaryKPIs for the API response.
 */
function formatSummaryKPIs(data: SummaryWithComparison['current']): SummaryKPIs {
  return {
    totalRevenue: createAmountDisplay(data.totalRevenueKobo),
    totalExpenses: createAmountDisplay(data.totalExpensesKobo),
    netCashflow: createAmountDisplay(data.netCashflowKobo),
    transactionCount: data.transactionCount,
    averageTransactionValue: createAmountDisplay(data.averageTransactionKobo),
  };
}

/**
 * Format ComparisonData into ComparisonKPIs for the API response.
 */
function formatComparisonKPIs(data: SummaryWithComparison): ComparisonKPIs {
  const { comparison, current, previous } = data;

  const countChangePercent =
    previous.transactionCount === 0 && current.transactionCount === 0
      ? 0
      : previous.transactionCount === 0
        ? Infinity
        : ((current.transactionCount - previous.transactionCount) /
            Math.abs(previous.transactionCount)) *
          100;

  return {
    revenueChange: {
      percentage: comparison.revenueChangePercent,
      formatted: formatPercentageChange(
        isFinite(comparison.revenueChangePercent) ? comparison.revenueChangePercent : 0,
      ),
      direction:
        comparison.revenueChangePercent > 0
          ? 'up'
          : comparison.revenueChangePercent < 0
            ? 'down'
            : 'unchanged',
    },
    expensesChange: {
      percentage: comparison.expensesChangePercent,
      formatted: formatPercentageChange(
        isFinite(comparison.expensesChangePercent) ? comparison.expensesChangePercent : 0,
      ),
      direction:
        comparison.expensesChangePercent > 0
          ? 'up'
          : comparison.expensesChangePercent < 0
            ? 'down'
            : 'unchanged',
    },
    netCashflowChange: {
      percentage: comparison.netCashflowChangePercent,
      formatted: formatPercentageChange(
        isFinite(comparison.netCashflowChangePercent) ? comparison.netCashflowChangePercent : 0,
      ),
      direction:
        comparison.netCashflowChangePercent > 0
          ? 'up'
          : comparison.netCashflowChangePercent < 0
            ? 'down'
            : 'unchanged',
    },
    transactionCountChange: {
      absolute: comparison.transactionCountChange,
      percentage: countChangePercent,
      formatted: formatPercentageChange(isFinite(countChangePercent) ? countChangePercent : 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Error handling middleware
// ---------------------------------------------------------------------------

/** Map dashboard error codes to HTTP status codes. */
const ERROR_STATUS_MAP: Record<string, number> = {
  [DASHBOARD_ERROR_CODES.BUSINESS_NOT_FOUND]: 404,
  [DASHBOARD_ERROR_CODES.FORBIDDEN]: 403,
  [DASHBOARD_ERROR_CODES.INVALID_PERIOD]: 400,
  [DASHBOARD_ERROR_CODES.INVALID_DATE_RANGE]: 400,
  [DASHBOARD_ERROR_CODES.DATE_REQUIRED]: 400,
  [DASHBOARD_ERROR_CODES.LIMIT_EXCEEDED]: 400,
  [DASHBOARD_ERROR_CODES.VALIDATION_ERROR]: 400,
  [DASHBOARD_ERROR_CODES.INTERNAL_ERROR]: 500,
};

/**
 * Express error-handling middleware for dashboard routes.
 *
 * Maps DashboardError codes to HTTP status codes and returns a
 * consistent ErrorResponse shape with requestId.
 *
 * Validates: Requirements 10.7, 12.1, 12.2, 12.3, 12.4
 */
export function dashboardErrorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = (res.getHeader('x-request-id') as string | undefined) ?? crypto.randomUUID();

  if (err instanceof DashboardError) {
    const status = ERROR_STATUS_MAP[err.code] ?? 500;
    const body: ErrorResponse = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.fields ? { fields: err.fields } : {}),
      },
      requestId,
    };
    res.status(status).json(body);
    return;
  }

  // Unexpected error — return generic 500
  const body: ErrorResponse = {
    success: false,
    error: {
      code: DASHBOARD_ERROR_CODES.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
    },
    requestId,
  };
  res.status(500).json(body);
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * Create an Express router with all dashboard API endpoints.
 *
 * @param deps - Injected dependencies (pool, redis, getBusinessByUserId).
 * @returns An Express Router mounted at `/api/dashboard`.
 */
export function createDashboardRouter(deps: DashboardRouterDeps): Router {
  const { pool, redis, getBusinessByUserId } = deps;
  const router = Router();

  // Attach requestId to every response
  router.use((_req: Request, res: Response, next: NextFunction) => {
    const requestId = crypto.randomUUID();
    res.setHeader('x-request-id', requestId);
    next();
  });

  // -------------------------------------------------------------------------
  // GET /summary
  // -------------------------------------------------------------------------

  /**
   * GET /api/dashboard/summary
   *
   * Returns dashboard summary KPIs with period comparison.
   *
   * Validates: Requirements 10.1, 10.5, 10.6, 10.8
   */
  router.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = res.getHeader('x-request-id') as string;
      const userId = getAuthenticatedUserId(req as AuthenticatedRequest);
      const business = await verifyBusinessOwnership(getBusinessByUserId, userId);

      const period = parsePeriod(req.query.period);
      const [customStart, customEnd] = parseCustomDates(
        period,
        req.query.startDate,
        req.query.endDate,
      );

      const result = await getSummaryWithComparison(
        pool,
        redis,
        business.id,
        period,
        customStart,
        customEnd,
      );

      const periodInfo = buildPeriodInfo(period, customStart, customEnd);

      const response: SummaryResponse = {
        success: true,
        data: {
          period: periodInfo,
          current: formatSummaryKPIs(result.current),
          previous: formatSummaryKPIs(result.previous),
          comparison: formatComparisonKPIs(result),
        },
        requestId,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  });

  // -------------------------------------------------------------------------
  // GET /trends
  // -------------------------------------------------------------------------

  /**
   * GET /api/dashboard/trends
   *
   * Returns cashflow trend time series data.
   *
   * Validates: Requirements 10.2, 10.5, 10.6, 10.8
   */
  router.get('/trends', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = res.getHeader('x-request-id') as string;
      const userId = getAuthenticatedUserId(req as AuthenticatedRequest);
      const business = await verifyBusinessOwnership(getBusinessByUserId, userId);

      const period = parsePeriod(req.query.period);
      const [customStart, customEnd] = parseCustomDates(
        period,
        req.query.startDate,
        req.query.endDate,
      );

      const result = await getTrendData(pool, redis, business.id, period, customStart, customEnd);

      const periodInfo = buildPeriodInfo(period, customStart, customEnd);

      const dataPoints: TrendDataPointDisplay[] = result.dataPoints.map((dp) => ({
        date: dp.date.toISOString(),
        label: dp.label,
        inflows: createAmountDisplay(dp.inflowsKobo),
        outflows: createAmountDisplay(dp.outflowsKobo),
        netCashflow: createAmountDisplay(dp.netCashflowKobo),
        transactionCount: dp.transactionCount,
      }));

      const response: TrendResponse = {
        success: true,
        data: {
          period: periodInfo,
          granularity: result.granularity,
          dataPoints,
        },
        requestId,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  });

  // -------------------------------------------------------------------------
  // GET /categories
  // -------------------------------------------------------------------------

  /**
   * GET /api/dashboard/categories
   *
   * Returns top expense category breakdown.
   *
   * Validates: Requirements 10.3, 10.5, 10.6, 10.8
   */
  router.get('/categories', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = res.getHeader('x-request-id') as string;
      const userId = getAuthenticatedUserId(req as AuthenticatedRequest);
      const business = await verifyBusinessOwnership(getBusinessByUserId, userId);

      const period = parsePeriod(req.query.period);
      const [customStart, customEnd] = parseCustomDates(
        period,
        req.query.startDate,
        req.query.endDate,
      );
      const limit = parseLimit(req.query.limit);

      const categories = await getTopExpenseCategories(
        pool,
        redis,
        business.id,
        period,
        customStart,
        customEnd,
        limit,
      );

      const periodInfo = buildPeriodInfo(period, customStart, customEnd);

      const totalExpensesKobo = categories.reduce((sum, c) => sum + c.totalAmountKobo, 0);

      const categoryDisplays: CategoryDisplay[] = categories.map((c) => ({
        category: c.category,
        categoryDisplay: c.categoryDisplay,
        amount: createAmountDisplay(c.totalAmountKobo),
        transactionCount: c.transactionCount,
        percentage: c.percentageOfTotal,
        percentageFormatted: formatPercentage(c.percentageOfTotal),
      }));

      const response: CategoryResponse = {
        success: true,
        data: {
          period: periodInfo,
          totalExpenses: createAmountDisplay(totalExpensesKobo),
          categories: categoryDisplays,
        },
        requestId,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  });

  // -------------------------------------------------------------------------
  // GET /top-counterparties
  // -------------------------------------------------------------------------

  /**
   * GET /api/dashboard/top-counterparties
   *
   * Returns top customers (revenue sources) and vendors (expense destinations).
   *
   * Validates: Requirements 10.4, 10.5, 10.6, 10.8
   */
  router.get('/top-counterparties', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = res.getHeader('x-request-id') as string;
      const userId = getAuthenticatedUserId(req as AuthenticatedRequest);
      const business = await verifyBusinessOwnership(getBusinessByUserId, userId);

      const period = parsePeriod(req.query.period);
      const [customStart, customEnd] = parseCustomDates(
        period,
        req.query.startDate,
        req.query.endDate,
      );
      const limit = parseLimit(req.query.limit);

      const [customers, vendors] = await Promise.all([
        getTopCustomers(pool, redis, business.id, period, customStart, customEnd, limit),
        getTopVendors(pool, redis, business.id, period, customStart, customEnd, limit),
      ]);

      const periodInfo = buildPeriodInfo(period, customStart, customEnd);

      const totalRevenueKobo = customers.reduce((sum, c) => sum + c.totalAmountKobo, 0);
      const totalExpensesKobo = vendors.reduce((sum, v) => sum + v.totalAmountKobo, 0);

      const mapCounterparty = (c: {
        counterparty: string;
        totalAmountKobo: number;
        transactionCount: number;
        percentageOfTotal: number;
      }): CounterpartyDisplay => ({
        name: c.counterparty,
        amount: createAmountDisplay(c.totalAmountKobo),
        transactionCount: c.transactionCount,
        percentage: c.percentageOfTotal,
        percentageFormatted: formatPercentage(c.percentageOfTotal),
      });

      const response: CounterpartyResponse = {
        success: true,
        data: {
          period: periodInfo,
          customers: {
            totalRevenue: createAmountDisplay(totalRevenueKobo),
            topCounterparties: customers.map(mapCounterparty),
          },
          vendors: {
            totalExpenses: createAmountDisplay(totalExpensesKobo),
            topCounterparties: vendors.map(mapCounterparty),
          },
        },
        requestId,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  });

  // Attach error handler as the last middleware on this router
  router.use(dashboardErrorHandler);

  return router;
}
