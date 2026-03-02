/**
 * Idempotency service for document retry processing.
 *
 * Generates deterministic idempotency keys using SHA-256 hashing and
 * checks for existing documents with the same key to prevent duplicate
 * transaction creation during retries.
 *
 * Requirements: 6.4
 * @module document-processing/idempotencyService
 */

import { createHash } from 'node:crypto';

import * as documentRepository from './documentRepository.js';

/**
 * Generate a deterministic idempotency key for a retry operation.
 *
 * Uses SHA-256 hash of `${documentId}:${attempt}` to produce a
 * consistent 64-character hex string for any given document + attempt pair.
 *
 * @param documentId - The document UUID
 * @param attempt - The retry attempt number (1-based)
 * @returns A 64-character hex string idempotency key
 */
export function generateIdempotencyKey(documentId: string, attempt: number): string {
  return createHash('sha256').update(`${documentId}:${attempt}`).digest('hex');
}

/**
 * Check whether a document with the given idempotency key already exists.
 *
 * @param key - The idempotency key to look up
 * @returns true if a document with this key exists, false otherwise
 */
export async function checkIdempotencyKey(key: string): Promise<boolean> {
  const existing = await documentRepository.findDocumentByIdempotencyKey(key);
  return existing !== null;
}

/**
 * Set the idempotency key on a document record.
 *
 * @param documentId - The document UUID to update
 * @param key - The idempotency key to set
 */
export async function setIdempotencyKey(documentId: string, key: string): Promise<void> {
  await documentRepository.setDocumentIdempotencyKey(documentId, key);
}
