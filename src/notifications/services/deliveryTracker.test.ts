/**
 * Unit tests for DeliveryTracker.
 *
 * Uses an in-memory mock of pg.Pool to verify delivery attempt recording,
 * status tracking, and bounce handling without a real database.
 *
 * @module notifications/services/deliveryTracker.test
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { DeliveryAttempt } from '../types/index.js';

import { createDeliveryTracker, type DeliveryTracker } from './deliveryTracker.js';

// ─── Mock Pool ───────────────────────────────────────────────────────────────

interface NotificationRow {
  id: string;
  status: string;
  sent_at: Date | null;
  delivery_attempts: DeliveryAttempt[];
}

function createMockPool(): {
  pool: { query: (text: string, params?: unknown[]) => Promise<{ rows: NotificationRow[] }> };
  getRow: (id: string) => NotificationRow | undefined;
  seedRow: (id: string) => void;
} {
  const store = new Map<string, NotificationRow>();

  const pool = {
    async query(text: string, params?: unknown[]): Promise<{ rows: NotificationRow[] }> {
      if (text.includes('delivery_attempts') && text.trim().startsWith('UPDATE')) {
        // recordAttempt: params = [jsonAttempts, status, id]
        const jsonAttempts = params?.[0] as string;
        const status = params?.[1] as string;
        const id = params?.[2] as string;
        const row = store.get(id);
        if (row) {
          row.delivery_attempts = JSON.parse(jsonAttempts) as DeliveryAttempt[];
          if (['delivered', 'opened', 'clicked'].includes(status)) {
            row.status = 'delivered';
          } else if (status === 'bounced' || status === 'failed') {
            row.status = 'failed';
          } else if (status === 'sent') {
            row.status = 'sent';
            if (!row.sent_at) {
              row.sent_at = new Date();
            }
          }
        }
        return { rows: [] };
      }

      if (text.trim().startsWith('UPDATE') && text.includes('SET status')) {
        // updateStatus: params = [notificationStatus, id]
        const notificationStatus = params?.[0] as string;
        const id = params?.[1] as string;
        const row = store.get(id);
        if (row) {
          row.status = notificationStatus;
        }
        return { rows: [] };
      }

      if (text.trim().startsWith('SELECT')) {
        const id = params?.[0] as string;
        const row = store.get(id);
        if (row) {
          return { rows: [row] };
        }
        return { rows: [] };
      }

      return { rows: [] };
    },
  };

  return {
    pool,
    getRow: (id: string): NotificationRow | undefined => store.get(id),
    seedRow: (id: string): void => {
      store.set(id, {
        id,
        status: 'pending',
        sent_at: null,
        delivery_attempts: [],
      });
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DeliveryTracker', () => {
  let tracker: DeliveryTracker;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    mockPool = createMockPool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tracker = createDeliveryTracker(mockPool.pool as any);
  });

  describe('recordAttempt', () => {
    it('should record a delivery attempt with correct attempt number', async () => {
      mockPool.seedRow('notif-1');

      await tracker.recordAttempt('notif-1', 'email', 'sent');

      const attempts = await tracker.getAttempts('notif-1');
      expect(attempts).toHaveLength(1);
      expect(attempts[0].channel).toBe('email');
      expect(attempts[0].attemptNumber).toBe(1);
      expect(attempts[0].status).toBe('sent');
      expect(attempts[0].errorMessage).toBeNull();
    });

    it('should increment attempt number for same channel', async () => {
      mockPool.seedRow('notif-2');

      await tracker.recordAttempt('notif-2', 'email', 'failed', 'Provider timeout');
      await tracker.recordAttempt('notif-2', 'email', 'sent');

      const attempts = await tracker.getAttempts('notif-2');
      expect(attempts).toHaveLength(2);
      expect(attempts[0].attemptNumber).toBe(1);
      expect(attempts[0].status).toBe('failed');
      expect(attempts[0].errorMessage).toBe('Provider timeout');
      expect(attempts[1].attemptNumber).toBe(2);
      expect(attempts[1].status).toBe('sent');
    });

    it('should track attempts independently per channel', async () => {
      mockPool.seedRow('notif-3');

      await tracker.recordAttempt('notif-3', 'email', 'sent');
      await tracker.recordAttempt('notif-3', 'push', 'sent');

      const attempts = await tracker.getAttempts('notif-3');
      expect(attempts).toHaveLength(2);
      expect(attempts[0].channel).toBe('email');
      expect(attempts[0].attemptNumber).toBe(1);
      expect(attempts[1].channel).toBe('push');
      expect(attempts[1].attemptNumber).toBe(1);
    });

    it('should update notification status to sent', async () => {
      mockPool.seedRow('notif-4');

      await tracker.recordAttempt('notif-4', 'email', 'sent');

      const row = mockPool.getRow('notif-4');
      expect(row?.status).toBe('sent');
      expect(row?.sent_at).toBeInstanceOf(Date);
    });

    it('should update notification status to delivered on delivered/opened/clicked', async () => {
      mockPool.seedRow('notif-5');

      await tracker.recordAttempt('notif-5', 'email', 'delivered');

      const row = mockPool.getRow('notif-5');
      expect(row?.status).toBe('delivered');
    });

    it('should update notification status to failed on bounce', async () => {
      mockPool.seedRow('notif-6');

      await tracker.recordAttempt('notif-6', 'email', 'bounced');

      const row = mockPool.getRow('notif-6');
      expect(row?.status).toBe('failed');
    });
  });

  describe('getAttempts', () => {
    it('should return empty array for unknown notification', async () => {
      const attempts = await tracker.getAttempts('nonexistent');
      expect(attempts).toEqual([]);
    });

    it('should return empty array for notification with no attempts', async () => {
      mockPool.seedRow('notif-empty');
      const attempts = await tracker.getAttempts('notif-empty');
      expect(attempts).toEqual([]);
    });

    it('should parse timestamps as Date objects', async () => {
      mockPool.seedRow('notif-ts');

      await tracker.recordAttempt('notif-ts', 'email', 'sent');

      const attempts = await tracker.getAttempts('notif-ts');
      expect(attempts[0].timestamp).toBeInstanceOf(Date);
    });
  });

  describe('updateStatus', () => {
    it('should update notification status for delivered', async () => {
      mockPool.seedRow('notif-upd');

      await tracker.updateStatus('notif-upd', 'delivered');

      const row = mockPool.getRow('notif-upd');
      expect(row?.status).toBe('delivered');
    });

    it('should update notification status for failed', async () => {
      mockPool.seedRow('notif-fail');

      await tracker.updateStatus('notif-fail', 'failed');

      const row = mockPool.getRow('notif-fail');
      expect(row?.status).toBe('failed');
    });
  });

  describe('getStatus', () => {
    it('should return null for unknown notification', async () => {
      const status = await tracker.getStatus('nonexistent');
      expect(status).toBeNull();
    });

    it('should return pending for notification with no attempts', async () => {
      mockPool.seedRow('notif-pending');

      const status = await tracker.getStatus('notif-pending');
      expect(status).toBe('pending');
    });

    it('should return the most recent attempt status', async () => {
      mockPool.seedRow('notif-recent');

      await tracker.recordAttempt('notif-recent', 'email', 'failed', 'Timeout');
      await tracker.recordAttempt('notif-recent', 'email', 'sent');

      const status = await tracker.getStatus('notif-recent');
      expect(status).toBe('sent');
    });
  });
});
