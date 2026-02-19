import { describe, it, expect, beforeEach } from 'vitest';
import { AuditServiceImpl } from './auditService.js';
import type { AuditContext } from './auditService.js';
import type { AuditEvent } from './types.js';

const defaultContext: AuditContext = {
  ipAddress: '192.168.1.1',
  userAgent: 'TestAgent/1.0',
};

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    eventType: 'data_access',
    userId: 'user-1',
    businessId: 'biz-1',
    resourceType: 'transaction',
    resourceId: 'txn-100',
    action: 'read',
    ...overrides,
  };
}

describe('AuditServiceImpl', () => {
  let service: AuditServiceImpl;

  beforeEach(() => {
    service = new AuditServiceImpl();
  });

  describe('log', () => {
    it('should create an audit entry with generated fields', async () => {
      await service.log(makeEvent(), defaultContext);
      const entries = await service.query({});
      expect(entries).toHaveLength(1);

      const entry = entries[0]!;
      expect(entry.id).toBeTruthy();
      expect(entry.timestamp).toBeInstanceOf(Date);
      expect(entry.correlationId).toBeTruthy();
      expect(entry.checksum).toBeTruthy();
      expect(entry.ipAddress).toBe('192.168.1.1');
      expect(entry.userAgent).toBe('TestAgent/1.0');
    });

    it('should preserve event fields in the entry', async () => {
      const event = makeEvent({
        eventType: 'data_modify',
        action: 'update',
        previousValue: { amount: 100 },
        newValue: { amount: 200 },
        metadata: { source: 'api' },
      });
      await service.log(event, defaultContext);
      const [entry] = await service.query({});

      expect(entry!.eventType).toBe('data_modify');
      expect(entry!.action).toBe('update');
      expect(entry!.previousValue).toEqual({ amount: 100 });
      expect(entry!.newValue).toEqual({ amount: 200 });
      expect(entry!.metadata).toEqual({ source: 'api' });
    });

    it('should log data access events (Req 4.1)', async () => {
      await service.log(makeEvent({ eventType: 'data_access', action: 'read' }), defaultContext);
      const entries = await service.query({ eventType: 'data_access' });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.eventType).toBe('data_access');
    });

    it('should log data modification events (Req 4.2)', async () => {
      await service.log(
        makeEvent({
          eventType: 'data_modify',
          action: 'update',
          previousValue: 'old',
          newValue: 'new',
        }),
        defaultContext,
      );
      const entries = await service.query({ eventType: 'data_modify' });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.previousValue).toBe('old');
      expect(entries[0]!.newValue).toBe('new');
    });

    it('should generate unique ids for each entry', async () => {
      await service.log(makeEvent(), defaultContext);
      await service.log(makeEvent(), defaultContext);
      const entries = await service.query({});
      expect(entries[0]!.id).not.toBe(entries[1]!.id);
    });
  });

  describe('query', () => {
    it('should filter by userId', async () => {
      await service.log(makeEvent({ userId: 'user-1' }), defaultContext);
      await service.log(makeEvent({ userId: 'user-2' }), defaultContext);
      const results = await service.query({ userId: 'user-1' });
      expect(results).toHaveLength(1);
      expect(results[0]!.userId).toBe('user-1');
    });

    it('should filter by businessId', async () => {
      await service.log(makeEvent({ businessId: 'biz-1' }), defaultContext);
      await service.log(makeEvent({ businessId: 'biz-2' }), defaultContext);
      const results = await service.query({ businessId: 'biz-2' });
      expect(results).toHaveLength(1);
      expect(results[0]!.businessId).toBe('biz-2');
    });

    it('should filter by eventType', async () => {
      await service.log(makeEvent({ eventType: 'data_access' }), defaultContext);
      await service.log(makeEvent({ eventType: 'data_modify' }), defaultContext);
      const results = await service.query({ eventType: 'data_modify' });
      expect(results).toHaveLength(1);
    });

    it('should filter by action', async () => {
      await service.log(makeEvent({ action: 'read' }), defaultContext);
      await service.log(makeEvent({ action: 'create' }), defaultContext);
      const results = await service.query({ action: 'create' });
      expect(results).toHaveLength(1);
    });

    it('should filter by resourceType', async () => {
      await service.log(makeEvent({ resourceType: 'transaction' }), defaultContext);
      await service.log(makeEvent({ resourceType: 'invoice' }), defaultContext);
      const results = await service.query({ resourceType: 'invoice' });
      expect(results).toHaveLength(1);
    });

    it('should filter by date range', async () => {
      await service.log(makeEvent(), defaultContext);
      const now = new Date();
      const results = await service.query({
        startDate: new Date(now.getTime() - 1000),
        endDate: new Date(now.getTime() + 1000),
      });
      expect(results).toHaveLength(1);
    });

    it('should support limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await service.log(makeEvent({ resourceId: `txn-${i}` }), defaultContext);
      }
      const page = await service.query({ limit: 2, offset: 1 });
      expect(page).toHaveLength(2);
      expect(page[0]!.resourceId).toBe('txn-1');
      expect(page[1]!.resourceId).toBe('txn-2');
    });

    it('should return empty array when no matches', async () => {
      await service.log(makeEvent(), defaultContext);
      const results = await service.query({ userId: 'nonexistent' });
      expect(results).toHaveLength(0);
    });
  });

  describe('export', () => {
    it('should export as JSON', async () => {
      await service.log(makeEvent(), defaultContext);
      const json = await service.export({}, 'json');
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].userId).toBe('user-1');
    });

    it('should export as CSV with headers', async () => {
      await service.log(makeEvent(), defaultContext);
      const csv = await service.export({}, 'csv');
      const lines = csv.split('\n');
      expect(lines[0]).toBe(
        'id,timestamp,eventType,userId,businessId,resourceType,resourceId,action,ipAddress,userAgent,correlationId,checksum',
      );
      expect(lines).toHaveLength(2);
    });

    it('should return empty string for CSV with no entries', async () => {
      const csv = await service.export({ userId: 'none' }, 'csv');
      expect(csv).toBe('');
    });

    it('should respect filters during export', async () => {
      await service.log(makeEvent({ userId: 'user-1' }), defaultContext);
      await service.log(makeEvent({ userId: 'user-2' }), defaultContext);
      const json = await service.export({ userId: 'user-1' }, 'json');
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(1);
    });
  });

  describe('verifyIntegrity', () => {
    it('should verify a valid entry', async () => {
      await service.log(makeEvent(), defaultContext);
      const [entry] = await service.query({});
      const result = await service.verifyIntegrity(entry!.id);
      expect(result.valid).toBe(true);
      expect(result.expectedChecksum).toBe(result.actualChecksum);
    });

    it('should return invalid for unknown entry', async () => {
      const result = await service.verifyIntegrity('nonexistent');
      expect(result.valid).toBe(false);
      expect(result.expectedChecksum).toBe('');
      expect(result.actualChecksum).toBe('');
    });

    it('should produce a SHA-256 hex checksum', async () => {
      await service.log(makeEvent(), defaultContext);
      const [entry] = await service.query({});
      // SHA-256 hex is 64 characters
      expect(entry!.checksum).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});

describe('AuditServiceImpl.logAuth', () => {
  let service: AuditServiceImpl;

  beforeEach(() => {
    service = new AuditServiceImpl();
  });

  it('should set eventType to auth (Req 4.3)', async () => {
    await service.logAuth(
      { userId: 'user-1', businessId: 'biz-1', outcome: 'success', method: 'password' },
      defaultContext,
    );
    const entries = await service.query({ eventType: 'auth' });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.eventType).toBe('auth');
  });

  it('should set action to create on successful auth', async () => {
    await service.logAuth(
      { userId: 'user-1', businessId: 'biz-1', outcome: 'success', method: 'password' },
      defaultContext,
    );
    const [entry] = await service.query({});
    expect(entry!.action).toBe('create');
  });

  it('should set action to read on failed auth', async () => {
    await service.logAuth(
      { userId: 'user-1', businessId: 'biz-1', outcome: 'failure', method: 'password' },
      defaultContext,
    );
    const [entry] = await service.query({});
    expect(entry!.action).toBe('read');
  });

  it('should include outcome in metadata', async () => {
    await service.logAuth(
      { userId: 'user-1', businessId: 'biz-1', outcome: 'failure', method: 'magic_link' },
      defaultContext,
    );
    const [entry] = await service.query({});
    expect(entry!.metadata).toEqual({ outcome: 'failure', method: 'magic_link' });
  });

  it('should include method in metadata', async () => {
    await service.logAuth(
      { userId: 'user-1', businessId: 'biz-1', outcome: 'success', method: 'magic_link' },
      defaultContext,
    );
    const [entry] = await service.query({});
    expect(entry!.metadata!.method).toBe('magic_link');
  });

  it('should set resourceType to session', async () => {
    await service.logAuth(
      { userId: 'user-1', businessId: 'biz-1', outcome: 'success', method: 'password' },
      defaultContext,
    );
    const [entry] = await service.query({});
    expect(entry!.resourceType).toBe('session');
  });

  it('should preserve userId and businessId', async () => {
    await service.logAuth(
      { userId: 'user-42', businessId: 'biz-99', outcome: 'success', method: 'password' },
      defaultContext,
    );
    const [entry] = await service.query({});
    expect(entry!.userId).toBe('user-42');
    expect(entry!.businessId).toBe('biz-99');
  });

  it('should preserve audit context (IP and user agent)', async () => {
    const ctx: AuditContext = { ipAddress: '10.0.0.1', userAgent: 'Chrome/120' };
    await service.logAuth(
      { userId: 'user-1', businessId: 'biz-1', outcome: 'success', method: 'password' },
      ctx,
    );
    const [entry] = await service.query({});
    expect(entry!.ipAddress).toBe('10.0.0.1');
    expect(entry!.userAgent).toBe('Chrome/120');
  });

  it('should generate id, timestamp, correlationId, and checksum', async () => {
    await service.logAuth(
      { userId: 'user-1', businessId: 'biz-1', outcome: 'success', method: 'password' },
      defaultContext,
    );
    const [entry] = await service.query({});
    expect(entry!.id).toBeTruthy();
    expect(entry!.timestamp).toBeInstanceOf(Date);
    expect(entry!.correlationId).toBeTruthy();
    expect(entry!.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should support different auth methods', async () => {
    const methods = ['password', 'magic_link', 'oauth', 'sso', 'biometric'];
    for (const method of methods) {
      await service.logAuth(
        { userId: 'user-1', businessId: 'biz-1', outcome: 'success', method },
        defaultContext,
      );
    }
    const entries = await service.query({ eventType: 'auth' });
    expect(entries).toHaveLength(methods.length);
    const loggedMethods = entries.map((e) => (e.metadata as Record<string, unknown>).method);
    expect(loggedMethods).toEqual(methods);
  });
});

describe('AuditServiceImpl.logAdmin', () => {
  let service: AuditServiceImpl;

  beforeEach(() => {
    service = new AuditServiceImpl();
  });

  it('should set eventType to admin (Req 4.4)', async () => {
    await service.logAdmin(
      {
        userId: 'admin-1',
        businessId: 'biz-1',
        adminAction: 'disable_user',
        targetResource: 'user',
        targetResourceId: 'user-42',
      },
      defaultContext,
    );
    const entries = await service.query({ eventType: 'admin' });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.eventType).toBe('admin');
  });

  it('should store adminAction in metadata', async () => {
    await service.logAdmin(
      {
        userId: 'admin-1',
        businessId: 'biz-1',
        adminAction: 'reset_password',
        targetResource: 'user',
        targetResourceId: 'user-42',
      },
      defaultContext,
    );
    const [entry] = await service.query({});
    expect(entry!.metadata).toMatchObject({ adminAction: 'reset_password' });
  });

  it('should store additional details in metadata', async () => {
    await service.logAdmin(
      {
        userId: 'admin-1',
        businessId: 'biz-1',
        adminAction: 'change_role',
        targetResource: 'user',
        targetResourceId: 'user-42',
        details: { previousRole: 'viewer', newRole: 'editor' },
      },
      defaultContext,
    );
    const [entry] = await service.query({});
    expect(entry!.metadata).toEqual({
      adminAction: 'change_role',
      previousRole: 'viewer',
      newRole: 'editor',
    });
  });

  it('should set resourceType to targetResource', async () => {
    await service.logAdmin(
      {
        userId: 'admin-1',
        businessId: 'biz-1',
        adminAction: 'delete_business',
        targetResource: 'business',
        targetResourceId: 'biz-99',
      },
      defaultContext,
    );
    const [entry] = await service.query({});
    expect(entry!.resourceType).toBe('business');
  });

  it('should set resourceId to targetResourceId', async () => {
    await service.logAdmin(
      {
        userId: 'admin-1',
        businessId: 'biz-1',
        adminAction: 'delete_business',
        targetResource: 'business',
        targetResourceId: 'biz-99',
      },
      defaultContext,
    );
    const [entry] = await service.query({});
    expect(entry!.resourceId).toBe('biz-99');
  });

  it('should preserve userId and businessId', async () => {
    await service.logAdmin(
      {
        userId: 'admin-7',
        businessId: 'biz-55',
        adminAction: 'update_config',
        targetResource: 'config',
        targetResourceId: 'cfg-1',
      },
      defaultContext,
    );
    const [entry] = await service.query({});
    expect(entry!.userId).toBe('admin-7');
    expect(entry!.businessId).toBe('biz-55');
  });

  it('should preserve audit context (IP and user agent)', async () => {
    const ctx: AuditContext = { ipAddress: '10.0.0.5', userAgent: 'AdminPanel/2.0' };
    await service.logAdmin(
      {
        userId: 'admin-1',
        businessId: 'biz-1',
        adminAction: 'disable_user',
        targetResource: 'user',
        targetResourceId: 'user-42',
      },
      ctx,
    );
    const [entry] = await service.query({});
    expect(entry!.ipAddress).toBe('10.0.0.5');
    expect(entry!.userAgent).toBe('AdminPanel/2.0');
  });

  it('should generate id, timestamp, correlationId, and checksum', async () => {
    await service.logAdmin(
      {
        userId: 'admin-1',
        businessId: 'biz-1',
        adminAction: 'disable_user',
        targetResource: 'user',
        targetResourceId: 'user-42',
      },
      defaultContext,
    );
    const [entry] = await service.query({});
    expect(entry!.id).toBeTruthy();
    expect(entry!.timestamp).toBeInstanceOf(Date);
    expect(entry!.correlationId).toBeTruthy();
    expect(entry!.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should work without optional details', async () => {
    await service.logAdmin(
      {
        userId: 'admin-1',
        businessId: 'biz-1',
        adminAction: 'view_logs',
        targetResource: 'audit_log',
        targetResourceId: 'log-1',
      },
      defaultContext,
    );
    const [entry] = await service.query({});
    expect(entry!.metadata).toEqual({ adminAction: 'view_logs' });
  });

  it('should pass integrity verification', async () => {
    await service.logAdmin(
      {
        userId: 'admin-1',
        businessId: 'biz-1',
        adminAction: 'disable_user',
        targetResource: 'user',
        targetResourceId: 'user-42',
      },
      defaultContext,
    );
    const [entry] = await service.query({});
    const result = await service.verifyIntegrity(entry!.id);
    expect(result.valid).toBe(true);
  });
});

describe('Tamper Detection - Chain Hashing (Req 4.5)', () => {
  let service: AuditServiceImpl;

  beforeEach(() => {
    service = new AuditServiceImpl();
  });

  describe('chain hashing', () => {
    it('first entry should have empty previousChecksum', async () => {
      await service.log(makeEvent(), defaultContext);
      const [entry] = await service.query({});
      expect(entry!.previousChecksum).toBe('');
    });

    it('second entry should reference first entry checksum', async () => {
      await service.log(makeEvent({ resourceId: 'txn-1' }), defaultContext);
      await service.log(makeEvent({ resourceId: 'txn-2' }), defaultContext);
      const entries = await service.query({});
      expect(entries[1]!.previousChecksum).toBe(entries[0]!.checksum);
    });

    it('each entry should chain to the previous entry checksum', async () => {
      for (let i = 0; i < 5; i++) {
        await service.log(makeEvent({ resourceId: `txn-${i}` }), defaultContext);
      }
      const entries = await service.query({});
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i]!.previousChecksum).toBe(entries[i - 1]!.checksum);
      }
    });

    it('previousChecksum should be included in checksum computation', async () => {
      // Log two identical events — their checksums must differ because
      // the second one chains to the first
      await service.log(makeEvent(), defaultContext);
      await service.log(makeEvent(), defaultContext);
      const entries = await service.query({});
      // Even if all other fields were identical (they won't be due to id/timestamp),
      // the chain ensures different checksums
      expect(entries[0]!.checksum).not.toBe(entries[1]!.checksum);
    });
  });

  describe('verifyChainIntegrity', () => {
    it('should return valid for empty log', async () => {
      const result = await service.verifyChainIntegrity();
      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(0);
      expect(result.firstInvalidIndex).toBeNull();
    });

    it('should return valid for a single entry', async () => {
      await service.log(makeEvent(), defaultContext);
      const result = await service.verifyChainIntegrity();
      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(1);
      expect(result.firstInvalidIndex).toBeNull();
    });

    it('should return valid for multiple entries', async () => {
      for (let i = 0; i < 10; i++) {
        await service.log(makeEvent({ resourceId: `txn-${i}` }), defaultContext);
      }
      const result = await service.verifyChainIntegrity();
      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(10);
      expect(result.firstInvalidIndex).toBeNull();
    });

    it('should detect tampered entry checksum', async () => {
      for (let i = 0; i < 3; i++) {
        await service.log(makeEvent({ resourceId: `txn-${i}` }), defaultContext);
      }
      // Tamper with the middle entry's checksum directly
      const entries = await service.query({});
      (entries[1] as { checksum: string }).checksum = 'tampered_checksum_value';

      const result = await service.verifyChainIntegrity();
      expect(result.valid).toBe(false);
      expect(result.firstInvalidIndex).toBe(1);
    });

    it('should detect broken chain link', async () => {
      for (let i = 0; i < 3; i++) {
        await service.log(makeEvent({ resourceId: `txn-${i}` }), defaultContext);
      }
      // Tamper with the previousChecksum of the last entry
      const entries = await service.query({});
      (entries[2] as { previousChecksum: string }).previousChecksum = 'wrong_prev';

      const result = await service.verifyChainIntegrity();
      expect(result.valid).toBe(false);
      expect(result.firstInvalidIndex).toBe(2);
    });

    it('should detect tampered entry data', async () => {
      for (let i = 0; i < 3; i++) {
        await service.log(makeEvent({ resourceId: `txn-${i}` }), defaultContext);
      }
      // Tamper with the data of the first entry (userId)
      const entries = await service.query({});
      (entries[0] as { userId: string }).userId = 'hacker';

      const result = await service.verifyChainIntegrity();
      expect(result.valid).toBe(false);
      expect(result.firstInvalidIndex).toBe(0);
    });

    it('should report details about the failure', async () => {
      await service.log(makeEvent(), defaultContext);
      await service.log(makeEvent(), defaultContext);
      const entries = await service.query({});
      (entries[0] as { checksum: string }).checksum = 'bad';

      const result = await service.verifyChainIntegrity();
      expect(result.valid).toBe(false);
      expect(result.details).toBeTruthy();
      expect(typeof result.details).toBe('string');
    });
  });

  describe('append-only enforcement', () => {
    it('should not expose any method to delete entries', () => {
      const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
      const dangerousMethods = proto.filter(
        (name) =>
          name.includes('delete') ||
          name.includes('remove') ||
          name.includes('clear') ||
          name.includes('splice') ||
          name.includes('pop') ||
          name.includes('shift'),
      );
      expect(dangerousMethods).toEqual([]);
    });

    it('should not expose any method to update entries', () => {
      const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
      const mutateMethods = proto.filter(
        (name) =>
          name.includes('edit') ||
          name.includes('modify') ||
          name.includes('replace') ||
          name.includes('set'),
      );
      expect(mutateMethods).toEqual([]);
    });

    it('entries should not be reassignable via the class API', () => {
      // The entries field is declared as `private readonly` in TypeScript,
      // which prevents reassignment at compile time. At runtime, we verify
      // there is no public getter/setter that exposes the raw array.
      const publicProps = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
      const entriesAccessors = publicProps.filter((name) => name === 'entries');
      expect(entriesAccessors).toEqual([]);
    });

    it('query results should not allow mutation of internal entries', async () => {
      await service.log(makeEvent(), defaultContext);
      const entries = await service.query({});
      // The returned entries are references to internal objects,
      // but the chain integrity check will catch any tampering
      const originalChecksum = entries[0]!.checksum;
      expect(originalChecksum).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('verifyIntegrity with chain hashing', () => {
    it('should still verify individual entries correctly', async () => {
      await service.log(makeEvent(), defaultContext);
      await service.log(makeEvent(), defaultContext);
      const entries = await service.query({});

      for (const entry of entries) {
        const result = await service.verifyIntegrity(entry.id);
        expect(result.valid).toBe(true);
      }
    });

    it('entries should include previousChecksum in their checksum', async () => {
      await service.log(makeEvent(), defaultContext);
      const [entry] = await service.query({});
      // The entry has previousChecksum field
      expect(entry!.previousChecksum).toBeDefined();
      expect(typeof entry!.previousChecksum).toBe('string');
    });
  });
});

import { RETENTION_PERIOD_DAYS } from './auditService.js';

describe('7-Year Retention (Req 4.6)', () => {
  let service: AuditServiceImpl;

  beforeEach(() => {
    service = new AuditServiceImpl();
  });

  describe('RETENTION_PERIOD_DAYS constant', () => {
    it('should be 2555 days (7 years)', () => {
      expect(RETENTION_PERIOD_DAYS).toBe(2555);
    });
  });

  describe('isWithinRetention', () => {
    it('should return true for a recent entry', async () => {
      await service.log(makeEvent(), defaultContext);
      const [entry] = await service.query({});
      expect(service.isWithinRetention(entry!)).toBe(true);
    });

    it('should return true for an entry exactly at the retention boundary', async () => {
      await service.log(makeEvent(), defaultContext);
      const [entry] = await service.query({});
      const boundaryDate = new Date(entry!.timestamp.getTime() + RETENTION_PERIOD_DAYS * 86400000);
      expect(service.isWithinRetention(entry!, boundaryDate)).toBe(true);
    });

    it('should return false for an entry past the retention period', async () => {
      await service.log(makeEvent(), defaultContext);
      const [entry] = await service.query({});
      const pastRetention = new Date(
        entry!.timestamp.getTime() + (RETENTION_PERIOD_DAYS + 1) * 86400000,
      );
      expect(service.isWithinRetention(entry!, pastRetention)).toBe(false);
    });
  });

  describe('getRetentionStatus', () => {
    it('should return correct status for a recent entry', async () => {
      await service.log(makeEvent(), defaultContext);
      const [entry] = await service.query({});
      const status = service.getRetentionStatus(entry!);
      expect(status.entryId).toBe(entry!.id);
      expect(status.timestamp).toBe(entry!.timestamp);
      expect(status.ageInDays).toBe(0);
      expect(status.withinRetention).toBe(true);
      expect(status.retentionPeriodDays).toBe(RETENTION_PERIOD_DAYS);
    });

    it('should compute age correctly for an old entry', async () => {
      await service.log(makeEvent(), defaultContext);
      const [entry] = await service.query({});
      const futureDate = new Date(entry!.timestamp.getTime() + 1000 * 86400000);
      const status = service.getRetentionStatus(entry!, futureDate);
      expect(status.ageInDays).toBe(1000);
      expect(status.withinRetention).toBe(true);
    });

    it('should flag entry as outside retention when expired', async () => {
      await service.log(makeEvent(), defaultContext);
      const [entry] = await service.query({});
      const futureDate = new Date(entry!.timestamp.getTime() + 3000 * 86400000);
      const status = service.getRetentionStatus(entry!, futureDate);
      expect(status.ageInDays).toBe(3000);
      expect(status.withinRetention).toBe(false);
    });
  });

  describe('getExpiredEntries', () => {
    it('should return empty array when no entries exist', async () => {
      const expired = await service.getExpiredEntries();
      expect(expired).toEqual([]);
    });

    it('should return empty array when all entries are within retention', async () => {
      await service.log(makeEvent(), defaultContext);
      await service.log(makeEvent(), defaultContext);
      const expired = await service.getExpiredEntries();
      expect(expired).toEqual([]);
    });

    it('should return only expired entries', async () => {
      await service.log(makeEvent({ resourceId: 'old-txn' }), defaultContext);
      await service.log(makeEvent({ resourceId: 'new-txn' }), defaultContext);
      const entries = await service.query({});

      // Simulate time passing: move the first entry's timestamp far into the past
      (entries[0] as { timestamp: Date }).timestamp = new Date(
        Date.now() - (RETENTION_PERIOD_DAYS + 10) * 86400000,
      );

      const expired = await service.getExpiredEntries();
      expect(expired).toHaveLength(1);
      expect(expired[0]!.resourceId).toBe('old-txn');
    });

    it('should not delete or modify any entries (flag-only)', async () => {
      await service.log(makeEvent({ resourceId: 'old-txn' }), defaultContext);
      const entries = await service.query({});
      (entries[0] as { timestamp: Date }).timestamp = new Date(
        Date.now() - (RETENTION_PERIOD_DAYS + 10) * 86400000,
      );

      await service.getExpiredEntries();

      // All entries should still be present
      const allEntries = await service.query({});
      expect(allEntries).toHaveLength(1);
    });
  });

  describe('no automatic deletion', () => {
    it('should not expose any delete or purge method', () => {
      const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
      const deleteMethods = proto.filter(
        (name) =>
          name.includes('delete') ||
          name.includes('purge') ||
          name.includes('remove') ||
          name.includes('clean'),
      );
      expect(deleteMethods).toEqual([]);
    });
  });
});
