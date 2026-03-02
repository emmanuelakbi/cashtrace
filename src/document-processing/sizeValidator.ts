/**
 * File size validation for document uploads.
 * Enforces individual file size limits, batch total limits,
 * and determines multipart upload threshold.
 */

import type { SizeValidation } from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum individual file size: 10MB */
export const MAX_FILE_SIZE = 10_485_760;

/** Maximum total batch size: 50MB */
export const MAX_BATCH_SIZE = 52_428_800;

/** Threshold for multipart upload: 5MB */
export const MULTIPART_THRESHOLD = 5_242_880;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Validate an individual file size against the 10MB limit.
 * Returns a SizeValidation result with the file size and limit info.
 */
export function validateFileSize(size: number): SizeValidation {
  if (size > MAX_FILE_SIZE) {
    return {
      valid: false,
      size,
      limit: MAX_FILE_SIZE,
      error: `File size ${size} bytes exceeds the maximum limit of ${MAX_FILE_SIZE} bytes (10MB)`,
    };
  }

  return {
    valid: true,
    size,
    limit: MAX_FILE_SIZE,
  };
}

/**
 * Validate the total size of a batch of files against the 50MB limit.
 * Returns a SizeValidation result with the total size and limit info.
 */
export function validateBatchSize(sizes: number[]): SizeValidation {
  const totalSize = sizes.reduce((sum, s) => sum + s, 0);

  if (totalSize > MAX_BATCH_SIZE) {
    return {
      valid: false,
      size: totalSize,
      limit: MAX_BATCH_SIZE,
      error: `Batch total size ${totalSize} bytes exceeds the maximum limit of ${MAX_BATCH_SIZE} bytes (50MB)`,
    };
  }

  return {
    valid: true,
    size: totalSize,
    limit: MAX_BATCH_SIZE,
  };
}

/**
 * Determine whether a file should use multipart upload.
 * Returns true if the file size exceeds the 5MB threshold.
 */
export function shouldUseMultipart(size: number): boolean {
  return size > MULTIPART_THRESHOLD;
}
