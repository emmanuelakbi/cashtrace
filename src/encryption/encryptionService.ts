/**
 * Encryption Service for CashTrace Security & Compliance Module.
 *
 * Provides AES-256-GCM encryption at rest with field-level encryption
 * support for PII and financial data. Uses envelope encryption via
 * a KmsProvider for key management.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { KmsProvider } from './kmsProvider.js';
import type { BusinessKeyManager } from './businessKeyManager.js';
import type { EncryptedData, FieldType } from './types.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const DATA_KEY_LENGTH = 32;

export interface EncryptionServiceConfig {
  kmsProvider: KmsProvider;
  defaultMasterKeyId: string;
  businessKeyManager?: BusinessKeyManager;
}

interface FieldEnvelope {
  encryptedDataKey: string;
  payload: EncryptedData;
}

export class EncryptionServiceImpl {
  private readonly kms: KmsProvider;
  private readonly defaultMasterKeyId: string;
  private readonly businessKeyManager?: BusinessKeyManager;

  constructor(config: EncryptionServiceConfig) {
    this.kms = config.kmsProvider;
    this.defaultMasterKeyId = config.defaultMasterKeyId;
    this.businessKeyManager = config.businessKeyManager;
  }

  /**
   * Encrypt plaintext using envelope encryption with AES-256-GCM.
   * A fresh data key is generated via KMS for each encryption operation.
   */
  async encrypt(plaintext: string, keyId: string): Promise<EncryptedData> {
    const { plaintextKey, encryptedKey } = await this.kms.generateDataKey(keyId, DATA_KEY_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, plaintextKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const encKeyB64 = encryptedKey.toString('base64');
    const ciphertextB64 = encrypted.toString('base64');
    return {
      ciphertext: encKeyB64 + '.' + ciphertextB64,
      keyId,
      keyVersion: 1,
      algorithm: ALGORITHM,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
    };
  }

  /**
   * Decrypt data that was encrypted with the encrypt method.
   * Recovers the data key from KMS, then decrypts the ciphertext.
   */
  async decrypt(encryptedData: EncryptedData): Promise<string> {
    const dotIndex = encryptedData.ciphertext.indexOf('.');
    if (dotIndex === -1) {
      throw new Error('Invalid encrypted data format');
    }
    const encryptedKey = Buffer.from(encryptedData.ciphertext.substring(0, dotIndex), 'base64');
    const ciphertext = Buffer.from(encryptedData.ciphertext.substring(dotIndex + 1), 'base64');
    const iv = Buffer.from(encryptedData.iv, 'base64');
    const tag = Buffer.from(encryptedData.tag, 'base64');
    const { plaintext: dataKey } = await this.kms.decrypt(encryptedData.keyId, encryptedKey);
    const decipher = createDecipheriv(ALGORITHM, dataKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /**
   * Encrypt a field value for storage. Wraps the value in a self-contained
   * envelope with the encrypted data key, suitable for column-level encryption.
   */
  async encryptField(value: unknown, fieldType: FieldType): Promise<string> {
    const serialized = this.serializeFieldValue(value, fieldType);
    const { plaintextKey, encryptedKey } = await this.kms.generateDataKey(
      this.defaultMasterKeyId,
      DATA_KEY_LENGTH,
    );
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, plaintextKey, iv);
    const encrypted = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const envelope: FieldEnvelope = {
      encryptedDataKey: encryptedKey.toString('base64'),
      payload: {
        ciphertext: encrypted.toString('base64'),
        keyId: this.defaultMasterKeyId,
        keyVersion: 1,
        algorithm: ALGORITHM,
        iv: iv.toString('base64'),
        tag: authTag.toString('base64'),
      },
    };
    return Buffer.from(JSON.stringify(envelope)).toString('base64');
  }

  /**
   * Decrypt a field value that was encrypted with encryptField.
   * Parses the envelope, recovers the data key, and decrypts.
   */
  async decryptField(encryptedStr: string, fieldType: FieldType): Promise<unknown> {
    const envelope: FieldEnvelope = JSON.parse(
      Buffer.from(encryptedStr, 'base64').toString('utf8'),
    );
    const encryptedKey = Buffer.from(envelope.encryptedDataKey, 'base64');
    const { plaintext: dataKey } = await this.kms.decrypt(envelope.payload.keyId, encryptedKey);
    const iv = Buffer.from(envelope.payload.iv, 'base64');
    const tag = Buffer.from(envelope.payload.tag, 'base64');
    const ciphertext = Buffer.from(envelope.payload.ciphertext, 'base64');
    const decipher = createDecipheriv(ALGORITHM, dataKey, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf8',
    );
    return this.deserializeFieldValue(decrypted, fieldType);
  }

  /**
   * Encrypt a field value using the business-specific master key.
   * Requires a BusinessKeyManager to be configured.
   */
  async encryptFieldForBusiness(
    value: unknown,
    fieldType: FieldType,
    businessId: string,
  ): Promise<string> {
    if (!this.businessKeyManager) {
      throw new Error('BusinessKeyManager not configured');
    }
    const masterKeyId = await this.businessKeyManager.getKeyForBusiness(businessId);
    const serialized = this.serializeFieldValue(value, fieldType);
    const { plaintextKey, encryptedKey } = await this.kms.generateDataKey(
      masterKeyId,
      DATA_KEY_LENGTH,
    );
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, plaintextKey, iv);
    const encrypted = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const envelope: FieldEnvelope = {
      encryptedDataKey: encryptedKey.toString('base64'),
      payload: {
        ciphertext: encrypted.toString('base64'),
        keyId: masterKeyId,
        keyVersion: 1,
        algorithm: ALGORITHM,
        iv: iv.toString('base64'),
        tag: authTag.toString('base64'),
      },
    };
    return Buffer.from(JSON.stringify(envelope)).toString('base64');
  }

  private serializeFieldValue(value: unknown, _fieldType: FieldType): string {
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  }

  private deserializeFieldValue(raw: string, _fieldType: FieldType): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
}
