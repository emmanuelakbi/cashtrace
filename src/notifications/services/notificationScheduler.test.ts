/**
 * Unit tests for NotificationScheduler
 *
 * @module notifications/services/notificationScheduler.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationRequest, NotificationResult } from '../types/index.js';

import type { NotificationDispatcher } from './notificationDispatcher.js';
import { createNotificationScheduler } from './notificationScheduler.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(overrides?: Partial<NotificationRequest>): NotificationRequest {
  return {
    userId: 'user-1',
    businessId: 'biz-1',
    category: 'transactions',
    templateId: 'tpl-welcome',
    variables: { name: 'Ada' },
    ...overrides,
  };
}

function makeDispatcher(overrides?: Partial<NotificationDispatcher>): NotificationDispatcher {
  const result: NotificationResult = {
    notificationId: 'dispatched-1',
    status: 'queued',
    channels: ['email'],
    createdAt: new Date(),
  };

  return {
    send: vi.fn().mockResolvedValue(result),
    sendBatch: vi.fn().mockResolvedValue([result]),
    schedule: vi.fn().mockResolvedValue('sched-1'),
    cancel: vi.fn(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('NotificationScheduler', () => {
  let dispatcher: NotificationDispatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T10:00:00Z'));
    dispatcher = makeDispatcher();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('scheduleNotification', () => {
    it('should store a notification with a unique ID', () => {
      const scheduler = createNotificationScheduler(dispatcher);
      const sendAt = new Date('2025-01-15T12:00:00Z');

      const entry = scheduler.scheduleNotification(makeRequest(), sendAt);

      expect(entry.id).toBeDefined();
      expect(typeof entry.id).toBe('string');
      expect(entry.sendAt).toEqual(sendAt);
      expect(entry.notification.userId).toBe('user-1');
    });

    it('should assign distinct IDs to each scheduled notification', () => {
      const scheduler = createNotificationScheduler(dispatcher);
      const sendAt = new Date('2025-01-15T12:00:00Z');

      const a = scheduler.scheduleNotification(makeRequest(), sendAt);
      const b = scheduler.scheduleNotification(makeRequest(), sendAt);

      expect(a.id).not.toBe(b.id);
    });

    it('should record createdAt as the current time', () => {
      const scheduler = createNotificationScheduler(dispatcher);
      const sendAt = new Date('2025-01-15T12:00:00Z');

      const entry = scheduler.scheduleNotification(makeRequest(), sendAt);

      expect(entry.createdAt).toEqual(new Date('2025-01-15T10:00:00Z'));
    });
  });

  describe('getScheduled', () => {
    it('should return empty array when nothing is scheduled', () => {
      const scheduler = createNotificationScheduler(dispatcher);

      expect(scheduler.getScheduled()).toEqual([]);
    });

    it('should return all pending scheduled notifications', () => {
      const scheduler = createNotificationScheduler(dispatcher);
      const sendAt = new Date('2025-01-15T12:00:00Z');

      scheduler.scheduleNotification(makeRequest({ userId: 'user-1' }), sendAt);
      scheduler.scheduleNotification(makeRequest({ userId: 'user-2' }), sendAt);

      expect(scheduler.getScheduled()).toHaveLength(2);
    });
  });

  describe('getDueNotifications', () => {
    it('should return notifications whose sendAt has passed', () => {
      const scheduler = createNotificationScheduler(dispatcher);

      scheduler.scheduleNotification(makeRequest(), new Date('2025-01-15T09:00:00Z'));
      scheduler.scheduleNotification(makeRequest(), new Date('2025-01-15T14:00:00Z'));

      const due = scheduler.getDueNotifications();

      expect(due).toHaveLength(1);
      expect(due[0]?.sendAt).toEqual(new Date('2025-01-15T09:00:00Z'));
    });

    it('should include notifications whose sendAt equals now', () => {
      const scheduler = createNotificationScheduler(dispatcher);

      scheduler.scheduleNotification(makeRequest(), new Date('2025-01-15T10:00:00Z'));

      expect(scheduler.getDueNotifications()).toHaveLength(1);
    });

    it('should accept a custom now parameter', () => {
      const scheduler = createNotificationScheduler(dispatcher);

      scheduler.scheduleNotification(makeRequest(), new Date('2025-01-15T11:00:00Z'));

      expect(scheduler.getDueNotifications(new Date('2025-01-15T10:30:00Z'))).toHaveLength(0);
      expect(scheduler.getDueNotifications(new Date('2025-01-15T11:30:00Z'))).toHaveLength(1);
    });

    it('should return empty array when no notifications are due', () => {
      const scheduler = createNotificationScheduler(dispatcher);

      scheduler.scheduleNotification(makeRequest(), new Date('2025-01-15T14:00:00Z'));

      expect(scheduler.getDueNotifications()).toHaveLength(0);
    });
  });

  describe('cancelScheduled', () => {
    it('should remove a scheduled notification and return true', () => {
      const scheduler = createNotificationScheduler(dispatcher);
      const entry = scheduler.scheduleNotification(makeRequest(), new Date('2025-01-15T12:00:00Z'));

      const result = scheduler.cancelScheduled(entry.id);

      expect(result).toBe(true);
      expect(scheduler.getScheduled()).toHaveLength(0);
    });

    it('should return false for a non-existent ID', () => {
      const scheduler = createNotificationScheduler(dispatcher);

      expect(scheduler.cancelScheduled('non-existent')).toBe(false);
    });

    it('should not affect other scheduled notifications', () => {
      const scheduler = createNotificationScheduler(dispatcher);
      const sendAt = new Date('2025-01-15T12:00:00Z');

      const a = scheduler.scheduleNotification(makeRequest({ userId: 'user-1' }), sendAt);
      scheduler.scheduleNotification(makeRequest({ userId: 'user-2' }), sendAt);

      scheduler.cancelScheduled(a.id);

      const remaining = scheduler.getScheduled();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.notification.userId).toBe('user-2');
    });
  });

  describe('processScheduled', () => {
    it('should dispatch due notifications via the dispatcher', async () => {
      const scheduler = createNotificationScheduler(dispatcher);

      scheduler.scheduleNotification(makeRequest(), new Date('2025-01-15T09:00:00Z'));

      const ids = await scheduler.processScheduled();

      expect(ids).toHaveLength(1);
      expect(dispatcher.send).toHaveBeenCalledTimes(1);
      expect(dispatcher.send).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
    });

    it('should remove processed notifications from the store', async () => {
      const scheduler = createNotificationScheduler(dispatcher);

      scheduler.scheduleNotification(makeRequest(), new Date('2025-01-15T09:00:00Z'));

      await scheduler.processScheduled();

      expect(scheduler.getScheduled()).toHaveLength(0);
    });

    it('should not dispatch future notifications', async () => {
      const scheduler = createNotificationScheduler(dispatcher);

      scheduler.scheduleNotification(makeRequest(), new Date('2025-01-15T14:00:00Z'));

      const ids = await scheduler.processScheduled();

      expect(ids).toHaveLength(0);
      expect(dispatcher.send).not.toHaveBeenCalled();
      expect(scheduler.getScheduled()).toHaveLength(1);
    });

    it('should process multiple due notifications', async () => {
      const scheduler = createNotificationScheduler(dispatcher);

      scheduler.scheduleNotification(
        makeRequest({ userId: 'user-1' }),
        new Date('2025-01-15T08:00:00Z'),
      );
      scheduler.scheduleNotification(
        makeRequest({ userId: 'user-2' }),
        new Date('2025-01-15T09:00:00Z'),
      );
      scheduler.scheduleNotification(
        makeRequest({ userId: 'user-3' }),
        new Date('2025-01-15T14:00:00Z'),
      );

      const ids = await scheduler.processScheduled();

      expect(ids).toHaveLength(2);
      expect(dispatcher.send).toHaveBeenCalledTimes(2);
      expect(scheduler.getScheduled()).toHaveLength(1);
    });

    it('should accept a custom now parameter', async () => {
      const scheduler = createNotificationScheduler(dispatcher);

      scheduler.scheduleNotification(makeRequest(), new Date('2025-01-15T12:00:00Z'));

      const ids = await scheduler.processScheduled(new Date('2025-01-15T13:00:00Z'));

      expect(ids).toHaveLength(1);
    });

    it('should return empty array when nothing is due', async () => {
      const scheduler = createNotificationScheduler(dispatcher);

      const ids = await scheduler.processScheduled();

      expect(ids).toHaveLength(0);
    });
  });
});
