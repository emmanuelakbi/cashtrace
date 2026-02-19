/**
 * KMS Provider abstraction for key management operations.
 *
 * Defines the interface for KMS operations and provides an in-memory
 * implementation for development/testing. In production, this can be
 * backed by AWS KMS or another HSM-backed service.
 *
 * Supports envelope encryption: data keys are generated and encrypted
 * by the master key, so only encrypted data keys are stored alongside data.
 */

/** Result of generating a data key via envelope encryption */
export interface DataKeyResult {
  /** Plaintext data key (use for encryption, then discard) */
  plaintextKey: Buffer;
  /** Encrypted data key (store alongside encrypted data) */
  encryptedKey: Buffer;
  /** Identifier of the master key that encrypted this data key */
  masterKeyId: string;
}

/** Result of a KMS encrypt operation */
export interface KmsEncryptResult {
  ciphertext: Buffer;
  keyId: string;
}

/** Result of a KMS decrypt operation */
export interface KmsDecryptResult {
  plaintext: Buffer;
  keyId: string;
}

/**
 * Abstract KMS provider interface.
 *
 * Implementations must support:
 * - Generating data keys (envelope encryption)
 * - Encrypting arbitrary data with a master key
 * - Decrypting data previously encrypted with a master key
 */
export interface KmsProvider {
  /** Generate a new data key, returning both plaintext and encrypted forms */
  generateDataKey(masterKeyId: string, keyLengthBytes?: number): Promise<DataKeyResult>;

  /** Encrypt plaintext using the specified master key */
  encrypt(masterKeyId: string, plaintext: Buffer): Promise<KmsEncryptResult>;

  /** Decrypt ciphertext that was encrypted by the specified master key */
  decrypt(masterKeyId: string, ciphertext: Buffer): Promise<KmsDecryptResult>;

  /** Check if a master key exists and is usable */
  describeKey(masterKeyId: string): Promise<{ keyId: string; enabled: boolean }>;

  /** Create a new master key, returning its ID */
  createMasterKey(alias?: string): Promise<string>;
}
