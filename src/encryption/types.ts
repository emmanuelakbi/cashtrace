/**
 * Type definitions for the Encryption module.
 */

export interface EncryptedData {
  ciphertext: string;
  keyId: string;
  keyVersion: number;
  algorithm: string;
  iv: string;
  tag: string;
}

export type FieldType = 'pii' | 'financial' | 'sensitive' | 'standard';

export type KeyStatus = 'active' | 'rotating' | 'deprecated' | 'revoked';

export interface EncryptionKey {
  id: string;
  businessId: string;
  version: number;
  algorithm: string;
  status: KeyStatus;
  createdAt: Date;
  rotatedAt?: Date;
  expiresAt?: Date;
  revokedAt?: Date;
  revocationReason?: string;
}

export interface KeyMetadata {
  id: string;
  businessId: string;
  version: number;
  status: KeyStatus;
  createdAt: Date;
  expiresAt?: Date;
}
