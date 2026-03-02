/**
 * Aggregation repository for dashboard analytics.
 * Provides efficient SQL-based aggregation queries for transaction data.
 *
 * All queries exclude personal transactions (is_personal = true) and
 * soft-deleted transactions (deleted_at IS NOT NULL).
 *
 * @module modules/analytics-dashboard/repositories/aggregationRepository
 */
import type { Pool } from 'pg';

import type {
  RawCategoryAggregation,
  RawCounterpartyAggregation,
  RawSummaryAggregation,
  RawTrendAggregation,
  TrendGranularity,
} from '../types/index.js';

/** Maps TrendGranularity enum values to PostgreSQL DATE_TRUNC intervals. */
const GRANULARITY_TO_INTERVAL: Record<TrendGranularity, string> = {
  DAILY: 'day',
  WEEKLY: 'week',
  MONTHLY: 'month',
};

/**
 * Retrieves summary aggregations (total inflows, outflows, counts) for a
 * business within a date range.
 *
 * Excludes personal and soft-deleted transactions.
 *
 * @param pool - PostgreSQL connection pool
 * @param businessId - The business to aggregate for
 * @param startDate - Inclusive start of the period
 * @param endDate - Exclusive end of the period
 * @returns Raw summary aggregation with bigint totals
 *
 * Requirements: 1.1, 1.2, 1.4, 1.6, 1.7
 */
export async function getSummaryAggregations(
  pool: Pool,
  businessId: string,
  startDate: Date,
  endDate: Date,
): Promise<RawSummaryAggregation> {
  const query = `
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type = 'INFLOW' THEN amount_kobo ELSE 0 END), 0) AS total_inflow_kobo,
      COALESCE(SUM(CASE WHEN transaction_type = 'OUTFLOW' THEN amount_kobo ELSE 0 END), 0) AS total_outflow_kobo,
      COUNT(CASE WHEN transaction_type = 'INFLOW' THEN 1 END) AS inflow_count,
      COUNT(CASE WHEN transaction_type = 'OUTFLOW' THEN 1 END) AS outflow_count
    FROM transactions
    WHERE business_id = $1
      AND transaction_date >= $2
      AND transaction_date < $3
      AND is_personal = false
      AND deleted_at IS NULL
  `;

  const result = await pool.query(query, [businessId, startDate, endDate]);
  const row = result.rows[0];

  return {
    totalInflowKobo: BigInt(row.total_inflow_kobo),
    totalOutflowKobo: BigInt(row.total_outflow_kobo),
    inflowCount: Number(row.inflow_count),
    outflowCount: Number(row.outflow_count),
  };
}

/**
 * Retrieves trend aggregations grouped by time buckets for a business
 * within a date range.
 *
 * Uses DATE_TRUNC with 'Africa/Lagos' timezone for WAT-aware bucketing.
 * Excludes personal and soft-deleted transactions.
 *
 * @param pool - PostgreSQL connection pool
 * @param businessId - The business to aggregate for
 * @param startDate - Inclusive start of the period
 * @param endDate - Exclusive end of the period
 * @param granularity - Time bucket granularity (DAILY, WEEKLY, MONTHLY)
 * @returns Array of trend aggregation rows ordered chronologically
 *
 * Requirements: 6.1, 6.5
 */
export async function getTrendAggregations(
  pool: Pool,
  businessId: string,
  startDate: Date,
  endDate: Date,
  granularity: TrendGranularity,
): Promise<RawTrendAggregation[]> {
  const interval = GRANULARITY_TO_INTERVAL[granularity];

  const query = `
    SELECT
      DATE_TRUNC($1, transaction_date AT TIME ZONE 'Africa/Lagos') AS time_bucket,
      COALESCE(SUM(CASE WHEN transaction_type = 'INFLOW' THEN amount_kobo ELSE 0 END), 0) AS total_inflow_kobo,
      COALESCE(SUM(CASE WHEN transaction_type = 'OUTFLOW' THEN amount_kobo ELSE 0 END), 0) AS total_outflow_kobo,
      COUNT(*) AS transaction_count
    FROM transactions
    WHERE business_id = $2
      AND transaction_date >= $3
      AND transaction_date < $4
      AND is_personal = false
      AND deleted_at IS NULL
    GROUP BY time_bucket
    ORDER BY time_bucket
  `;

  const result = await pool.query(query, [interval, businessId, startDate, endDate]);

  return result.rows.map((row) => ({
    timeBucket: new Date(row.time_bucket),
    totalInflowKobo: BigInt(row.total_inflow_kobo),
    totalOutflowKobo: BigInt(row.total_outflow_kobo),
    transactionCount: Number(row.transaction_count),
  }));
}

/**
 * Retrieves category aggregations for a business within a date range,
 * filtered by transaction type.
 *
 * Groups by category, orders by total amount descending, and limits results.
 * Excludes personal and soft-deleted transactions.
 *
 * @param pool - PostgreSQL connection pool
 * @param businessId - The business to aggregate for
 * @param startDate - Inclusive start of the period
 * @param endDate - Exclusive end of the period
 * @param transactionType - Filter by 'INFLOW' or 'OUTFLOW'
 * @param limit - Maximum number of categories to return
 * @returns Array of category aggregation rows sorted by amount descending
 *
 * Requirements: 4.1, 4.2, 4.3
 */
export async function getCategoryAggregations(
  pool: Pool,
  businessId: string,
  startDate: Date,
  endDate: Date,
  transactionType: 'INFLOW' | 'OUTFLOW',
  limit: number,
): Promise<RawCategoryAggregation[]> {
  const query = `
    SELECT
      category,
      SUM(amount_kobo) AS total_amount_kobo,
      COUNT(*) AS transaction_count
    FROM transactions
    WHERE business_id = $1
      AND transaction_date >= $2
      AND transaction_date < $3
      AND transaction_type = $4
      AND is_personal = false
      AND deleted_at IS NULL
    GROUP BY category
    ORDER BY total_amount_kobo DESC
    LIMIT $5
  `;

  const result = await pool.query(query, [businessId, startDate, endDate, transactionType, limit]);

  return result.rows.map((row) => ({
    category: String(row.category),
    totalAmountKobo: BigInt(row.total_amount_kobo),
    transactionCount: Number(row.transaction_count),
  }));
}

/**
 * Retrieves counterparty aggregations for a business within a date range,
 * filtered by transaction type.
 *
 * Uses COALESCE to group null counterparties as 'Unknown'.
 * Orders by total amount descending and limits results.
 * Excludes personal and soft-deleted transactions.
 *
 * @param pool - PostgreSQL connection pool
 * @param businessId - The business to aggregate for
 * @param startDate - Inclusive start of the period
 * @param endDate - Exclusive end of the period
 * @param transactionType - Filter by 'INFLOW' or 'OUTFLOW'
 * @param limit - Maximum number of counterparties to return
 * @returns Array of counterparty aggregation rows sorted by amount descending
 *
 * Requirements: 5.1, 5.2, 5.3, 5.5, 5.6
 */
export async function getCounterpartyAggregations(
  pool: Pool,
  businessId: string,
  startDate: Date,
  endDate: Date,
  transactionType: 'INFLOW' | 'OUTFLOW',
  limit: number,
): Promise<RawCounterpartyAggregation[]> {
  const query = `
    SELECT
      COALESCE(counterparty, 'Unknown') AS counterparty,
      SUM(amount_kobo) AS total_amount_kobo,
      COUNT(*) AS transaction_count
    FROM transactions
    WHERE business_id = $1
      AND transaction_date >= $2
      AND transaction_date < $3
      AND transaction_type = $4
      AND is_personal = false
      AND deleted_at IS NULL
    GROUP BY COALESCE(counterparty, 'Unknown')
    ORDER BY total_amount_kobo DESC
    LIMIT $5
  `;

  const result = await pool.query(query, [businessId, startDate, endDate, transactionType, limit]);

  return result.rows.map((row) => ({
    counterparty: String(row.counterparty),
    totalAmountKobo: BigInt(row.total_amount_kobo),
    transactionCount: Number(row.transaction_count),
  }));
}

/**
 * Pure filtering predicate that mirrors the SQL WHERE clause logic for
 * transaction exclusion. Used for property-based testing to verify that
 * personal and soft-deleted transactions are correctly excluded.
 *
 * @param transaction - Transaction-like object with filtering flags
 * @returns true if the transaction should be INCLUDED in aggregations
 *
 * Requirements: 1.6, 1.7, 4.4, 5.4
 */
export function shouldIncludeTransaction(transaction: {
  isPersonal: boolean;
  deletedAt: Date | null;
}): boolean {
  return !transaction.isPersonal && transaction.deletedAt === null;
}
