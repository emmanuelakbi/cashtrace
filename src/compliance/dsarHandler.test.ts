import { describe, it, expect, beforeEach } from 'vitest';
import { DSARHandler, InMemoryDSARDataProvider } from './dsarHandler.js';
import type { UserPersonalData } from './dsarHandler.js';
import type { ConsentRecord } from './types.js';

describe('DSARHandler', () => {
  let handler: DSARHandler;
  let dataProvider: InMemoryDSARDataProvider;

  const sampleUser: UserPersonalData = {
    userId: 'user-1',
    name: 'Test User',
    email: 'test@example.com',
    phone: '+234-800-000-0000',
    address: '123 Lagos St',
    financialData: { accountNumber: '1234567890', balance: 50000 },
  };

  const sampleConsents: ConsentRecord[] = [
    {
      id: 'consent-1',
      userId: 'user-1',
      consentType: 'terms',
      version: '1.0',
      grantedAt: new Date('2024-01-01'),
      ipAddress: '192.168.1.1',
      userAgent: 'TestAgent/1.0',
    },
  ];

  const sampleActivityLog = [
    { action: 'login', timestamp: '2024-01-15T10:00:00Z' },
    { action: 'view_balance', timestamp: '2024-01-15T10:05:00Z' },
  ];

  beforeEach(() => {
    dataProvider = new InMemoryDSARDataProvider();
    dataProvider.setUserPersonalData('user-1', sampleUser);
    dataProvider.setUserConsents('user-1', sampleConsents);
    dataProvider.setUserActivityLog('user-1', sampleActivityLog);
    handler = new DSARHandler(dataProvider);
  });

  describe('submitRequest', () => {
    it('should submit a valid request and return an id', async () => {
      const id = await handler.submitRequest({
        userId: 'user-1',
        requestType: 'access',
        requestedBy: 'user-1',
        verificationMethod: 'email',
      });

      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
    });

    it('should set initial status to pending', async () => {
      const id = await handler.submitRequest({
        userId: 'user-1',
        requestType: 'access',
        requestedBy: 'user-1',
        verificationMethod: 'email',
      });

      const status = await handler.getRequestStatus(id);
      expect(status).toBe('pending');
    });

    it('should reject request with missing userId', async () => {
      await expect(
        handler.submitRequest({
          userId: '',
          requestType: 'access',
          requestedBy: 'admin',
          verificationMethod: 'email',
        }),
      ).rejects.toThrow('SEC_DSAR_INVALID');
    });

    it('should reject request with missing requestType', async () => {
      await expect(
        handler.submitRequest({
          userId: 'user-1',
          requestType: '' as 'access',
          requestedBy: 'admin',
          verificationMethod: 'email',
        }),
      ).rejects.toThrow('SEC_DSAR_INVALID');
    });

    it('should reject request with missing requestedBy', async () => {
      await expect(
        handler.submitRequest({
          userId: 'user-1',
          requestType: 'access',
          requestedBy: '',
          verificationMethod: 'email',
        }),
      ).rejects.toThrow('SEC_DSAR_INVALID');
    });

    it('should reject request with missing verificationMethod', async () => {
      await expect(
        handler.submitRequest({
          userId: 'user-1',
          requestType: 'access',
          requestedBy: 'admin',
          verificationMethod: '',
        }),
      ).rejects.toThrow('SEC_DSAR_INVALID');
    });

    it('should accept all valid DSAR types', async () => {
      const types = ['access', 'portability', 'erasure', 'rectification'] as const;
      for (const requestType of types) {
        const id = await handler.submitRequest({
          userId: 'user-1',
          requestType,
          requestedBy: 'user-1',
          verificationMethod: 'email',
        });
        expect(id).toBeTruthy();
      }
    });
  });

  describe('getRequestStatus', () => {
    it('should return status for a valid request', async () => {
      const id = await handler.submitRequest({
        userId: 'user-1',
        requestType: 'access',
        requestedBy: 'user-1',
        verificationMethod: 'email',
      });

      const status = await handler.getRequestStatus(id);
      expect(status).toBe('pending');
    });

    it('should throw for unknown request id', async () => {
      await expect(handler.getRequestStatus('nonexistent')).rejects.toThrow('SEC_DSAR_INVALID');
    });
  });

  describe('processRequest - access', () => {
    it('should process an access request and return user data', async () => {
      const id = await handler.submitRequest({
        userId: 'user-1',
        requestType: 'access',
        requestedBy: 'user-1',
        verificationMethod: 'email',
      });

      const result = await handler.processRequest(id);

      expect(result.requestId).toBe(id);
      expect(result.status).toBe('completed');
      expect(result.completedAt).toBeInstanceOf(Date);
      expect(result.data).toBeDefined();
      expect(result.data!.userId).toBe('user-1');
      expect(result.data!.format).toBe('json');
      expect(result.data!.personalData).toHaveProperty('name', 'Test User');
      expect(result.data!.personalData).toHaveProperty('email', 'test@example.com');
      expect(result.data!.consents).toHaveLength(1);
      expect(result.data!.activityLog).toHaveLength(2);
    });

    it('should update request status to completed after processing', async () => {
      const id = await handler.submitRequest({
        userId: 'user-1',
        requestType: 'access',
        requestedBy: 'user-1',
        verificationMethod: 'email',
      });

      await handler.processRequest(id);
      const status = await handler.getRequestStatus(id);
      expect(status).toBe('completed');
    });

    it('should return empty data for unknown user', async () => {
      const id = await handler.submitRequest({
        userId: 'unknown-user',
        requestType: 'access',
        requestedBy: 'unknown-user',
        verificationMethod: 'email',
      });

      const result = await handler.processRequest(id);
      expect(result.data).toBeDefined();
      expect(result.data!.personalData).toEqual({});
      expect(result.data!.consents).toEqual([]);
      expect(result.data!.activityLog).toEqual([]);
    });
  });

  describe('processRequest - portability', () => {
    it('should export data in machine-readable JSON format', async () => {
      const id = await handler.submitRequest({
        userId: 'user-1',
        requestType: 'portability',
        requestedBy: 'user-1',
        verificationMethod: 'email',
      });

      const result = await handler.processRequest(id);

      expect(result.data).toBeDefined();
      expect(result.data!.format).toBe('json');
      expect(result.data!.exportedAt).toBeInstanceOf(Date);
      expect(result.data!.personalData).toHaveProperty('name');
      expect(result.data!.personalData).toHaveProperty('email');
      expect(result.data!.consents).toHaveLength(1);
    });
  });

  describe('processRequest - erasure', () => {
    it('should delete user data and return deletion result', async () => {
      const id = await handler.submitRequest({
        userId: 'user-1',
        requestType: 'erasure',
        requestedBy: 'user-1',
        verificationMethod: 'email',
      });

      const result = await handler.processRequest(id);

      expect(result.deletionResult).toBeDefined();
      expect(result.deletionResult!.userId).toBe('user-1');
      expect(result.deletionResult!.deletedAt).toBeInstanceOf(Date);
      expect(result.deletionResult!.fieldsDeleted.length).toBeGreaterThan(0);
    });

    it('should retain financial data when retainRequired is true', async () => {
      const id = await handler.submitRequest({
        userId: 'user-1',
        requestType: 'erasure',
        requestedBy: 'user-1',
        verificationMethod: 'email',
      });

      const result = await handler.processRequest(id);

      expect(result.deletionResult!.fieldsRetained).toContain('financialData');
      expect(result.deletionResult!.retainedReason).toBeDefined();
    });

    it('should make user data inaccessible after erasure', async () => {
      const id = await handler.submitRequest({
        userId: 'user-1',
        requestType: 'erasure',
        requestedBy: 'user-1',
        verificationMethod: 'email',
      });

      await handler.processRequest(id);

      // Subsequent access request should return empty data
      const accessId = await handler.submitRequest({
        userId: 'user-1',
        requestType: 'access',
        requestedBy: 'user-1',
        verificationMethod: 'email',
      });

      const accessResult = await handler.processRequest(accessId);
      expect(accessResult.data!.personalData).toEqual({});
      expect(accessResult.data!.activityLog).toEqual([]);
    });
  });

  describe('processRequest - rectification', () => {
    it('should complete rectification request', async () => {
      const id = await handler.submitRequest({
        userId: 'user-1',
        requestType: 'rectification',
        requestedBy: 'user-1',
        verificationMethod: 'email',
      });

      const result = await handler.processRequest(id);
      expect(result.status).toBe('completed');
      expect(result.completedAt).toBeInstanceOf(Date);
    });
  });

  describe('processRequest - error cases', () => {
    it('should throw for unknown request id', async () => {
      await expect(handler.processRequest('nonexistent')).rejects.toThrow('SEC_DSAR_INVALID');
    });

    it('should throw when processing an already completed request', async () => {
      const id = await handler.submitRequest({
        userId: 'user-1',
        requestType: 'access',
        requestedBy: 'user-1',
        verificationMethod: 'email',
      });

      await handler.processRequest(id);
      await expect(handler.processRequest(id)).rejects.toThrow('not pending');
    });
  });

  describe('exportUserData', () => {
    it('should export all personal data for a user', async () => {
      const exported = await handler.exportUserData('user-1');

      expect(exported.userId).toBe('user-1');
      expect(exported.exportedAt).toBeInstanceOf(Date);
      expect(exported.format).toBe('json');
      expect(exported.personalData).toHaveProperty('name', 'Test User');
      expect(exported.personalData).toHaveProperty('email', 'test@example.com');
      expect(exported.personalData).toHaveProperty('phone', '+234-800-000-0000');
      expect(exported.consents).toHaveLength(1);
      expect(exported.activityLog).toHaveLength(2);
    });

    it('should return empty export for nonexistent user', async () => {
      const exported = await handler.exportUserData('ghost');

      expect(exported.userId).toBe('ghost');
      expect(exported.personalData).toEqual({});
      expect(exported.consents).toEqual([]);
      expect(exported.activityLog).toEqual([]);
    });
  });

  describe('deleteUserData', () => {
    it('should delete user data with retention', async () => {
      const result = await handler.deleteUserData('user-1', true);

      expect(result.userId).toBe('user-1');
      expect(result.deletedAt).toBeInstanceOf(Date);
      expect(result.fieldsDeleted).toContain('name');
      expect(result.fieldsDeleted).toContain('email');
      expect(result.fieldsRetained).toContain('financialData');
    });

    it('should delete all data when retainRequired is false', async () => {
      const result = await handler.deleteUserData('user-1', false);

      expect(result.fieldsDeleted.length).toBeGreaterThan(0);
      expect(result.fieldsRetained).toEqual([]);
      expect(result.retainedReason).toBeUndefined();
    });

    it('should handle deletion for nonexistent user gracefully', async () => {
      const result = await handler.deleteUserData('ghost', true);

      expect(result.userId).toBe('ghost');
      expect(result.fieldsDeleted).toEqual([]);
      expect(result.fieldsRetained).toEqual([]);
    });
  });
});
