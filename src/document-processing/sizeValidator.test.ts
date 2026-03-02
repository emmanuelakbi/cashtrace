import { describe, expect, it } from 'vitest';

import {
  MAX_BATCH_SIZE,
  MAX_FILE_SIZE,
  MULTIPART_THRESHOLD,
  shouldUseMultipart,
  validateBatchSize,
  validateFileSize,
} from './sizeValidator.js';

// ─── validateFileSize ────────────────────────────────────────────────────────

describe('validateFileSize', () => {
  it('accepts a file exactly at the 10MB limit', () => {
    const result = validateFileSize(MAX_FILE_SIZE);
    expect(result.valid).toBe(true);
    expect(result.size).toBe(MAX_FILE_SIZE);
    expect(result.limit).toBe(MAX_FILE_SIZE);
    expect(result.error).toBeUndefined();
  });

  it('accepts a small file', () => {
    const result = validateFileSize(1024);
    expect(result.valid).toBe(true);
    expect(result.size).toBe(1024);
    expect(result.limit).toBe(MAX_FILE_SIZE);
  });

  it('accepts a zero-byte file', () => {
    const result = validateFileSize(0);
    expect(result.valid).toBe(true);
    expect(result.size).toBe(0);
  });

  it('rejects a file one byte over the 10MB limit', () => {
    const result = validateFileSize(MAX_FILE_SIZE + 1);
    expect(result.valid).toBe(false);
    expect(result.size).toBe(MAX_FILE_SIZE + 1);
    expect(result.limit).toBe(MAX_FILE_SIZE);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('exceeds');
  });

  it('rejects a very large file', () => {
    const result = validateFileSize(100_000_000);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('exceeds');
  });
});

// ─── validateBatchSize ───────────────────────────────────────────────────────

describe('validateBatchSize', () => {
  it('accepts a batch exactly at the 50MB limit', () => {
    const sizes = [MAX_BATCH_SIZE];
    const result = validateBatchSize(sizes);
    expect(result.valid).toBe(true);
    expect(result.size).toBe(MAX_BATCH_SIZE);
    expect(result.limit).toBe(MAX_BATCH_SIZE);
  });

  it('accepts a batch of multiple small files', () => {
    const sizes = [1_000_000, 2_000_000, 3_000_000];
    const result = validateBatchSize(sizes);
    expect(result.valid).toBe(true);
    expect(result.size).toBe(6_000_000);
    expect(result.limit).toBe(MAX_BATCH_SIZE);
  });

  it('accepts an empty batch', () => {
    const result = validateBatchSize([]);
    expect(result.valid).toBe(true);
    expect(result.size).toBe(0);
  });

  it('rejects a batch one byte over the 50MB limit', () => {
    const sizes = [MAX_BATCH_SIZE, 1];
    const result = validateBatchSize(sizes);
    expect(result.valid).toBe(false);
    expect(result.size).toBe(MAX_BATCH_SIZE + 1);
    expect(result.limit).toBe(MAX_BATCH_SIZE);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('exceeds');
  });

  it('rejects a batch of many files exceeding the limit', () => {
    const sizes = Array.from({ length: 10 }, () => MAX_FILE_SIZE);
    const result = validateBatchSize(sizes);
    // 10 * 10MB = 100MB > 50MB
    expect(result.valid).toBe(false);
  });
});

// ─── shouldUseMultipart ──────────────────────────────────────────────────────

describe('shouldUseMultipart', () => {
  it('returns true for files over 5MB', () => {
    expect(shouldUseMultipart(MULTIPART_THRESHOLD + 1)).toBe(true);
  });

  it('returns false for files exactly at 5MB', () => {
    expect(shouldUseMultipart(MULTIPART_THRESHOLD)).toBe(false);
  });

  it('returns false for files under 5MB', () => {
    expect(shouldUseMultipart(1_000_000)).toBe(false);
  });

  it('returns false for zero-byte files', () => {
    expect(shouldUseMultipart(0)).toBe(false);
  });

  it('returns true for a 10MB file', () => {
    expect(shouldUseMultipart(MAX_FILE_SIZE)).toBe(true);
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe('constants', () => {
  it('MAX_FILE_SIZE is 10MB in bytes', () => {
    expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024);
  });

  it('MAX_BATCH_SIZE is 50MB in bytes', () => {
    expect(MAX_BATCH_SIZE).toBe(50 * 1024 * 1024);
  });

  it('MULTIPART_THRESHOLD is 5MB in bytes', () => {
    expect(MULTIPART_THRESHOLD).toBe(5 * 1024 * 1024);
  });
});
