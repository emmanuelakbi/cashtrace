/**
 * Delivery Tracker - Tracks notification delivery attempts and status.
 *
 * Records delivery attempts in the notifications table's delivery_attempts
 * JSONB column, tracks status transitions, and handles bounce events.
 *
 * @module notifications/services/deliveryTracker
 */

import type { Pool } from 'pg';

import type { DeliveryAttempt, DeliveryStatus, NotificationChannel } from '../types/index.js';

// ─── Interface ───────────────────────────────────────────────────────────────

/** Delivery tracker for recording and querying notification delivery state. */
export interface DeliveryTracker {
  recordAttempt(
    notificationId: string,
    channel: NotificationChannel,
    status: DeliveryStatus,
    errorMessage?: string,
  ): Promise<void>;
  getAttempts(notificationId: string): Promise<DeliveryAttempt[]>;
  updateStatus(notificationId: string, status: DeliveryStatus): Promise<void>;
  getStatus(notificationId: string): Promise<DeliveryStatus | null>;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a delivery tracker backed by PostgreSQL.
 *
 * Stores delivery attempts in the `delivery_attempts` JSONB column of the
 * `notifications` table. Each attempt records the channel, attempt number,
 * status, timestamp, and optional error message.
 */
export function createDeliveryTracker(pool: Pool): DeliveryTracker {
  return {
    async recordAttempt(
      notificationId: string,
      channel: NotificationChannel,
      status: DeliveryStatus,
      errorMessage?: string,
    ): Promise<void> {
      const existing = await getAttemptsFromDb(pool, notificationId);
      const channelAttempts = existing.filter((a) => a.channel === channel);
      const attemptNumber = channelAttempts.length + 1;

      const attempt: DeliveryAttempt = {
        channel,
        attemptNumber,
        status,
        timestamp: new Date(),
        errorMessage: errorMessage ?? null,
      };

      const updated = [...existing, attempt];

      await pool.query(
        `UPDATE notifications
         SET delivery_attempts = $1::jsonb,
             status = CASE
               WHEN $2 IN ('delivered', 'opened', 'clicked') THEN 'delivered'
               WHEN $2 = 'bounced' THEN 'failed'
               WHEN $2 = 'failed' THEN 'failed'
               WHEN $2 = 'sent' THEN 'sent'
               ELSE status
             END,
             sent_at = CASE
               WHEN $2 = 'sent' AND sent_at IS NULL THEN NOW()
               ELSE sent_at
             END
         WHERE id = $3`,
        [JSON.stringify(updated), status, notificationId],
      );
    },

    async getAttempts(notificationId: string): Promise<DeliveryAttempt[]> {
      return getAttemptsFromDb(pool, notificationId);
    },

    async updateStatus(notificationId: string, status: DeliveryStatus): Promise<void> {
      const notificationStatus =
        status === 'delivered' || status === 'opened' || status === 'clicked'
          ? 'delivered'
          : status === 'bounced' || status === 'failed'
            ? 'failed'
            : status === 'sent'
              ? 'sent'
              : 'pending';

      await pool.query(`UPDATE notifications SET status = $1 WHERE id = $2`, [
        notificationStatus,
        notificationId,
      ]);
    },

    async getStatus(notificationId: string): Promise<DeliveryStatus | null> {
      const result = await pool.query<{ delivery_attempts: DeliveryAttempt[] }>(
        `SELECT delivery_attempts FROM notifications WHERE id = $1`,
        [notificationId],
      );

      if (result.rows.length === 0) {
        return null;
      }

      const attempts = parseAttempts(result.rows[0].delivery_attempts);
      if (attempts.length === 0) {
        return 'pending';
      }

      // Return the most recent attempt's status
      return attempts[attempts.length - 1].status;
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getAttemptsFromDb(pool: Pool, notificationId: string): Promise<DeliveryAttempt[]> {
  const result = await pool.query<{ delivery_attempts: DeliveryAttempt[] | string }>(
    `SELECT delivery_attempts FROM notifications WHERE id = $1`,
    [notificationId],
  );

  if (result.rows.length === 0) {
    return [];
  }

  return parseAttempts(result.rows[0].delivery_attempts);
}

function parseAttempts(raw: DeliveryAttempt[] | string | null): DeliveryAttempt[] {
  if (!raw) {
    return [];
  }

  const data = typeof raw === 'string' ? (JSON.parse(raw) as DeliveryAttempt[]) : raw;

  return data.map((a) => ({
    channel: a.channel,
    attemptNumber: a.attemptNumber,
    status: a.status,
    timestamp: new Date(a.timestamp),
    errorMessage: a.errorMessage ?? null,
  }));
}
