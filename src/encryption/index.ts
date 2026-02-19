/**
 * Encryption Module for CashTrace Security & Compliance
 *
 * Provides AES-256-GCM encryption at rest, field-level encryption,
 * key management, and envelope encryption capabilities.
 *
 * @module encryption
 */

export type { EncryptedData, EncryptionKey, KeyMetadata, KeyStatus, FieldType } from './types.js';
export type {
  KmsProvider,
  DataKeyResult,
  KmsEncryptResult,
  KmsDecryptResult,
} from './kmsProvider.js';
export { InMemoryKmsProvider } from './inMemoryKmsProvider.js';
export { EncryptionServiceImpl } from './encryptionService.js';
export type { EncryptionServiceConfig } from './encryptionService.js';
export { KeyManagerImpl } from './keyManager.js';
export type { KeyManagerConfig } from './keyManager.js';
export { KeyCache } from './keyCache.js';
export type { KeyCacheConfig } from './keyCache.js';
export { BusinessKeyManager } from './businessKeyManager.js';
