/**
 * Queue Processor - Unit Tests
 *
 * Tests for the background worker that processes the notification queue,
 * handles retries with exponential backoff, and manages the dead letter queue.
 *
 * @module notifications/services/queueProcessor.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { EmailChannel } from '../channels/emailChannel.js';
import type { InAppChannel } from '../channels/inAppChannel.js';
import type { PushChannel } from '../channels/pushChannel.js';
import type { NotificationRepository } from '../repositories/notificationRepository.js';
import type { Notification, NotificationChannel } from '../types/index.js';

import type { AnalyticsTracker } from './analyticsTracker.js';
import type { NotificationQueue, QueueItem } from './notificationQueue.js';
import type { QueuePayload, QueueProcessorDeps } from './queueProcessor.js';
import { createQueueProcessor } from './queueProcessor.js';
import type { RetryHandler } from './retryHandler.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notif-1',
    userId: 'user-1',
    businessId: 'biz-1',
    category: 'transactions',
    templateId: 'tpl-1',
    templateVersion: '1.0',
    channels: ['email'] as NotificationChannel[],
    priority: 'normal',
    status: 'queued',
    deliveryAttempts: [],
    createdAt: new Date(),
    scheduledAt: null,
    sentAt: null,
    readAt: null,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

function makePayload(overrides: Partial<QueuePayload> = {}): QueuePayload {
  return {
    notificationId: 'notif-1',
    attemptNumber: 0,
    channels: ['email'],
    ...overrides,
  };
}

function makeQueueItem(payload: QueuePayload, overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    notificationId: payload.notificationId,
    priority: 'normal',
    payload: JSON.stringify(payload),
    enqueuedAt: Date.now(),
    ...overrides,
  };
}

// ─── Mock Factories ──────────────────────────────────────────────────────────

function createMockQueue(): NotificationQueue {
  const items: QueueItem[] = [];
  return {
    enqueue: vi.fn(async (id, priority, payload) => {
      items.push({ notificationId: id, priority, payload, enqueuedAt: Date.now() });
    }),
    dequeue: vi.fn(async () => items.shift() ?? null),
    peek: vi.fn(async () => items[0] ?? null),
    size: vi.fn(async () => items.length),
    acknowledge: vi.fn(async () => {}),
    moveToDeadLetterQueue: vi.fn(async () => {}),
    deadLetterQueueSize: vi.fn(async () => 0),
    peekDeadLetterQueue: vi.fn(async () => []),
  };
}

function createMockEmailChannel(): EmailChannel {
  return {
    send: vi.fn(async () => ({
      messageId: 'msg-1',
      status: 'sent' as const,
      timestamp: new Date(),
    })),
    getDeliveryStatus: vi.fn(async () => 'delivered' as const),
    handleBounce: vi.fn(async () => {}),
    handleUnsubscribe: vi.fn(async () => {}),
    getBouncedEmails: vi.fn(() => new Set<string>()),
    getUnsubscribedEmails: vi.fn(() => new Map<string, string[]>()),
  };
}

function createMockInAppChannel(): InAppChannel {
  return {
    create: vi.fn(async (input) => ({
      ...input,
      id: 'inapp-1',
      isRead: false,
      readAt: null,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })),
    getForUser: vi.fn(async () => []),
    markAsRead: vi.fn(async () => {}),
    markAllAsRead: vi.fn(async () => {}),
    getUnreadCount: vi.fn(async () => 0),
    expireOld: vi.fn(async () => 0),
  };
}

function createMockPushChannel(): PushChannel {
  return {
    send: vi.fn(async () => [
      { messageId: 'push-1', status: 'sent' as const, timestamp: new Date() },
    ]),
    sendToDevice: vi.fn(async () => ({
      messageId: 'push-1',
      status: 'sent' as const,
      timestamp: new Date(),
    })),
    sendToAllDevices: vi.fn(async () => [
      { messageId: 'push-1', status: 'sent' as const, timestamp: new Date() },
    ]),
    registerDevice: vi.fn(() => ({
      id: 'dev-1',
      userId: 'user-1',
      token: 'tok-1',
      platform: 'android' as const,
      deviceName: 'Test',
      isValid: true,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    })),
    removeDevice: vi.fn(() => true),
    getDevices: vi.fn(() => []),
    invalidateToken: vi.fn(),
  };
}

function createMockRetryHandler(maxRetries = 3): RetryHandler {
  return {
    shouldRetry: vi.fn((attempt: number) => attempt < maxRetries),
    getDelay: vi.fn((attempt: number) => 1000 * Math.pow(2, attempt)),
    executeWithRetry: vi.fn(async (fn) => fn()),
  };
}

function createMockRepository(notifications: Notification[] = []): NotificationRepository {
  const store = new Map(notifications.map((n) => [n.id, n]));
  return {
    createNotification: vi.fn((input) => {
      const n = makeNotification({ ...input, id: `notif-${store.size + 1}` });
      store.set(n.id, n);
      return n;
    }),
    getNotificationById: vi.fn((id: string) => store.get(id)),
    getNotificationsByUserId: vi.fn(() => [...store.values()]),
    updateNotificationStatus: vi.fn((id, status) => {
      const n = store.get(id);
      if (!n) return undefined;
      n.status = status;
      if (status === 'sent') n.sentAt = new Date();
      return n;
    }),
    markAsRead: vi.fn((id) => {
      const n = store.get(id);
      if (!n) return undefined;
      n.status = 'read';
      n.readAt = new Date();
      return n;
    }),
    addDeliveryAttempt: vi.fn((id, attempt) => {
      const n = store.get(id);
      if (!n) return undefined;
      n.deliveryAttempts.push(attempt);
      return n;
    }),
    getExpiredNotifications: vi.fn(() => []),
    deleteNotification: vi.fn(() => true),
    countUnread: vi.fn(() => 0),
  };
}

function createMockAnalytics(): AnalyticsTracker {
  return {
    recordSend: vi.fn(),
    recordDelivery: vi.fn(),
    recordOpen: vi.fn(),
    recordClick: vi.fn(),
    recordRead: vi.fn(),
    recordBounce: vi.fn(),
    getStats: vi.fn(() => ({
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      read: 0,
      bounced: 0,
    })),
    getDeliveryRate: vi.fn(() => 0),
    getOpenRate: vi.fn(() => 0),
    getClickRate: vi.fn(() => 0),
    getReadRate: vi.fn(() => 0),
    resetStats: vi.fn(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('QueueProcessor', () => {
  let queue: NotificationQueue;
  let emailChannel: EmailChannel;
  let inAppChannel: InAppChannel;
  let pushChannel: PushChannel;
  let retryHandler: RetryHandler;
  let repository: NotificationRepository;
  let analytics: AnalyticsTracker;
  let deps: QueueProcessorDeps;

  beforeEach(() => {
    queue = createMockQueue();
    emailChannel = createMockEmailChannel();
    inAppChannel = createMockInAppChannel();
    pushChannel = createMockPushChannel();
    retryHandler = createMockRetryHandler();
    repository = createMockRepository([makeNotification()]);
    analytics = createMockAnalytics();
    deps = {
      notificationQueue: queue,
      emailChannel,
      inAppChannel,
      pushChannel,
      retryHandler,
      notificationRepository: repository,
      analyticsTracker: analytics,
    };
  });

  describe('processNext', () => {
    it('should return false when queue is empty', async () => {
      const processor = createQueueProcessor(deps);
      const result = await processor.processNext();
      expect(result).toBe(false);
    });

    it('should process an email notification successfully', async () => {
      const payload = makePayload();
      const item = makeQueueItem(payload);
      vi.mocked(queue.dequeue).mockResolvedValueOnce(item);

      const processor = createQueueProcessor(deps);
      const result = await processor.processNext();

      expect(result).toBe(true);
      expect(emailChannel.send).toHaveBeenCalledOnce();
      expect(repository.updateNotificationStatus).toHaveBeenCalledWith('notif-1', 'sent');
      expect(queue.acknowledge).toHaveBeenCalledWith('notif-1');
      expect(analytics.recordSend).toHaveBeenCalledWith('email', 'transactions');
      expect(analytics.recordDelivery).toHaveBeenCalledWith('email', 'transactions');
    });

    it('should process an in_app notification successfully', async () => {
      const notification = makeNotification({ channels: ['in_app'] });
      repository = createMockRepository([notification]);
      deps.notificationRepository = repository;

      const payload = makePayload({ channels: ['in_app'] });
      const item = makeQueueItem(payload);
      vi.mocked(queue.dequeue).mockResolvedValueOnce(item);

      const processor = createQueueProcessor(deps);
      const result = await processor.processNext();

      expect(result).toBe(true);
      expect(inAppChannel.create).toHaveBeenCalledOnce();
      expect(repository.updateNotificationStatus).toHaveBeenCalledWith('notif-1', 'sent');
    });

    it('should process a push notification successfully', async () => {
      const notification = makeNotification({ channels: ['push'] });
      repository = createMockRepository([notification]);
      deps.notificationRepository = repository;

      const payload = makePayload({ channels: ['push'] });
      const item = makeQueueItem(payload);
      vi.mocked(queue.dequeue).mockResolvedValueOnce(item);

      const processor = createQueueProcessor(deps);
      const result = await processor.processNext();

      expect(result).toBe(true);
      expect(pushChannel.send).toHaveBeenCalledOnce();
      expect(repository.updateNotificationStatus).toHaveBeenCalledWith('notif-1', 'sent');
    });

    it('should process multi-channel notifications', async () => {
      const notification = makeNotification({ channels: ['email', 'in_app', 'push'] });
      repository = createMockRepository([notification]);
      deps.notificationRepository = repository;

      const payload = makePayload({ channels: ['email', 'in_app', 'push'] });
      const item = makeQueueItem(payload);
      vi.mocked(queue.dequeue).mockResolvedValueOnce(item);

      const processor = createQueueProcessor(deps);
      await processor.processNext();

      expect(emailChannel.send).toHaveBeenCalledOnce();
      expect(inAppChannel.create).toHaveBeenCalledOnce();
      expect(pushChannel.send).toHaveBeenCalledOnce();
      expect(repository.updateNotificationStatus).toHaveBeenCalledWith('notif-1', 'sent');
    });

    it('should handle malformed payload by moving to DLQ', async () => {
      const item: QueueItem = {
        notificationId: 'notif-bad',
        priority: 'normal',
        payload: 'not-valid-json{{{',
        enqueuedAt: Date.now(),
      };
      vi.mocked(queue.dequeue).mockResolvedValueOnce(item);

      const processor = createQueueProcessor(deps);
      const result = await processor.processNext();

      expect(result).toBe(true);
      expect(queue.moveToDeadLetterQueue).toHaveBeenCalledWith(
        'notif-bad',
        'Malformed queue payload',
      );
      expect(processor.getDeadLetterCount()).toBe(1);
    });

    it('should skip when notification not found in repository', async () => {
      const payload = makePayload({ notificationId: 'notif-missing' });
      const item = makeQueueItem(payload, { notificationId: 'notif-missing' });
      vi.mocked(queue.dequeue).mockResolvedValueOnce(item);

      const processor = createQueueProcessor(deps);
      const result = await processor.processNext();

      expect(result).toBe(true);
      expect(queue.acknowledge).toHaveBeenCalledWith('notif-missing');
      expect(emailChannel.send).not.toHaveBeenCalled();
    });
  });

  describe('retry behavior', () => {
    it('should re-enqueue on failure when retries remain', async () => {
      vi.mocked(emailChannel.send).mockRejectedValueOnce(new Error('Provider timeout'));

      const payload = makePayload();
      const item = makeQueueItem(payload);
      vi.mocked(queue.dequeue).mockResolvedValueOnce(item);

      const processor = createQueueProcessor(deps);
      await processor.processNext();

      // Should acknowledge the old item and enqueue a new one with incremented attempt
      expect(queue.acknowledge).toHaveBeenCalledWith('notif-1');
      expect(queue.enqueue).toHaveBeenCalledWith(
        'notif-1',
        'normal',
        expect.stringContaining('"attemptNumber":1'),
      );
      expect(processor.getDeadLetterCount()).toBe(0);
    });

    it('should move to DLQ when max retries exceeded', async () => {
      vi.mocked(emailChannel.send).mockRejectedValueOnce(new Error('Provider down'));
      // shouldRetry returns false for attempt >= 3
      vi.mocked(retryHandler.shouldRetry).mockReturnValue(false);

      const payload = makePayload({ attemptNumber: 2 });
      const item = makeQueueItem(payload);
      vi.mocked(queue.dequeue).mockResolvedValueOnce(item);

      const processor = createQueueProcessor(deps);
      await processor.processNext();

      expect(repository.updateNotificationStatus).toHaveBeenCalledWith('notif-1', 'failed');
      expect(queue.moveToDeadLetterQueue).toHaveBeenCalledWith('notif-1', 'Provider down');
      expect(processor.getDeadLetterCount()).toBe(1);
    });

    it('should record delivery attempt on failure', async () => {
      vi.mocked(emailChannel.send).mockRejectedValueOnce(new Error('Connection refused'));

      const payload = makePayload();
      const item = makeQueueItem(payload);
      vi.mocked(queue.dequeue).mockResolvedValueOnce(item);

      const processor = createQueueProcessor(deps);
      await processor.processNext();

      expect(repository.addDeliveryAttempt).toHaveBeenCalledWith(
        'notif-1',
        expect.objectContaining({
          channel: 'email',
          attemptNumber: 1,
          status: 'failed',
          errorMessage: 'Connection refused',
        }),
      );
    });

    it('should handle bounced email as failure and retry', async () => {
      vi.mocked(emailChannel.send).mockResolvedValueOnce({
        messageId: '',
        status: 'bounced',
        timestamp: new Date(),
      });

      const payload = makePayload();
      const item = makeQueueItem(payload);
      vi.mocked(queue.dequeue).mockResolvedValueOnce(item);

      const processor = createQueueProcessor(deps);
      await processor.processNext();

      expect(analytics.recordBounce).toHaveBeenCalledWith('email', 'transactions');
      // Should retry since bounced is a failure
      expect(queue.enqueue).toHaveBeenCalled();
    });
  });

  describe('processAll', () => {
    it('should process all items in the queue', async () => {
      const payload1 = makePayload({ notificationId: 'notif-1' });
      const payload2 = makePayload({ notificationId: 'notif-2' });
      const notif2 = makeNotification({ id: 'notif-2' });
      repository = createMockRepository([makeNotification(), notif2]);
      deps.notificationRepository = repository;

      vi.mocked(queue.dequeue)
        .mockResolvedValueOnce(makeQueueItem(payload1))
        .mockResolvedValueOnce(makeQueueItem(payload2, { notificationId: 'notif-2' }))
        .mockResolvedValueOnce(null);

      const processor = createQueueProcessor(deps);
      const count = await processor.processAll();

      expect(count).toBe(2);
    });

    it('should return 0 when queue is empty', async () => {
      const processor = createQueueProcessor(deps);
      const count = await processor.processAll();
      expect(count).toBe(0);
    });
  });

  describe('dead letter queue', () => {
    it('should return empty DLQ initially', () => {
      const processor = createQueueProcessor(deps);
      expect(processor.getDeadLetterQueue()).toEqual([]);
      expect(processor.getDeadLetterCount()).toBe(0);
    });

    it('should track items moved to DLQ', async () => {
      vi.mocked(emailChannel.send).mockRejectedValueOnce(new Error('Fatal'));
      vi.mocked(retryHandler.shouldRetry).mockReturnValue(false);

      const payload = makePayload({ attemptNumber: 2 });
      const item = makeQueueItem(payload);
      vi.mocked(queue.dequeue).mockResolvedValueOnce(item);

      const processor = createQueueProcessor(deps);
      await processor.processNext();

      const dlq = processor.getDeadLetterQueue();
      expect(dlq).toHaveLength(1);
      expect(dlq[0]!.notificationId).toBe('notif-1');
      expect(dlq[0]!.reason).toBe('Fatal');
      expect(dlq[0]!.attemptCount).toBe(3);
    });
  });

  describe('retryDeadLetter', () => {
    it('should re-enqueue a dead letter item', async () => {
      // First, get an item into the DLQ
      vi.mocked(emailChannel.send).mockRejectedValueOnce(new Error('Down'));
      vi.mocked(retryHandler.shouldRetry).mockReturnValue(false);

      const payload = makePayload({ attemptNumber: 2 });
      const item = makeQueueItem(payload);
      vi.mocked(queue.dequeue).mockResolvedValueOnce(item);

      const processor = createQueueProcessor(deps);
      await processor.processNext();
      expect(processor.getDeadLetterCount()).toBe(1);

      // Now retry the dead letter
      const result = await processor.retryDeadLetter('notif-1');

      expect(result).toBe(true);
      expect(processor.getDeadLetterCount()).toBe(0);
      expect(repository.updateNotificationStatus).toHaveBeenCalledWith('notif-1', 'queued');
      expect(queue.enqueue).toHaveBeenCalledWith(
        'notif-1',
        'normal',
        expect.stringContaining('"attemptNumber":0'),
      );
    });

    it('should return false for unknown notification ID', async () => {
      const processor = createQueueProcessor(deps);
      const result = await processor.retryDeadLetter('nonexistent');
      expect(result).toBe(false);
    });

    it('should return false if notification no longer exists in repository', async () => {
      vi.mocked(emailChannel.send).mockRejectedValueOnce(new Error('Down'));
      vi.mocked(retryHandler.shouldRetry).mockReturnValue(false);

      const payload = makePayload({ attemptNumber: 2 });
      const item = makeQueueItem(payload);
      vi.mocked(queue.dequeue).mockResolvedValueOnce(item);

      const processor = createQueueProcessor(deps);
      await processor.processNext();

      // Remove notification from repository
      vi.mocked(repository.getNotificationById).mockReturnValue(undefined);

      const result = await processor.retryDeadLetter('notif-1');
      expect(result).toBe(false);
    });
  });

  describe('analytics tracking', () => {
    it('should record send and delivery on success', async () => {
      const payload = makePayload();
      const item = makeQueueItem(payload);
      vi.mocked(queue.dequeue).mockResolvedValueOnce(item);

      const processor = createQueueProcessor(deps);
      await processor.processNext();

      expect(analytics.recordSend).toHaveBeenCalledWith('email', 'transactions');
      expect(analytics.recordDelivery).toHaveBeenCalledWith('email', 'transactions');
    });

    it('should record send but not delivery on failure', async () => {
      vi.mocked(emailChannel.send).mockRejectedValueOnce(new Error('Fail'));

      const payload = makePayload();
      const item = makeQueueItem(payload);
      vi.mocked(queue.dequeue).mockResolvedValueOnce(item);

      const processor = createQueueProcessor(deps);
      await processor.processNext();

      expect(analytics.recordSend).toHaveBeenCalledWith('email', 'transactions');
      expect(analytics.recordDelivery).not.toHaveBeenCalled();
    });
  });
});
