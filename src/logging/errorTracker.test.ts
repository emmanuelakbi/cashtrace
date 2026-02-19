/**
 * Unit tests for the error tracker.
 *
 * Tests error capture with full stack traces, error grouping by fingerprint,
 * occurrence tracking, severity classification, and query methods.
 *
 * Requirements: 5.1 (capture unhandled exceptions with full stack traces),
 *               5.2 (group similar errors to reduce noise),
 *               5.4 (track error frequency and first/last occurrence),
 *               5.5 (support error severity classification)
 *
 * @module logging/errorTracker.test
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createErrorTracker,
  generateFingerprint,
  extractFirstStackFrame,
  extractRequestContext,
  type ErrorSeverity,
  type TrackedError,
  type RequestContext,
} from './errorTracker.js';

// ─── Helper ────────────────────────────────────────────────────────────────

function makeError(message: string, name = 'Error'): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

// ─── extractFirstStackFrame ────────────────────────────────────────────────

describe('extractFirstStackFrame', () => {
  it('should extract the first "at" line from a stack trace', () => {
    const stack = 'Error: boom\n    at foo (file.ts:10:5)\n    at bar (file.ts:20:3)';
    expect(extractFirstStackFrame(stack)).toBe('at foo (file.ts:10:5)');
  });

  it('should return empty string when no stack frames exist', () => {
    expect(extractFirstStackFrame('Error: boom')).toBe('');
    expect(extractFirstStackFrame('')).toBe('');
  });
});

// ─── generateFingerprint ───────────────────────────────────────────────────

describe('generateFingerprint', () => {
  it('should return a 16-character hex string', () => {
    const fp = generateFingerprint(makeError('test'));
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should produce the same fingerprint for identical errors', () => {
    const err1 = new Error('same message');
    const err2 = new Error('same message');
    // Force identical stacks for determinism
    const stack = 'Error: same message\n    at test (file.ts:1:1)';
    err1.stack = stack;
    err2.stack = stack;
    expect(generateFingerprint(err1)).toBe(generateFingerprint(err2));
  });

  it('should produce different fingerprints for different messages', () => {
    const err1 = new Error('message A');
    const err2 = new Error('message B');
    err1.stack = 'Error: message A\n    at test (file.ts:1:1)';
    err2.stack = 'Error: message B\n    at test (file.ts:1:1)';
    expect(generateFingerprint(err1)).not.toBe(generateFingerprint(err2));
  });

  it('should produce different fingerprints for different error types', () => {
    const err1 = makeError('boom', 'TypeError');
    const err2 = makeError('boom', 'RangeError');
    err1.stack = 'TypeError: boom\n    at test (file.ts:1:1)';
    err2.stack = 'RangeError: boom\n    at test (file.ts:1:1)';
    expect(generateFingerprint(err1)).not.toBe(generateFingerprint(err2));
  });

  it('should handle errors without a stack trace', () => {
    const err = makeError('no stack');
    err.stack = undefined;
    const fp = generateFingerprint(err);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ─── createErrorTracker ────────────────────────────────────────────────────

describe('createErrorTracker', () => {
  // ─── Capture ─────────────────────────────────────────────────────────

  describe('capture', () => {
    it('should capture an error with full stack trace (Req 5.1)', () => {
      const tracker = createErrorTracker();
      const err = makeError('unhandled');
      const tracked = tracker.capture(err);

      expect(tracked.name).toBe('Error');
      expect(tracked.message).toBe('unhandled');
      expect(tracked.stack).toBe(err.stack);
      expect(tracked.count).toBe(1);
    });

    it('should store context with the captured error', () => {
      const tracker = createErrorTracker();
      const ctx = { correlationId: 'abc-123', userId: 'user-1' };
      const tracked = tracker.capture(makeError('ctx test'), ctx);

      expect(tracked.lastContext).toEqual(ctx);
    });

    it('should assign default severity when none specified', () => {
      const tracker = createErrorTracker({ defaultSeverity: 'high' });
      const tracked = tracker.capture(makeError('default sev'));
      expect(tracked.severity).toBe('high');
    });

    it('should use explicit severity over default', () => {
      const tracker = createErrorTracker({ defaultSeverity: 'low' });
      const tracked = tracker.capture(makeError('explicit'), undefined, 'critical');
      expect(tracked.severity).toBe('critical');
    });

    it('should use custom severity classifier when provided (Req 5.5)', () => {
      const classifier = (err: Error): ErrorSeverity =>
        err.name === 'TypeError' ? 'critical' : 'low';
      const tracker = createErrorTracker({ severityClassifier: classifier });

      const typeErr = makeError('bad type', 'TypeError');
      const genericErr = makeError('generic');

      expect(tracker.capture(typeErr).severity).toBe('critical');
      expect(tracker.capture(genericErr).severity).toBe('low');
    });

    it('should prefer explicit severity over classifier', () => {
      const classifier = (_err: Error): ErrorSeverity => 'critical';
      const tracker = createErrorTracker({ severityClassifier: classifier });
      const tracked = tracker.capture(makeError('test'), undefined, 'low');
      expect(tracked.severity).toBe('low');
    });

    it('should invoke onError callback when an error is captured', () => {
      const onError = vi.fn();
      const tracker = createErrorTracker({ onError });
      tracker.capture(makeError('callback test'));
      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0]![0]!.message).toBe('callback test');
    });
  });

  // ─── Grouping (Req 5.2) ─────────────────────────────────────────────

  describe('grouping', () => {
    it('should group identical errors under the same fingerprint', () => {
      const tracker = createErrorTracker();
      const stack = 'Error: dup\n    at fn (file.ts:5:3)';
      const err1 = makeError('dup');
      err1.stack = stack;
      const err2 = makeError('dup');
      err2.stack = stack;

      tracker.capture(err1);
      tracker.capture(err2);

      expect(tracker.size).toBe(1);
      const all = tracker.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]!.count).toBe(2);
    });

    it('should not group errors with different messages', () => {
      const tracker = createErrorTracker();
      tracker.capture(makeError('error A'));
      tracker.capture(makeError('error B'));
      expect(tracker.size).toBe(2);
    });

    it('should update lastContext on subsequent captures of the same error', () => {
      const tracker = createErrorTracker();
      const stack = 'Error: ctx\n    at fn (file.ts:1:1)';
      const err1 = makeError('ctx');
      err1.stack = stack;
      const err2 = makeError('ctx');
      err2.stack = stack;

      tracker.capture(err1, { userId: 'first' });
      tracker.capture(err2, { userId: 'second' });

      const all = tracker.getAll();
      expect(all[0]!.lastContext).toEqual({ userId: 'second' });
    });
  });

  // ─── Occurrence Tracking (Req 5.4) ──────────────────────────────────

  describe('occurrence tracking', () => {
    it('should track firstOccurrence and lastOccurrence', () => {
      const tracker = createErrorTracker();
      const stack = 'Error: time\n    at fn (file.ts:1:1)';
      const err1 = makeError('time');
      err1.stack = stack;

      const tracked1 = tracker.capture(err1);
      const firstTime = tracked1.firstOccurrence;

      const err2 = makeError('time');
      err2.stack = stack;
      const tracked2 = tracker.capture(err2);

      expect(tracked2.firstOccurrence).toBe(firstTime);
      expect(tracked2.lastOccurrence.getTime()).toBeGreaterThanOrEqual(firstTime.getTime());
    });

    it('should increment count on repeated captures', () => {
      const tracker = createErrorTracker();
      const stack = 'Error: repeat\n    at fn (file.ts:1:1)';

      for (let i = 0; i < 5; i++) {
        const err = makeError('repeat');
        err.stack = stack;
        tracker.capture(err);
      }

      expect(tracker.getAll()[0]!.count).toBe(5);
    });
  });

  // ─── Query Methods ──────────────────────────────────────────────────

  describe('query methods', () => {
    function seedTracker() {
      const tracker = createErrorTracker();
      const critErr = makeError('critical fail', 'TypeError');
      critErr.stack = 'TypeError: critical fail\n    at a (a.ts:1:1)';
      const highErr = makeError('high fail');
      highErr.stack = 'Error: high fail\n    at b (b.ts:1:1)';
      const lowErr = makeError('low fail');
      lowErr.stack = 'Error: low fail\n    at c (c.ts:1:1)';

      tracker.capture(critErr, undefined, 'critical');
      // Capture highErr 3 times
      for (let i = 0; i < 3; i++) {
        const e = makeError('high fail');
        e.stack = highErr.stack;
        tracker.capture(e, undefined, 'high');
      }
      tracker.capture(lowErr, undefined, 'low');

      return tracker;
    }

    it('get() should return a tracked error by fingerprint', () => {
      const tracker = createErrorTracker();
      const err = makeError('lookup');
      const tracked = tracker.capture(err);
      expect(tracker.get(tracked.fingerprint)).toBe(tracked);
    });

    it('get() should return undefined for unknown fingerprint', () => {
      const tracker = createErrorTracker();
      expect(tracker.get('nonexistent')).toBeUndefined();
    });

    it('getAll() should return all tracked error groups', () => {
      const tracker = seedTracker();
      expect(tracker.getAll()).toHaveLength(3);
    });

    it('getBySeverity() should filter by severity level', () => {
      const tracker = seedTracker();
      expect(tracker.getBySeverity('critical')).toHaveLength(1);
      expect(tracker.getBySeverity('high')).toHaveLength(1);
      expect(tracker.getBySeverity('low')).toHaveLength(1);
      expect(tracker.getBySeverity('medium')).toHaveLength(0);
    });

    it('getTopErrors() should return errors sorted by count descending', () => {
      const tracker = seedTracker();
      const top = tracker.getTopErrors(2);
      expect(top).toHaveLength(2);
      expect(top[0]!.count).toBe(3); // highErr captured 3 times
      expect(top[1]!.count).toBe(1);
    });

    it('getTopErrors() should handle limit larger than size', () => {
      const tracker = seedTracker();
      const top = tracker.getTopErrors(100);
      expect(top).toHaveLength(3);
    });
  });

  // ─── Capacity Management ────────────────────────────────────────────

  describe('capacity management', () => {
    it('should evict the oldest error group when maxGroups is reached', () => {
      const tracker = createErrorTracker({ maxGroups: 2 });

      const err1 = makeError('first');
      err1.stack = 'Error: first\n    at a (a.ts:1:1)';
      const err2 = makeError('second');
      err2.stack = 'Error: second\n    at b (b.ts:1:1)';
      const err3 = makeError('third');
      err3.stack = 'Error: third\n    at c (c.ts:1:1)';

      const tracked1 = tracker.capture(err1);
      tracker.capture(err2);

      expect(tracker.size).toBe(2);

      tracker.capture(err3);

      expect(tracker.size).toBe(2);
      // The oldest (first) should have been evicted
      expect(tracker.get(tracked1.fingerprint)).toBeUndefined();
    });
  });

  // ─── Clear ──────────────────────────────────────────────────────────

  describe('clear', () => {
    it('should remove all tracked errors', () => {
      const tracker = createErrorTracker();
      tracker.capture(makeError('a'));
      tracker.capture(makeError('b'));
      expect(tracker.size).toBe(2);

      tracker.clear();
      expect(tracker.size).toBe(0);
      expect(tracker.getAll()).toHaveLength(0);
    });
  });

  // ─── Request Context (Req 5.3) ─────────────────────────────────────

  describe('request context', () => {
    it('should store request context with captured error', () => {
      const tracker = createErrorTracker();
      const ctx = {
        correlationId: 'req-1',
        userId: 'user-1',
        request: {
          method: 'POST',
          path: '/api/transactions',
          ip: '192.168.1.1',
          query: { page: '1' },
        } satisfies RequestContext,
      };
      const tracked = tracker.capture(makeError('request fail'), ctx);

      expect(tracked.lastContext?.request).toBeDefined();
      expect(tracked.lastContext!.request!.method).toBe('POST');
      expect(tracked.lastContext!.request!.path).toBe('/api/transactions');
      expect(tracked.lastContext!.request!.ip).toBe('192.168.1.1');
      expect(tracked.lastContext!.request!.query).toEqual({ page: '1' });
    });

    it('should update request context on subsequent captures of the same error', () => {
      const tracker = createErrorTracker();
      const stack = 'Error: ctx\n    at fn (file.ts:1:1)';

      const err1 = makeError('ctx');
      err1.stack = stack;
      tracker.capture(err1, {
        correlationId: 'req-1',
        request: { method: 'GET', path: '/old' },
      });

      const err2 = makeError('ctx');
      err2.stack = stack;
      tracker.capture(err2, {
        correlationId: 'req-2',
        request: { method: 'POST', path: '/new' },
      });

      const all = tracker.getAll();
      expect(all[0]!.lastContext!.request!.method).toBe('POST');
      expect(all[0]!.lastContext!.request!.path).toBe('/new');
      expect(all[0]!.lastContext!.correlationId).toBe('req-2');
    });
  });

  // ─── Context-Based Queries (Req 5.3, 5.4) ──────────────────────────

  describe('context-based queries', () => {
    function seedTrackerWithContext() {
      const tracker = createErrorTracker();

      const err1 = makeError('auth fail');
      err1.stack = 'Error: auth fail\n    at a (a.ts:1:1)';
      tracker.capture(err1, { correlationId: 'corr-1', userId: 'user-A' });

      const err2 = makeError('db timeout');
      err2.stack = 'Error: db timeout\n    at b (b.ts:1:1)';
      tracker.capture(err2, { correlationId: 'corr-2', userId: 'user-A' });

      const err3 = makeError('not found');
      err3.stack = 'Error: not found\n    at c (c.ts:1:1)';
      tracker.capture(err3, { correlationId: 'corr-3', userId: 'user-B' });

      return tracker;
    }

    it('getByCorrelationId() should return errors matching the correlationId', () => {
      const tracker = seedTrackerWithContext();
      const results = tracker.getByCorrelationId('corr-1');
      expect(results).toHaveLength(1);
      expect(results[0]!.message).toBe('auth fail');
    });

    it('getByCorrelationId() should return empty array for unknown correlationId', () => {
      const tracker = seedTrackerWithContext();
      expect(tracker.getByCorrelationId('nonexistent')).toHaveLength(0);
    });

    it('getByUserId() should return all errors for a given user', () => {
      const tracker = seedTrackerWithContext();
      const results = tracker.getByUserId('user-A');
      expect(results).toHaveLength(2);
      const messages = results.map((e) => e.message).sort();
      expect(messages).toEqual(['auth fail', 'db timeout']);
    });

    it('getByUserId() should return empty array for unknown userId', () => {
      const tracker = seedTrackerWithContext();
      expect(tracker.getByUserId('unknown')).toHaveLength(0);
    });

    it('getByTimeRange() should return errors within the specified range', () => {
      const tracker = createErrorTracker();
      const now = new Date();

      const err = makeError('timed error');
      err.stack = 'Error: timed error\n    at a (a.ts:1:1)';
      tracker.capture(err);

      const start = new Date(now.getTime() - 1000);
      const end = new Date(now.getTime() + 1000);
      expect(tracker.getByTimeRange(start, end)).toHaveLength(1);
    });

    it('getByTimeRange() should exclude errors outside the range', () => {
      const tracker = createErrorTracker();

      const err = makeError('old error');
      err.stack = 'Error: old error\n    at a (a.ts:1:1)';
      tracker.capture(err);

      const futureStart = new Date(Date.now() + 60_000);
      const futureEnd = new Date(Date.now() + 120_000);
      expect(tracker.getByTimeRange(futureStart, futureEnd)).toHaveLength(0);
    });
  });
});

// ─── extractRequestContext ─────────────────────────────────────────────────

describe('extractRequestContext', () => {
  it('should extract method, path, ip, and query from a request object', () => {
    const req = {
      method: 'GET',
      path: '/api/users',
      headers: { 'content-type': 'application/json', host: 'localhost' },
      query: { page: '1', limit: '10' },
      ip: '10.0.0.1',
    };

    const ctx = extractRequestContext(req);
    expect(ctx.method).toBe('GET');
    expect(ctx.path).toBe('/api/users');
    expect(ctx.ip).toBe('10.0.0.1');
    expect(ctx.query).toEqual({ page: '1', limit: '10' });
    expect(ctx.headers).toEqual({ 'content-type': 'application/json', host: 'localhost' });
  });

  it('should strip sensitive headers (authorization, cookie, x-api-key, x-auth-token)', () => {
    const req = {
      method: 'POST',
      path: '/api/login',
      headers: {
        authorization: 'Bearer secret-token',
        cookie: 'session=abc',
        'set-cookie': 'session=abc; HttpOnly',
        'x-api-key': 'my-key',
        'x-auth-token': 'my-token',
        'content-type': 'application/json',
      },
      query: {},
      ip: '127.0.0.1',
    };

    const ctx = extractRequestContext(req);
    expect(ctx.headers).toEqual({ 'content-type': 'application/json' });
    expect(ctx.headers!['authorization']).toBeUndefined();
    expect(ctx.headers!['cookie']).toBeUndefined();
    expect(ctx.headers!['set-cookie']).toBeUndefined();
    expect(ctx.headers!['x-api-key']).toBeUndefined();
    expect(ctx.headers!['x-auth-token']).toBeUndefined();
  });

  it('should handle case-insensitive sensitive header stripping', () => {
    const req = {
      method: 'GET',
      path: '/',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'text/html' },
      query: {},
    };

    const ctx = extractRequestContext(req);
    expect(ctx.headers!['authorization']).toBeUndefined();
    expect(ctx.headers!['content-type']).toBe('text/html');
  });

  it('should fall back to url when path is not available', () => {
    const req = {
      method: 'GET',
      url: '/fallback/path',
      headers: {},
      query: {},
    };

    const ctx = extractRequestContext(req);
    expect(ctx.path).toBe('/fallback/path');
  });

  it('should return undefined for headers and query when empty', () => {
    const req = {
      method: 'DELETE',
      path: '/api/resource/1',
      headers: {},
      query: {},
    };

    const ctx = extractRequestContext(req);
    expect(ctx.headers).toBeUndefined();
    expect(ctx.query).toBeUndefined();
  });

  it('should handle array header values by joining them', () => {
    const req = {
      method: 'GET',
      path: '/',
      headers: { accept: ['text/html', 'application/json'] as unknown as string },
      query: {},
    };

    const ctx = extractRequestContext(req);
    expect(ctx.headers!['accept']).toBe('text/html, application/json');
  });

  it('should handle missing optional fields gracefully', () => {
    const req = { method: 'GET' };
    const ctx = extractRequestContext(req);
    expect(ctx.method).toBe('GET');
    expect(ctx.path).toBeUndefined();
    expect(ctx.headers).toBeUndefined();
    expect(ctx.query).toBeUndefined();
    expect(ctx.ip).toBeUndefined();
  });

  it('should stringify non-string query values', () => {
    const req = {
      method: 'GET',
      path: '/search',
      headers: {},
      query: { page: 2, active: true },
    };

    const ctx = extractRequestContext(req);
    expect(ctx.query).toEqual({ page: '2', active: 'true' });
  });
});
