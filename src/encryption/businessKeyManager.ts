/**
 * Business Key Manager for per-business encryption key isolation.
 *
 * Maps each businessId to a unique KMS master key, ensuring data
 * encrypted for one business cannot be decrypted by another.
 * Keys are created on demand and cached for subsequent lookups.
 *
 * Requirements: 1.3 — unique encryption keys per business for data isolation.
 */

import type { KmsProvider } from './kmsProvider.js';

export class BusinessKeyManager {
  private readonly kms: KmsProvider;
  /** businessId → masterKeyId */
  private readonly keyMap = new Map<string, string>();

  constructor(kms: KmsProvider) {
    this.kms = kms;
  }

  /**
   * Get the master key ID for a business, creating one if it doesn't exist.
   */
  async getKeyForBusiness(businessId: string): Promise<string> {
    const existing = this.keyMap.get(businessId);
    if (existing) {
      return existing;
    }
    const masterKeyId = await this.kms.createMasterKey(`business-${businessId}`);
    this.keyMap.set(businessId, masterKeyId);
    return masterKeyId;
  }

  /**
   * Check whether a business already has an assigned key.
   */
  hasKey(businessId: string): boolean {
    return this.keyMap.has(businessId);
  }

  /**
   * Return the master key ID for a business, or undefined if none assigned.
   */
  getExistingKey(businessId: string): string | undefined {
    return this.keyMap.get(businessId);
  }

  /**
   * Register an externally-created key for a business.
   * Useful for restoring state or migrating keys.
   */
  registerKey(businessId: string, masterKeyId: string): void {
    this.keyMap.set(businessId, masterKeyId);
  }
}
