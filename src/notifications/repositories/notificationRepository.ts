/**
 * Notification Repository
 *
 * In-memory data access layer for notification persistence and queries.
 * Provides CRUD operations and query capabilities by user, status, channel, and category.
 *
 * @module notifications/repositories/notificationRepository
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  DeliveryAttempt,
  Notification,
  NotificationCategory,
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
} from '../types/index.js';

// ─── Query Options ───

export interface GetNotificationsOptions {
  status?: NotificationStatus;
  channel?: NotificationChannel;
  category?: NotificationCategory;
  limit?: number;
  offset?: number;
}

// ─── Create Input ───

export interface CreateNotificationInput {
  userId: string;
  businessId: string;
  category: NotificationCategory;
  templateId: string;
  templateVersion: string;
  channels: NotificationChannel[];
  priority: NotificationPriority;
  status?: NotificationStatus;
  scheduledAt?: Date | null;
  expiresAt?: Date;
}

// ─── Repository Interface ───

export interface NotificationRepository {
  createNotification(input: CreateNotificationInput): Notification;
  getNotificationById(id: string): Notification | undefined;
  getNotificationsByUserId(userId: string, options?: GetNotificationsOptions): Notification[];
  updateNotificationStatus(id: string, status: NotificationStatus): Notification | undefined;
  markAsRead(id: string): Notification | undefined;
  addDeliveryAttempt(notificationId: string, attempt: DeliveryAttempt): Notification | undefined;
  getExpiredNotifications(before: Date): Notification[];
  deleteNotification(id: string): boolean;
  countUnread(userId: string): number;
}

// ─── Constants ───

const DEFAULT_EXPIRY_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─── Factory ───

export function createNotificationRepository(): NotificationRepository {
  const store = new Map<string, Notification>();

  function createNotification(input: CreateNotificationInput): Notification {
    const now = new Date();
    const notification: Notification = {
      id: uuidv4(),
      userId: input.userId,
      businessId: input.businessId,
      category: input.category,
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      channels: input.channels,
      priority: input.priority,
      status: input.status ?? 'pending',
      deliveryAttempts: [],
      createdAt: now,
      scheduledAt: input.scheduledAt ?? null,
      sentAt: null,
      readAt: null,
      expiresAt: input.expiresAt ?? new Date(now.getTime() + DEFAULT_EXPIRY_DAYS * MS_PER_DAY),
    };
    store.set(notification.id, notification);
    return notification;
  }

  function getNotificationById(id: string): Notification | undefined {
    return store.get(id);
  }

  function getNotificationsByUserId(
    userId: string,
    options?: GetNotificationsOptions,
  ): Notification[] {
    let results: Notification[] = [];

    for (const notification of store.values()) {
      if (notification.userId !== userId) continue;
      results.push(notification);
    }

    if (options?.status) {
      results = results.filter((n) => n.status === options.status);
    }
    if (options?.channel) {
      results = results.filter((n) => n.channels.includes(options.channel!));
    }
    if (options?.category) {
      results = results.filter((n) => n.category === options.category);
    }

    // Sort by createdAt descending (newest first)
    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const offset = options?.offset ?? 0;
    const limit = options?.limit;

    if (limit !== undefined) {
      return results.slice(offset, offset + limit);
    }
    return offset > 0 ? results.slice(offset) : results;
  }

  function updateNotificationStatus(
    id: string,
    status: NotificationStatus,
  ): Notification | undefined {
    const notification = store.get(id);
    if (!notification) return undefined;

    notification.status = status;
    if (status === 'sent') {
      notification.sentAt = new Date();
    }
    return notification;
  }

  function markAsRead(id: string): Notification | undefined {
    const notification = store.get(id);
    if (!notification) return undefined;

    notification.status = 'read';
    notification.readAt = new Date();
    return notification;
  }

  function addDeliveryAttempt(
    notificationId: string,
    attempt: DeliveryAttempt,
  ): Notification | undefined {
    const notification = store.get(notificationId);
    if (!notification) return undefined;

    notification.deliveryAttempts.push(attempt);
    return notification;
  }

  function getExpiredNotifications(before: Date): Notification[] {
    const results: Notification[] = [];
    for (const notification of store.values()) {
      if (notification.expiresAt <= before && notification.status !== 'expired') {
        results.push(notification);
      }
    }
    return results;
  }

  function deleteNotification(id: string): boolean {
    return store.delete(id);
  }

  function countUnread(userId: string): number {
    let count = 0;
    for (const notification of store.values()) {
      if (notification.userId === userId && notification.status !== 'read') {
        count++;
      }
    }
    return count;
  }

  return {
    createNotification,
    getNotificationById,
    getNotificationsByUserId,
    updateNotificationStatus,
    markAsRead,
    addDeliveryAttempt,
    getExpiredNotifications,
    deleteNotification,
    countUnread,
  };
}
