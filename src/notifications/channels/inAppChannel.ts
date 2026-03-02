/**
 * In-App Channel - Stores and manages in-app notifications.
 *
 * Uses PostgreSQL for persistence. Supports notification types, actions,
 * read tracking, pagination, and auto-expiration (30 days default).
 *
 * @module notifications/channels/inAppChannel
 */

import type { Pool, QueryResult } from 'pg';
import { v4 as uuidv4 } from 'uuid';

import type {
  InAppGetOptions,
  InAppNotification,
  InAppNotificationType,
  NotificationAction,
  NotificationCategory,
} from '../types/index.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_EXPIRATION_DAYS = 30;
const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;

// ─── In-App Channel Interface ────────────────────────────────────────────────

/** In-app notification channel for database-backed notifications. */
export interface InAppChannel {
  create(
    notification: Omit<InAppNotification, 'id' | 'isRead' | 'readAt' | 'createdAt' | 'expiresAt'>,
  ): Promise<InAppNotification>;
  getForUser(userId: string, options?: InAppGetOptions): Promise<InAppNotification[]>;
  markAsRead(notificationId: string): Promise<void>;
  markAllAsRead(userId: string): Promise<void>;
  getUnreadCount(userId: string): Promise<number>;
  expireOld(): Promise<number>;
}

// ─── Row Mapping ─────────────────────────────────────────────────────────────

interface NotificationRow {
  id: string;
  user_id: string;
  business_id: string;
  category: NotificationCategory;
  type: InAppNotificationType;
  title: string;
  body: string;
  actions: NotificationAction[] | null;
  is_read: boolean;
  read_at: Date | null;
  created_at: Date;
  expires_at: Date;
}

function rowToInAppNotification(row: NotificationRow): InAppNotification {
  return {
    id: row.id,
    userId: row.user_id,
    businessId: row.business_id,
    category: row.category,
    type: row.type,
    title: row.title,
    body: row.body,
    actions: row.actions ?? undefined,
    isRead: row.is_read,
    readAt: row.read_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

// ─── In-App Channel Factory ──────────────────────────────────────────────────

/**
 * Create an in-app notification channel backed by PostgreSQL.
 *
 * Stores notifications in the database with channel='in_app'.
 * Supports read tracking, pagination, and auto-expiration.
 */
export function createInAppChannel(pool: Pool): InAppChannel {
  return {
    async create(
      notification: Omit<InAppNotification, 'id' | 'isRead' | 'readAt' | 'createdAt' | 'expiresAt'>,
    ): Promise<InAppNotification> {
      const id = uuidv4();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + DEFAULT_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

      const result: QueryResult<NotificationRow> = await pool.query(
        `INSERT INTO notifications (
          id, user_id, business_id, category, type, title, body,
          actions, channel, is_read, read_at, created_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'in_app', false, NULL, $9, $10)
        RETURNING
          id, user_id, business_id, category, type, title, body,
          actions, is_read, read_at, created_at, expires_at`,
        [
          id,
          notification.userId,
          notification.businessId,
          notification.category,
          notification.type,
          notification.title,
          notification.body,
          notification.actions ? JSON.stringify(notification.actions) : null,
          now,
          expiresAt,
        ],
      );

      return rowToInAppNotification(result.rows[0]!);
    },

    async getForUser(userId: string, options?: InAppGetOptions): Promise<InAppNotification[]> {
      const limit = options?.limit ?? DEFAULT_LIMIT;
      const offset = options?.offset ?? DEFAULT_OFFSET;
      const unreadOnly = options?.unreadOnly ?? false;

      let query = `
        SELECT id, user_id, business_id, category, type, title, body,
               actions, is_read, read_at, created_at, expires_at
        FROM notifications
        WHERE user_id = $1
          AND channel = 'in_app'
          AND (expires_at > NOW() OR expires_at IS NULL)`;

      const params: (string | number | boolean)[] = [userId];

      if (unreadOnly) {
        query += ' AND is_read = false';
      }

      query += ' ORDER BY created_at DESC LIMIT $2 OFFSET $3';
      params.push(limit, offset);

      const result: QueryResult<NotificationRow> = await pool.query(query, params);
      return result.rows.map(rowToInAppNotification);
    },

    async markAsRead(notificationId: string): Promise<void> {
      await pool.query(
        `UPDATE notifications
         SET is_read = true, read_at = NOW()
         WHERE id = $1 AND channel = 'in_app' AND is_read = false`,
        [notificationId],
      );
    },

    async markAllAsRead(userId: string): Promise<void> {
      await pool.query(
        `UPDATE notifications
         SET is_read = true, read_at = NOW()
         WHERE user_id = $1 AND channel = 'in_app' AND is_read = false`,
        [userId],
      );
    },

    async getUnreadCount(userId: string): Promise<number> {
      const result: QueryResult<{ count: string }> = await pool.query(
        `SELECT COUNT(*)::text AS count
         FROM notifications
         WHERE user_id = $1
           AND channel = 'in_app'
           AND is_read = false
           AND (expires_at > NOW() OR expires_at IS NULL)`,
        [userId],
      );
      return parseInt(result.rows[0]!.count, 10);
    },

    async expireOld(): Promise<number> {
      const result = await pool.query(
        `UPDATE notifications
         SET is_read = true, read_at = NOW()
         WHERE channel = 'in_app'
           AND is_read = false
           AND expires_at <= NOW()`,
      );
      return result.rowCount ?? 0;
    },
  };
}
