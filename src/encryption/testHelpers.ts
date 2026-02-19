/**
 * Test helpers for the Security & Compliance module.
 *
 * Provides pre-configured InMemoryKmsProvider instances and helper
 * functions for creating encryption contexts in property-based tests.
 */

import { InMemoryKmsProvider } from './inMemoryKmsProvider.js';
import type { FieldType } from './types.js';

/** A pre-initialized KMS provider with a master key ready to use. */
export interface TestKmsContext {
  kms: InMemoryKmsProvider;
  masterKeyId: string;
}

/**
 * Create a fresh InMemoryKmsProvider with a single master key.
 * Use this in beforeEach or at the start of each property test.
 */
export async function createTestKmsContext(alias = 'test-master-key'): Promise<TestKmsContext> {
  const kms = new InMemoryKmsProvider();
  const masterKeyId = await kms.createMasterKey(alias);
  return { kms, masterKeyId };
}

/**
 * Create multiple business-scoped master keys for testing key isolation.
 * Returns a map of businessId → masterKeyId.
 */
export async function createMultiBusinessKmsContext(
  businessIds: string[],
): Promise<{ kms: InMemoryKmsProvider; keyMap: Map<string, string> }> {
  const kms = new InMemoryKmsProvider();
  const keyMap = new Map<string, string>();

  for (const businessId of businessIds) {
    const masterKeyId = await kms.createMasterKey(`key-${businessId}`);
    keyMap.set(businessId, masterKeyId);
  }

  return { kms, keyMap };
}

/** Sample PII field values for property testing. */
export const samplePiiFields = [
  { value: 'John Doe', fieldType: 'pii' as FieldType },
  { value: 'john@example.com', fieldType: 'pii' as FieldType },
  { value: '+234-800-000-0000', fieldType: 'pii' as FieldType },
];

/** Sample financial field values for property testing. */
export const sampleFinancialFields = [
  { value: '1234567890', fieldType: 'financial' as FieldType },
  { value: '50000.00', fieldType: 'financial' as FieldType },
  { value: 'NGN', fieldType: 'financial' as FieldType },
];

/**
 * Generate a data key from the test context for use in encryption operations.
 * Returns both the plaintext key (for encrypting) and encrypted key (for storage).
 */
export async function generateTestDataKey(ctx: TestKmsContext) {
  return ctx.kms.generateDataKey(ctx.masterKeyId);
}
