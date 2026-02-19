import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLogger, type LogEntry, type LogOutput, type LogLevel } from './logger.js';

describe('Logger', () => {
  let captured: LogEntry[];
  let output: LogOutput;

  beforeEach(() => {
    captured = [];
    output = (entry: LogEntry) => {
      captured.push(entry);
    };
  });

  // ─── JSON Structured Output (Req 1.1) ──────────────────────────────────

  describe('JSON structured output', () => {
    it('should produce valid JSON output via default stdout', () => {
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const logger = createLogger({ service: 'test-svc' });

      logger.info('hello');

      expect(writeSpy).toHaveBeenCalledOnce();
      const raw = writeSpy.mock.calls[0]![0] as string;
      const parsed = JSON.parse(raw.trim());
      expect(parsed).toHaveProperty('timestamp');
      expect(parsed).toHaveProperty('level', 'info');
      expect(parsed).toHaveProperty('message', 'hello');
      expect(parsed).toHaveProperty('service', 'test-svc');

      writeSpy.mockRestore();
    });

    it('should include all standard fields in log entry', () => {
      const logger = createLogger({
        service: 'api',
        output,
        context: { correlationId: 'corr-123', userId: 'u-1', businessId: 'b-1' },
      });

      logger.info('request received');

      expect(captured).toHaveLength(1);
      const entry = captured[0]!;
      expect(entry.timestamp).toBeTruthy();
      expect(entry.level).toBe('info');
      expect(entry.message).toBe('request received');
      expect(entry.service).toBe('api');
      expect(entry.correlationId).toBe('corr-123');
      expect(entry.userId).toBe('u-1');
      expect(entry.businessId).toBe('b-1');
    });

    it('should produce ISO 8601 timestamps', () => {
      const logger = createLogger({ output });
      logger.info('ts check');

      const ts = captured[0]!.timestamp;
      expect(() => new Date(ts)).not.toThrow();
      expect(new Date(ts).toISOString()).toBe(ts);
    });
  });

  // ─── Log Levels (Req 1.3) ──────────────────────────────────────────────

  describe('log levels', () => {
    it('should support all five log levels', () => {
      const logger = createLogger({ level: 'debug', output, debugSampleRate: 1.0 });

      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');
      logger.fatal('f');

      expect(captured.map((e) => e.level)).toEqual(['debug', 'info', 'warn', 'error', 'fatal']);
    });

    it('should filter logs below minimum level', () => {
      const logger = createLogger({ level: 'warn', output });

      logger.debug('nope');
      logger.info('nope');
      logger.warn('yes');
      logger.error('yes');
      logger.fatal('yes');

      expect(captured).toHaveLength(3);
      expect(captured.map((e) => e.level)).toEqual(['warn', 'error', 'fatal']);
    });

    it('should default to info level', () => {
      const logger = createLogger({ output });

      logger.debug('hidden');
      logger.info('visible');

      expect(captured).toHaveLength(1);
      expect(captured[0]!.level).toBe('info');
    });
  });

  // ─── Error Handling ──────────────────────────────────────────────────────

  describe('error logging', () => {
    it('should include error info for error level', () => {
      const logger = createLogger({ output });
      const err = new Error('something broke');

      logger.error('failure', err);

      const entry = captured[0]!;
      expect(entry.error).toBeDefined();
      expect(entry.error!.name).toBe('Error');
      expect(entry.error!.message).toBe('something broke');
      expect(entry.error!.stack).toBeTruthy();
    });

    it('should include error info for fatal level', () => {
      const logger = createLogger({ output });
      const err = new TypeError('type mismatch');

      logger.fatal('critical', err);

      const entry = captured[0]!;
      expect(entry.error!.name).toBe('TypeError');
      expect(entry.error!.message).toBe('type mismatch');
    });

    it('should handle error methods without an error object', () => {
      const logger = createLogger({ output });

      logger.error('no error obj');

      const entry = captured[0]!;
      expect(entry.error).toBeUndefined();
    });
  });

  // ─── Metadata ────────────────────────────────────────────────────────────

  describe('metadata', () => {
    it('should include metadata when provided', () => {
      const logger = createLogger({ output });

      logger.info('with meta', { requestId: 'r-1', duration: 42 });

      expect(captured[0]!.metadata).toEqual({ requestId: 'r-1', duration: 42 });
    });

    it('should omit metadata field when not provided', () => {
      const logger = createLogger({ output });

      logger.info('no meta');

      expect(captured[0]!.metadata).toBeUndefined();
    });

    it('should omit metadata field when empty object', () => {
      const logger = createLogger({ output });

      logger.info('empty meta', {});

      expect(captured[0]!.metadata).toBeUndefined();
    });

    it('should include both error and metadata for error/fatal', () => {
      const logger = createLogger({ output });
      const err = new Error('oops');

      logger.error('fail', err, { retryCount: 3 });

      const entry = captured[0]!;
      expect(entry.error).toBeDefined();
      expect(entry.metadata).toEqual({ retryCount: 3 });
    });
  });

  // ─── Child Logger ────────────────────────────────────────────────────────

  describe('child logger', () => {
    it('should inherit parent context', () => {
      const parent = createLogger({
        output,
        context: { correlationId: 'parent-corr', service: 'api' },
      });
      const child = parent.child({ userId: 'u-42' });

      child.info('from child');

      const entry = captured[0]!;
      expect(entry.correlationId).toBe('parent-corr');
      expect(entry.service).toBe('api');
      expect(entry.userId).toBe('u-42');
    });

    it('should override parent context fields', () => {
      const parent = createLogger({
        output,
        context: { correlationId: 'old', service: 'api' },
      });
      const child = parent.child({ correlationId: 'new' });

      child.info('overridden');

      expect(captured[0]!.correlationId).toBe('new');
    });

    it('should inherit parent log level', () => {
      const parent = createLogger({ level: 'warn', output });
      const child = parent.child({ userId: 'u-1' });

      child.debug('hidden');
      child.info('hidden');
      child.warn('visible');

      expect(captured).toHaveLength(1);
      expect(captured[0]!.level).toBe('warn');
    });

    it('should use parent output sink', () => {
      const parent = createLogger({ output });
      const child = parent.child({ businessId: 'b-1' });

      child.info('test');

      // captured array is populated, meaning the parent's output was used
      expect(captured).toHaveLength(1);
    });
  });

  // ─── Service Name (Req 1.2) ────────────────────────────────────────────

  describe('service name', () => {
    it('should default service to cashtrace', () => {
      const logger = createLogger({ output });

      logger.info('default svc');

      expect(captured[0]!.service).toBe('cashtrace');
    });

    it('should always include service name in log entries', () => {
      const logger = createLogger({ output });

      logger.info('check service');

      expect(captured[0]!.service).toBeTruthy();
    });

    it('should use context service over constructor service', () => {
      const logger = createLogger({
        service: 'fallback',
        output,
        context: { service: 'from-context' },
      });

      logger.info('test');

      expect(captured[0]!.service).toBe('from-context');
    });
  });

  // ─── Correlation ID (Req 1.2, 1.4) ─────────────────────────────────────

  describe('correlation ID', () => {
    it('should auto-generate a UUID correlation ID when none provided', () => {
      const logger = createLogger({ output });

      logger.info('auto corr');

      const corrId = captured[0]!.correlationId;
      expect(corrId).toBeTruthy();
      // UUID v4 format: 8-4-4-4-12 hex chars
      expect(corrId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should reuse the same auto-generated correlation ID across log calls', () => {
      const logger = createLogger({ output });

      logger.info('first');
      logger.info('second');

      expect(captured[0]!.correlationId).toBe(captured[1]!.correlationId);
    });

    it('should include correlation ID from context when explicitly provided', () => {
      const logger = createLogger({
        output,
        context: { correlationId: 'abc-123' },
      });

      logger.info('with corr');

      expect(captured[0]!.correlationId).toBe('abc-123');
    });

    it('should generate different correlation IDs for different loggers', () => {
      const logger1 = createLogger({ output });
      const logger2 = createLogger({ output });

      logger1.info('from 1');
      logger2.info('from 2');

      expect(captured[0]!.correlationId).not.toBe(captured[1]!.correlationId);
    });
  });

  // ─── Log Sampling (Req 1.5) ──────────────────────────────────────────────

  describe('debug log sampling', () => {
    it('should sample debug logs based on debugSampleRate', () => {
      let callIndex = 0;
      // Alternate: 0.05 (below 0.1 → emit), 0.95 (above 0.1 → drop)
      const randomFn = () => (callIndex++ % 2 === 0 ? 0.05 : 0.95);

      const logger = createLogger({
        level: 'debug',
        output,
        debugSampleRate: 0.1,
        randomFn,
      });

      for (let i = 0; i < 10; i++) {
        logger.debug(`msg-${i}`);
      }

      // 5 out of 10 should be emitted (even indices)
      expect(captured).toHaveLength(5);
      expect(captured.every((e) => e.level === 'debug')).toBe(true);
    });

    it('should always emit warn, error, and fatal regardless of sampling', () => {
      // randomFn always returns 1.0 → would drop all sampled logs
      const logger = createLogger({
        level: 'debug',
        output,
        debugSampleRate: 0.0,
        randomFn: () => 1.0,
      });

      logger.debug('dropped');
      logger.info('info msg');
      logger.warn('warning');
      logger.error('error');
      logger.fatal('fatal');

      expect(captured.map((e) => e.level)).toEqual(['info', 'warn', 'error', 'fatal']);
    });

    it('should emit all debug logs when debugSampleRate is 1.0', () => {
      const logger = createLogger({
        level: 'debug',
        output,
        debugSampleRate: 1.0,
        randomFn: () => 0.99,
      });

      for (let i = 0; i < 20; i++) {
        logger.debug(`msg-${i}`);
      }

      expect(captured).toHaveLength(20);
    });

    it('should drop all debug logs when debugSampleRate is 0.0', () => {
      const logger = createLogger({
        level: 'debug',
        output,
        debugSampleRate: 0.0,
        randomFn: () => 0.0,
      });

      for (let i = 0; i < 10; i++) {
        logger.debug(`msg-${i}`);
      }

      expect(captured).toHaveLength(0);
    });

    it('should default debugSampleRate to 0.1', () => {
      // randomFn returns 0.05 → always below 0.1 → always emit
      const logger = createLogger({
        level: 'debug',
        output,
        randomFn: () => 0.05,
      });

      logger.debug('sampled');

      expect(captured).toHaveLength(1);
    });

    it('should clamp debugSampleRate above 1.0 to 1.0', () => {
      const logger = createLogger({
        level: 'debug',
        output,
        debugSampleRate: 5.0,
        randomFn: () => 0.99,
      });

      logger.debug('should emit');

      expect(captured).toHaveLength(1);
    });

    it('should clamp negative debugSampleRate to 0.0', () => {
      const logger = createLogger({
        level: 'debug',
        output,
        debugSampleRate: -1.0,
        randomFn: () => 0.0,
      });

      logger.debug('should drop');

      expect(captured).toHaveLength(0);
    });

    it('should not sample info-level logs', () => {
      // randomFn returns 1.0 → would drop if sampled
      const logger = createLogger({
        level: 'debug',
        output,
        debugSampleRate: 0.0,
        randomFn: () => 1.0,
      });

      logger.info('always emitted');

      expect(captured).toHaveLength(1);
      expect(captured[0]!.level).toBe('info');
    });

    it('should propagate debugSampleRate to child loggers', () => {
      let callIndex = 0;
      const randomFn = () => (callIndex++ % 2 === 0 ? 0.05 : 0.95);

      const parent = createLogger({
        level: 'debug',
        output,
        debugSampleRate: 0.1,
        randomFn,
      });
      const child = parent.child({ userId: 'u-1' });

      child.debug('msg-0'); // 0.05 < 0.1 → emit
      child.debug('msg-1'); // 0.95 >= 0.1 → drop
      child.debug('msg-2'); // 0.05 < 0.1 → emit

      expect(captured).toHaveLength(2);
    });
  });

  // ─── Child Logger Context Propagation (Req 1.4) ──────────────────────────

  describe('child logger context propagation', () => {
    it('should propagate auto-generated correlation ID to child loggers', () => {
      const parent = createLogger({ output });
      const child = parent.child({ userId: 'u-1' });

      parent.info('parent msg');
      child.info('child msg');

      expect(captured[0]!.correlationId).toBeTruthy();
      expect(captured[1]!.correlationId).toBe(captured[0]!.correlationId);
    });

    it('should propagate correlation ID through multiple child levels', () => {
      const root = createLogger({ output });
      const child = root.child({ userId: 'u-1' });
      const grandchild = child.child({ operation: 'process' });

      root.info('root');
      child.info('child');
      grandchild.info('grandchild');

      const rootCorrId = captured[0]!.correlationId;
      expect(rootCorrId).toBeTruthy();
      expect(captured[1]!.correlationId).toBe(rootCorrId);
      expect(captured[2]!.correlationId).toBe(rootCorrId);
    });

    it('should propagate service name to child loggers', () => {
      const parent = createLogger({ service: 'payments', output });
      const child = parent.child({ userId: 'u-1' });

      child.info('child msg');

      expect(captured[0]!.service).toBe('payments');
    });

    it('should allow child to override correlation ID', () => {
      const parent = createLogger({ output });
      const child = parent.child({ correlationId: 'child-corr' });

      child.info('overridden');

      expect(captured[0]!.correlationId).toBe('child-corr');
    });
  });
});
