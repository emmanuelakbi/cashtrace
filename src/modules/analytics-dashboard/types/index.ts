/**
 * Type definitions for the analytics-dashboard module.
 * All types are derived from the design document data models.
 *
 * @module modules/analytics-dashboard/types
 */

// ---------------------------------------------------------------------------
// Enums / Union Types
// ---------------------------------------------------------------------------

/**
 * Supported period types for analytics queries.
 * Defaults to 'this_month' when not specified.
 */
export type PeriodType =
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'this_quarter'
  | 'this_year'
  | 'custom';

/**
 * Granularity for trend data time buckets.
 * - DAILY: periods ≤ 7 days
 * - WEEKLY: periods 8–90 days
 * - MONTHLY: periods > 90 days
 */
export type TrendGranularity = 'DAILY' | 'WEEKLY' | 'MONTHLY';

// ---------------------------------------------------------------------------
// Request Types
// ---------------------------------------------------------------------------

/** Request parameters for the dashboard summary endpoint. */
export interface SummaryRequest {
  /** Period type – defaults to 'this_month'. */
  period?: PeriodType;
  /** ISO 8601 start date – required when period is 'custom'. */
  startDate?: string;
  /** ISO 8601 end date – required when period is 'custom'. */
  endDate?: string;
}

/** Request parameters for the cashflow trends endpoint. */
export interface TrendRequest {
  /** Period type – defaults to 'this_month'. */
  period?: PeriodType;
  /** ISO 8601 start date – required when period is 'custom'. */
  startDate?: string;
  /** ISO 8601 end date – required when period is 'custom'. */
  endDate?: string;
}

/** Request parameters for the expense category breakdown endpoint. */
export interface CategoryRequest {
  /** Period type – defaults to 'this_month'. */
  period?: PeriodType;
  /** ISO 8601 start date – required when period is 'custom'. */
  startDate?: string;
  /** ISO 8601 end date – required when period is 'custom'. */
  endDate?: string;
  /** Maximum categories to return – defaults to 5, max 10. */
  limit?: number;
}

/** Request parameters for the top counterparties endpoint. */
export interface CounterpartyRequest {
  /** Period type – defaults to 'this_month'. */
  period?: PeriodType;
  /** ISO 8601 start date – required when period is 'custom'. */
  startDate?: string;
  /** ISO 8601 end date – required when period is 'custom'. */
  endDate?: string;
  /** Maximum counterparties to return – defaults to 5, max 10. */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Core Data Types
// ---------------------------------------------------------------------------

/** Aggregated summary KPI data for a single period. */
export interface SummaryData {
  /** Total revenue (sum of INFLOW transactions) in kobo. */
  totalRevenueKobo: number;
  /** Total expenses (sum of OUTFLOW transactions) in kobo. */
  totalExpensesKobo: number;
  /** Net cashflow (revenue − expenses) in kobo. */
  netCashflowKobo: number;
  /** Total number of non-personal, non-deleted transactions. */
  transactionCount: number;
  /** Average transaction value in kobo (0 when count is 0). */
  averageTransactionKobo: number;
  /** Start of the period (inclusive). */
  periodStart: Date;
  /** End of the period (exclusive). */
  periodEnd: Date;
}

/** Percentage-change comparison between current and previous periods. */
export interface ComparisonData {
  /** Revenue percentage change. */
  revenueChangePercent: number;
  /** Expenses percentage change. */
  expensesChangePercent: number;
  /** Net cashflow percentage change. */
  netCashflowChangePercent: number;
  /** Absolute change in transaction count. */
  transactionCountChange: number;
}

/** Combined current + previous summary with comparison metrics. */
export interface SummaryWithComparison {
  current: SummaryData;
  previous: SummaryData;
  comparison: ComparisonData;
}

/** Resolved date boundaries for a period. */
export interface PeriodBounds {
  startDate: Date;
  endDate: Date;
  periodType: PeriodType;
  /** Number of days the period spans. */
  daysInPeriod: number;
}

// ---------------------------------------------------------------------------
// Trend Types
// ---------------------------------------------------------------------------

/** A single data point in a cashflow trend time series. */
export interface TrendDataPoint {
  /** Bucket date (start of the time bucket). */
  date: Date;
  /** Human-readable label (e.g. "Mon", "Week 1", "Jan"). */
  label: string;
  /** Total inflows in kobo. */
  inflowsKobo: number;
  /** Total outflows in kobo. */
  outflowsKobo: number;
  /** Net cashflow in kobo. */
  netCashflowKobo: number;
  /** Number of transactions in this bucket. */
  transactionCount: number;
}

/** Complete trend data for a period. */
export interface TrendData {
  granularity: TrendGranularity;
  dataPoints: TrendDataPoint[];
  periodStart: Date;
  periodEnd: Date;
}

// ---------------------------------------------------------------------------
// Category & Counterparty Types
// ---------------------------------------------------------------------------

/** Expense category breakdown entry. */
export interface CategoryBreakdown {
  /** Raw category key. */
  category: string;
  /** Human-readable category name. */
  categoryDisplay: string;
  /** Total amount in kobo. */
  totalAmountKobo: number;
  /** Number of transactions in this category. */
  transactionCount: number;
  /** Percentage of total expenses. */
  percentageOfTotal: number;
}

/** Counterparty breakdown entry. */
export interface CounterpartyBreakdown {
  /** Counterparty name – "Unknown" when the original value is null. */
  counterparty: string;
  /** Total amount in kobo. */
  totalAmountKobo: number;
  /** Number of transactions with this counterparty. */
  transactionCount: number;
  /** Percentage of total for the transaction type. */
  percentageOfTotal: number;
}

// ---------------------------------------------------------------------------
// Display / Formatting Types
// ---------------------------------------------------------------------------

/** Monetary amount in multiple representations. */
export interface AmountDisplay {
  /** Raw value in kobo (integer). */
  kobo: number;
  /** Value in Naira (kobo / 100). */
  naira: number;
  /** Formatted Naira string, e.g. "₦1,234,567.89". */
  formatted: string;
}

/** Percentage change with direction indicator. */
export interface PercentageChange {
  /** Numeric percentage value. */
  percentage: number;
  /** Formatted string, e.g. "+15.5%" or "-8.2%". */
  formatted: string;
  /** Direction of change. */
  direction: 'up' | 'down' | 'unchanged';
}

// ---------------------------------------------------------------------------
// API Response Types
// ---------------------------------------------------------------------------

/** Period metadata included in every API response. */
export interface PeriodInfo {
  type: PeriodType;
  /** ISO 8601 start date of the current period. */
  startDate: string;
  /** ISO 8601 end date of the current period. */
  endDate: string;
  /** Number of days the period spans. */
  daysInPeriod: number;
  /** ISO 8601 start date of the previous comparison period. */
  previousStartDate: string;
  /** ISO 8601 end date of the previous comparison period. */
  previousEndDate: string;
}

/** Summary KPIs formatted for API responses. */
export interface SummaryKPIs {
  totalRevenue: AmountDisplay;
  totalExpenses: AmountDisplay;
  netCashflow: AmountDisplay;
  transactionCount: number;
  averageTransactionValue: AmountDisplay;
}

/** Comparison KPIs formatted for API responses. */
export interface ComparisonKPIs {
  revenueChange: PercentageChange;
  expensesChange: PercentageChange;
  netCashflowChange: PercentageChange;
  transactionCountChange: {
    absolute: number;
    percentage: number;
    formatted: string;
  };
}

/** GET /api/dashboard/summary response body. */
export interface SummaryResponse {
  success: boolean;
  data: {
    period: PeriodInfo;
    current: SummaryKPIs;
    previous: SummaryKPIs;
    comparison: ComparisonKPIs;
  };
  requestId: string;
}

/** Trend data point formatted for API responses. */
export interface TrendDataPointDisplay {
  /** ISO 8601 date string. */
  date: string;
  label: string;
  inflows: AmountDisplay;
  outflows: AmountDisplay;
  netCashflow: AmountDisplay;
  transactionCount: number;
}

/** GET /api/dashboard/trends response body. */
export interface TrendResponse {
  success: boolean;
  data: {
    period: PeriodInfo;
    granularity: TrendGranularity;
    dataPoints: TrendDataPointDisplay[];
  };
  requestId: string;
}

/** Category entry formatted for API responses. */
export interface CategoryDisplay {
  category: string;
  categoryDisplay: string;
  amount: AmountDisplay;
  transactionCount: number;
  percentage: number;
  percentageFormatted: string;
}

/** GET /api/dashboard/categories response body. */
export interface CategoryResponse {
  success: boolean;
  data: {
    period: PeriodInfo;
    totalExpenses: AmountDisplay;
    categories: CategoryDisplay[];
  };
  requestId: string;
}

/** Counterparty entry formatted for API responses. */
export interface CounterpartyDisplay {
  name: string;
  amount: AmountDisplay;
  transactionCount: number;
  percentage: number;
  percentageFormatted: string;
}

/** GET /api/dashboard/top-counterparties response body. */
export interface CounterpartyResponse {
  success: boolean;
  data: {
    period: PeriodInfo;
    customers: {
      totalRevenue: AmountDisplay;
      topCounterparties: CounterpartyDisplay[];
    };
    vendors: {
      totalExpenses: AmountDisplay;
      topCounterparties: CounterpartyDisplay[];
    };
  };
  requestId: string;
}

// ---------------------------------------------------------------------------
// Error Response
// ---------------------------------------------------------------------------

/** Standard error response shape for all dashboard endpoints. */
export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
  };
  requestId: string;
}

// ---------------------------------------------------------------------------
// Raw Database Aggregation Types
// ---------------------------------------------------------------------------

/** Raw summary aggregation result from PostgreSQL. */
export interface RawSummaryAggregation {
  totalInflowKobo: bigint;
  totalOutflowKobo: bigint;
  inflowCount: number;
  outflowCount: number;
}

/** Raw trend aggregation row from PostgreSQL. */
export interface RawTrendAggregation {
  timeBucket: Date;
  totalInflowKobo: bigint;
  totalOutflowKobo: bigint;
  transactionCount: number;
}

/** Raw category aggregation row from PostgreSQL. */
export interface RawCategoryAggregation {
  category: string;
  totalAmountKobo: bigint;
  transactionCount: number;
}

/** Raw counterparty aggregation row from PostgreSQL. */
export interface RawCounterpartyAggregation {
  counterparty: string | null;
  totalAmountKobo: bigint;
  transactionCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Dashboard-specific error codes. */
export const DASHBOARD_ERROR_CODES = {
  BUSINESS_NOT_FOUND: 'DASHBOARD_BUSINESS_NOT_FOUND',
  FORBIDDEN: 'DASHBOARD_FORBIDDEN',
  INVALID_PERIOD: 'DASHBOARD_INVALID_PERIOD',
  INVALID_DATE_RANGE: 'DASHBOARD_INVALID_DATE_RANGE',
  DATE_REQUIRED: 'DASHBOARD_DATE_REQUIRED',
  LIMIT_EXCEEDED: 'DASHBOARD_LIMIT_EXCEEDED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

/** Type for individual dashboard error code values. */
export type DashboardErrorCode = (typeof DASHBOARD_ERROR_CODES)[keyof typeof DASHBOARD_ERROR_CODES];

/** Cache TTL in seconds (5 minutes). */
export const CACHE_TTL_SECONDS = 300;

/** Redis cache key patterns. */
export const CACHE_KEYS = {
  summary: 'dashboard:summary:{businessId}:{periodKey}',
  trends: 'dashboard:trends:{businessId}:{periodKey}',
  categories: 'dashboard:categories:{businessId}:{periodKey}',
  counterparties: 'dashboard:counterparties:{businessId}:{periodKey}:{type}',
} as const;
