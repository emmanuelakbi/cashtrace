/**
 * Test helper factory functions for the Notification System module.
 *
 * Provides `make*` factories for all notification types, following the
 * project convention of `Partial<T>` overrides with sensible defaults.
 *
 * @module notifications/test/helpers
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  DeviceToken,
  EmailMessage,
  Notification,
  NotificationPreferences,
  NotificationRequest,
  NotificationTemplate,
} from '../types/index.js';

// ─── Core Factories ──────────────────────────────────────────────────────────

/** Create a NotificationRequest with sensible defaults. */
export function makeNotificationRequest(
  overrides: Partial<NotificationRequest> = {},
): NotificationRequest {
  return {
    userId: uuidv4(),
    businessId: uuidv4(),
    category: 'transactions',
    templateId: 'txn-received',
    variables: { amount: 50000, currency: '₦' },
    channels: ['email', 'in_app'],
    priority: 'normal',
    ...overrides,
  };
}

/** Create a Notification with sensible defaults. */
export function makeNotification(overrides: Partial<Notification> = {}): Notification {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
  return {
    id: uuidv4(),
    userId: uuidv4(),
    businessId: uuidv4(),
    category: 'transactions',
    templateId: 'txn-received',
    templateVersion: '1.0.0',
    channels: ['email', 'in_app'],
    priority: 'normal',
    status: 'pending',
    deliveryAttempts: [],
    createdAt: now,
    scheduledAt: null,
    sentAt: null,
    readAt: null,
    expiresAt,
    ...overrides,
  };
}

// ─── Template Factories ──────────────────────────────────────────────────────

/** Create a NotificationTemplate with sensible defaults. */
export function makeTemplate(overrides: Partial<NotificationTemplate> = {}): NotificationTemplate {
  return {
    id: uuidv4(),
    version: '1.0.0',
    category: 'transactions',
    subject: 'Transaction Alert: {{amount}}',
    bodyHtml: '<p>You received {{amount}} from {{sender}}.</p>',
    bodyText: 'You received {{amount}} from {{sender}}.',
    pushTitle: 'New Transaction',
    pushBody: 'You received {{amount}}',
    variables: [
      { name: 'amount', required: true, type: 'currency' },
      { name: 'sender', required: true, type: 'string' },
    ],
    ...overrides,
  };
}

// ─── Preference Factories ────────────────────────────────────────────────────

/** Create NotificationPreferences with sensible defaults. */
export function makePreferences(
  overrides: Partial<NotificationPreferences> = {},
): NotificationPreferences {
  return {
    userId: uuidv4(),
    enabledCategories: ['security', 'transactions', 'insights', 'compliance', 'system'],
    channelPreferences: {
      security: ['email', 'in_app', 'push'],
      transactions: ['email', 'in_app'],
      insights: ['in_app'],
      compliance: ['email', 'in_app'],
      system: ['in_app'],
      marketing: [],
    },
    frequency: 'immediate',
    quietHours: {
      enabled: true,
      startTime: '22:00',
      endTime: '07:00',
    },
    unsubscribedCategories: ['marketing'],
    ...overrides,
  };
}

// ─── Device Token Factories ──────────────────────────────────────────────────

/** Create a DeviceToken with sensible defaults. */
export function makeDeviceToken(overrides: Partial<DeviceToken> = {}): DeviceToken {
  const now = new Date();
  return {
    id: uuidv4(),
    userId: uuidv4(),
    token: `fcm-token-${uuidv4()}`,
    platform: 'android',
    deviceName: 'Samsung Galaxy S24',
    isValid: true,
    createdAt: now,
    lastUsedAt: now,
    ...overrides,
  };
}

// ─── Email Factories ─────────────────────────────────────────────────────────

/** Create an EmailMessage with sensible defaults. */
export function makeEmailMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    to: 'user@example.com',
    from: 'noreply@cashtrace.ng',
    replyTo: 'support@cashtrace.ng',
    subject: 'Transaction Alert',
    bodyHtml: '<p>You received ₦50,000.</p>',
    bodyText: 'You received ₦50,000.',
    headers: {
      'List-Unsubscribe': '<https://cashtrace.ng/unsubscribe>',
    },
    metadata: {
      notificationId: uuidv4(),
      category: 'transactions',
    },
    ...overrides,
  };
}
