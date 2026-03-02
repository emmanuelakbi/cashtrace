/**
 * Notification Dispatcher
 *
 * Main entry point for creating and dispatching notifications. Orchestrates
 * preference checking, rate limiting, template rendering, and queue delivery.
 *
 * Security notifications bypass preference and rate limit checks.
 *
 * @module notifications/services/notificationDispatcher
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  NotificationChannel,
  NotificationRequest,
  NotificationResult,
  NotificationStatus,
} from '../types/index.js';
import { NOTIFICATION_ERROR_CODES } from '../types/index.js';

import type { NotificationQueue } from './notificationQueue.js';
import type { PreferenceService } from './preferenceService.js';
import type { RateLimiter } from './rateLimiter.js';
import type { TemplateEngine } from './templateEngine.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_CHANNELS: NotificationChannel[] = ['email', 'in_app', 'push'];

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NotificationDispatcher {
  /** Send a single notification through the dispatch pipeline. */
  send(notification: NotificationRequest): Promise<NotificationResult>;
  /** Send multiple notifications, returning results for each. */
  sendBatch(notifications: NotificationRequest[]): Promise<NotificationResult[]>;
  /** Schedule a notification for future delivery. */
  schedule(notification: NotificationRequest, sendAt: Date): Promise<string>;
  /** Cancel a pending or scheduled notification. */
  cancel(notificationId: string): Promise<void>;
}

export interface DispatcherDeps {
  preferences: PreferenceService;
  rateLimiter: RateLimiter;
  templateEngine: TemplateEngine;
  queue: NotificationQueue;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isSecurity(request: NotificationRequest): boolean {
  return request.category === 'security';
}

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * Create a notification dispatcher with injected dependencies.
 *
 * The dispatch pipeline for each notification:
 * 1. Validate template variables
 * 2. Determine target channels (use defaults if not specified)
 * 3. Filter channels by user preferences (security bypasses)
 * 4. Check rate limits per channel (security bypasses)
 * 5. Render template content
 * 6. Enqueue for delivery
 */
export function createNotificationDispatcher(deps: DispatcherDeps): NotificationDispatcher {
  const { preferences, rateLimiter, templateEngine, queue } = deps;

  async function send(notification: NotificationRequest): Promise<NotificationResult> {
    const notificationId = uuidv4();
    const priority = notification.priority ?? 'normal';
    const requestedChannels = notification.channels ?? [...DEFAULT_CHANNELS];

    // 1. Validate template variables
    const validation = await templateEngine.validate(
      notification.templateId,
      notification.variables,
    );
    if (!validation.valid) {
      const error = new Error(
        `Missing required variables: ${validation.missingVariables.join(', ')}`,
      );
      error.name = NOTIFICATION_ERROR_CODES.NOTIF_MISSING_VARIABLES;
      throw error;
    }

    // 2. Filter channels by user preferences (security bypasses)
    const allowedChannels: NotificationChannel[] = [];
    for (const channel of requestedChannels) {
      if (isSecurity(notification)) {
        allowedChannels.push(channel);
      } else {
        const shouldSend = await preferences.shouldDeliver(
          notification.userId,
          notification.category,
          channel,
        );
        if (shouldSend) {
          allowedChannels.push(channel);
        }
      }
    }

    if (allowedChannels.length === 0) {
      return {
        notificationId,
        status: 'pending' as NotificationStatus,
        channels: [],
        createdAt: new Date(),
      };
    }

    // 3. Check rate limits per channel (security bypasses)
    const deliverableChannels: NotificationChannel[] = [];
    for (const channel of allowedChannels) {
      if (isSecurity(notification)) {
        deliverableChannels.push(channel);
      } else {
        const limitResult = await rateLimiter.checkLimit(
          notification.userId,
          channel,
          notification.category,
        );
        if (limitResult.allowed) {
          deliverableChannels.push(channel);
        }
      }
    }

    if (deliverableChannels.length === 0) {
      const error = new Error('Rate limit exceeded for all channels');
      error.name = NOTIFICATION_ERROR_CODES.NOTIF_RATE_LIMITED;
      throw error;
    }

    // 4. Render template
    const rendered = await templateEngine.render(notification.templateId, notification.variables);

    // 5. Enqueue for delivery
    const payload = JSON.stringify({
      notificationId,
      userId: notification.userId,
      businessId: notification.businessId,
      category: notification.category,
      templateId: notification.templateId,
      channels: deliverableChannels,
      priority,
      rendered,
      createdAt: new Date().toISOString(),
    });

    await queue.enqueue(notificationId, priority, payload);

    return {
      notificationId,
      status: 'queued',
      channels: deliverableChannels,
      createdAt: new Date(),
    };
  }

  async function sendBatch(notifications: NotificationRequest[]): Promise<NotificationResult[]> {
    return Promise.all(notifications.map((n) => send(n)));
  }

  async function schedule(notification: NotificationRequest, sendAt: Date): Promise<string> {
    const notificationId = uuidv4();
    const priority = notification.priority ?? 'normal';

    // Validate template before scheduling
    const validation = await templateEngine.validate(
      notification.templateId,
      notification.variables,
    );
    if (!validation.valid) {
      const error = new Error(
        `Missing required variables: ${validation.missingVariables.join(', ')}`,
      );
      error.name = NOTIFICATION_ERROR_CODES.NOTIF_MISSING_VARIABLES;
      throw error;
    }

    const payload = JSON.stringify({
      notificationId,
      userId: notification.userId,
      businessId: notification.businessId,
      category: notification.category,
      templateId: notification.templateId,
      channels: notification.channels ?? [...DEFAULT_CHANNELS],
      priority,
      variables: notification.variables,
      scheduledAt: sendAt.toISOString(),
      createdAt: new Date().toISOString(),
    });

    await queue.enqueue(notificationId, priority, payload);

    return notificationId;
  }

  async function cancel(notificationId: string): Promise<void> {
    await queue.moveToDeadLetterQueue(notificationId, 'cancelled');
  }

  return { send, sendBatch, schedule, cancel };
}
