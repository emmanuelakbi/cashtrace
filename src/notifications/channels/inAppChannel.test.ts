/**
 * Unit tests for the In-App Channel.
 *
 * Validates: Requirements 2.1 (store in database), 2.2 (notification types),
 * 2.3 (unread count), 2.4 (mark as read with timestamp), 2.5 (actions),
 * 2.6 (auto-expire after 30 days)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import type { InAppNotification, NotificationAction } from '../types/index.js';

import type { InAppChannel } from './inAppChannel.js';
import { createInAppChannel } from './inAppChannel.js';

// ─── Mock Pool ───────────────────────────────────────────────────────────────

interface MockPool {
  query: ReturnType<typeof vi.fn>;
}

function createMockPool(): MockPool {
  return {
    query: vi.fn(),
  };
}

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeCreateInput(
  overrides: Partial<
    Omit<InAppNotification, 'id' | 'isRead' | 'readAt' | 'createdAt' | 'expiresAt'>
  > = {},
): Omit<InAppNotification, 'id' | 'isRead' | 'readAt' | 'createdAt' | 'expiresAt'> {
  return {
    userId: uuidv4(),
    businessId: uuidv4(),
    category: 'transactions',
    type: 'info',
    title: 'Transaction Received',
    body: 'You received ₦50,000 from GTBank.',
    ...overrides,
  };
}

function makeDbRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    id: uuidv4(),
    user_id: uuidv4(),
    business_id: uuidv4(),
    category: 'transactions',
    type: 'info',
    title: 'Transaction Received',
    body: 'You received ₦50,000.',
    actions: null,
    is_read: false,
    read_at: null,
    created_at: now,
    expires_at: expiresAt,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('InAppChannel', () => {
  let channel: InAppChannel;
  let mockPool: MockPool;

  beforeEach(() => {
    mockPool = createMockPool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    channel = createInAppChannel(mockPool as any);
  });

  describe('create', () => {
    it('should store a notification in the database and return it', async () => {
      const input = makeCreateInput();
      const row = makeDbRow({
        user_id: input.userId,
        business_id: input.businessId,
        category: input.category,
        type: input.type,
        title: input.title,
        body: input.body,
      });

      mockPool.query.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      const result = await channel.create(input);

      expect(result.userId).toBe(input.userId);
      expect(result.businessId).toBe(input.businessId);
      expect(result.category).toBe('transactions');
      expect(result.type).toBe('info');
      expect(result.title).toBe(input.title);
      expect(result.body).toBe(input.body);
      expect(result.isRead).toBe(false);
      expect(result.readAt).toBeNull();
      expect(result.id).toBeTruthy();
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('should set expiration to 30 days from creation', async () => {
      const input = makeCreateInput();
      const now = new Date();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const expiresAt = new Date(now.getTime() + thirtyDaysMs);
      const row = makeDbRow({
        user_id: input.userId,
        created_at: now,
        expires_at: expiresAt,
      });

      mockPool.query.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      const result = await channel.create(input);

      const diffMs = result.expiresAt.getTime() - result.createdAt.getTime();
      const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
      expect(diffDays).toBe(30);
    });

    it('should pass channel as in_app in the INSERT query', async () => {
      const input = makeCreateInput();
      const row = makeDbRow({ user_id: input.userId });
      mockPool.query.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      await channel.create(input);

      const queryStr = mockPool.query.mock.calls[0]![0] as string;
      expect(queryStr).toContain("'in_app'");
    });

    it('should support all notification types', async () => {
      const types = ['info', 'success', 'warning', 'error', 'action_required'] as const;

      for (const type of types) {
        const input = makeCreateInput({ type });
        const row = makeDbRow({ type, user_id: input.userId });
        mockPool.query.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

        const result = await channel.create(input);
        expect(result.type).toBe(type);
      }
    });

    it('should store notification actions as JSON', async () => {
      const actions: NotificationAction[] = [
        { label: 'View Transaction', type: 'navigate', target: '/transactions/123' },
        { label: 'Approve', type: 'api_call', target: '/api/transactions/123/approve' },
      ];
      const input = makeCreateInput({ actions });
      const row = makeDbRow({ user_id: input.userId, actions });
      mockPool.query.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      const result = await channel.create(input);

      expect(result.actions).toEqual(actions);
      // Verify JSON.stringify was passed to the query
      const queryParams = mockPool.query.mock.calls[0]![1] as unknown[];
      expect(queryParams[7]).toBe(JSON.stringify(actions));
    });

    it('should store null actions when none provided', async () => {
      const input = makeCreateInput();
      const row = makeDbRow({ user_id: input.userId, actions: null });
      mockPool.query.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      const result = await channel.create(input);

      expect(result.actions).toBeUndefined();
      const queryParams = mockPool.query.mock.calls[0]![1] as unknown[];
      expect(queryParams[7]).toBeNull();
    });
  });

  describe('getForUser', () => {
    it('should return notifications for a user', async () => {
      const userId = uuidv4();
      const rows = [
        makeDbRow({ user_id: userId, title: 'First' }),
        makeDbRow({ user_id: userId, title: 'Second' }),
      ];
      mockPool.query.mockResolvedValueOnce({ rows, rowCount: 2 });

      const results = await channel.getForUser(userId);

      expect(results).toHaveLength(2);
      expect(results[0]!.title).toBe('First');
      expect(results[1]!.title).toBe('Second');
    });

    it('should filter unread-only when option is set', async () => {
      const userId = uuidv4();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await channel.getForUser(userId, { unreadOnly: true });

      const queryStr = mockPool.query.mock.calls[0]![0] as string;
      expect(queryStr).toContain('is_read = false');
    });

    it('should apply default limit and offset', async () => {
      const userId = uuidv4();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await channel.getForUser(userId);

      const params = mockPool.query.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe(50); // default limit
      expect(params[2]).toBe(0); // default offset
    });

    it('should apply custom limit and offset for pagination', async () => {
      const userId = uuidv4();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await channel.getForUser(userId, { limit: 10, offset: 20 });

      const params = mockPool.query.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe(10);
      expect(params[2]).toBe(20);
    });

    it('should exclude expired notifications', async () => {
      const userId = uuidv4();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await channel.getForUser(userId);

      const queryStr = mockPool.query.mock.calls[0]![0] as string;
      expect(queryStr).toContain('expires_at > NOW()');
    });

    it('should order by created_at descending', async () => {
      const userId = uuidv4();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await channel.getForUser(userId);

      const queryStr = mockPool.query.mock.calls[0]![0] as string;
      expect(queryStr).toContain('ORDER BY created_at DESC');
    });
  });

  describe('markAsRead', () => {
    it('should update the notification to read with timestamp', async () => {
      const notifId = uuidv4();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await channel.markAsRead(notifId);

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const queryStr = mockPool.query.mock.calls[0]![0] as string;
      expect(queryStr).toContain('is_read = true');
      expect(queryStr).toContain('read_at = NOW()');
      const params = mockPool.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe(notifId);
    });

    it('should only update unread in_app notifications', async () => {
      const notifId = uuidv4();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await channel.markAsRead(notifId);

      const queryStr = mockPool.query.mock.calls[0]![0] as string;
      expect(queryStr).toContain("channel = 'in_app'");
      expect(queryStr).toContain('is_read = false');
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all unread notifications for a user as read', async () => {
      const userId = uuidv4();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 5 });

      await channel.markAllAsRead(userId);

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const queryStr = mockPool.query.mock.calls[0]![0] as string;
      expect(queryStr).toContain('is_read = true');
      expect(queryStr).toContain('read_at = NOW()');
      expect(queryStr).toContain("channel = 'in_app'");
      expect(queryStr).toContain('is_read = false');
      const params = mockPool.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe(userId);
    });
  });

  describe('getUnreadCount', () => {
    it('should return the count of unread notifications', async () => {
      const userId = uuidv4();
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '7' }], rowCount: 1 });

      const count = await channel.getUnreadCount(userId);

      expect(count).toBe(7);
    });

    it('should return 0 when no unread notifications exist', async () => {
      const userId = uuidv4();
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 });

      const count = await channel.getUnreadCount(userId);

      expect(count).toBe(0);
    });

    it('should exclude expired notifications from count', async () => {
      const userId = uuidv4();
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '3' }], rowCount: 1 });

      await channel.getUnreadCount(userId);

      const queryStr = mockPool.query.mock.calls[0]![0] as string;
      expect(queryStr).toContain('is_read = false');
      expect(queryStr).toContain('expires_at > NOW()');
    });
  });

  describe('expireOld', () => {
    it('should mark expired notifications as read and return count', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 12 });

      const count = await channel.expireOld();

      expect(count).toBe(12);
      const queryStr = mockPool.query.mock.calls[0]![0] as string;
      expect(queryStr).toContain('is_read = true');
      expect(queryStr).toContain('expires_at <= NOW()');
    });

    it('should return 0 when no notifications are expired', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const count = await channel.expireOld();

      expect(count).toBe(0);
    });

    it('should only expire in_app channel notifications', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await channel.expireOld();

      const queryStr = mockPool.query.mock.calls[0]![0] as string;
      expect(queryStr).toContain("channel = 'in_app'");
    });
  });
});
