// Gemini Integration - PDF extraction utility
// Validates: Requirements 2.7

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse') as typeof import('pdf-parse').default;

/**
 * Result of extracting text from a PDF buffer.
 */
export interface PdfExtractionResult {
  success: boolean;
  text: string;
  pages: number;
  warnings: string[];
}

/**
 * Result of validating a PDF buffer's format via magic bytes.
 */
export interface PdfFormatResult {
  valid: boolean;
  isEncrypted: boolean;
  version: string | null;
}

/**
 * Metadata extracted from a PDF buffer.
 */
export interface PdfMetadata {
  pages: number;
  title: string | null;
  author: string | null;
  createdAt: Date | null;
  sizeBytes: number;
}

// PDF magic bytes: %PDF (0x25 0x50 0x44 0x46)
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] as const;

/**
 * Extracts the PDF version string from the header (e.g. "%PDF-1.7" → "1.7").
 * Returns null if no version is found.
 */
function extractVersion(buffer: Buffer): string | null {
  // The version sits in the first ~20 bytes: %PDF-X.Y
  const header = buffer.subarray(0, 20).toString('ascii');
  const match = header.match(/%PDF-(\d+\.\d+)/);
  return match ? match[1] : null;
}

/**
 * Detects whether a PDF buffer contains an /Encrypt dictionary entry,
 * indicating the PDF is password-protected.
 */
function detectEncryption(buffer: Buffer): boolean {
  // Search for the /Encrypt dictionary key in the raw bytes.
  // This is a lightweight heuristic — full parsing is not required.
  const content = buffer.toString('binary');
  return content.includes('/Encrypt');
}

/**
 * Validates a PDF buffer's format using magic byte detection.
 *
 * Checks for the %PDF (0x25 0x50 0x44 0x46) signature, detects encryption
 * via the /Encrypt dictionary entry, and extracts the PDF version from the
 * header line (e.g. %PDF-1.7).
 *
 * @param buffer - The PDF buffer to validate
 * @returns PdfFormatResult with validity, encryption status, and version
 */
export function validateFormat(buffer: Buffer): PdfFormatResult {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return { valid: false, isEncrypted: false, version: null };
  }

  const hasMagic =
    buffer[0] === PDF_MAGIC[0] &&
    buffer[1] === PDF_MAGIC[1] &&
    buffer[2] === PDF_MAGIC[2] &&
    buffer[3] === PDF_MAGIC[3];

  if (!hasMagic) {
    return { valid: false, isEncrypted: false, version: null };
  }

  return {
    valid: true,
    isEncrypted: detectEncryption(buffer),
    version: extractVersion(buffer),
  };
}

/**
 * Extracts text content from a PDF buffer using pdf-parse.
 *
 * Handles password-protected PDFs by detecting encryption before parsing,
 * and catches errors from corrupted PDFs to return graceful error results.
 *
 * @param buffer - The PDF buffer to extract text from
 * @returns Promise resolving to PdfExtractionResult
 */
export async function extractText(buffer: Buffer): Promise<PdfExtractionResult> {
  const warnings: string[] = [];

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { success: false, text: '', pages: 0, warnings: ['Buffer is empty or invalid'] };
  }

  const format = validateFormat(buffer);

  if (!format.valid) {
    return { success: false, text: '', pages: 0, warnings: ['Buffer is not a valid PDF'] };
  }

  if (format.isEncrypted) {
    return {
      success: false,
      text: '',
      pages: 0,
      warnings: ['PDF is password-protected and cannot be extracted'],
    };
  }

  try {
    const result = await pdfParse(buffer);
    const text = result.text.trim();

    if (text.length === 0) {
      warnings.push('PDF parsed successfully but contained no extractable text');
    }

    return {
      success: true,
      text,
      pages: result.numpages,
      warnings,
    };
  } catch (_error: unknown) {
    const message = _error instanceof Error ? _error.message : 'Unknown error during PDF parsing';
    return {
      success: false,
      text: '',
      pages: 0,
      warnings: [`PDF parsing failed: ${message}`],
    };
  }
}

/**
 * Retrieves metadata from a PDF buffer using pdf-parse.
 *
 * @param buffer - The PDF buffer to inspect
 * @returns Promise resolving to PdfMetadata
 */
export async function getMetadata(buffer: Buffer): Promise<PdfMetadata> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { pages: 0, title: null, author: null, createdAt: null, sizeBytes: 0 };
  }

  try {
    const result = await pdfParse(buffer);
    const info = result.info as Record<string, unknown> | undefined;

    const title = typeof info?.['Title'] === 'string' ? info['Title'] : null;
    const author = typeof info?.['Author'] === 'string' ? info['Author'] : null;

    let createdAt: Date | null = null;
    const creationDate = info?.['CreationDate'];
    if (typeof creationDate === 'string' && creationDate.length > 0) {
      const parsed = parsePdfDate(creationDate);
      if (parsed !== null) {
        createdAt = parsed;
      }
    }

    return {
      pages: result.numpages,
      title,
      author,
      createdAt,
      sizeBytes: buffer.length,
    };
  } catch {
    return { pages: 0, title: null, author: null, createdAt: null, sizeBytes: buffer.length };
  }
}

/**
 * Parses a PDF date string (e.g. "D:20231015120000+01'00'") into a Date.
 * Returns null if the string cannot be parsed.
 */
function parsePdfDate(dateStr: string): Date | null {
  // PDF dates follow the format: D:YYYYMMDDHHmmSSOHH'mm'
  const cleaned = dateStr.replace(/^D:/, '');
  const match = cleaned.match(/^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
  if (!match) {
    return null;
  }

  const year = parseInt(match[1], 10);
  const month = match[2] ? parseInt(match[2], 10) - 1 : 0;
  const day = match[3] ? parseInt(match[3], 10) : 1;
  const hour = match[4] ? parseInt(match[4], 10) : 0;
  const minute = match[5] ? parseInt(match[5], 10) : 0;
  const second = match[6] ? parseInt(match[6], 10) : 0;

  const date = new Date(Date.UTC(year, month, day, hour, minute, second));
  if (isNaN(date.getTime())) {
    return null;
  }
  return date;
}
