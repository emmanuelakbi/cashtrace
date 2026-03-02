/**
 * Business repository for database operations on the businesses table.
 *
 * Provides CRUD operations for business records with soft delete support
 * and snake_case ↔ camelCase mapping between PostgreSQL and TypeScript.
 *
 * @module modules/business/repositories/businessRepository
 */

import { query } from '../../../utils/db.js';
import { Business, BusinessSector, CreateBusinessRequest, Currency } from '../types/index.js';

// ─── Row Mapping ─────────────────────────────────────────────────────────────

/** Raw row shape returned by PostgreSQL for the businesses table. */
export interface BusinessRow {
  id: string;
  user_id: string;
  name: string;
  sector: string;
  currency: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  hard_delete_at: Date | null;
}

/**
 * Map a database row (snake_case) to a Business domain object (camelCase).
 */
export function mapRowToBusiness(row: BusinessRow): Business {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    sector: row.sector as BusinessSector,
    currency: row.currency as Currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    hardDeleteAt: row.hard_delete_at,
  };
}

/** All columns to select from the businesses table. */
const ALL_COLUMNS = `id, user_id, name, sector, currency, created_at, updated_at, deleted_at, hard_delete_at`;

// ─── Repository Functions ────────────────────────────────────────────────────

/**
 * Create a new business profile for a user.
 *
 * Defaults sector to OTHER and currency to NGN if not provided.
 *
 * @param userId - The UUID of the owning user
 * @param data - Business creation data (name, optional sector)
 * @returns The newly created Business record
 */
export async function create(userId: string, data: CreateBusinessRequest): Promise<Business> {
  const sector = data.sector ?? BusinessSector.OTHER;
  const currency = Currency.NGN;

  const result = await query<BusinessRow>(
    `INSERT INTO businesses (user_id, name, sector, currency)
     VALUES ($1, $2, $3, $4)
     RETURNING ${ALL_COLUMNS}`,
    [userId, data.name, sector, currency],
  );

  return mapRowToBusiness(result.rows[0]!);
}

/**
 * Find a business by user ID, excluding soft-deleted records.
 *
 * @param userId - The UUID of the owning user
 * @returns The matching Business or null if not found / soft-deleted
 */
export async function findByUserId(userId: string): Promise<Business | null> {
  const result = await query<BusinessRow>(
    `SELECT ${ALL_COLUMNS}
     FROM businesses
     WHERE user_id = $1 AND deleted_at IS NULL`,
    [userId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToBusiness(result.rows[0]!);
}

/**
 * Find a business by user ID, including soft-deleted records.
 * Used for recovery scenarios where we need to find deleted businesses.
 *
 * @param userId - The UUID of the owning user
 * @returns The matching Business or null if not found
 */
export async function findByUserIdIncludeDeleted(userId: string): Promise<Business | null> {
  const result = await query<BusinessRow>(
    `SELECT ${ALL_COLUMNS}
     FROM businesses
     WHERE user_id = $1`,
    [userId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToBusiness(result.rows[0]!);
}

/**
 * Find a business by its ID, excluding soft-deleted records.
 *
 * @param id - The UUID of the business
 * @returns The matching Business or null if not found / soft-deleted
 */
export async function findById(id: string): Promise<Business | null> {
  const result = await query<BusinessRow>(
    `SELECT ${ALL_COLUMNS}
     FROM businesses
     WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToBusiness(result.rows[0]!);
}

/**
 * Update a business profile with the given fields.
 *
 * Dynamically builds the SET clause based on provided fields.
 * Always updates the updated_at timestamp.
 *
 * @param id - The UUID of the business to update
 * @param data - Fields to update (name and/or sector)
 * @returns The updated Business record
 * @throws Error if no rows are updated (business not found)
 */
export async function update(
  id: string,
  data: { name?: string; sector?: BusinessSector },
): Promise<Business> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    setClauses.push(`name = $${paramIndex}`);
    params.push(data.name);
    paramIndex++;
  }

  if (data.sector !== undefined) {
    setClauses.push(`sector = $${paramIndex}`);
    params.push(data.sector);
    paramIndex++;
  }

  setClauses.push('updated_at = NOW()');

  params.push(id);

  const result = await query<BusinessRow>(
    `UPDATE businesses
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND deleted_at IS NULL
     RETURNING ${ALL_COLUMNS}`,
    params,
  );

  if (result.rows.length === 0) {
    throw new Error(`Business not found: ${id}`);
  }

  return mapRowToBusiness(result.rows[0]!);
}

/**
 * Soft delete a business by setting deletedAt and scheduling hard delete in 30 days.
 *
 * Only affects non-deleted businesses (deleted_at IS NULL).
 *
 * @param id - The UUID of the business to soft delete
 * @throws Error if no rows are updated (business not found or already deleted)
 */
export async function softDelete(id: string): Promise<void> {
  const result = await query<BusinessRow>(
    `UPDATE businesses
     SET deleted_at = NOW(), hard_delete_at = NOW() + INTERVAL '30 days', updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );

  if (result.rowCount === 0) {
    throw new Error(`Business not found or already deleted: ${id}`);
  }
}

/**
 * Restore a soft-deleted business by clearing deletedAt and hardDeleteAt.
 *
 * Only affects businesses that are currently soft-deleted (deleted_at IS NOT NULL).
 *
 * @param id - The UUID of the business to restore
 * @returns The restored Business record
 * @throws Error if no rows are updated (business not found or not deleted)
 */
export async function restore(id: string): Promise<Business> {
  const result = await query<BusinessRow>(
    `UPDATE businesses
     SET deleted_at = NULL, hard_delete_at = NULL, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NOT NULL
     RETURNING ${ALL_COLUMNS}`,
    [id],
  );

  if (result.rows.length === 0) {
    throw new Error(`Business not found or not deleted: ${id}`);
  }

  return mapRowToBusiness(result.rows[0]!);
}

/**
 * Permanently delete a business record from the database.
 *
 * This is an irreversible operation. Use softDelete for recoverable deletion.
 *
 * @param id - The UUID of the business to permanently delete
 */
export async function hardDelete(id: string): Promise<void> {
  await query(`DELETE FROM businesses WHERE id = $1`, [id]);
}

/**
 * Find all businesses whose hard delete date has passed and are ready for permanent removal.
 *
 * Used by the hard delete batch job to identify records that should be purged.
 *
 * @returns Array of businesses pending hard deletion
 */
export async function findPendingHardDelete(): Promise<Business[]> {
  const result = await query<BusinessRow>(
    `SELECT ${ALL_COLUMNS}
     FROM businesses
     WHERE hard_delete_at IS NOT NULL AND hard_delete_at <= NOW()`,
  );

  return result.rows.map(mapRowToBusiness);
}
