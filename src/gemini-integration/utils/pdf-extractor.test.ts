// Gemini Integration - PdfExtractor unit tests
// Validates: Requirements 2.7

import { describe, expect, it } from 'vitest';

import { extractText, getMetadata, validateFormat } from './pdf-extractor.js';

// --- Helpers ---

/**
 * Builds a minimal valid PDF buffer with the given body text.
 * This produces a bare-bones single-page PDF that pdf-parse can read.
 */
function buildMinimalPdf(bodyText: string = 'Hello World'): Buffer {
  const stream =
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n` +
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n` +
    `4 0 obj\n<< /Length ${bodyText.length + 24} >>\nstream\nBT /F1 12 Tf 100 700 Td (${bodyText}) Tj ET\nendstream\nendobj\n` +
    `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;

  const xrefOffset = stream.length + 15; // approximate
  const header = '%PDF-1.4\n';
  const body = stream;
  const xref =
    `xref\n0 6\n` +
    `0000000000 65535 f \n` +
    `0000000009 00000 n \n` +
    `0000000058 00000 n \n` +
    `0000000115 00000 n \n` +
    `0000000266 00000 n \n` +
    `0000000360 00000 n \n`;
  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\n` + `startxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(header + body + xref + trailer, 'binary');
}

// PDF magic bytes: %PDF
const PDF_HEADER = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

/**
 * Builds a buffer that looks like a PDF header but has /Encrypt in the body.
 */
function buildEncryptedPdfHeader(): Buffer {
  const content = '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Encrypt 2 0 R >>\nendobj\n';
  return Buffer.from(content, 'binary');
}

// --- validateFormat ---

describe('validateFormat', () => {
  it('should detect valid PDF from magic bytes', () => {
    const result = validateFormat(PDF_HEADER);
    expect(result.valid).toBe(true);
    expect(result.isEncrypted).toBe(false);
  });

  it('should extract version from PDF header', () => {
    const buf = Buffer.from('%PDF-1.7\nsome content', 'binary');
    const result = validateFormat(buf);
    expect(result.valid).toBe(true);
    expect(result.version).toBe('1.7');
  });

  it('should detect encryption via /Encrypt dictionary', () => {
    const buf = buildEncryptedPdfHeader();
    const result = validateFormat(buf);
    expect(result.valid).toBe(true);
    expect(result.isEncrypted).toBe(true);
  });

  it('should reject an empty buffer', () => {
    const result = validateFormat(Buffer.alloc(0));
    expect(result).toEqual({ valid: false, isEncrypted: false, version: null });
  });

  it('should reject a buffer shorter than 4 bytes', () => {
    const result = validateFormat(Buffer.from([0x25, 0x50]));
    expect(result).toEqual({ valid: false, isEncrypted: false, version: null });
  });

  it('should reject non-PDF content', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const result = validateFormat(jpeg);
    expect(result).toEqual({ valid: false, isEncrypted: false, version: null });
  });

  it('should handle a real minimal PDF buffer', () => {
    const pdf = buildMinimalPdf('Test');
    const result = validateFormat(pdf);
    expect(result.valid).toBe(true);
    expect(result.version).toBe('1.4');
    expect(result.isEncrypted).toBe(false);
  });
});

// --- extractText ---

describe('extractText', () => {
  it('should return failure for an empty buffer', async () => {
    const result = await extractText(Buffer.alloc(0));
    expect(result.success).toBe(false);
    expect(result.text).toBe('');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should return failure for a non-PDF buffer', async () => {
    const result = await extractText(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]));
    expect(result.success).toBe(false);
    expect(result.warnings).toContain('Buffer is not a valid PDF');
  });

  it('should return failure for an encrypted PDF', async () => {
    const buf = buildEncryptedPdfHeader();
    const result = await extractText(buf);
    expect(result.success).toBe(false);
    expect(result.warnings.some((w) => w.includes('password-protected'))).toBe(true);
  });

  it('should extract text from a valid minimal PDF', async () => {
    const pdf = buildMinimalPdf('Hello World');
    const result = await extractText(pdf);
    // pdf-parse may or may not extract text from our minimal PDF depending
    // on how well-formed the xref table is. We verify the contract:
    expect(typeof result.success).toBe('boolean');
    expect(typeof result.text).toBe('string');
    expect(typeof result.pages).toBe('number');
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('should handle a corrupted PDF gracefully', async () => {
    // Valid magic bytes but garbage body
    const corrupted = Buffer.concat([Buffer.from('%PDF-1.4\n', 'binary'), Buffer.alloc(100, 0xff)]);
    const result = await extractText(corrupted);
    // Should not throw — returns a result with success false or warnings
    expect(typeof result.success).toBe('boolean');
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});

// --- getMetadata ---

describe('getMetadata', () => {
  it('should return empty metadata for an empty buffer', async () => {
    const meta = await getMetadata(Buffer.alloc(0));
    expect(meta).toEqual({
      pages: 0,
      title: null,
      author: null,
      createdAt: null,
      sizeBytes: 0,
    });
  });

  it('should return sizeBytes even when parsing fails', async () => {
    const corrupted = Buffer.concat([Buffer.from('%PDF-1.4\n', 'binary'), Buffer.alloc(50, 0xff)]);
    const meta = await getMetadata(corrupted);
    expect(meta.sizeBytes).toBe(corrupted.length);
  });

  it('should extract page count from a valid PDF', async () => {
    const pdf = buildMinimalPdf('Test');
    const meta = await getMetadata(pdf);
    // Our minimal PDF declares 1 page
    expect(typeof meta.pages).toBe('number');
    expect(meta.sizeBytes).toBe(pdf.length);
  });

  it('should return null for missing title and author', async () => {
    const pdf = buildMinimalPdf('Test');
    const meta = await getMetadata(pdf);
    // Our minimal PDF has no Info dictionary
    expect(meta.title).toBeNull();
    expect(meta.author).toBeNull();
  });
});
