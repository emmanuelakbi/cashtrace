import { describe, it, expect, beforeEach } from 'vitest';
import { VendorManager } from './vendorManager.js';
import type { VendorStatus } from './types.js';

const baseDate = new Date('2024-06-01T12:00:00Z');

function createManager() {
  return new VendorManager();
}

describe('VendorManager', () => {
  let manager: VendorManager;

  beforeEach(() => {
    manager = createManager();
  });

  // ─── addVendor ───

  describe('addVendor()', () => {
    it('registers a vendor with all provided fields', () => {
      const vendor = manager.addVendor({
        name: 'Paystack',
        description: 'Payment gateway',
        dataShared: ['transaction_amounts', 'account_numbers'],
        integrationDate: baseDate,
        status: 'active',
      });

      expect(vendor.id).toBeDefined();
      expect(vendor.name).toBe('Paystack');
      expect(vendor.description).toBe('Payment gateway');
      expect(vendor.dataShared).toEqual(['transaction_amounts', 'account_numbers']);
      expect(vendor.integrationDate).toEqual(baseDate);
      expect(vendor.status).toBe('active');
    });

    it('defaults status to pending_review', () => {
      const vendor = manager.addVendor({
        name: 'Vendor A',
        description: 'Test vendor',
        dataShared: [],
      });
      expect(vendor.status).toBe('pending_review');
    });

    it('assigns unique ids', () => {
      const a = manager.addVendor({ name: 'A', description: 'A', dataShared: [] });
      const b = manager.addVendor({ name: 'B', description: 'B', dataShared: [] });
      expect(a.id).not.toBe(b.id);
    });
  });

  // ─── getVendor ───

  describe('getVendor()', () => {
    it('retrieves a vendor by id', () => {
      const created = manager.addVendor({
        name: 'Paystack',
        description: 'Payment gateway',
        dataShared: ['transactions'],
        integrationDate: baseDate,
      });

      const retrieved = manager.getVendor(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe('Paystack');
    });

    it('returns undefined for unknown id', () => {
      expect(manager.getVendor('nonexistent')).toBeUndefined();
    });

    it('returns a copy (not a reference)', () => {
      const created = manager.addVendor({
        name: 'V',
        description: 'V',
        dataShared: ['email'],
      });
      const a = manager.getVendor(created.id);
      const b = manager.getVendor(created.id);
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
      expect(a!.dataShared).not.toBe(b!.dataShared);
    });
  });

  // ─── getVendors ───

  describe('getVendors()', () => {
    it('returns all vendors when no filter is provided', () => {
      manager.addVendor({ name: 'A', description: 'A', dataShared: [] });
      manager.addVendor({ name: 'B', description: 'B', dataShared: [] });
      expect(manager.getVendors()).toHaveLength(2);
    });

    it('filters by status', () => {
      manager.addVendor({ name: 'A', description: 'A', dataShared: [], status: 'active' });
      manager.addVendor({ name: 'B', description: 'B', dataShared: [], status: 'suspended' });
      manager.addVendor({ name: 'C', description: 'C', dataShared: [], status: 'active' });

      expect(manager.getVendors({ status: 'active' })).toHaveLength(2);
      expect(manager.getVendors({ status: 'suspended' })).toHaveLength(1);
      expect(manager.getVendors({ status: 'revoked' })).toHaveLength(0);
    });

    it('returns empty array when no vendors exist', () => {
      expect(manager.getVendors()).toHaveLength(0);
    });
  });

  // ─── updateVendor ───

  describe('updateVendor()', () => {
    it('updates vendor fields', () => {
      const vendor = manager.addVendor({
        name: 'Old Name',
        description: 'Old desc',
        dataShared: ['email'],
        status: 'pending_review',
      });

      const updated = manager.updateVendor(vendor.id, {
        name: 'New Name',
        status: 'active',
      });

      expect(updated).toBeDefined();
      expect(updated!.name).toBe('New Name');
      expect(updated!.status).toBe('active');
      expect(updated!.description).toBe('Old desc');
    });

    it('updates dataShared', () => {
      const vendor = manager.addVendor({
        name: 'V',
        description: 'V',
        dataShared: ['email'],
      });

      const updated = manager.updateVendor(vendor.id, {
        dataShared: ['email', 'phone'],
      });

      expect(updated!.dataShared).toEqual(['email', 'phone']);
    });

    it('returns undefined for unknown vendor', () => {
      expect(manager.updateVendor('nonexistent', { name: 'X' })).toBeUndefined();
    });

    it('persists updates for later retrieval', () => {
      const vendor = manager.addVendor({
        name: 'V',
        description: 'V',
        dataShared: [],
        status: 'pending_review',
      });

      manager.updateVendor(vendor.id, { status: 'active' });
      const retrieved = manager.getVendor(vendor.id);
      expect(retrieved!.status).toBe('active');
    });
  });

  // ─── removeVendor ───

  describe('removeVendor()', () => {
    it('removes an existing vendor', () => {
      const vendor = manager.addVendor({ name: 'V', description: 'V', dataShared: [] });
      expect(manager.removeVendor(vendor.id)).toBe(true);
      expect(manager.getVendor(vendor.id)).toBeUndefined();
    });

    it('returns false for unknown vendor', () => {
      expect(manager.removeVendor('nonexistent')).toBe(false);
    });
  });

  // ─── getVendorsByDataType ───

  describe('getVendorsByDataType()', () => {
    it('finds vendors sharing a specific data type', () => {
      manager.addVendor({ name: 'A', description: 'A', dataShared: ['email', 'phone'] });
      manager.addVendor({ name: 'B', description: 'B', dataShared: ['email'] });
      manager.addVendor({ name: 'C', description: 'C', dataShared: ['transactions'] });

      const emailVendors = manager.getVendorsByDataType('email');
      expect(emailVendors).toHaveLength(2);
      expect(emailVendors.map((v) => v.name).sort()).toEqual(['A', 'B']);
    });

    it('returns empty array when no vendors share the data type', () => {
      manager.addVendor({ name: 'A', description: 'A', dataShared: ['email'] });
      expect(manager.getVendorsByDataType('biometrics')).toHaveLength(0);
    });

    it('returns copies (not references)', () => {
      manager.addVendor({ name: 'A', description: 'A', dataShared: ['email'] });
      const results = manager.getVendorsByDataType('email');
      const results2 = manager.getVendorsByDataType('email');
      expect(results[0]).toEqual(results2[0]);
      expect(results[0]).not.toBe(results2[0]);
    });
  });

  // ─── Vendor statuses ───

  describe('vendor statuses', () => {
    const statuses: VendorStatus[] = ['active', 'suspended', 'revoked', 'pending_review'];

    it.each(statuses)('supports %s status', (status) => {
      const vendor = manager.addVendor({
        name: 'V',
        description: 'V',
        dataShared: [],
        status,
      });
      expect(vendor.status).toBe(status);
    });
  });

  // ─── revokeAccess (Requirement 12.5) ───

  describe('revokeAccess()', () => {
    it('sets vendor status to revoked and returns a revocation record', () => {
      const vendor = manager.addVendor({
        name: 'Paystack',
        description: 'Payment gateway',
        dataShared: ['transactions'],
        status: 'active',
      });

      const record = manager.revokeAccess(vendor.id, 'Security breach', 'admin@co.ng');

      expect(record).toBeDefined();
      expect(record!.vendorId).toBe(vendor.id);
      expect(record!.reason).toBe('Security breach');
      expect(record!.revokedBy).toBe('admin@co.ng');
      expect(record!.revokedAt).toBeInstanceOf(Date);

      const updated = manager.getVendor(vendor.id);
      expect(updated!.status).toBe('revoked');
    });

    it('returns undefined for unknown vendor', () => {
      expect(manager.revokeAccess('nonexistent', 'reason', 'user')).toBeUndefined();
    });

    it('can revoke a vendor that is already revoked (idempotent)', () => {
      const vendor = manager.addVendor({
        name: 'V',
        description: 'V',
        dataShared: [],
        status: 'revoked',
      });

      const record = manager.revokeAccess(vendor.id, 'Double revoke', 'admin');
      expect(record).toBeDefined();
      expect(manager.getVendor(vendor.id)!.status).toBe('revoked');
    });
  });

  // ─── getRevokedVendors (Requirement 12.5) ───

  describe('getRevokedVendors()', () => {
    it('returns only vendors with revoked status', () => {
      manager.addVendor({ name: 'A', description: 'A', dataShared: [], status: 'active' });
      const b = manager.addVendor({
        name: 'B',
        description: 'B',
        dataShared: [],
        status: 'active',
      });
      manager.addVendor({ name: 'C', description: 'C', dataShared: [], status: 'suspended' });

      manager.revokeAccess(b.id, 'Compliance issue', 'admin');

      const revoked = manager.getRevokedVendors();
      expect(revoked).toHaveLength(1);
      expect(revoked[0].name).toBe('B');
    });

    it('returns empty array when no vendors are revoked', () => {
      manager.addVendor({ name: 'A', description: 'A', dataShared: [], status: 'active' });
      expect(manager.getRevokedVendors()).toHaveLength(0);
    });
  });

  // ─── getRevocationRecord ───

  describe('getRevocationRecord()', () => {
    it('returns the revocation record for a revoked vendor', () => {
      const vendor = manager.addVendor({
        name: 'V',
        description: 'V',
        dataShared: [],
        status: 'active',
      });

      manager.revokeAccess(vendor.id, 'Data leak', 'security-team');

      const record = manager.getRevocationRecord(vendor.id);
      expect(record).toBeDefined();
      expect(record!.reason).toBe('Data leak');
      expect(record!.revokedBy).toBe('security-team');
    });

    it('returns undefined when vendor was never revoked', () => {
      const vendor = manager.addVendor({
        name: 'V',
        description: 'V',
        dataShared: [],
        status: 'active',
      });
      expect(manager.getRevocationRecord(vendor.id)).toBeUndefined();
    });

    it('returns a copy (not a reference)', () => {
      const vendor = manager.addVendor({
        name: 'V',
        description: 'V',
        dataShared: [],
      });
      manager.revokeAccess(vendor.id, 'reason', 'user');

      const a = manager.getRevocationRecord(vendor.id);
      const b = manager.getRevocationRecord(vendor.id);
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
    });
  });
});
