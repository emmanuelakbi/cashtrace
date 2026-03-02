import { describe, expect, it } from 'vitest';

import { validateImageInput, validatePdfInput } from './input-validator.js';

// Valid JPEG: starts with 0xFF 0xD8 0xFF followed by some payload
function makeJpeg(size: number = 100): Buffer {
  const buf = Buffer.alloc(size);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
}

// Valid PNG: starts with 0x89 0x50 0x4E 0x47 followed by some payload
function makePng(size: number = 100): Buffer {
  const buf = Buffer.alloc(size);
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  return buf;
}

describe('validateImageInput', () => {
  describe('valid inputs', () => {
    it('accepts a valid JPEG buffer', () => {
      const result = validateImageInput(makeJpeg());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts a valid PNG buffer', () => {
      const result = validateImageInput(makePng());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('adds a warning for PNG images about token cost', () => {
      const result = validateImageInput(makePng());
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('PNG');
    });

    it('does not warn for JPEG images', () => {
      const result = validateImageInput(makeJpeg());
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('empty buffer', () => {
    it('rejects an empty buffer', () => {
      const result = validateImageInput(Buffer.alloc(0));
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        field: 'imageBuffer',
        code: 'EMPTY_BUFFER',
        message: 'Image buffer is empty',
      });
    });
  });

  describe('size limits', () => {
    it('rejects a buffer exceeding the default 10MB limit', () => {
      const oversized = makeJpeg(10 * 1024 * 1024 + 1);
      const result = validateImageInput(oversized);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe('FILE_TOO_LARGE');
    });

    it('accepts a buffer exactly at the 10MB limit', () => {
      const exact = makeJpeg(10 * 1024 * 1024);
      const result = validateImageInput(exact);
      expect(result.valid).toBe(true);
    });

    it('respects a custom maxSizeBytes parameter', () => {
      const buf = makeJpeg(2000);
      const result = validateImageInput(buf, 1000);
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.code).toBe('FILE_TOO_LARGE');
    });

    it('accepts a buffer within a custom maxSizeBytes', () => {
      const buf = makeJpeg(500);
      const result = validateImageInput(buf, 1000);
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid formats', () => {
    it('rejects a GIF buffer', () => {
      const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
      const result = validateImageInput(gif);
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.code).toBe('INVALID_FORMAT');
    });

    it('rejects a BMP buffer', () => {
      const bmp = Buffer.from([0x42, 0x4d, 0x00, 0x00]);
      const result = validateImageInput(bmp);
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.code).toBe('INVALID_FORMAT');
    });

    it('rejects random bytes', () => {
      const random = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
      const result = validateImageInput(random);
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.code).toBe('INVALID_FORMAT');
      expect(result.errors[0]?.message).toContain('not a valid JPEG or PNG');
    });

    it('rejects a buffer too short for any magic bytes', () => {
      const tiny = Buffer.from([0xff, 0xd8]);
      const result = validateImageInput(tiny);
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.code).toBe('INVALID_FORMAT');
    });
  });

  describe('error structure', () => {
    it('returns errors with field, code, and message', () => {
      const result = validateImageInput(Buffer.alloc(0));
      const error = result.errors[0];
      expect(error).toHaveProperty('field');
      expect(error).toHaveProperty('code');
      expect(error).toHaveProperty('message');
      expect(typeof error?.field).toBe('string');
      expect(typeof error?.code).toBe('string');
      expect(typeof error?.message).toBe('string');
    });
  });
});

// Helper: valid PDF buffer starting with %PDF magic bytes
function makePdf(size: number = 100): Buffer {
  const buf = Buffer.alloc(size);
  buf[0] = 0x25; // %
  buf[1] = 0x50; // P
  buf[2] = 0x44; // D
  buf[3] = 0x46; // F
  return buf;
}

// Helper: PDF buffer that contains the /Encrypt marker (password-protected)
function makeEncryptedPdf(size: number = 200): Buffer {
  const buf = makePdf(size);
  const marker = '/Encrypt';
  buf.write(marker, 20, 'latin1');
  return buf;
}

describe('validatePdfInput', () => {
  describe('valid inputs', () => {
    it('accepts a valid PDF buffer', () => {
      const result = validatePdfInput(makePdf());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('accepts a PDF at exactly the 10MB limit', () => {
      const exact = makePdf(10 * 1024 * 1024);
      const result = validatePdfInput(exact);
      expect(result.valid).toBe(true);
    });
  });

  describe('empty buffer', () => {
    it('rejects an empty buffer', () => {
      const result = validatePdfInput(Buffer.alloc(0));
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        field: 'pdfBuffer',
        code: 'EMPTY_BUFFER',
        message: 'PDF buffer is empty',
      });
    });
  });

  describe('size limits', () => {
    it('rejects a buffer exceeding the default 10MB limit', () => {
      const oversized = makePdf(10 * 1024 * 1024 + 1);
      const result = validatePdfInput(oversized);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe('FILE_TOO_LARGE');
    });

    it('respects a custom maxSizeBytes parameter', () => {
      const buf = makePdf(2000);
      const result = validatePdfInput(buf, 1000);
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.code).toBe('FILE_TOO_LARGE');
    });

    it('accepts a buffer within a custom maxSizeBytes', () => {
      const buf = makePdf(500);
      const result = validatePdfInput(buf, 1000);
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid formats', () => {
    it('rejects a JPEG buffer', () => {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
      const result = validatePdfInput(jpeg);
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.code).toBe('INVALID_FORMAT');
    });

    it('rejects random bytes', () => {
      const random = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
      const result = validatePdfInput(random);
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.code).toBe('INVALID_FORMAT');
      expect(result.errors[0]?.message).toContain('not a valid PDF');
    });

    it('rejects a buffer too short for PDF magic bytes', () => {
      const tiny = Buffer.from([0x25, 0x50, 0x44]);
      const result = validatePdfInput(tiny);
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.code).toBe('INVALID_FORMAT');
    });
  });

  describe('password-protected PDF detection', () => {
    it('adds a warning for password-protected PDFs', () => {
      const result = validatePdfInput(makeEncryptedPdf());
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('password-protected');
    });

    it('does not warn for non-encrypted PDFs', () => {
      const result = validatePdfInput(makePdf());
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('error structure', () => {
    it('returns errors with field, code, and message', () => {
      const result = validatePdfInput(Buffer.alloc(0));
      const error = result.errors[0];
      expect(error).toHaveProperty('field');
      expect(error).toHaveProperty('code');
      expect(error).toHaveProperty('message');
      expect(typeof error?.field).toBe('string');
      expect(typeof error?.code).toBe('string');
      expect(typeof error?.message).toBe('string');
    });
  });
});

import { validateCsvInput } from './input-validator.js';

describe('validateCsvInput', () => {
  describe('valid inputs', () => {
    it('accepts a valid comma-delimited CSV', () => {
      const csv = 'name,amount,date\nItem A,1000,2024-01-01';
      const result = validateCsvInput(csv);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('accepts a valid semicolon-delimited CSV', () => {
      const csv = 'name;amount;date\nItem A;1000;2024-01-01';
      const result = validateCsvInput(csv);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts a valid tab-delimited CSV', () => {
      const csv = 'name\tamount\tdate\nItem A\t1000\t2024-01-01';
      const result = validateCsvInput(csv);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts a valid pipe-delimited CSV', () => {
      const csv = 'name|amount|date\nItem A|1000|2024-01-01';
      const result = validateCsvInput(csv);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts CSV with multiple data rows', () => {
      const csv = 'name,amount\nA,100\nB,200\nC,300';
      const result = validateCsvInput(csv);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('handles Windows-style line endings (CRLF)', () => {
      const csv = 'name,amount\r\nA,100\r\nB,200';
      const result = validateCsvInput(csv);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('empty content', () => {
    it('rejects an empty string', () => {
      const result = validateCsvInput('');
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        field: 'csvContent',
        code: 'EMPTY_CONTENT',
        message: 'CSV content is empty',
      });
    });

    it('rejects whitespace-only content', () => {
      const result = validateCsvInput('   \n  \t  \n  ');
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.code).toBe('EMPTY_CONTENT');
    });
  });

  describe('size limits', () => {
    it('rejects content exceeding the default 5MB limit', () => {
      const oversized = 'a'.repeat(5 * 1024 * 1024 + 1);
      const result = validateCsvInput(oversized);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe('FILE_TOO_LARGE');
    });

    it('respects a custom maxSizeBytes parameter', () => {
      const csv = 'name,amount\nA,100';
      const result = validateCsvInput(csv, 10);
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.code).toBe('FILE_TOO_LARGE');
    });

    it('accepts content within a custom maxSizeBytes', () => {
      const csv = 'name,amount\nA,100';
      const result = validateCsvInput(csv, 10000);
      expect(result.valid).toBe(true);
    });

    it('measures size as UTF-8 byte length', () => {
      // ₦ is 3 bytes in UTF-8
      const csv = 'name,amount\n₦₦₦₦₦,100';
      const byteLength = Buffer.byteLength(csv, 'utf-8');
      // Reject when limit is less than actual byte length
      const result = validateCsvInput(csv, byteLength - 1);
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.code).toBe('FILE_TOO_LARGE');
    });
  });

  describe('insufficient rows', () => {
    it('rejects CSV with only a header row', () => {
      const result = validateCsvInput('name,amount,date');
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        field: 'csvContent',
        code: 'INSUFFICIENT_ROWS',
        message: 'CSV must have at least a header row and one data row',
      });
    });

    it('rejects CSV with header and only blank lines', () => {
      const result = validateCsvInput('name,amount\n\n\n');
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.code).toBe('INSUFFICIENT_ROWS');
    });
  });

  describe('inconsistent column counts', () => {
    it('warns when data rows have different column counts than header', () => {
      const csv = 'name,amount,date\nA,100\nB,200,2024-01-01';
      const result = validateCsvInput(csv);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('1 row(s) have inconsistent column count');
      expect(result.warnings[0]).toContain('expected 3 columns');
    });

    it('warns for multiple inconsistent rows', () => {
      const csv = 'a,b,c\n1,2\n3\n4,5,6';
      const result = validateCsvInput(csv);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('2 row(s)');
    });

    it('does not warn when all rows have consistent column counts', () => {
      const csv = 'a,b,c\n1,2,3\n4,5,6';
      const result = validateCsvInput(csv);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('delimiter detection', () => {
    it('detects comma as delimiter', () => {
      const csv = 'a,b,c\n1,2,3';
      const result = validateCsvInput(csv);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('detects semicolon as delimiter when more frequent than comma', () => {
      const csv = 'a;b;c;d\n1;2;3;4';
      const result = validateCsvInput(csv);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('detects tab as delimiter', () => {
      const csv = 'a\tb\tc\n1\t2\t3';
      const result = validateCsvInput(csv);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('detects pipe as delimiter', () => {
      const csv = 'a|b|c\n1|2|3';
      const result = validateCsvInput(csv);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('error structure', () => {
    it('returns errors with field, code, and message', () => {
      const result = validateCsvInput('');
      const error = result.errors[0];
      expect(error).toHaveProperty('field');
      expect(error).toHaveProperty('code');
      expect(error).toHaveProperty('message');
      expect(typeof error?.field).toBe('string');
      expect(typeof error?.code).toBe('string');
      expect(typeof error?.message).toBe('string');
    });
  });
});

import type { BusinessContext } from '../types/insights.js';

import { validateBusinessContext } from './input-validator.js';

function makeTransaction(
  overrides: Partial<BusinessContext['transactions'][number]> = {},
): BusinessContext['transactions'][number] {
  return {
    id: 'txn-001',
    date: '2024-06-15',
    description: 'POS payment',
    amount: 5000,
    type: 'credit',
    ...overrides,
  };
}

function makeBusinessContext(overrides: Partial<BusinessContext> = {}): BusinessContext {
  return {
    businessId: 'biz-123',
    businessName: 'Ade Stores',
    businessType: 'retail',
    transactions: [makeTransaction()],
    period: { start: '2024-01-01', end: '2024-06-30' },
    ...overrides,
  };
}

describe('validateBusinessContext', () => {
  describe('valid inputs', () => {
    it('accepts a valid BusinessContext', () => {
      const result = validateBusinessContext(makeBusinessContext());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('accepts context with optional fields', () => {
      const result = validateBusinessContext(
        makeBusinessContext({
          previousPeriodComparison: [makeTransaction()],
          customPromptContext: 'Focus on tax',
        }),
      );
      expect(result.valid).toBe(true);
    });

    it('accepts context with same start and end date', () => {
      const result = validateBusinessContext(
        makeBusinessContext({ period: { start: '2024-06-01', end: '2024-06-01' } }),
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('businessId validation', () => {
    it('rejects empty businessId', () => {
      const result = validateBusinessContext(makeBusinessContext({ businessId: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        field: 'businessId',
        code: 'REQUIRED_FIELD',
        message: 'businessId must be a non-empty string',
      });
    });

    it('rejects whitespace-only businessId', () => {
      const result = validateBusinessContext(makeBusinessContext({ businessId: '   ' }));
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.field).toBe('businessId');
    });
  });

  describe('businessName validation', () => {
    it('rejects empty businessName', () => {
      const result = validateBusinessContext(makeBusinessContext({ businessName: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toEqual({
        field: 'businessName',
        code: 'REQUIRED_FIELD',
        message: 'businessName must be a non-empty string',
      });
    });

    it('rejects whitespace-only businessName', () => {
      const result = validateBusinessContext(makeBusinessContext({ businessName: '  ' }));
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.field).toBe('businessName');
    });
  });

  describe('businessType validation', () => {
    it('rejects empty businessType', () => {
      const result = validateBusinessContext(makeBusinessContext({ businessType: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toEqual({
        field: 'businessType',
        code: 'REQUIRED_FIELD',
        message: 'businessType must be a non-empty string',
      });
    });

    it('rejects whitespace-only businessType', () => {
      const result = validateBusinessContext(makeBusinessContext({ businessType: '\t' }));
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.field).toBe('businessType');
    });
  });

  describe('transactions validation', () => {
    it('rejects empty transactions array', () => {
      const result = validateBusinessContext(makeBusinessContext({ transactions: [] }));
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toEqual({
        field: 'transactions',
        code: 'EMPTY_ARRAY',
        message: 'transactions must be a non-empty array',
      });
    });

    it('warns when transactions array exceeds 1000 items', () => {
      const transactions = Array.from({ length: 1001 }, (_, i) =>
        makeTransaction({ id: `txn-${i}` }),
      );
      const result = validateBusinessContext(makeBusinessContext({ transactions }));
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('1001');
      expect(result.warnings[0]).toContain('>1000');
      expect(result.warnings[0]).toContain('token usage');
    });

    it('does not warn when transactions array has exactly 1000 items', () => {
      const transactions = Array.from({ length: 1000 }, (_, i) =>
        makeTransaction({ id: `txn-${i}` }),
      );
      const result = validateBusinessContext(makeBusinessContext({ transactions }));
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('period validation', () => {
    it('rejects missing period.start', () => {
      const result = validateBusinessContext(
        makeBusinessContext({ period: { start: '', end: '2024-06-30' } }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'period.start')).toBe(true);
    });

    it('rejects missing period.end', () => {
      const result = validateBusinessContext(
        makeBusinessContext({ period: { start: '2024-01-01', end: '' } }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'period.end')).toBe(true);
    });

    it('rejects unparseable period.start', () => {
      const result = validateBusinessContext(
        makeBusinessContext({ period: { start: 'not-a-date', end: '2024-06-30' } }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toEqual({
        field: 'period.start',
        code: 'INVALID_DATE',
        message: 'period.start is not a valid date',
      });
    });

    it('rejects unparseable period.end', () => {
      const result = validateBusinessContext(
        makeBusinessContext({ period: { start: '2024-01-01', end: 'xyz' } }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toEqual({
        field: 'period.end',
        code: 'INVALID_DATE',
        message: 'period.end is not a valid date',
      });
    });

    it('rejects period.end before period.start', () => {
      const result = validateBusinessContext(
        makeBusinessContext({ period: { start: '2024-06-30', end: '2024-01-01' } }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toEqual({
        field: 'period',
        code: 'INVALID_RANGE',
        message: 'period.end must be greater than or equal to period.start',
      });
    });
  });

  describe('multiple errors', () => {
    it('collects all errors when multiple fields are invalid', () => {
      const result = validateBusinessContext(
        makeBusinessContext({
          businessId: '',
          businessName: '',
          businessType: '',
          transactions: [],
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('error structure', () => {
    it('returns errors with field, code, and message', () => {
      const result = validateBusinessContext(makeBusinessContext({ businessId: '' }));
      const error = result.errors[0];
      expect(error).toHaveProperty('field');
      expect(error).toHaveProperty('code');
      expect(error).toHaveProperty('message');
      expect(typeof error?.field).toBe('string');
      expect(typeof error?.code).toBe('string');
      expect(typeof error?.message).toBe('string');
    });
  });
});
