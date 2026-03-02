/**
 * Cache Invalidation Event Handler
 *
 * Provides a clean API for the transaction-engine module to notify the
 * analytics-dashboard of transaction changes. Each handler invalidates
 * cached aggregations for the affected business and period so that
 * subsequent dashboard requests reflect the latest data.
 *
 * ## Integration with transaction-engine
 *
 * The transaction-engine should call these functions whenever a transaction
 * is created, updated, or deleted. Example usage:
 *
 * ```typescript
 * import { onTransactionCreated } from '../analytics-dashboard/services/cacheInvalidationHandler.js';
 *
 * // After inserting a new transaction:
 * await onTransactionCreated(redis, transaction.businessId, transaction.transactionDate);
 * ```
 *
 * Each function accepts:
 * - `redis`           – an ioredis `Redis` instance used for cache operations
 * - `businessId`      – the UUID of the business that owns the transaction
 * - `transactionDate` – the date of the transaction (used to determine which
 *                        cached periods need invalidation)
 *
 * @module modules/analytics-dashboard/services/cacheInvalidationHandler
 */

import type { Redis } from 'ioredis';

import { invalidateAffectedPeriods } from './cacheService.js';

/**
 * Invalidate cached dashboard aggregations after a new transaction is created.
 *
 * Call this from the transaction-engine whenever a transaction is inserted so
 * that dashboard KPIs, trends, categories, and counterparty caches covering
 * the transaction's date are refreshed on the next request.
 *
 * @param redis           - ioredis Redis client
 * @param businessId      - UUID of the business owning the transaction
 * @param transactionDate - date of the newly created transaction
 *
 * **Validates: Requirements 9.1, 9.4**
 */
export async function onTransactionCreated(
  redis: Redis,
  businessId: string,
  transactionDate: Date,
): Promise<void> {
  await invalidateAffectedPeriods(redis, businessId, transactionDate);
}

/**
 * Invalidate cached dashboard aggregations after a transaction is updated.
 *
 * Call this from the transaction-engine whenever a transaction's amount, type,
 * category, counterparty, or date is modified. If the date changed, call this
 * function twice — once with the old date and once with the new date — to
 * ensure both affected periods are invalidated.
 *
 * @param redis           - ioredis Redis client
 * @param businessId      - UUID of the business owning the transaction
 * @param transactionDate - date of the updated transaction
 *
 * **Validates: Requirements 9.2, 9.4**
 */
export async function onTransactionUpdated(
  redis: Redis,
  businessId: string,
  transactionDate: Date,
): Promise<void> {
  await invalidateAffectedPeriods(redis, businessId, transactionDate);
}

/**
 * Invalidate cached dashboard aggregations after a transaction is deleted.
 *
 * Call this from the transaction-engine whenever a transaction is soft-deleted
 * or permanently removed so that dashboard aggregations no longer include the
 * deleted transaction's values.
 *
 * @param redis           - ioredis Redis client
 * @param businessId      - UUID of the business owning the transaction
 * @param transactionDate - date of the deleted transaction
 *
 * **Validates: Requirements 9.3, 9.4**
 */
export async function onTransactionDeleted(
  redis: Redis,
  businessId: string,
  transactionDate: Date,
): Promise<void> {
  await invalidateAffectedPeriods(redis, businessId, transactionDate);
}
