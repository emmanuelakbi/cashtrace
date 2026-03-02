/**
 * Notification Queue Service
 *
 * Redis-based persistent notification queue with priority ordering.
 * Uses sorted sets for priority-based dequeuing and supports
 * dead letter queue for failed deliveries.
 *
 * @module notifications/services/notificationQueue
 */

import type { Redis } from 'ioredis';

import type { NotificationPriority } from '../types/index.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const QUEUE_KEY = 'notif:queue';
const DLQ_KEY = 'notif:dlq';
const PAYLOAD_PREFIX = 'notif:payload:';
const PROCESSING_KEY = 'notif:processing';

/** Lower score = higher priority in the sorted set. */
const PRIORITY_SCORES: Record<NotificationPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QueueItem {
  notificationId: string;
  priority: NotificationPriority;
  payload: string;
  enqueuedAt: number;
}

export interface NotificationQueue {
  /** Add a notification to the queue with priority ordering. */
  enqueue(notificationId: string, priority: NotificationPriority, payload: string): Promise<void>;
  /** Remove and return the highest-priority item from the queue. */
  dequeue(): Promise<QueueItem | null>;
  /** Return the highest-priority item without removing it. */
  peek(): Promise<QueueItem | null>;
  /** Return the number of items currently in the queue. */
  size(): Promise<number>;
  /** Acknowledge successful processing, removing from the processing set. */
  acknowledge(notificationId: string): Promise<void>;
  /** Move a failed notification to the dead letter queue. */
  moveToDeadLetterQueue(notificationId: string, reason: string): Promise<void>;
  /** Return the number of items in the dead letter queue. */
  deadLetterQueueSize(): Promise<number>;
  /** Return items from the dead letter queue for inspection. */
  peekDeadLetterQueue(limit: number): Promise<QueueItem[]>;
}

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * Create a Redis-backed notification queue.
 *
 * Uses sorted sets for priority ordering (lower score = higher priority).
 * Payloads are stored separately under `notif:payload:{id}` to keep the
 * sorted set lightweight. A processing set tracks in-flight items so they
 * can be recovered on restart.
 */
export function createNotificationQueue(redis: Redis): NotificationQueue {
  async function enqueue(
    notificationId: string,
    priority: NotificationPriority,
    payload: string,
  ): Promise<void> {
    const score = PRIORITY_SCORES[priority];
    const enqueuedAt = Date.now();
    const meta = JSON.stringify({ notificationId, priority, enqueuedAt });

    // Store payload separately and add to sorted set atomically via pipeline
    const pipeline = redis.pipeline();
    pipeline.set(`${PAYLOAD_PREFIX}${notificationId}`, payload);
    pipeline.zadd(QUEUE_KEY, score.toString(), meta);
    await pipeline.exec();
  }

  async function dequeue(): Promise<QueueItem | null> {
    // Pop the lowest-score (highest-priority) member
    const results = await redis.zpopmin(QUEUE_KEY, 1);
    if (!results || results.length < 2) {
      return null;
    }

    const raw = results[0] as string;
    const parsed = JSON.parse(raw) as {
      notificationId: string;
      priority: NotificationPriority;
      enqueuedAt: number;
    };

    const payload = await redis.get(`${PAYLOAD_PREFIX}${parsed.notificationId}`);
    if (payload === null) {
      return null;
    }

    // Track as in-flight
    await redis.sadd(PROCESSING_KEY, parsed.notificationId);

    return {
      notificationId: parsed.notificationId,
      priority: parsed.priority,
      payload,
      enqueuedAt: parsed.enqueuedAt,
    };
  }

  async function peek(): Promise<QueueItem | null> {
    const results = await redis.zrange(QUEUE_KEY, 0, 0);
    if (!results || results.length === 0) {
      return null;
    }

    const raw = results[0] as string;
    const parsed = JSON.parse(raw) as {
      notificationId: string;
      priority: NotificationPriority;
      enqueuedAt: number;
    };

    const payload = await redis.get(`${PAYLOAD_PREFIX}${parsed.notificationId}`);
    if (payload === null) {
      return null;
    }

    return {
      notificationId: parsed.notificationId,
      priority: parsed.priority,
      payload,
      enqueuedAt: parsed.enqueuedAt,
    };
  }

  async function size(): Promise<number> {
    return redis.zcard(QUEUE_KEY);
  }

  async function acknowledge(notificationId: string): Promise<void> {
    const pipeline = redis.pipeline();
    pipeline.srem(PROCESSING_KEY, notificationId);
    pipeline.del(`${PAYLOAD_PREFIX}${notificationId}`);
    await pipeline.exec();
  }

  async function moveToDeadLetterQueue(notificationId: string, reason: string): Promise<void> {
    const payload = await redis.get(`${PAYLOAD_PREFIX}${notificationId}`);
    const enqueuedAt = Date.now();
    const meta = JSON.stringify({
      notificationId,
      priority: 'low' as NotificationPriority,
      enqueuedAt,
      reason,
    });

    const pipeline = redis.pipeline();
    pipeline.zadd(DLQ_KEY, enqueuedAt.toString(), meta);
    if (payload !== null) {
      pipeline.set(`${PAYLOAD_PREFIX}${notificationId}:dlq`, payload);
    }
    pipeline.srem(PROCESSING_KEY, notificationId);
    pipeline.del(`${PAYLOAD_PREFIX}${notificationId}`);
    await pipeline.exec();
  }

  async function deadLetterQueueSize(): Promise<number> {
    return redis.zcard(DLQ_KEY);
  }

  async function peekDeadLetterQueue(limit: number): Promise<QueueItem[]> {
    const results = await redis.zrange(DLQ_KEY, 0, limit - 1);
    const items: QueueItem[] = [];

    for (const raw of results) {
      const parsed = JSON.parse(raw) as {
        notificationId: string;
        priority: NotificationPriority;
        enqueuedAt: number;
      };
      const payload = (await redis.get(`${PAYLOAD_PREFIX}${parsed.notificationId}:dlq`)) ?? '';

      items.push({
        notificationId: parsed.notificationId,
        priority: parsed.priority,
        payload,
        enqueuedAt: parsed.enqueuedAt,
      });
    }

    return items;
  }

  return {
    enqueue,
    dequeue,
    peek,
    size,
    acknowledge,
    moveToDeadLetterQueue,
    deadLetterQueueSize,
    peekDeadLetterQueue,
  };
}
