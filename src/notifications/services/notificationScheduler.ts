/**
 * Notification Scheduler
 *
 * Manages scheduled notifications for future delivery. Stores notifications
 * with a target send time and processes them when due by dispatching through
 * the standard notification pipeline.
 *
 * @module notifications/services/notificationScheduler
 */

import { v4 as uuidv4 } from 'uuid';

import type { NotificationRequest, NotificationResult } from '../types/index.js';

import type { NotificationDispatcher } from './notificationDispatcher.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScheduledNotification {
  id: string;
  notification: NotificationRequest;
  sendAt: Date;
  createdAt: Date;
}

export interface NotificationScheduler {
  /** Store a notification for future delivery at the specified time. */
  scheduleNotification(notification: NotificationRequest, sendAt: Date): ScheduledNotification;
  /** Get all pending scheduled notifications. */
  getScheduled(): ScheduledNotification[];
  /** Get notifications whose sendAt time has passed. */
  getDueNotifications(now?: Date): ScheduledNotification[];
  /** Cancel a scheduled notification by ID. Returns true if found and removed. */
  cancelScheduled(notificationId: string): boolean;
  /** Process all due notifications by dispatching them. Returns processed IDs. */
  processScheduled(now?: Date): Promise<string[]>;
}

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * Create a notification scheduler with an in-memory store.
 *
 * Scheduled notifications are held until their `sendAt` time arrives,
 * then dispatched via the provided dispatcher's `send()` method.
 */
export function createNotificationScheduler(
  dispatcher: NotificationDispatcher,
): NotificationScheduler {
  const store = new Map<string, ScheduledNotification>();

  function scheduleNotification(
    notification: NotificationRequest,
    sendAt: Date,
  ): ScheduledNotification {
    const entry: ScheduledNotification = {
      id: uuidv4(),
      notification,
      sendAt,
      createdAt: new Date(),
    };
    store.set(entry.id, entry);
    return entry;
  }

  function getScheduled(): ScheduledNotification[] {
    return [...store.values()];
  }

  function getDueNotifications(now?: Date): ScheduledNotification[] {
    const currentTime = now ?? new Date();
    return [...store.values()].filter((entry) => entry.sendAt <= currentTime);
  }

  function cancelScheduled(notificationId: string): boolean {
    return store.delete(notificationId);
  }

  async function processScheduled(now?: Date): Promise<string[]> {
    const due = getDueNotifications(now);
    const processedIds: string[] = [];

    for (const entry of due) {
      await dispatcher.send(entry.notification);
      store.delete(entry.id);
      processedIds.push(entry.id);
    }

    return processedIds;
  }

  return {
    scheduleNotification,
    getScheduled,
    getDueNotifications,
    cancelScheduled,
    processScheduled,
  };
}
