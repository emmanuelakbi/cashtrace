/**
 * Unit tests for the ProcessingRecordsService.
 *
 * Validates Requirement 7.5: Maintain records of processing activities.
 *
 * @module compliance/processingRecords.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ProcessingRecordsService } from './processingRecords.js';
import type { ProcessingRecord, LegalBasis } from './types.js';

function validInput() {
  return {
    businessId: 'biz-1',
    purpose: 'Invoice processing',
    legalBasis: 'contract' as LegalBasis,
    dataCategories: ['financial', 'contact'],
    dataSubjects: ['customers'],
    processors: ['CashTrace'],
    retentionPeriodDays: 2555,
  };
}

describe('ProcessingRecordsService', () => {
  let service: ProcessingRecordsService;

  beforeEach(() => {
    service = new ProcessingRecordsService();
  });

  describe('createRecord', () => {
    it('should create a record with auto-generated id and timestamps', async () => {
      const record = await service.createRecord(validInput());

      expect(record.id).toBeDefined();
      expect(record.businessId).toBe('biz-1');
      expect(record.purpose).toBe('Invoice processing');
      expect(record.legalBasis).toBe('contract');
      expect(record.dataCategories).toEqual(['financial', 'contact']);
      expect(record.processors).toEqual(['CashTrace']);
      expect(record.status).toBe('active');
      expect(record.createdAt).toBeInstanceOf(Date);
      expect(record.updatedAt).toBeInstanceOf(Date);
    });

    it('should throw if businessId is missing', async () => {
      await expect(service.createRecord({ ...validInput(), businessId: '' })).rejects.toThrow(
        'businessId',
      );
    });

    it('should throw if purpose is missing', async () => {
      await expect(service.createRecord({ ...validInput(), purpose: '' })).rejects.toThrow(
        'purpose',
      );
    });

    it('should throw if legalBasis is missing', async () => {
      await expect(
        service.createRecord({ ...validInput(), legalBasis: '' as LegalBasis }),
      ).rejects.toThrow('legalBasis');
    });

    it('should throw if dataCategories is empty', async () => {
      await expect(service.createRecord({ ...validInput(), dataCategories: [] })).rejects.toThrow(
        'data category',
      );
    });

    it('should throw if processors is empty', async () => {
      await expect(service.createRecord({ ...validInput(), processors: [] })).rejects.toThrow(
        'processor',
      );
    });
  });

  describe('getRecord', () => {
    it('should return a record by id', async () => {
      const created = await service.createRecord(validInput());
      const fetched = await service.getRecord(created.id);
      expect(fetched).toEqual(created);
    });

    it('should return undefined for unknown id', async () => {
      const result = await service.getRecord('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('updateRecord', () => {
    it('should update specified fields and bump updatedAt', async () => {
      const created = await service.createRecord(validInput());
      const updated = await service.updateRecord(created.id, {
        purpose: 'Payroll processing',
        legalBasis: 'legal_obligation',
      });

      expect(updated.purpose).toBe('Payroll processing');
      expect(updated.legalBasis).toBe('legal_obligation');
      expect(updated.businessId).toBe(created.businessId);
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
    });

    it('should throw for unknown record id', async () => {
      await expect(service.updateRecord('nonexistent', { purpose: 'x' })).rejects.toThrow(
        'not found',
      );
    });
  });

  describe('listRecords', () => {
    it('should return all records when no filter is provided', async () => {
      await service.createRecord(validInput());
      await service.createRecord({ ...validInput(), businessId: 'biz-2', purpose: 'Marketing' });

      const all = await service.listRecords();
      expect(all).toHaveLength(2);
    });

    it('should filter by businessId', async () => {
      await service.createRecord(validInput());
      await service.createRecord({ ...validInput(), businessId: 'biz-2' });

      const filtered = await service.listRecords({ businessId: 'biz-1' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].businessId).toBe('biz-1');
    });

    it('should filter by status', async () => {
      const r = await service.createRecord(validInput());
      await service.createRecord(validInput());
      await service.suspendRecord(r.id);

      const suspended = await service.listRecords({ status: 'suspended' });
      expect(suspended).toHaveLength(1);
      expect(suspended[0].status).toBe('suspended');
    });

    it('should filter by legalBasis', async () => {
      await service.createRecord(validInput());
      await service.createRecord({ ...validInput(), legalBasis: 'consent' });

      const filtered = await service.listRecords({ legalBasis: 'consent' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].legalBasis).toBe('consent');
    });

    it('should filter by purpose substring (case-insensitive)', async () => {
      await service.createRecord(validInput());
      await service.createRecord({ ...validInput(), purpose: 'Marketing emails' });

      const filtered = await service.listRecords({ purpose: 'marketing' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].purpose).toBe('Marketing emails');
    });

    it('should return empty array when no records match', async () => {
      await service.createRecord(validInput());
      const filtered = await service.listRecords({ businessId: 'nonexistent' });
      expect(filtered).toHaveLength(0);
    });
  });

  describe('suspendRecord', () => {
    it('should set status to suspended', async () => {
      const created = await service.createRecord(validInput());
      const suspended = await service.suspendRecord(created.id);
      expect(suspended.status).toBe('suspended');
    });

    it('should throw for unknown record', async () => {
      await expect(service.suspendRecord('nonexistent')).rejects.toThrow('not found');
    });

    it('should throw when suspending a terminated record', async () => {
      const created = await service.createRecord(validInput());
      await service.terminateRecord(created.id);
      await expect(service.suspendRecord(created.id)).rejects.toThrow('terminated');
    });
  });

  describe('terminateRecord', () => {
    it('should set status to terminated', async () => {
      const created = await service.createRecord(validInput());
      const terminated = await service.terminateRecord(created.id);
      expect(terminated.status).toBe('terminated');
    });

    it('should throw for unknown record', async () => {
      await expect(service.terminateRecord('nonexistent')).rejects.toThrow('not found');
    });

    it('should allow terminating a suspended record', async () => {
      const created = await service.createRecord(validInput());
      await service.suspendRecord(created.id);
      const terminated = await service.terminateRecord(created.id);
      expect(terminated.status).toBe('terminated');
    });
  });
});
