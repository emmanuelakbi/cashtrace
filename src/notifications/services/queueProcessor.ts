/**
 * Queue Processor - Background worker for processing the notification queue.
 *
 * Dequeues notifications, dispatches to appropriate channels (email, in_app, push),
 * handles retries with exponential backoff, and manages a dead letter queue
 * for items that exceed max retry attempts.
 *
 * @module notifications/services/queueProcessor
 */

import type { EmailChannel } from '../channels/emailChannel.js';
import type { InAppChannel } from '../channels/inAppChannel.js';
import type { PushChannel } from '../channels/pushChannel.js';
import type { NotificationRepository } from '../repositories/notificationRepository.js';
import type {
  DeliveryAttempt,
  DeliveryStatus,
  Notification,
  NotificationChannel,
} from '../types/index.js';

import type { AnalyticsTracker } from './analyticsTracker.js';
import type { NotificationQueue, QueueItem } from './notificationQueue.js';
import type { RetryHandler } from './retryHandler.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Payload stored in the queue for each notification. */
export interface QueuePayload {
  notificationId: string;
  attemptNumber: number;
  channels: NotificationChannel[];
}

/** An item in the dead letter queue. */
export interface DeadLetterItem {
  notificationId: string;
  reason: string;
  failedAt: Date;
  attemptCount: number;
}

/** Dependencies for the queue processor factory. */
export interface QueueProcessorDeps {
  notificationQueue: NotificationQueue;
  emailChannel: EmailChannel;
  inAppChannel: InAppChannel;
  pushChannel: PushChannel;
  retryHandler: RetryHandler;
  notificationRepository: NotificationRepository;
  analyticsTracker: AnalyticsTracker;
}

/** Queue processor interface for background notification processing. */
export interface QueueProcessor {
  processNext(): Promise<boolean>;
  processAll(): Promise<number>;
  getDeadLetterQueue(): DeadLetterItem[];
  getDeadLetterCount(): number;
  retryDeadLetter(notificationId: string): Promise<boolean>;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a queue processor that polls the notification queue and dispatches
 * to the appropriate channels.
 *
 * Processing flow:
 * 1. Dequeue highest-priority item
 * 2. Look up notification from repository
 * 3. For each channel, attempt delivery
 * 4. Record delivery attempts and track analytics
 * 5. On success: update status to 'sent', acknowledge queue item
 * 6. On failure with retries remaining: re-enqueue with incremented attempt
 * 7. On failure with max retries exceeded: move to dead letter queue, mark 'failed'
 */
export function createQueueProcessor(deps: QueueProcessorDeps): QueueProcessor {
  const {
    notificationQueue,
    emailChannel,
    inAppChannel,
    pushChannel,
    retryHandler,
    notificationRepository,
    analyticsTracker,
  } = deps;

  const deadLetterItems: DeadLetterItem[] = [];

  // ─── Channel Dispatch ────────────────────────────────────────────────

  async function deliverToChannel(
    notification: Notification,
    channel: NotificationChannel,
  ): Promise<DeliveryStatus> {
    switch (channel) {
      case 'email': {
        const result = await emailChannel.send({
          to: notification.userId,
          from: '',
          replyTo: '',
          subject: notification.templateId,
          bodyHtml: '',
          bodyText: '',
          headers: {},
          metadata: { notificationId: notification.id },
        });
        return result.status;
      }
      case 'in_app': {
        await inAppChannel.create({
          userId: notification.userId,
          businessId: notification.businessId,
          category: notification.category,
          type: 'info',
          title: notification.templateId,
          body: '',
        });
        return 'delivered';
      }
      case 'push': {
        const results = await pushChannel.send(notification.userId, {
          title: notification.templateId,
          body: '',
        });
        const hasSuccess = results.some((r) => r.status === 'sent' || r.status === 'delivered');
        return hasSuccess ? 'sent' : results.length === 0 ? 'sent' : 'failed';
      }
    }
  }

  // ─── Process Single Item ─────────────────────────────────────────────

  async function processItem(
    queueItem: QueueItem,
    payload: QueuePayload,
    notification: Notification,
  ): Promise<void> {
    let allSucceeded = true;
    let lastError: string | null = null;

    for (const channel of payload.channels) {
      try {
        analyticsTracker.recordSend(channel, notification.category);

        const status = await deliverToChannel(notification, channel);

        const attempt: DeliveryAttempt = {
          channel,
          attemptNumber: payload.attemptNumber + 1,
          status,
          timestamp: new Date(),
          errorMessage: null,
        };
        notificationRepository.addDeliveryAttempt(notification.id, attempt);

        if (status === 'sent' || status === 'delivered') {
          analyticsTracker.recordDelivery(channel, notification.category);
        } else if (status === 'bounced') {
          analyticsTracker.recordBounce(channel, notification.category);
          allSucceeded = false;
          lastError = `Delivery bounced on channel ${channel}`;
        } else if (status === 'failed') {
          allSucceeded = false;
          lastError = `Delivery failed on channel ${channel}`;
        }
      } catch (error: unknown) {
        allSucceeded = false;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        lastError = errorMsg;

        const attempt: DeliveryAttempt = {
          channel,
          attemptNumber: payload.attemptNumber + 1,
          status: 'failed',
          timestamp: new Date(),
          errorMessage: errorMsg,
        };
        notificationRepository.addDeliveryAttempt(notification.id, attempt);
      }
    }

    if (allSucceeded) {
      notificationRepository.updateNotificationStatus(notification.id, 'sent');
      await notificationQueue.acknowledge(queueItem.notificationId);
    } else {
      await handleFailure(queueItem, payload, notification, lastError ?? 'Unknown failure');
    }
  }

  // ─── Failure Handling ────────────────────────────────────────────────

  async function handleFailure(
    queueItem: QueueItem,
    payload: QueuePayload,
    notification: Notification,
    reason: string,
  ): Promise<void> {
    const nextAttempt = payload.attemptNumber + 1;

    if (retryHandler.shouldRetry(nextAttempt)) {
      // Re-enqueue with incremented attempt count
      const retryPayload: QueuePayload = {
        ...payload,
        attemptNumber: nextAttempt,
      };
      await notificationQueue.acknowledge(queueItem.notificationId);
      await notificationQueue.enqueue(
        notification.id,
        notification.priority,
        JSON.stringify(retryPayload),
      );
    } else {
      // Max retries exceeded — move to dead letter queue
      notificationRepository.updateNotificationStatus(notification.id, 'failed');
      await notificationQueue.moveToDeadLetterQueue(queueItem.notificationId, reason);

      deadLetterItems.push({
        notificationId: notification.id,
        reason,
        failedAt: new Date(),
        attemptCount: nextAttempt,
      });
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────

  async function processNext(): Promise<boolean> {
    const queueItem = await notificationQueue.dequeue();
    if (!queueItem) {
      return false;
    }

    let payload: QueuePayload;
    try {
      payload = JSON.parse(queueItem.payload) as QueuePayload;
    } catch {
      // Malformed payload — move to DLQ
      await notificationQueue.moveToDeadLetterQueue(
        queueItem.notificationId,
        'Malformed queue payload',
      );
      deadLetterItems.push({
        notificationId: queueItem.notificationId,
        reason: 'Malformed queue payload',
        failedAt: new Date(),
        attemptCount: 0,
      });
      return true;
    }

    const notification = notificationRepository.getNotificationById(payload.notificationId);
    if (!notification) {
      // Notification no longer exists — acknowledge and skip
      await notificationQueue.acknowledge(queueItem.notificationId);
      return true;
    }

    await processItem(queueItem, payload, notification);
    return true;
  }

  async function processAll(): Promise<number> {
    let processed = 0;
    while (await processNext()) {
      processed++;
    }
    return processed;
  }

  function getDeadLetterQueue(): DeadLetterItem[] {
    return [...deadLetterItems];
  }

  function getDeadLetterCount(): number {
    return deadLetterItems.length;
  }

  async function retryDeadLetter(notificationId: string): Promise<boolean> {
    const idx = deadLetterItems.findIndex((item) => item.notificationId === notificationId);
    if (idx === -1) {
      return false;
    }

    const notification = notificationRepository.getNotificationById(notificationId);
    if (!notification) {
      return false;
    }

    // Remove from local dead letter list
    deadLetterItems.splice(idx, 1);

    // Reset status and re-enqueue with attempt 0
    notificationRepository.updateNotificationStatus(notificationId, 'queued');
    const payload: QueuePayload = {
      notificationId,
      attemptNumber: 0,
      channels: notification.channels,
    };
    await notificationQueue.enqueue(notificationId, notification.priority, JSON.stringify(payload));

    return true;
  }

  return {
    processNext,
    processAll,
    getDeadLetterQueue,
    getDeadLetterCount,
    retryDeadLetter,
  };
}
