/**
 * Device Token Service
 *
 * Persistent device token management for push notifications.
 * Stores tokens with user association, supports multiple devices per user,
 * and handles token invalidation and cleanup.
 *
 * @module notifications/services/deviceTokenService
 */

import type { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

import type { DevicePlatform, DeviceToken } from '../types/index.js';

// ─── Database Row ────────────────────────────────────────────────────────────

interface DeviceTokenRow {
  id: string;
  user_id: string;
  token: string;
  platform: DevicePlatform;
  device_name: string;
  is_valid: boolean;
  created_at: Date;
  last_used_at: Date;
}

// ─── Interface ───────────────────────────────────────────────────────────────

export interface DeviceTokenService {
  /** Register or update a device token for a user. */
  registerToken(
    userId: string,
    token: string,
    platform: DevicePlatform,
    deviceName: string,
  ): Promise<DeviceToken>;
  /** Remove a specific device token by ID. */
  removeToken(tokenId: string): Promise<boolean>;
  /** Get all device tokens for a user. */
  getUserTokens(userId: string): Promise<DeviceToken[]>;
  /** Get only valid device tokens for a user. */
  getValidTokens(userId: string): Promise<DeviceToken[]>;
  /** Mark a token value as invalid. */
  invalidateToken(token: string): Promise<boolean>;
  /** Remove tokens not used within the given number of days (default 90). */
  cleanupExpiredTokens(maxAgeDays?: number): Promise<number>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_AGE_DAYS = 90;

function rowToDeviceToken(row: DeviceTokenRow): DeviceToken {
  return {
    id: row.id,
    userId: row.user_id,
    token: row.token,
    platform: row.platform,
    deviceName: row.device_name,
    isValid: row.is_valid,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a PostgreSQL-backed device token service.
 *
 * Manages device tokens in the `device_tokens` table. Supports registering
 * new tokens (upsert on duplicate token value), removing tokens, querying
 * by user, invalidating stale tokens, and cleaning up expired entries.
 */
export function createDeviceTokenService(pool: Pool): DeviceTokenService {
  async function registerToken(
    userId: string,
    token: string,
    platform: DevicePlatform,
    deviceName: string,
  ): Promise<DeviceToken> {
    const id = uuidv4();
    const now = new Date();

    const result = await pool.query<DeviceTokenRow>(
      `INSERT INTO device_tokens (id, user_id, token, platform, device_name, is_valid, created_at, last_used_at)
       VALUES ($1, $2, $3, $4, $5, true, $6, $6)
       ON CONFLICT (token) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         platform = EXCLUDED.platform,
         device_name = EXCLUDED.device_name,
         is_valid = true,
         last_used_at = EXCLUDED.last_used_at
       RETURNING id, user_id, token, platform, device_name, is_valid, created_at, last_used_at`,
      [id, userId, token, platform, deviceName, now],
    );

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return rowToDeviceToken(result.rows[0]!);
  }

  async function removeToken(tokenId: string): Promise<boolean> {
    const result = await pool.query(`DELETE FROM device_tokens WHERE id = $1`, [tokenId]);
    return (result.rowCount ?? 0) > 0;
  }

  async function getUserTokens(userId: string): Promise<DeviceToken[]> {
    const result = await pool.query<DeviceTokenRow>(
      `SELECT id, user_id, token, platform, device_name, is_valid, created_at, last_used_at
       FROM device_tokens
       WHERE user_id = $1
       ORDER BY last_used_at DESC`,
      [userId],
    );
    return result.rows.map(rowToDeviceToken);
  }

  async function getValidTokens(userId: string): Promise<DeviceToken[]> {
    const result = await pool.query<DeviceTokenRow>(
      `SELECT id, user_id, token, platform, device_name, is_valid, created_at, last_used_at
       FROM device_tokens
       WHERE user_id = $1 AND is_valid = true
       ORDER BY last_used_at DESC`,
      [userId],
    );
    return result.rows.map(rowToDeviceToken);
  }

  async function invalidateToken(token: string): Promise<boolean> {
    const result = await pool.query(
      `UPDATE device_tokens SET is_valid = false WHERE token = $1 AND is_valid = true`,
      [token],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async function cleanupExpiredTokens(maxAgeDays: number = DEFAULT_MAX_AGE_DAYS): Promise<number> {
    const result = await pool.query(
      `DELETE FROM device_tokens WHERE last_used_at < NOW() - INTERVAL '1 day' * $1`,
      [maxAgeDays],
    );
    return result.rowCount ?? 0;
  }

  return {
    registerToken,
    removeToken,
    getUserTokens,
    getValidTokens,
    invalidateToken,
    cleanupExpiredTokens,
  };
}
