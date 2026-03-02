import { describe, it, expect, beforeEach } from 'vitest';

import type { DeliveryAttempt } from '../types/index.js';

import type { CreateNotificationInput, NotificationRepository } from './notificationRepository.js';
import { createNotificationRepository } from './notificationRepository.js';

function makeInput(overrides?: Partial<CreateNotificationInput>): CreateNotificationInput {
  return {
    userId: 'user-1',
    businessId: 'biz-1',
    category: 'transactions',
    templateId: 'tpl-1',
    templateVersion: '1.0',
    channels: ['email'],
    priority: 'normal',
    ...overrides,
  };
}

describe('NotificationRepository', () => {
  let repo: NotificationRepository;

  beforeEach(() => {
    repo = createNotificationRepository();
  });

  describe('createNotification', () => {
    it('should create a notification with generated id and defaults', () => {
      const notification = repo.createNotification(makeInput());

      expect(notification.id).toBeDefined();
      expect(notification.userId).toBe('user-1');
      expect(notification.businessId).toBe('biz-1');
      expect(notification.category).toBe('transactions');
      expect(notification.status).toBe('pending');
      expect(notification.deliveryAttempts).toEqual([]);
      expect(notification.sentAt).toBeNull();
      expect(notification.readAt).toBeNull();
      expect(notification.scheduledAt).toBeNull();
      expect(notification.expiresAt).toBeInstanceOf(Date);
      expect(notification.createdAt).toBeInstanceOf(Date);
    });

    it('should respect provided status and scheduledAt', () => {
      const scheduledAt = new Date('2025-01-15T10:00:00Z');
      const notification = repo.createNotification(makeInput({ status: 'queued', scheduledAt }));

      expect(notification.status).toBe('queued');
      expect(notification.scheduledAt).toEqual(scheduledAt);
    });

    it('should default expiresAt to 30 days from now', () => {
      const before = Date.now();
      const notification = repo.createNotification(makeInput());
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

      expect(notification.expiresAt.getTime()).toBeGreaterThanOrEqual(before + thirtyDaysMs - 100);
      expect(notification.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + thirtyDaysMs + 100);
    });
  });

  describe('getNotificationById', () => {
    it('should return a notification by id', () => {
      const created = repo.createNotification(makeInput());
      const found = repo.getNotificationById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
    });

    it('should return undefined for non-existent id', () => {
      expect(repo.getNotificationById('non-existent')).toBeUndefined();
    });
  });

  describe('getNotificationsByUserId', () => {
    it('should return notifications for a user', () => {
      repo.createNotification(makeInput({ userId: 'user-1' }));
      repo.createNotification(makeInput({ userId: 'user-1' }));
      repo.createNotification(makeInput({ userId: 'user-2' }));

      const results = repo.getNotificationsByUserId('user-1');
      expect(results).toHaveLength(2);
      expect(results.every((n) => n.userId === 'user-1')).toBe(true);
    });

    it('should filter by status', () => {
      repo.createNotification(makeInput({ status: 'pending' }));
      repo.createNotification(makeInput({ status: 'sent' }));

      const results = repo.getNotificationsByUserId('user-1', { status: 'sent' });
      expect(results).toHaveLength(1);
      expect(results[0]?.status).toBe('sent');
    });

    it('should filter by channel', () => {
      repo.createNotification(makeInput({ channels: ['email'] }));
      repo.createNotification(makeInput({ channels: ['push'] }));
      repo.createNotification(makeInput({ channels: ['email', 'push'] }));

      const results = repo.getNotificationsByUserId('user-1', { channel: 'push' });
      expect(results).toHaveLength(2);
    });

    it('should filter by category', () => {
      repo.createNotification(makeInput({ category: 'security' }));
      repo.createNotification(makeInput({ category: 'transactions' }));

      const results = repo.getNotificationsByUserId('user-1', { category: 'security' });
      expect(results).toHaveLength(1);
      expect(results[0]?.category).toBe('security');
    });

    it('should support limit and offset', () => {
      for (let i = 0; i < 5; i++) {
        repo.createNotification(makeInput());
      }

      const page = repo.getNotificationsByUserId('user-1', { limit: 2, offset: 1 });
      expect(page).toHaveLength(2);
    });

    it('should return results sorted by createdAt descending', () => {
      const n1 = repo.createNotification(makeInput());
      const n2 = repo.createNotification(makeInput());
      const n3 = repo.createNotification(makeInput());

      // Manually set distinct timestamps to ensure deterministic ordering
      n1.createdAt = new Date('2025-01-01T00:00:00Z');
      n2.createdAt = new Date('2025-01-02T00:00:00Z');
      n3.createdAt = new Date('2025-01-03T00:00:00Z');

      const results = repo.getNotificationsByUserId('user-1');
      expect(results.map((n) => n.id)).toEqual([n3.id, n2.id, n1.id]);
    });

    it('should return empty array for unknown user', () => {
      expect(repo.getNotificationsByUserId('unknown')).toEqual([]);
    });
  });

  describe('updateNotificationStatus', () => {
    it('should update the status of a notification', () => {
      const created = repo.createNotification(makeInput());
      const updated = repo.updateNotificationStatus(created.id, 'delivered');

      expect(updated?.status).toBe('delivered');
    });

    it('should set sentAt when status is sent', () => {
      const created = repo.createNotification(makeInput());
      const updated = repo.updateNotificationStatus(created.id, 'sent');

      expect(updated?.sentAt).toBeInstanceOf(Date);
    });

    it('should return undefined for non-existent id', () => {
      expect(repo.updateNotificationStatus('non-existent', 'sent')).toBeUndefined();
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read with timestamp', () => {
      const created = repo.createNotification(makeInput());
      const read = repo.markAsRead(created.id);

      expect(read?.status).toBe('read');
      expect(read?.readAt).toBeInstanceOf(Date);
    });

    it('should return undefined for non-existent id', () => {
      expect(repo.markAsRead('non-existent')).toBeUndefined();
    });
  });

  describe('addDeliveryAttempt', () => {
    it('should add a delivery attempt to a notification', () => {
      const created = repo.createNotification(makeInput());
      const attempt: DeliveryAttempt = {
        channel: 'email',
        attemptNumber: 1,
        status: 'sent',
        timestamp: new Date(),
        errorMessage: null,
      };

      const updated = repo.addDeliveryAttempt(created.id, attempt);

      expect(updated?.deliveryAttempts).toHaveLength(1);
      expect(updated?.deliveryAttempts[0]).toEqual(attempt);
    });

    it('should append multiple attempts', () => {
      const created = repo.createNotification(makeInput());
      const attempt1: DeliveryAttempt = {
        channel: 'email',
        attemptNumber: 1,
        status: 'failed',
        timestamp: new Date(),
        errorMessage: 'timeout',
      };
      const attempt2: DeliveryAttempt = {
        channel: 'email',
        attemptNumber: 2,
        status: 'sent',
        timestamp: new Date(),
        errorMessage: null,
      };

      repo.addDeliveryAttempt(created.id, attempt1);
      const updated = repo.addDeliveryAttempt(created.id, attempt2);

      expect(updated?.deliveryAttempts).toHaveLength(2);
    });

    it('should return undefined for non-existent id', () => {
      const attempt: DeliveryAttempt = {
        channel: 'email',
        attemptNumber: 1,
        status: 'sent',
        timestamp: new Date(),
        errorMessage: null,
      };
      expect(repo.addDeliveryAttempt('non-existent', attempt)).toBeUndefined();
    });
  });

  describe('getExpiredNotifications', () => {
    it('should return notifications past their expiry date', () => {
      const pastExpiry = new Date('2024-01-01T00:00:00Z');
      repo.createNotification(makeInput({ expiresAt: pastExpiry }));
      repo.createNotification(makeInput()); // default 30 days from now

      const expired = repo.getExpiredNotifications(new Date());
      expect(expired).toHaveLength(1);
    });

    it('should exclude already-expired-status notifications', () => {
      const pastExpiry = new Date('2024-01-01T00:00:00Z');
      const n = repo.createNotification(makeInput({ expiresAt: pastExpiry }));
      repo.updateNotificationStatus(n.id, 'expired');

      const expired = repo.getExpiredNotifications(new Date());
      expect(expired).toHaveLength(0);
    });
  });

  describe('deleteNotification', () => {
    it('should delete a notification and return true', () => {
      const created = repo.createNotification(makeInput());
      expect(repo.deleteNotification(created.id)).toBe(true);
      expect(repo.getNotificationById(created.id)).toBeUndefined();
    });

    it('should return false for non-existent id', () => {
      expect(repo.deleteNotification('non-existent')).toBe(false);
    });
  });

  describe('countUnread', () => {
    it('should count notifications that are not read', () => {
      repo.createNotification(makeInput({ userId: 'user-1' }));
      repo.createNotification(makeInput({ userId: 'user-1' }));
      const n3 = repo.createNotification(makeInput({ userId: 'user-1' }));
      repo.markAsRead(n3.id);

      expect(repo.countUnread('user-1')).toBe(2);
    });

    it('should return 0 for user with no notifications', () => {
      expect(repo.countUnread('unknown')).toBe(0);
    });

    it('should not count notifications from other users', () => {
      repo.createNotification(makeInput({ userId: 'user-1' }));
      repo.createNotification(makeInput({ userId: 'user-2' }));

      expect(repo.countUnread('user-1')).toBe(1);
    });
  });
});
