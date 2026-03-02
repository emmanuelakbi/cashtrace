/**
 * Property-based tests for FileTypeValidator
 *
 * **Feature: document-processing, Property 1: File Type Validation Correctness**
 *
 * For any file buffer, the file type validator SHALL accept it as a valid receipt image
 * if and only if its magic bytes match JPEG or PNG signatures. For any file buffer,
 * the validator SHALL accept it as a valid bank statement if and only if its magic bytes
 * match PDF signature. For any text content, the validator SHALL accept it as a valid
 * POS export if and only if it contains valid CSV structure.
 *
 * **Validates: Requirements 1.1, 1.2, 2.1, 2.2, 3.1, 3.2**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  detectFileType,
  isSupportedType,
  validateCsvStructure,
  validateFileType,
} from './fileTypeValidator.js';

// ─── Magic Byte Constants ────────────────────────────────────────────────────

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate arbitrary trailing bytes to append after magic bytes. */
const trailingBytesArb = fc.uint8Array({ minLength: 0, maxLength: 256 });

/** Generate a buffer starting with JPEG magic bytes followed by arbitrary data. */
const jpegBufferArb = trailingBytesArb.map((trailing) => Buffer.from([...JPEG_MAGIC, ...trailing]));

/** Generate a buffer starting with PNG magic bytes followed by arbitrary data. */
const pngBufferArb = trailingBytesArb.map((trailing) => Buffer.from([...PNG_MAGIC, ...trailing]));

/** Generate a buffer starting with PDF magic bytes followed by arbitrary data. */
const pdfBufferArb = trailingBytesArb.map((trailing) => Buffer.from([...PDF_MAGIC, ...trailing]));

/**
 * Generate a buffer that does NOT start with any known magic bytes.
 * Filters out buffers whose first bytes match JPEG, PNG, or PDF signatures.
 */
const unknownBufferArb = fc.uint8Array({ minLength: 1, maxLength: 256 }).filter((arr) => {
  const buf = Buffer.from(arr);
  // Must not match JPEG
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return false;
  // Must not match PNG
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return false;
  // Must not match PDF
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)
    return false;
  return true;
});

/** Generate a safe column name (alphanumeric, no commas or newlines). */
const columnNameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,15}$/);

/** Generate a safe cell value (no commas or newlines). */
const cellValueArb = fc.stringMatching(/^[a-zA-Z0-9_ ]{1,20}$/);

/**
 * Generate a valid CSV string with a header row and at least one data row.
 * Ensures at least 2 columns and consistent column count across rows.
 */
const validCsvArb = fc
  .tuple(
    fc.integer({ min: 2, max: 6 }), // number of columns
    fc.integer({ min: 1, max: 5 }), // number of data rows
  )
  .chain(([numCols, numRows]) =>
    fc.tuple(
      fc.array(columnNameArb, { minLength: numCols, maxLength: numCols }),
      fc.array(fc.array(cellValueArb, { minLength: numCols, maxLength: numCols }), {
        minLength: numRows,
        maxLength: numRows,
      }),
    ),
  )
  .map(([headers, rows]) => {
    const headerLine = headers.join(',');
    const dataLines = rows.map((row) => row.join(','));
    return [headerLine, ...dataLines].join('\n');
  });

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('File Type Validation Correctness (Property 1)', () => {
  /**
   * **Validates: Requirements 1.1, 1.2**
   * For any buffer starting with JPEG magic bytes, detectFileType returns
   * RECEIPT_IMAGE with image/jpeg MIME type.
   */
  it('detects JPEG from magic bytes for any trailing data', () => {
    fc.assert(
      fc.property(jpegBufferArb, (buffer) => {
        const result = detectFileType(buffer);
        expect(result.documentType).toBe('RECEIPT_IMAGE');
        expect(result.mime).toBe('image/jpeg');
        expect(result.ext).toBe('jpg');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.1, 1.2**
   * For any buffer starting with PNG magic bytes, detectFileType returns
   * RECEIPT_IMAGE with image/png MIME type.
   */
  it('detects PNG from magic bytes for any trailing data', () => {
    fc.assert(
      fc.property(pngBufferArb, (buffer) => {
        const result = detectFileType(buffer);
        expect(result.documentType).toBe('RECEIPT_IMAGE');
        expect(result.mime).toBe('image/png');
        expect(result.ext).toBe('png');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.2**
   * For any buffer starting with PDF magic bytes, detectFileType returns
   * BANK_STATEMENT with application/pdf MIME type.
   */
  it('detects PDF from magic bytes for any trailing data', () => {
    fc.assert(
      fc.property(pdfBufferArb, (buffer) => {
        const result = detectFileType(buffer);
        expect(result.documentType).toBe('BANK_STATEMENT');
        expect(result.mime).toBe('application/pdf');
        expect(result.ext).toBe('pdf');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.2, 2.2**
   * For any buffer that does NOT start with known magic bytes,
   * detectFileType returns null documentType.
   */
  it('returns null documentType for buffers without known magic bytes', () => {
    fc.assert(
      fc.property(unknownBufferArb, (arr) => {
        const buffer = Buffer.from(arr);
        const result = detectFileType(buffer);
        expect(result.documentType).toBeNull();
        expect(result.mime).toBe('application/octet-stream');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.2**
   * For any valid CSV string (header + data rows, consistent columns),
   * validateCsvStructure returns true.
   */
  it('accepts valid CSV structures with consistent columns', () => {
    fc.assert(
      fc.property(validCsvArb, (csv) => {
        expect(validateCsvStructure(csv)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.2**
   * CSV with fewer than 2 rows or fewer than 2 columns is rejected.
   */
  it('rejects CSV with only a header row (no data)', () => {
    fc.assert(
      fc.property(fc.array(columnNameArb, { minLength: 2, maxLength: 6 }), (headers) => {
        const csv = headers.join(',');
        expect(validateCsvStructure(csv)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.1, 1.2, 2.1, 2.2, 3.1, 3.2**
   * validateFileType and isSupportedType are consistent with detectFileType:
   * - Known magic bytes → valid: true, supported: true
   * - Unknown magic bytes (non-CSV) → valid: false, supported: false
   */
  it('validateFileType is consistent with detectFileType for known types', () => {
    const knownBufferArb = fc.oneof(jpegBufferArb, pngBufferArb, pdfBufferArb);
    fc.assert(
      fc.property(knownBufferArb, (buffer) => {
        const detected = detectFileType(buffer);
        const validation = validateFileType(buffer);
        const supported = isSupportedType(buffer);

        expect(validation.valid).toBe(true);
        expect(validation.detectedType).toBe(detected.documentType);
        expect(validation.detectedMime).toBe(detected.mime);
        expect(supported).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.2, 2.2, 3.2**
   * For valid CSV content encoded as a buffer, validateFileType detects POS_EXPORT.
   */
  it('validateFileType detects CSV content as POS_EXPORT', () => {
    fc.assert(
      fc.property(validCsvArb, (csv) => {
        const buffer = Buffer.from(csv, 'utf-8');
        const validation = validateFileType(buffer);

        // CSV buffers won't match magic bytes, so detectFileType returns null.
        // But validateFileType falls through to CSV structure check.
        expect(validation.valid).toBe(true);
        expect(validation.detectedType).toBe('POS_EXPORT');
        expect(validation.detectedMime).toBe('text/csv');
        expect(isSupportedType(buffer)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
