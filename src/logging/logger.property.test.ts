/**
 * Property-based tests for correlation ID propagation.
 *
 * **Property 2: Correlation ID Propagation**
 * For any request, the correlation ID SHALL be present in all log entries,
 * metrics, and traces for that request.
 *
 * **Validates: Requirements 1.4, 4.2**
 *
 * @module logging/logger.property.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { createLogger, type LogEntry, type LogOutput } from './logger.js';
import { logLevelArb, logContextArb } from '../test/arbitraries.js';

// ─── UUID v4 regex ───────────────────────────────────────────────────────────

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createCapture(): { entries: LogEntry[]; output: LogOutput } {
  const entries: LogEntry[] = [];
  const output: LogOutput = (entry) => entries.push(entry);
  return { entries, output };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Property 2: Correlation ID Propagation', () => {
  /**
   * **Validates: Requirements 1.4, 4.2**
   *
   * For any log context with a correlation ID, ALL log entries produced
   * by the logger SHALL contain that exact correlation ID.
   */
  it('should include the provided correlation ID in every log entry', () => {
    fc.assert(
      fc.property(
        logContextArb,
        logLevelArb,
        fc.string({ minLength: 1, maxLength: 100 }),
        (ctx, level, message) => {
          const { entries, output } = createCapture();
          const logger = createLogger({
            level: 'debug',
            debugSampleRate: 1,
            output,
            context: ctx,
          });

          // Log at the given level
          if (level === 'error' || level === 'fatal') {
            logger[level](message, undefined);
          } else {
            logger[level](message);
          }

          expect(entries).toHaveLength(1);
          expect(entries[0]!.correlationId).toBe(ctx.correlationId);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.4, 4.2**
   *
   * For any logger, the correlation ID SHALL be consistent across
   * multiple log calls from the same logger instance.
   */
  it('should use the same correlation ID across multiple log calls', () => {
    fc.assert(
      fc.property(
        logContextArb,
        fc.array(logLevelArb, { minLength: 2, maxLength: 10 }),
        (ctx, levels) => {
          const { entries, output } = createCapture();
          const logger = createLogger({
            level: 'debug',
            debugSampleRate: 1,
            output,
            context: ctx,
          });

          for (const level of levels) {
            if (level === 'error' || level === 'fatal') {
              logger[level](`msg-${level}`, undefined);
            } else {
              logger[level](`msg-${level}`);
            }
          }

          expect(entries.length).toBe(levels.length);
          for (const entry of entries) {
            expect(entry.correlationId).toBe(ctx.correlationId);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.4, 4.2**
   *
   * For any parent logger, child loggers SHALL inherit the parent's
   * correlation ID, and all entries from both parent and child SHALL
   * share the same correlation ID.
   */
  it('should propagate correlation ID from parent to child loggers', () => {
    fc.assert(
      fc.property(
        logContextArb,
        fc.record({
          userId: fc.uuid(),
          businessId: fc.uuid(),
          operation: fc.constantFrom('create', 'read', 'update', 'delete'),
        }),
        (parentCtx, childOverrides) => {
          const { entries, output } = createCapture();
          const parent = createLogger({
            level: 'debug',
            output,
            context: parentCtx,
          });
          const child = parent.child(childOverrides);

          parent.info('parent log');
          child.info('child log');

          expect(entries).toHaveLength(2);
          // Both entries must share the parent's correlation ID
          expect(entries[0]!.correlationId).toBe(parentCtx.correlationId);
          expect(entries[1]!.correlationId).toBe(parentCtx.correlationId);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.4, 4.2**
   *
   * For any logger hierarchy (parent → child → grandchild), the
   * correlation ID SHALL propagate through all levels.
   */
  it('should propagate correlation ID through multiple child levels', () => {
    fc.assert(
      fc.property(logContextArb, fc.integer({ min: 1, max: 5 }), (rootCtx, depth) => {
        const { entries, output } = createCapture();
        let current = createLogger({
          level: 'debug',
          output,
          context: rootCtx,
        });

        // Log from root
        current.info('root');

        // Create nested children and log from each
        for (let i = 0; i < depth; i++) {
          current = current.child({ operation: `op-${i}` });
          current.info(`child-${i}`);
        }

        expect(entries.length).toBe(depth + 1);
        for (const entry of entries) {
          expect(entry.correlationId).toBe(rootCtx.correlationId);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.4, 4.2**
   *
   * When no correlation ID is provided, the logger SHALL auto-generate
   * a valid UUID, and that UUID SHALL appear in all log entries.
   */
  it('should auto-generate a valid UUID correlation ID when none provided', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('api', 'worker', 'scheduler', 'auth'),
        fc.array(logLevelArb, { minLength: 1, maxLength: 5 }),
        (service, levels) => {
          const { entries, output } = createCapture();
          const logger = createLogger({
            service,
            level: 'debug',
            debugSampleRate: 1,
            output,
            // No correlationId provided
          });

          for (const level of levels) {
            if (level === 'error' || level === 'fatal') {
              logger[level]('msg', undefined);
            } else {
              logger[level]('msg');
            }
          }

          expect(entries.length).toBe(levels.length);

          // The auto-generated ID must be a valid UUID
          const autoId = entries[0]!.correlationId;
          expect(autoId).toMatch(UUID_V4_RE);

          // All entries must share the same auto-generated ID
          for (const entry of entries) {
            expect(entry.correlationId).toBe(autoId);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.4, 4.2**
   *
   * When no correlation ID is provided, child loggers SHALL inherit
   * the auto-generated UUID from the parent.
   */
  it('should propagate auto-generated correlation ID to child loggers', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('api', 'worker', 'scheduler'),
        fc.uuid(),
        fc.uuid(),
        (service, userId, businessId) => {
          const { entries, output } = createCapture();
          const parent = createLogger({
            service,
            level: 'debug',
            output,
          });
          const child = parent.child({ userId, businessId });

          parent.info('parent');
          child.info('child');

          expect(entries).toHaveLength(2);

          const parentCorrId = entries[0]!.correlationId;
          expect(parentCorrId).toMatch(UUID_V4_RE);
          expect(entries[1]!.correlationId).toBe(parentCorrId);
        },
      ),
      { numRuns: 100 },
    );
  });
});
