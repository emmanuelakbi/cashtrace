/**
 * Property-based tests for GeminiLogger correlation ID presence.
 *
 * **Property 25: Correlation ID Presence**
 * For any sequence of log calls with any log level, every stored log entry
 * SHALL include the exact correlation ID that was passed to the log method.
 *
 * **Validates: Requirements 12.5**
 *
 * @module gemini-integration/monitoring/logger.property.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';

import { GeminiLogger } from './logger.js';
import type { LogLevel } from './logger.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const logLevelArb: fc.Arbitrary<LogLevel> = fc.constantFrom('debug', 'info', 'warn', 'error');

const correlationIdArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split('')),
  { minLength: 1, maxLength: 64 },
);

const messageArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 200 });

const contextArb: fc.Arbitrary<Record<string, unknown> | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.dictionary(
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.oneof(fc.string(), fc.integer(), fc.boolean()),
    { minKeys: 1, maxKeys: 5 },
  ),
);

interface LogCall {
  level: LogLevel;
  message: string;
  correlationId: string;
  context: Record<string, unknown> | undefined;
}

const logCallArb: fc.Arbitrary<LogCall> = fc.record({
  level: logLevelArb,
  message: messageArb,
  correlationId: correlationIdArb,
  context: contextArb,
});

const logCallListArb: fc.Arbitrary<LogCall[]> = fc.array(logCallArb, {
  minLength: 1,
  maxLength: 30,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function executeLogCall(logger: GeminiLogger, call: LogCall): void {
  switch (call.level) {
    case 'debug':
      logger.debug(call.message, call.correlationId, call.context);
      break;
    case 'info':
      logger.info(call.message, call.correlationId, call.context);
      break;
    case 'warn':
      logger.warn(call.message, call.correlationId, call.context);
      break;
    case 'error':
      logger.error(call.message, call.correlationId, call.context);
      break;
  }
}

// ─── Property 25: Correlation ID Presence ────────────────────────────────────

describe('Property 25: Correlation ID Presence', () => {
  let logger: GeminiLogger;

  beforeEach(() => {
    logger = new GeminiLogger({ level: 'debug', redactPii: false });
  });

  /**
   * **Validates: Requirements 12.5**
   *
   * For any single log call at any level, the stored entry SHALL include
   * the exact correlation ID that was passed.
   */
  it('should include the exact correlation ID on every individual log entry', () => {
    fc.assert(
      fc.property(logCallArb, (call) => {
        logger.clear();
        executeLogCall(logger, call);

        const entries = logger.getEntries();
        expect(entries).toHaveLength(1);
        expect(entries[0].correlationId).toBe(call.correlationId);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 12.5**
   *
   * For any sequence of log calls, every stored entry SHALL include
   * the exact correlation ID that was passed to its corresponding call.
   */
  it('should preserve correlation IDs across a sequence of log calls', () => {
    fc.assert(
      fc.property(logCallListArb, (calls) => {
        logger.clear();
        for (const call of calls) {
          executeLogCall(logger, call);
        }

        const entries = logger.getEntries();
        expect(entries).toHaveLength(calls.length);

        for (let i = 0; i < calls.length; i++) {
          expect(entries[i].correlationId).toBe(calls[i].correlationId);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 12.5**
   *
   * For any log entry, the correlationId field SHALL be a non-empty string.
   */
  it('should always store a non-empty correlationId', () => {
    fc.assert(
      fc.property(logCallArb, (call) => {
        logger.clear();
        executeLogCall(logger, call);

        const entries = logger.getEntries();
        expect(entries).toHaveLength(1);
        expect(typeof entries[0].correlationId).toBe('string');
        expect(entries[0].correlationId.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 12.5**
   *
   * Correlation ID presence SHALL hold regardless of PII redaction setting.
   */
  it('should include correlation ID with PII redaction enabled', () => {
    const redactingLogger = new GeminiLogger({ level: 'debug', redactPii: true });

    fc.assert(
      fc.property(logCallArb, (call) => {
        redactingLogger.clear();
        executeLogCall(redactingLogger, call);

        const entries = redactingLogger.getEntries();
        expect(entries).toHaveLength(1);
        expect(entries[0].correlationId).toBe(call.correlationId);
      }),
      { numRuns: 100 },
    );
  });
});
