import { describe, it, expect, beforeEach } from 'vitest';
import { createAuditLogger, computeChecksum, type AuditLogger } from './auditLogger.js';

const baseAccess = {
  userId: 'user-1',
  businessId: 'biz-1',
  resourceType: 'invoice',
  resourceId: 'inv-100',
  ipAddress: '192.168.1.1',
  userAgent: 'TestAgent/1.0',
};

const baseMod = {
  ...baseAccess,
  action: 'update' as const,
  previousValue: { amount: 100 },
  newValue: { amount: 200 },
};

const baseAuth = {
  userId: 'user-1',
  businessId: 'biz-1',
  action: 'login' as const,
  ipAddress: '10.0.0.1',
  userAgent: 'TestAgent/1.0',
};

describe('AuditLogger', () => {
  let logger: AuditLogger;

  beforeEach(() => {
    logger = createAuditLogger();
  });

  // ── Data access logging (Req 10.1) ──────────────────────────────────────

  describe('logAccess', () => {
    it('creates an entry with data_access event type and read action', () => {
      const entry = logger.logAccess(baseAccess);
      expect(entry.eventType).toBe('data_access');
      expect(entry.action).toBe('read');
    });

    it('populates all required fields', () => {
      const entry = logger.logAccess(baseAccess);
      expect(entry.id).toBeTruthy();
      expect(entry.timestamp).toBeInstanceOf(Date);
      expect(entry.userId).toBe('user-1');
      expect(entry.businessId).toBe('biz-1');
      expect(entry.resourceType).toBe('invoice');
      expect(entry.resourceId).toBe('inv-100');
      expect(entry.ipAddress).toBe('192.168.1.1');
      expect(entry.userAgent).toBe('TestAgent/1.0');
      expect(entry.correlationId).toBeTruthy();
      expect(entry.checksum).toBeTruthy();
    });

    it('uses provided correlationId when given', () => {
      const entry = logger.logAccess({ ...baseAccess, correlationId: 'corr-abc' });
      expect(entry.correlationId).toBe('corr-abc');
    });

    it('stores the entry for later retrieval', () => {
      const entry = logger.logAccess(baseAccess);
      expect(logger.getEntry(entry.id)).toEqual(entry);
    });
  });

  // ── Data modification logging (Req 10.2) ────────────────────────────────

  describe('logModification', () => {
    it('creates an entry with data_modify event type', () => {
      const entry = logger.logModification(baseMod);
      expect(entry.eventType).toBe('data_modify');
      expect(entry.action).toBe('update');
    });

    it('records before/after values', () => {
      const entry = logger.logModification(baseMod);
      expect(entry.previousValue).toEqual({ amount: 100 });
      expect(entry.newValue).toEqual({ amount: 200 });
    });

    it('handles create action with only newValue', () => {
      const entry = logger.logModification({
        ...baseAccess,
        action: 'create',
        newValue: { name: 'New Invoice' },
      });
      expect(entry.action).toBe('create');
      expect(entry.previousValue).toBeUndefined();
      expect(entry.newValue).toEqual({ name: 'New Invoice' });
    });

    it('handles delete action with only previousValue', () => {
      const entry = logger.logModification({
        ...baseAccess,
        action: 'delete',
        previousValue: { name: 'Old Invoice' },
      });
      expect(entry.action).toBe('delete');
      expect(entry.previousValue).toEqual({ name: 'Old Invoice' });
      expect(entry.newValue).toBeUndefined();
    });
  });

  // ── Authentication logging (Req 10.3) ──────────────────────────────────

  describe('logAuth', () => {
    it('creates an entry with auth event type for login', () => {
      const entry = logger.logAuth(baseAuth);
      expect(entry.eventType).toBe('auth');
      expect(entry.action).toBe('login');
    });

    it('creates an entry with auth event type for logout', () => {
      const entry = logger.logAuth({ ...baseAuth, action: 'logout' });
      expect(entry.eventType).toBe('auth');
      expect(entry.action).toBe('logout');
    });

    it('sets resourceType to session and resourceId to userId', () => {
      const entry = logger.logAuth(baseAuth);
      expect(entry.resourceType).toBe('session');
      expect(entry.resourceId).toBe('user-1');
    });
  });

  // ── Checksum ───────────────────────────────────────────────────────────

  describe('checksum', () => {
    it('generates a valid SHA-256 hex checksum', () => {
      const entry = logger.logAccess(baseAccess);
      expect(entry.checksum).toMatch(/^[a-f0-9]{64}$/);
    });

    it('is deterministic for the same entry content', () => {
      const entry = logger.logAccess(baseAccess);
      const recomputed = computeChecksum({
        id: entry.id,
        timestamp: entry.timestamp,
        eventType: entry.eventType,
        userId: entry.userId,
        businessId: entry.businessId,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        action: entry.action,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        correlationId: entry.correlationId,
        previousChecksum: entry.previousChecksum,
      });
      expect(entry.checksum).toBe(recomputed);
    });

    it('differs when entry content differs', () => {
      const e1 = logger.logAccess(baseAccess);
      const e2 = logger.logAccess({ ...baseAccess, userId: 'user-2' });
      expect(e1.checksum).not.toBe(e2.checksum);
    });
  });

  // ── Querying entries ───────────────────────────────────────────────────

  describe('getEntries', () => {
    it('returns all entries when no filter is provided', () => {
      logger.logAccess(baseAccess);
      logger.logAuth(baseAuth);
      expect(logger.getEntries()).toHaveLength(2);
    });

    it('filters by eventType', () => {
      logger.logAccess(baseAccess);
      logger.logAuth(baseAuth);
      const results = logger.getEntries({ eventType: 'auth' });
      expect(results).toHaveLength(1);
      expect(results[0].eventType).toBe('auth');
    });

    it('filters by userId', () => {
      logger.logAccess(baseAccess);
      logger.logAccess({ ...baseAccess, userId: 'user-2' });
      const results = logger.getEntries({ userId: 'user-1' });
      expect(results).toHaveLength(1);
    });

    it('filters by businessId', () => {
      logger.logAccess(baseAccess);
      logger.logAccess({ ...baseAccess, businessId: 'biz-2' });
      expect(logger.getEntries({ businessId: 'biz-1' })).toHaveLength(1);
    });

    it('filters by resourceType', () => {
      logger.logAccess(baseAccess);
      logger.logAccess({ ...baseAccess, resourceType: 'receipt' });
      expect(logger.getEntries({ resourceType: 'invoice' })).toHaveLength(1);
    });

    it('filters by action', () => {
      logger.logAccess(baseAccess);
      logger.logModification(baseMod);
      expect(logger.getEntries({ action: 'update' })).toHaveLength(1);
    });

    it('filters by date range', () => {
      const e1 = logger.logAccess(baseAccess);
      // Shift e1 timestamp back to ensure it falls outside the range
      e1.timestamp = new Date('2024-01-01T00:00:00Z');
      logger.logAccess(baseAccess);
      const results = logger.getEntries({ from: new Date('2024-06-01') });
      expect(results).toHaveLength(1);
    });

    it('returns a copy so mutations do not affect internal state', () => {
      logger.logAccess(baseAccess);
      const results = logger.getEntries();
      results.pop();
      expect(logger.getEntries()).toHaveLength(1);
    });
  });

  // ── getEntry ───────────────────────────────────────────────────────────

  describe('getEntry', () => {
    it('returns undefined for unknown id', () => {
      expect(logger.getEntry('nonexistent')).toBeUndefined();
    });

    it('returns the correct entry by id', () => {
      const entry = logger.logAccess(baseAccess);
      expect(logger.getEntry(entry.id)).toEqual(entry);
    });
  });

  // ── Retention (Req 10.4) ────────────────────────────────────────────────

  describe('retention', () => {
    it('defaults to 7-year (2555 day) retention', () => {
      const policy = logger.getRetentionPolicy();
      expect(policy.retentionDays).toBe(2555);
      expect(policy.retentionMs).toBe(2555 * 24 * 60 * 60 * 1000);
    });

    it('accepts a custom retention period', () => {
      const custom = createAuditLogger({ retentionDays: 365 });
      const policy = custom.getRetentionPolicy();
      expect(policy.retentionDays).toBe(365);
      expect(policy.retentionMs).toBe(365 * 24 * 60 * 60 * 1000);
    });

    it('getExpiredEntries returns entries older than retention period', () => {
      const entry = logger.logAccess(baseAccess);
      // Not expired relative to now
      expect(logger.getExpiredEntries()).toHaveLength(0);

      // Shift entry timestamp to 8 years ago
      entry.timestamp = new Date(Date.now() - 8 * 365 * 24 * 60 * 60 * 1000);
      expect(logger.getExpiredEntries()).toHaveLength(1);
      expect(logger.getExpiredEntries()[0].id).toBe(entry.id);
    });

    it('getExpiredEntries accepts a custom now parameter', () => {
      const entry = logger.logAccess(baseAccess);
      // Entry is "now", but if we set reference 8 years in the future it's expired
      const future = new Date(Date.now() + 8 * 365 * 24 * 60 * 60 * 1000);
      expect(logger.getExpiredEntries(future)).toHaveLength(1);
    });

    it('getExpiredEntries does not return entries within retention', () => {
      logger.logAccess(baseAccess);
      // 1 year in the future — still within 7-year window
      const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      expect(logger.getExpiredEntries(future)).toHaveLength(0);
    });

    it('purgeExpired removes expired entries and returns count', () => {
      const e1 = logger.logAccess(baseAccess);
      const e2 = logger.logAccess(baseAccess);
      // Make e1 expired
      e1.timestamp = new Date(Date.now() - 8 * 365 * 24 * 60 * 60 * 1000);

      const removed = logger.purgeExpired();
      expect(removed).toBe(1);
      expect(logger.getEntries()).toHaveLength(1);
      expect(logger.getEntry(e1.id)).toBeUndefined();
      expect(logger.getEntry(e2.id)).toBeDefined();
    });

    it('purgeExpired returns 0 when nothing is expired', () => {
      logger.logAccess(baseAccess);
      expect(logger.purgeExpired()).toBe(0);
      expect(logger.getEntries()).toHaveLength(1);
    });

    it('purgeExpired with custom retention removes entries accordingly', () => {
      const short = createAuditLogger({ retentionDays: 1 });
      const entry = short.logAccess(baseAccess);
      // Shift entry to 2 days ago
      entry.timestamp = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      expect(short.purgeExpired()).toBe(1);
      expect(short.getEntries()).toHaveLength(0);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('generates unique ids for each entry', () => {
      const ids = Array.from({ length: 10 }, () => logger.logAccess(baseAccess).id);
      expect(new Set(ids).size).toBe(10);
    });

    it('handles empty string fields without error', () => {
      const entry = logger.logAccess({
        userId: '',
        businessId: '',
        resourceType: '',
        resourceId: '',
        ipAddress: '',
        userAgent: '',
      });
      expect(entry.id).toBeTruthy();
      expect(entry.checksum).toMatch(/^[a-f0-9]{64}$/);
    });

    it('handles modification with empty before/after objects', () => {
      const entry = logger.logModification({
        ...baseAccess,
        action: 'update',
        previousValue: {},
        newValue: {},
      });
      expect(entry.previousValue).toEqual({});
      expect(entry.newValue).toEqual({});
    });

    it('combines multiple filters', () => {
      logger.logAccess(baseAccess);
      logger.logAccess({ ...baseAccess, userId: 'user-2' });
      logger.logAuth(baseAuth);
      const results = logger.getEntries({ userId: 'user-1', eventType: 'data_access' });
      expect(results).toHaveLength(1);
    });
  });

  // ── Tamper detection (Req 10.5) ─────────────────────────────────────────

  describe('verifyIntegrity', () => {
    it('returns valid for an untampered entry', () => {
      const entry = logger.logAccess(baseAccess);
      const result = logger.verifyIntegrity(entry.id);
      expect(result.valid).toBe(true);
      expect(result.expected).toBe(result.actual);
    });

    it('returns invalid when entry content is modified', () => {
      const entry = logger.logAccess(baseAccess);
      // Tamper with the entry
      (entry as Record<string, unknown>).userId = 'hacker';
      const result = logger.verifyIntegrity(entry.id);
      expect(result.valid).toBe(false);
      expect(result.expected).not.toBe(result.actual);
    });

    it('returns invalid with empty strings for unknown id', () => {
      const result = logger.verifyIntegrity('nonexistent');
      expect(result.valid).toBe(false);
      expect(result.expected).toBe('');
      expect(result.actual).toBe('');
    });
  });

  describe('verifyAll', () => {
    it('returns valid when no entries are tampered', () => {
      logger.logAccess(baseAccess);
      logger.logAuth(baseAuth);
      logger.logModification(baseMod);
      const result = logger.verifyAll();
      expect(result.valid).toBe(true);
      expect(result.tamperedEntries).toHaveLength(0);
    });

    it('detects tampered entries', () => {
      const e1 = logger.logAccess(baseAccess);
      logger.logAuth(baseAuth);
      const e3 = logger.logModification(baseMod);
      // Tamper with two entries
      (e1 as Record<string, unknown>).ipAddress = 'evil';
      (e3 as Record<string, unknown>).action = 'delete';
      const result = logger.verifyAll();
      expect(result.valid).toBe(false);
      expect(result.tamperedEntries).toContain(e1.id);
      expect(result.tamperedEntries).toContain(e3.id);
      expect(result.tamperedEntries).toHaveLength(2);
    });

    it('returns valid for empty log', () => {
      const result = logger.verifyAll();
      expect(result.valid).toBe(true);
      expect(result.tamperedEntries).toHaveLength(0);
    });
  });

  // ── Hash chain (Req 10.5) ──────────────────────────────────────────────

  describe('hash chain', () => {
    it('first entry has null previousChecksum', () => {
      const entry = logger.logAccess(baseAccess);
      expect(entry.previousChecksum).toBeNull();
    });

    it('subsequent entries reference the previous checksum', () => {
      const e1 = logger.logAccess(baseAccess);
      const e2 = logger.logAuth(baseAuth);
      const e3 = logger.logModification(baseMod);
      expect(e2.previousChecksum).toBe(e1.checksum);
      expect(e3.previousChecksum).toBe(e2.checksum);
    });
  });

  describe('verifyChain', () => {
    it('returns valid for an intact chain', () => {
      logger.logAccess(baseAccess);
      logger.logAuth(baseAuth);
      logger.logModification(baseMod);
      const result = logger.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.brokenAt).toBeNull();
    });

    it('returns valid for empty log', () => {
      const result = logger.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.brokenAt).toBeNull();
    });

    it('returns valid for single entry', () => {
      logger.logAccess(baseAccess);
      const result = logger.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.brokenAt).toBeNull();
    });

    it('detects broken chain when previousChecksum is altered', () => {
      logger.logAccess(baseAccess);
      const e2 = logger.logAuth(baseAuth);
      logger.logModification(baseMod);
      // Break the chain link
      (e2 as Record<string, unknown>).previousChecksum = 'tampered';
      const result = logger.verifyChain();
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(e2.id);
    });

    it('detects broken chain when entry content is tampered', () => {
      logger.logAccess(baseAccess);
      const e2 = logger.logAuth(baseAuth);
      logger.logModification(baseMod);
      // Tamper with content (checksum no longer matches)
      (e2 as Record<string, unknown>).userId = 'hacker';
      const result = logger.verifyChain();
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(e2.id);
    });
  });
});
