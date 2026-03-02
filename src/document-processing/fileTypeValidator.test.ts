import { describe, expect, it } from 'vitest';

import {
  detectFileType,
  isSupportedType,
  validateCsvStructure,
  validateFileType,
} from './fileTypeValidator.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeJpegBuffer(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
}

function makePngBuffer(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
}

function makePdfBuffer(): Buffer {
  return Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
}

function makeUnknownBuffer(): Buffer {
  return Buffer.from([0x00, 0x01, 0x02, 0x03]);
}

// ─── detectFileType ──────────────────────────────────────────────────────────

describe('detectFileType', () => {
  it('detects JPEG from magic bytes', () => {
    const result = detectFileType(makeJpegBuffer());
    expect(result.mime).toBe('image/jpeg');
    expect(result.ext).toBe('jpg');
    expect(result.documentType).toBe('RECEIPT_IMAGE');
  });

  it('detects PNG from magic bytes', () => {
    const result = detectFileType(makePngBuffer());
    expect(result.mime).toBe('image/png');
    expect(result.ext).toBe('png');
    expect(result.documentType).toBe('RECEIPT_IMAGE');
  });

  it('detects PDF from magic bytes', () => {
    const result = detectFileType(makePdfBuffer());
    expect(result.mime).toBe('application/pdf');
    expect(result.ext).toBe('pdf');
    expect(result.documentType).toBe('BANK_STATEMENT');
  });

  it('returns null documentType for unknown bytes', () => {
    const result = detectFileType(makeUnknownBuffer());
    expect(result.documentType).toBeNull();
    expect(result.mime).toBe('application/octet-stream');
  });

  it('returns null documentType for empty buffer', () => {
    const result = detectFileType(Buffer.alloc(0));
    expect(result.documentType).toBeNull();
  });

  it('returns null documentType for buffer shorter than any signature', () => {
    const result = detectFileType(Buffer.from([0xff]));
    expect(result.documentType).toBeNull();
  });
});

// ─── validateFileType ────────────────────────────────────────────────────────

describe('validateFileType', () => {
  it('validates JPEG as RECEIPT_IMAGE', () => {
    const result = validateFileType(makeJpegBuffer());
    expect(result.valid).toBe(true);
    expect(result.detectedType).toBe('RECEIPT_IMAGE');
    expect(result.detectedMime).toBe('image/jpeg');
  });

  it('validates PNG as RECEIPT_IMAGE', () => {
    const result = validateFileType(makePngBuffer());
    expect(result.valid).toBe(true);
    expect(result.detectedType).toBe('RECEIPT_IMAGE');
    expect(result.detectedMime).toBe('image/png');
  });

  it('validates PDF as BANK_STATEMENT', () => {
    const result = validateFileType(makePdfBuffer());
    expect(result.valid).toBe(true);
    expect(result.detectedType).toBe('BANK_STATEMENT');
    expect(result.detectedMime).toBe('application/pdf');
  });

  it('validates CSV content as POS_EXPORT', () => {
    const csv = 'date,amount,description\n2024-01-01,5000,Sale';
    const result = validateFileType(Buffer.from(csv));
    expect(result.valid).toBe(true);
    expect(result.detectedType).toBe('POS_EXPORT');
    expect(result.detectedMime).toBe('text/csv');
  });

  it('rejects unknown file types with error message', () => {
    const result = validateFileType(makeUnknownBuffer());
    expect(result.valid).toBe(false);
    expect(result.detectedType).toBeNull();
    expect(result.error).toContain('Unsupported file type');
  });

  it('rejects empty buffer', () => {
    const result = validateFileType(Buffer.alloc(0));
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Empty file buffer');
  });
});

// ─── isSupportedType ─────────────────────────────────────────────────────────

describe('isSupportedType', () => {
  it('returns true for JPEG', () => {
    expect(isSupportedType(makeJpegBuffer())).toBe(true);
  });

  it('returns true for PNG', () => {
    expect(isSupportedType(makePngBuffer())).toBe(true);
  });

  it('returns true for PDF', () => {
    expect(isSupportedType(makePdfBuffer())).toBe(true);
  });

  it('returns true for valid CSV', () => {
    const csv = 'col1,col2\nval1,val2';
    expect(isSupportedType(Buffer.from(csv))).toBe(true);
  });

  it('returns false for unknown types', () => {
    expect(isSupportedType(makeUnknownBuffer())).toBe(false);
  });

  it('returns false for empty buffer', () => {
    expect(isSupportedType(Buffer.alloc(0))).toBe(false);
  });
});

// ─── validateCsvStructure ────────────────────────────────────────────────────

describe('validateCsvStructure', () => {
  it('accepts valid CSV with header and data rows', () => {
    expect(validateCsvStructure('name,amount\nItem,100')).toBe(true);
  });

  it('accepts CSV with multiple data rows', () => {
    const csv = 'date,amount,desc\n2024-01-01,100,A\n2024-01-02,200,B';
    expect(validateCsvStructure(csv)).toBe(true);
  });

  it('accepts CSV with Windows line endings', () => {
    expect(validateCsvStructure('a,b\r\n1,2')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(validateCsvStructure('')).toBe(false);
  });

  it('rejects whitespace-only string', () => {
    expect(validateCsvStructure('   \n  ')).toBe(false);
  });

  it('rejects single row (header only, no data)', () => {
    expect(validateCsvStructure('name,amount')).toBe(false);
  });

  it('rejects single-column CSV', () => {
    expect(validateCsvStructure('name\nAlice')).toBe(false);
  });

  it('rejects inconsistent column counts', () => {
    expect(validateCsvStructure('a,b,c\n1,2')).toBe(false);
  });
});
