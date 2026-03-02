/**
 * Property-Based Tests — Notification Queue Delivery Guarantee
 *
 * **Property 1: Notification Delivery Guarantee**
 * For any notification request with valid user and template, the notification
 * SHALL be persisted to the queue before returning success, ensuring no
 * notification loss.
 *
 * **Validates: Requirements 6.1, 6.2**
 *
 * @module notifications/services/notificationQueue.property.test
 */

import * as fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';

import { createMockRedis } from '../test/index.js';
import type { MockRedis } from '../test/index.js';
import type { NotificationPriority } from '../types/index.js';

import { createNotificationQueue } from './notificationQueue.js';
import type { NotificationQueue } from './notificationQueue.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const arbPriority = fc.constantFrom<NotificationPriority>('critical', 'high', 'normal', 'low');

const arbNotification = fc.record({
  id: fc.string({ minLength: 1, maxLength: 64 }),
  priority: arbPriority,
  payload: fc.string(),
});

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('NotificationQueue — Property 1: Delivery Guarantee', () => {
  let redis: MockRedis;
  let queue: NotificationQueue;

  beforeEach(() => {
    redis = createMockRedis();
    queue = createNotificationQueue(redis as never);
  });

  /**
   * **Validates: Requirements 6.1, 6.2**
   *
   * For any valid notification, after enqueue the queue size increases by 1.
   * This ensures every notification is persisted to the queue.
   */
  it('enqueue always increases queue size by exactly 1', async () => {
    await fc.assert(
      fc.asyncProperty(arbNotification, async ({ id, priority, payload }) => {
        const sizeBefore = await queue.size();
        await queue.enqueue(id, priority, payload);
        const sizeAfter = await queue.size();

        expect(sizeAfter).toBe(sizeBefore + 1);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.1, 6.2**
   *
   * For any valid notification, after enqueue the notification can be dequeued.
   * This guarantees no notification loss — everything enqueued is retrievable.
   */
  it('enqueued notification can always be dequeued (no loss)', async () => {
    await fc.assert(
      fc.asyncProperty(arbNotification, async ({ id, priority, payload }) => {
        // Fresh queue per run to isolate
        redis.clear();
        queue = createNotificationQueue(redis as never);

        await queue.enqueue(id, priority, payload);
        const item = await queue.dequeue();

        expect(item).not.toBeNull();
        expect(item!.notificationId).toBe(id);
        expect(item!.priority).toBe(priority);
        expect(item!.payload).toBe(payload);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.1, 6.2, 6.4**
   *
   * Priority ordering is maintained: items with higher priority (lower score)
   * are dequeued before items with lower priority.
   */
  it('dequeue respects priority ordering (critical before low)', async () => {
    const priorities: NotificationPriority[] = ['critical', 'high', 'normal', 'low'];
    const priorityOrder: Record<NotificationPriority, number> = {
      critical: 0,
      high: 1,
      normal: 2,
      low: 3,
    };

    await fc.assert(
      fc.asyncProperty(
        fc.shuffledSubarray(priorities, { minLength: 2, maxLength: 4 }),
        async (shuffledPriorities) => {
          redis.clear();
          queue = createNotificationQueue(redis as never);

          // Enqueue in shuffled order
          for (let i = 0; i < shuffledPriorities.length; i++) {
            await queue.enqueue(`notif-${i}`, shuffledPriorities[i], `payload-${i}`);
          }

          // Dequeue all and verify ordering
          const dequeued: NotificationPriority[] = [];
          for (let i = 0; i < shuffledPriorities.length; i++) {
            const item = await queue.dequeue();
            expect(item).not.toBeNull();
            dequeued.push(item!.priority);
          }

          // Each dequeued priority should have a score <= the next one
          for (let i = 0; i < dequeued.length - 1; i++) {
            expect(priorityOrder[dequeued[i]]).toBeLessThanOrEqual(priorityOrder[dequeued[i + 1]]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.1, 6.2**
   *
   * After enqueue, peek returns the item without removing it from the queue.
   * This confirms persistence — the item remains available after inspection.
   */
  it('peek returns enqueued item without removing it', async () => {
    await fc.assert(
      fc.asyncProperty(arbNotification, async ({ id, priority, payload }) => {
        redis.clear();
        queue = createNotificationQueue(redis as never);

        await queue.enqueue(id, priority, payload);

        const peeked = await queue.peek();
        expect(peeked).not.toBeNull();
        expect(peeked!.notificationId).toBe(id);
        expect(peeked!.payload).toBe(payload);

        // Queue size should still be 1 (peek doesn't remove)
        const sizeAfterPeek = await queue.size();
        expect(sizeAfterPeek).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});
