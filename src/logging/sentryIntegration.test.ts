/**
 * Unit tests for the Sentry integration.
 *
 * Tests severity mapping, event formatting, DSN validation, adapter lifecycle,
 * and integration with the error tracker's onError callback.
 *
 * Requirements: 5.6 (integrate with error tracking service - Sentry)
 *
 * @module logging/sentryIntegration.test
 */

import { describe, it, expect } from 'vitest';
import {
  mapSeverity,
  formatSentryEvent,
  isValidDsn,
  createSentryAdapter,
  createInMemoryTransport,
  type SentryConfig,
  type SentryEvent,
} from './sentryIntegration.js';
import { createErrorTracker, type TrackedError, type ErrorSeverity } from './errorTracker.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeTrackedError(overrides: Partial<TrackedError> = {}): TrackedError {
  return {
    fingerprint: 'abc123def456',
    name: 'TypeError',
    message: 'Cannot read property of undefined',
    stack: 'TypeError: Cannot read property of undefined\n    at handler (app.ts:42:5)',
    severity: 'high',
    count: 3,
    firstOccurrence: new Date('2024-01-01T00:00:00Z'),
    lastOccurrence: new Date('2024-01-02T12:00:00Z'),
    lastContext: undefined,
    ...overrides,
  };
}

const validConfig: SentryConfig = {
  dsn: 'https://key123@sentry.example.com/42',
  environment: 'production',
  release: 'cashtrace@1.2.3',
};

// ─── mapSeverity ───────────────────────────────────────────────────────────

describe('mapSeverity', () => {
  it('should map critical to fatal', () => {
    expect(mapSeverity('critical')).toBe('fatal');
  });

  it('should map high to error', () => {
    expect(mapSeverity('high')).toBe('error');
  });

  it('should map medium to warning', () => {
    expect(mapSeverity('medium')).toBe('warning');
  });

  it('should map low to info', () => {
    expect(mapSeverity('low')).toBe('info');
  });
});

// ─── formatSentryEvent ─────────────────────────────────────────────────────

describe('formatSentryEvent', () => {
  it('should format a basic tracked error into a Sentry event', () => {
    const tracked = makeTrackedError();
    const event = formatSentryEvent(tracked, validConfig);

    expect(event.message).toBe('Cannot read property of undefined');
    expect(event.level).toBe('error');
    expect(event.fingerprint).toEqual(['abc123def456']);
    expect(event.errorType).toBe('TypeError');
    expect(event.stackTrace).toContain('at handler (app.ts:42:5)');
    expect(event.environment).toBe('production');
    expect(event.release).toBe('cashtrace@1.2.3');
    expect(event.timestamp).toBe('2024-01-02T12:00:00.000Z');
  });

  it('should include count and occurrence times in extra', () => {
    const tracked = makeTrackedError({ count: 7 });
    const event = formatSentryEvent(tracked, validConfig);

    expect(event.extra['count']).toBe(7);
    expect(event.extra['firstOccurrence']).toBe('2024-01-01T00:00:00.000Z');
    expect(event.extra['lastOccurrence']).toBe('2024-01-02T12:00:00.000Z');
  });

  it('should include context fields as tags', () => {
    const tracked = makeTrackedError({
      lastContext: {
        correlationId: 'corr-abc',
        userId: 'user-42',
        businessId: 'biz-99',
        service: 'payment-service',
        operation: 'processPayment',
      },
    });
    const event = formatSentryEvent(tracked, validConfig);

    expect(event.tags['correlationId']).toBe('corr-abc');
    expect(event.tags['userId']).toBe('user-42');
    expect(event.tags['businessId']).toBe('biz-99');
    expect(event.tags['service']).toBe('payment-service');
    expect(event.tags['operation']).toBe('processPayment');
  });

  it('should include request context in extra', () => {
    const tracked = makeTrackedError({
      lastContext: {
        request: {
          method: 'POST',
          path: '/api/transactions',
          ip: '10.0.0.1',
        },
      },
    });
    const event = formatSentryEvent(tracked, validConfig);

    expect(event.extra['request']).toEqual({
      method: 'POST',
      path: '/api/transactions',
      ip: '10.0.0.1',
    });
  });

  it('should handle tracked error with no context', () => {
    const tracked = makeTrackedError({ lastContext: undefined });
    const event = formatSentryEvent(tracked, validConfig);

    expect(event.tags['correlationId']).toBeUndefined();
    expect(event.tags['userId']).toBeUndefined();
    expect(event.extra['request']).toBeUndefined();
  });

  it('should omit release from event when not configured', () => {
    const configNoRelease: SentryConfig = {
      dsn: 'https://key@sentry.example.com/1',
      environment: 'staging',
    };
    const event = formatSentryEvent(makeTrackedError(), configNoRelease);
    expect(event.release).toBeUndefined();
  });

  it('should always include errorType and severity in tags', () => {
    const tracked = makeTrackedError({ name: 'RangeError', severity: 'critical' });
    const event = formatSentryEvent(tracked, validConfig);

    expect(event.tags['errorType']).toBe('RangeError');
    expect(event.tags['severity']).toBe('critical');
  });
});

// ─── isValidDsn ────────────────────────────────────────────────────────────

describe('isValidDsn', () => {
  it('should accept a valid HTTPS DSN', () => {
    expect(isValidDsn('https://key123@sentry.example.com/42')).toBe(true);
  });

  it('should accept a valid HTTP DSN', () => {
    expect(isValidDsn('http://key123@localhost:9000/1')).toBe(true);
  });

  it('should reject a DSN without a key (username)', () => {
    expect(isValidDsn('https://sentry.example.com/42')).toBe(false);
  });

  it('should reject a DSN without a project path', () => {
    expect(isValidDsn('https://key@sentry.example.com/')).toBe(false);
  });

  it('should reject an empty string', () => {
    expect(isValidDsn('')).toBe(false);
  });

  it('should reject a non-URL string', () => {
    expect(isValidDsn('not-a-url')).toBe(false);
  });
});

// ─── createInMemoryTransport ───────────────────────────────────────────────

describe('createInMemoryTransport', () => {
  it('should store sent events', () => {
    const transport = createInMemoryTransport();
    const event = formatSentryEvent(makeTrackedError(), validConfig);

    const result = transport.sendEvent(event);

    expect(result).toBe(true);
    expect(transport.events).toHaveLength(1);
    expect(transport.events[0]).toBe(event);
  });

  it('should accumulate multiple events', () => {
    const transport = createInMemoryTransport();

    transport.sendEvent(formatSentryEvent(makeTrackedError({ message: 'err1' }), validConfig));
    transport.sendEvent(formatSentryEvent(makeTrackedError({ message: 'err2' }), validConfig));

    expect(transport.events).toHaveLength(2);
  });
});

// ─── createSentryAdapter ───────────────────────────────────────────────────

describe('createSentryAdapter', () => {
  it('should throw on invalid DSN', () => {
    const transport = createInMemoryTransport();
    expect(() => createSentryAdapter({ dsn: 'bad', environment: 'test' }, transport)).toThrow(
      'Invalid Sentry DSN',
    );
  });

  it('should expose config and enabled state', () => {
    const transport = createInMemoryTransport();
    const adapter = createSentryAdapter(validConfig, transport);

    expect(adapter.config).toEqual(validConfig);
    expect(adapter.enabled).toBe(true);
  });

  it('should be disabled when config.enabled is false', () => {
    const transport = createInMemoryTransport();
    const adapter = createSentryAdapter({ ...validConfig, enabled: false }, transport);

    expect(adapter.enabled).toBe(false);
  });

  it('should format and send errors via transport', () => {
    const transport = createInMemoryTransport();
    const adapter = createSentryAdapter(validConfig, transport);
    const tracked = makeTrackedError();

    const event = adapter.handleError(tracked);

    expect(event).not.toBeNull();
    expect(event!.message).toBe(tracked.message);
    expect(transport.events).toHaveLength(1);
  });

  it('should return null and not send when disabled', () => {
    const transport = createInMemoryTransport();
    const adapter = createSentryAdapter({ ...validConfig, enabled: false }, transport);

    const event = adapter.handleError(makeTrackedError());

    expect(event).toBeNull();
    expect(transport.events).toHaveLength(0);
  });

  it('should work as an onError callback for the error tracker', () => {
    const transport = createInMemoryTransport();
    const adapter = createSentryAdapter(validConfig, transport);

    const tracker = createErrorTracker({
      onError: (tracked) => adapter.handleError(tracked),
    });

    const err = new Error('integration test');
    err.stack = 'Error: integration test\n    at test (test.ts:1:1)';
    tracker.capture(err, {
      correlationId: 'req-123',
      userId: 'user-1',
      service: 'api',
    });

    expect(transport.events).toHaveLength(1);
    const sentEvent = transport.events[0]!;
    expect(sentEvent.message).toBe('integration test');
    expect(sentEvent.tags['correlationId']).toBe('req-123');
    expect(sentEvent.tags['userId']).toBe('user-1');
    expect(sentEvent.tags['service']).toBe('api');
    expect(sentEvent.environment).toBe('production');
    expect(sentEvent.release).toBe('cashtrace@1.2.3');
  });

  it('should send updated events when the same error is captured multiple times', () => {
    const transport = createInMemoryTransport();
    const adapter = createSentryAdapter(validConfig, transport);

    const tracker = createErrorTracker({
      onError: (tracked) => adapter.handleError(tracked),
    });

    const stack = 'Error: repeated\n    at fn (file.ts:5:3)';
    const err1 = new Error('repeated');
    err1.stack = stack;
    const err2 = new Error('repeated');
    err2.stack = stack;

    tracker.capture(err1, { userId: 'user-A' });
    tracker.capture(err2, { userId: 'user-B' });

    expect(transport.events).toHaveLength(2);
    // Second event should reflect updated count and context
    expect(transport.events[1]!.extra['count']).toBe(2);
    expect(transport.events[1]!.tags['userId']).toBe('user-B');
  });
});
