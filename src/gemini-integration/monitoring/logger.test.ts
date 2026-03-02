import { beforeEach, describe, expect, it } from 'vitest';

import { GeminiLogger } from './logger.js';

describe('GeminiLogger', () => {
  let logger: GeminiLogger;

  beforeEach(() => {
    logger = new GeminiLogger({ level: 'debug', redactPii: true });
  });

  describe('log level methods', () => {
    it('should store a debug entry', () => {
      logger.debug('debug message', 'corr-1');
      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe('debug');
      expect(entries[0].message).toBe('debug message');
      expect(entries[0].correlationId).toBe('corr-1');
    });

    it('should store an info entry', () => {
      logger.info('info message', 'corr-2');
      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe('info');
    });

    it('should store a warn entry', () => {
      logger.warn('warn message', 'corr-3');
      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe('warn');
    });

    it('should store an error entry', () => {
      logger.error('error message', 'corr-4');
      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe('error');
    });

    it('should include a timestamp on every entry', () => {
      const before = new Date();
      logger.info('test', 'corr-5');
      const after = new Date();
      const entry = logger.getEntries()[0];
      expect(entry.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(entry.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should include optional context', () => {
      logger.info('with context', 'corr-6', { key: 'value' });
      const entry = logger.getEntries()[0];
      expect(entry.context).toEqual({ key: 'value' });
    });

    it('should set context to undefined when not provided', () => {
      logger.info('no context', 'corr-7');
      const entry = logger.getEntries()[0];
      expect(entry.context).toBeUndefined();
    });
  });

  describe('log level filtering', () => {
    it('should filter out entries below the configured level', () => {
      const warnLogger = new GeminiLogger({ level: 'warn', redactPii: false });
      warnLogger.debug('should be filtered', 'c1');
      warnLogger.info('should be filtered', 'c2');
      warnLogger.warn('should appear', 'c3');
      warnLogger.error('should appear', 'c4');
      expect(warnLogger.getEntries()).toHaveLength(2);
      expect(warnLogger.getEntries()[0].level).toBe('warn');
      expect(warnLogger.getEntries()[1].level).toBe('error');
    });

    it('should default to info level', () => {
      const defaultLogger = new GeminiLogger();
      defaultLogger.debug('filtered', 'c1');
      defaultLogger.info('kept', 'c2');
      expect(defaultLogger.getEntries()).toHaveLength(1);
      expect(defaultLogger.getEntries()[0].level).toBe('info');
    });

    it('should allow all entries at debug level', () => {
      logger.debug('d', 'c1');
      logger.info('i', 'c2');
      logger.warn('w', 'c3');
      logger.error('e', 'c4');
      expect(logger.getEntries()).toHaveLength(4);
    });

    it('should only allow error entries at error level', () => {
      const errorLogger = new GeminiLogger({ level: 'error', redactPii: false });
      errorLogger.debug('no', 'c1');
      errorLogger.info('no', 'c2');
      errorLogger.warn('no', 'c3');
      errorLogger.error('yes', 'c4');
      expect(errorLogger.getEntries()).toHaveLength(1);
      expect(errorLogger.getEntries()[0].level).toBe('error');
    });
  });

  describe('PII redaction', () => {
    it('should redact phone numbers from messages', () => {
      logger.info('Call 08012345678 for details', 'corr-pii');
      const entry = logger.getEntries()[0];
      expect(entry.message).not.toContain('08012345678');
      expect(entry.message).toContain('[PHONE]');
    });

    it('should redact email addresses from messages', () => {
      logger.info('Contact user@example.com', 'corr-pii');
      const entry = logger.getEntries()[0];
      expect(entry.message).not.toContain('user@example.com');
      expect(entry.message).toContain('[EMAIL]');
    });

    it('should redact account numbers from messages', () => {
      logger.info('Account 1234567890 debited', 'corr-pii');
      const entry = logger.getEntries()[0];
      expect(entry.message).not.toContain('1234567890');
      expect(entry.message).toContain('[ACCOUNT]');
    });

    it('should redact PII from context objects', () => {
      logger.info('request', 'corr-pii', { email: 'user@example.com', phone: '08012345678' });
      const entry = logger.getEntries()[0];
      expect(entry.context).toBeDefined();
      expect(entry.context!.email).toBe('[EMAIL]');
      expect(entry.context!.phone).toContain('[PHONE]');
    });

    it('should not redact when redactPii is false', () => {
      const noRedactLogger = new GeminiLogger({ level: 'debug', redactPii: false });
      noRedactLogger.info('Call 08012345678', 'corr-pii');
      const entry = noRedactLogger.getEntries()[0];
      expect(entry.message).toContain('08012345678');
    });

    it('should default redactPii to true', () => {
      const defaultLogger = new GeminiLogger({ level: 'debug' });
      defaultLogger.info('Call 08012345678', 'corr-pii');
      const entry = defaultLogger.getEntries()[0];
      expect(entry.message).not.toContain('08012345678');
    });
  });

  describe('correlation IDs', () => {
    it('should include the correlation ID on every entry', () => {
      logger.info('msg1', 'request-abc');
      logger.warn('msg2', 'request-def');
      const entries = logger.getEntries();
      expect(entries[0].correlationId).toBe('request-abc');
      expect(entries[1].correlationId).toBe('request-def');
    });
  });

  describe('getEntries and clear', () => {
    it('should return a copy of entries', () => {
      logger.info('test', 'c1');
      const entries1 = logger.getEntries();
      const entries2 = logger.getEntries();
      expect(entries1).toEqual(entries2);
      expect(entries1).not.toBe(entries2);
    });

    it('should clear all entries', () => {
      logger.info('a', 'c1');
      logger.info('b', 'c2');
      expect(logger.getEntries()).toHaveLength(2);
      logger.clear();
      expect(logger.getEntries()).toHaveLength(0);
    });
  });
});
