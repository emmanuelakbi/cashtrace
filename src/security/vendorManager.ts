/**
 * Vendor Manager for CashTrace Security & Compliance Module.
 *
 * Maintains an inventory of third-party services and the data
 * shared with each vendor.
 *
 * @module security/vendorManager
 *
 * Requirement 12.1: Maintain inventory of third-party services and data shared.
 */

import { randomUUID } from 'node:crypto';
import type { Vendor, VendorStatus, RevocationRecord } from './types.js';

export class VendorManager {
  /** In-memory store keyed by vendor id. */
  private readonly vendors = new Map<string, Vendor>();

  /** Revocation records keyed by vendor id. */
  private readonly revocations = new Map<string, RevocationRecord>();

  /**
   * Register a new third-party vendor.
   *
   * Requirement 12.1: Maintain inventory of third-party services and data shared.
   */
  addVendor(params: {
    name: string;
    description: string;
    dataShared: string[];
    integrationDate?: Date;
    status?: VendorStatus;
  }): Vendor {
    const vendor: Vendor = {
      id: randomUUID(),
      name: params.name,
      description: params.description,
      dataShared: [...params.dataShared],
      integrationDate: params.integrationDate ?? new Date(),
      status: params.status ?? 'pending_review',
    };
    this.vendors.set(vendor.id, vendor);
    return { ...vendor, dataShared: [...vendor.dataShared] };
  }

  /**
   * Get a single vendor by id.
   */
  getVendor(id: string): Vendor | undefined {
    const vendor = this.vendors.get(id);
    return vendor ? { ...vendor, dataShared: [...vendor.dataShared] } : undefined;
  }

  /**
   * Get all vendors, optionally filtered by status.
   */
  getVendors(filter?: { status?: VendorStatus }): Vendor[] {
    let results = [...this.vendors.values()];
    if (filter?.status) {
      results = results.filter((v) => v.status === filter.status);
    }
    return results.map((v) => ({ ...v, dataShared: [...v.dataShared] }));
  }

  /**
   * Update an existing vendor.
   * Returns the updated vendor, or undefined if not found.
   */
  updateVendor(
    id: string,
    updates: Partial<Pick<Vendor, 'name' | 'description' | 'dataShared' | 'status'>>,
  ): Vendor | undefined {
    const vendor = this.vendors.get(id);
    if (!vendor) return undefined;

    const updated: Vendor = {
      ...vendor,
      ...updates,
      dataShared: updates.dataShared ? [...updates.dataShared] : [...vendor.dataShared],
    };

    this.vendors.set(id, updated);
    return { ...updated, dataShared: [...updated.dataShared] };
  }

  /**
   * Remove a vendor from the inventory.
   * Returns true if the vendor was removed, false if not found.
   */
  removeVendor(id: string): boolean {
    return this.vendors.delete(id);
  }

  /**
   * Find vendors that share a specific data type.
   *
   * Requirement 12.1: Maintain inventory of third-party services and data shared.
   */
  getVendorsByDataType(dataType: string): Vendor[] {
    return [...this.vendors.values()]
      .filter((v) => v.dataShared.includes(dataType))
      .map((v) => ({ ...v, dataShared: [...v.dataShared] }));
  }

  /**
   * Revoke a vendor's access, setting status to 'revoked' and recording the revocation.
   *
   * Requirement 12.5: Support third-party access revocation.
   */
  revokeAccess(vendorId: string, reason: string, revokedBy: string): RevocationRecord | undefined {
    const vendor = this.vendors.get(vendorId);
    if (!vendor) return undefined;

    vendor.status = 'revoked';

    const record: RevocationRecord = {
      vendorId,
      reason,
      revokedBy,
      revokedAt: new Date(),
    };
    this.revocations.set(vendorId, record);

    return { ...record };
  }

  /**
   * Get all vendors whose access has been revoked.
   *
   * Requirement 12.5: Support third-party access revocation.
   */
  getRevokedVendors(): Vendor[] {
    return this.getVendors({ status: 'revoked' });
  }

  /**
   * Get the revocation record for a specific vendor.
   */
  getRevocationRecord(vendorId: string): RevocationRecord | undefined {
    const record = this.revocations.get(vendorId);
    return record ? { ...record } : undefined;
  }
}
