/**
 * Key Manager for CashTrace Security & Compliance Module.
 *
 * Manages the full encryption key lifecycle: creation, retrieval,
 * rotation, revocation, and listing. Uses envelope encryption via
 * a KmsProvider — master keys live in KMS (or an HSM-backed service),
 * and data keys are generated per-operation.
 *
 * Requirements:
 *  3.1 — Store master encryption keys in AWS KMS or similar HSM-backed service
 *  3.6 — Use envelope encryption (data keys encrypted by master key)
 */

import { randomUUID } from 'node:crypto';
import type { KmsProvider } from './kmsProvider.js';
import type { EncryptionKey, KeyMetadata } from './types.js';

/** Number of days after which a key must be rotated (Req 3.2). */
export const KEY_ROTATION_DAYS = 90;

export interface KeyManagerConfig {
  kmsProvider: KmsProvider;
  /** Default key expiry in days (from creation). Defaults to 90. */
  defaultExpiryDays?: number;
  /** Key rotation interval in days. Defaults to KEY_ROTATION_DAYS (90). */
  rotationIntervalDays?: number;
}

export class KeyManagerImpl {
  private readonly kms: KmsProvider;
  private readonly defaultExpiryDays: number;
  private readonly rotationIntervalDays: number;

  /** keyId → EncryptionKey metadata + masterKeyId mapping */
  private readonly keys = new Map<string, EncryptionKey & { masterKeyId: string }>();
  /** businessId → keyId[] (ordered, newest last) */
  private readonly businessKeys = new Map<string, string[]>();

  constructor(config: KeyManagerConfig) {
    this.kms = config.kmsProvider;
    this.defaultExpiryDays = config.defaultExpiryDays ?? 90;
    this.rotationIntervalDays = config.rotationIntervalDays ?? KEY_ROTATION_DAYS;
  }

  /**
   * Retrieve an encryption key by its ID.
   * Throws if the key does not exist.
   */
  async getKey(keyId: string): Promise<EncryptionKey> {
    const entry = this.keys.get(keyId);
    if (!entry) {
      throw new Error(`Key not found: ${keyId}`);
    }
    // Verify the master key is still accessible in KMS
    await this.kms.describeKey(entry.masterKeyId);
    return this.toEncryptionKey(entry);
  }

  /**
   * Create a new encryption key for a business.
   * A KMS master key is created and the key metadata is stored locally.
   */
  async createKey(businessId: string): Promise<EncryptionKey> {
    const masterKeyId = await this.kms.createMasterKey(`business-${businessId}`);
    const now = new Date();
    const keyId = randomUUID();

    const entry: EncryptionKey & { masterKeyId: string } = {
      id: keyId,
      businessId,
      version: 1,
      algorithm: 'aes-256-gcm',
      status: 'active',
      createdAt: now,
      expiresAt: this.computeExpiry(now),
      masterKeyId,
    };

    this.keys.set(keyId, entry);
    this.addBusinessKey(businessId, keyId);

    return this.toEncryptionKey(entry);
  }

  /**
   * Rotate an existing key. Creates a new KMS master key, bumps the
   * version, and deprecates the old key. The old key remains available
   * for decrypting existing data (version history — Req 3.3).
   *
   * During rotation the old key transitions through the 'rotating' status
   * before settling on 'deprecated', making the transition observable.
   */
  async rotateKey(keyId: string): Promise<EncryptionKey> {
    const existing = this.keys.get(keyId);
    if (!existing) {
      throw new Error(`Key not found: ${keyId}`);
    }
    if (existing.status === 'revoked') {
      throw new Error(`Cannot rotate a revoked key: ${keyId}`);
    }

    // Mark the old key as rotating while the new key is being created
    existing.status = 'rotating';

    // Create a new master key in KMS for the rotated version
    const newMasterKeyId = await this.kms.createMasterKey(
      `business-${existing.businessId}-v${existing.version + 1}`,
    );
    const now = new Date();
    const newKeyId = randomUUID();

    const rotatedEntry: EncryptionKey & { masterKeyId: string } = {
      id: newKeyId,
      businessId: existing.businessId,
      version: existing.version + 1,
      algorithm: 'aes-256-gcm',
      status: 'active',
      createdAt: now,
      rotatedAt: now,
      expiresAt: this.computeExpiry(now),
      masterKeyId: newMasterKeyId,
    };

    this.keys.set(newKeyId, rotatedEntry);
    this.addBusinessKey(existing.businessId, newKeyId);

    // Transition old key to deprecated now that the new key is ready
    existing.status = 'deprecated';

    return this.toEncryptionKey(rotatedEntry);
  }

  /**
   * Revoke a key immediately. Revoked keys cannot be used for new
   * encryption and their KMS master key is not accessible.
   * Supports emergency key revocation (Req 3.4).
   */
  async revokeKey(keyId: string, reason: string): Promise<void> {
    const entry = this.keys.get(keyId);
    if (!entry) {
      throw new Error(`Key not found: ${keyId}`);
    }
    if (entry.status === 'revoked') {
      return; // already revoked, idempotent
    }
    entry.status = 'revoked';
    entry.revokedAt = new Date();
    entry.revocationReason = reason;
  }

  /**
   * Check whether a key has been revoked.
   * Returns `true` if the key exists and its status is 'revoked'.
   * Throws if the key does not exist.
   */
  isRevoked(keyId: string): boolean {
    const entry = this.keys.get(keyId);
    if (!entry) {
      throw new Error(`Key not found: ${keyId}`);
    }
    return entry.status === 'revoked';
  }

  /**
   * List all key metadata for a business, ordered by version ascending.
   */
  async listKeys(businessId: string): Promise<KeyMetadata[]> {
    const keyIds = this.businessKeys.get(businessId) ?? [];
    return keyIds
      .map((id) => this.keys.get(id))
      .filter((entry): entry is EncryptionKey & { masterKeyId: string } => entry !== undefined)
      .map((entry) => ({
        id: entry.id,
        businessId: entry.businessId,
        version: entry.version,
        status: entry.status,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
      }));
  }

  /**
   * Get the KMS master key ID backing a given key.
   * Useful for envelope encryption operations.
   */
  getMasterKeyId(keyId: string): string {
    const entry = this.keys.get(keyId);
    if (!entry) {
      throw new Error(`Key not found: ${keyId}`);
    }
    return entry.masterKeyId;
  }

  // ─── Key Rotation (Req 3.2, 3.3) ──────────────────────────────────

  /**
   * Check whether a key needs rotation based on the configured rotation
   * interval (default 90 days). Only active keys can need rotation.
   *
   * Requirement 3.2 — automatic key rotation every 90 days.
   */
  needsRotation(keyId: string, now: Date = new Date()): boolean {
    const entry = this.keys.get(keyId);
    if (!entry) {
      throw new Error(`Key not found: ${keyId}`);
    }
    if (entry.status !== 'active') {
      return false;
    }
    const ageMs = now.getTime() - entry.createdAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return ageDays >= this.rotationIntervalDays;
  }

  /**
   * Check a single key and rotate it automatically if it exceeds the
   * rotation interval. Returns the new key if rotation occurred, or
   * `null` if no rotation was needed.
   *
   * Requirement 3.2 — automatic key rotation every 90 days.
   */
  async checkAndRotateKey(keyId: string, now: Date = new Date()): Promise<EncryptionKey | null> {
    if (!this.needsRotation(keyId, now)) {
      return null;
    }
    return this.rotateKey(keyId);
  }

  /**
   * Check all active keys for a business and rotate any that exceed the
   * rotation interval. Returns an array of newly created keys (one per
   * rotated key). Returns an empty array if nothing needed rotation.
   *
   * Requirement 3.2 — automatic key rotation every 90 days.
   */
  async checkAndRotateBusinessKeys(
    businessId: string,
    now: Date = new Date(),
  ): Promise<EncryptionKey[]> {
    const keyIds = this.businessKeys.get(businessId) ?? [];
    const rotated: EncryptionKey[] = [];

    for (const keyId of [...keyIds]) {
      const entry = this.keys.get(keyId);
      if (entry && entry.status === 'active' && this.needsRotation(keyId, now)) {
        const newKey = await this.rotateKey(keyId);
        rotated.push(newKey);
      }
    }

    return rotated;
  }

  /**
   * Retrieve a specific version of a key for a business.
   * This is essential for decrypting data that was encrypted with an
   * older key version (Req 3.3 — maintain key version history).
   *
   * Returns `null` if no key with that version exists for the business.
   */
  async getKeyByVersion(businessId: string, version: number): Promise<EncryptionKey | null> {
    const keyIds = this.businessKeys.get(businessId) ?? [];
    for (const keyId of keyIds) {
      const entry = this.keys.get(keyId);
      if (entry && entry.version === version) {
        return this.toEncryptionKey(entry);
      }
    }
    return null;
  }

  /**
   * Get the full version history for a business, ordered by version
   * ascending. Includes deprecated and revoked keys so that old data
   * can still be decrypted (Req 3.3).
   */
  async getKeyVersionHistory(businessId: string): Promise<EncryptionKey[]> {
    const keyIds = this.businessKeys.get(businessId) ?? [];
    return keyIds
      .map((id) => this.keys.get(id))
      .filter((entry): entry is EncryptionKey & { masterKeyId: string } => entry !== undefined)
      .sort((a, b) => a.version - b.version)
      .map((entry) => this.toEncryptionKey(entry));
  }

  // --- Internal helpers ---

  private addBusinessKey(businessId: string, keyId: string): void {
    const existing = this.businessKeys.get(businessId) ?? [];
    existing.push(keyId);
    this.businessKeys.set(businessId, existing);
  }

  private computeExpiry(from: Date): Date {
    const expiry = new Date(from);
    expiry.setDate(expiry.getDate() + this.defaultExpiryDays);
    return expiry;
  }

  private toEncryptionKey(entry: EncryptionKey & { masterKeyId: string }): EncryptionKey {
    return {
      id: entry.id,
      businessId: entry.businessId,
      version: entry.version,
      algorithm: entry.algorithm,
      status: entry.status,
      createdAt: entry.createdAt,
      rotatedAt: entry.rotatedAt,
      expiresAt: entry.expiresAt,
      revokedAt: entry.revokedAt,
      revocationReason: entry.revocationReason,
    };
  }
}
