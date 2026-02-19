/**
 * In-memory KMS provider for development and testing.
 *
 * Simulates AWS KMS behavior using Node.js crypto:
 * - Master keys are random 256-bit keys stored in memory
 * - Data keys are generated and encrypted using AES-256-GCM under the master key
 * - No external dependencies required
 *
 * NOT for production use. Replace with an AWS KMS-backed provider in production.
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type {
  KmsProvider,
  DataKeyResult,
  KmsEncryptResult,
  KmsDecryptResult,
} from './kmsProvider.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const DEFAULT_DATA_KEY_LENGTH = 32; // 256 bits

interface MasterKeyEntry {
  keyId: string;
  keyMaterial: Buffer;
  alias?: string;
  enabled: boolean;
  createdAt: Date;
}

export class InMemoryKmsProvider implements KmsProvider {
  private readonly masterKeys = new Map<string, MasterKeyEntry>();

  async generateDataKey(
    masterKeyId: string,
    keyLengthBytes: number = DEFAULT_DATA_KEY_LENGTH,
  ): Promise<DataKeyResult> {
    const masterKey = this.getMasterKeyOrThrow(masterKeyId);

    const plaintextKey = randomBytes(keyLengthBytes);
    const { ciphertext } = this.encryptWithMasterKey(masterKey.keyMaterial, plaintextKey);

    return {
      plaintextKey,
      encryptedKey: ciphertext,
      masterKeyId,
    };
  }

  async encrypt(masterKeyId: string, plaintext: Buffer): Promise<KmsEncryptResult> {
    const masterKey = this.getMasterKeyOrThrow(masterKeyId);
    const { ciphertext } = this.encryptWithMasterKey(masterKey.keyMaterial, plaintext);

    return { ciphertext, keyId: masterKeyId };
  }

  async decrypt(masterKeyId: string, ciphertext: Buffer): Promise<KmsDecryptResult> {
    const masterKey = this.getMasterKeyOrThrow(masterKeyId);
    const plaintext = this.decryptWithMasterKey(masterKey.keyMaterial, ciphertext);

    return { plaintext, keyId: masterKeyId };
  }

  async describeKey(masterKeyId: string): Promise<{ keyId: string; enabled: boolean }> {
    const entry = this.masterKeys.get(masterKeyId);
    if (!entry) {
      throw new Error(`Master key not found: ${masterKeyId}`);
    }
    return { keyId: entry.keyId, enabled: entry.enabled };
  }

  async createMasterKey(alias?: string): Promise<string> {
    const keyId = randomUUID();
    const keyMaterial = randomBytes(32);

    this.masterKeys.set(keyId, {
      keyId,
      keyMaterial,
      alias,
      enabled: true,
      createdAt: new Date(),
    });

    return keyId;
  }

  /**
   * Disable a master key (for testing key revocation scenarios).
   */
  disableKey(masterKeyId: string): void {
    const entry = this.masterKeys.get(masterKeyId);
    if (!entry) {
      throw new Error(`Master key not found: ${masterKeyId}`);
    }
    entry.enabled = false;
  }

  /**
   * Enable a previously disabled master key.
   */
  enableKey(masterKeyId: string): void {
    const entry = this.masterKeys.get(masterKeyId);
    if (!entry) {
      throw new Error(`Master key not found: ${masterKeyId}`);
    }
    entry.enabled = true;
  }

  // --- Internal helpers ---

  private getMasterKeyOrThrow(masterKeyId: string): MasterKeyEntry {
    const entry = this.masterKeys.get(masterKeyId);
    if (!entry) {
      throw new Error(`Master key not found: ${masterKeyId}`);
    }
    if (!entry.enabled) {
      throw new Error(`Master key is disabled: ${masterKeyId}`);
    }
    return entry;
  }

  /**
   * Encrypt data with a master key using AES-256-GCM.
   * Returns a single buffer: [iv (12 bytes) | tag (16 bytes) | ciphertext]
   */
  private encryptWithMasterKey(keyMaterial: Buffer, plaintext: Buffer): { ciphertext: Buffer } {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, keyMaterial, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Pack as: iv | tag | encrypted
    const ciphertext = Buffer.concat([iv, tag, encrypted]);
    return { ciphertext };
  }

  /**
   * Decrypt data with a master key using AES-256-GCM.
   * Expects buffer format: [iv (12 bytes) | tag (16 bytes) | ciphertext]
   */
  private decryptWithMasterKey(keyMaterial: Buffer, packed: Buffer): Buffer {
    if (packed.length < IV_LENGTH + TAG_LENGTH) {
      throw new Error('Invalid ciphertext: too short');
    }

    const iv = packed.subarray(0, IV_LENGTH);
    const tag = packed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = packed.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, keyMaterial, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
