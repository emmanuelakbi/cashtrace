/**
 * File type validation using magic bytes detection.
 * Validates JPEG, PNG, PDF by magic bytes and CSV by structure.
 */

import type { DetectedFileType, DocumentType, FileTypeValidation } from './types.js';

// ─── Magic Bytes Definitions ─────────────────────────────────────────────────

const MAGIC_BYTES: Record<
  string,
  { bytes: number[]; mime: string; ext: string; documentType: DocumentType }
> = {
  jpeg: {
    bytes: [0xff, 0xd8, 0xff],
    mime: 'image/jpeg',
    ext: 'jpg',
    documentType: 'RECEIPT_IMAGE',
  },
  png: {
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    mime: 'image/png',
    ext: 'png',
    documentType: 'RECEIPT_IMAGE',
  },
  pdf: {
    bytes: [0x25, 0x50, 0x44, 0x46],
    mime: 'application/pdf',
    ext: 'pdf',
    documentType: 'BANK_STATEMENT',
  },
};

const CSV_VALIDATION = {
  mime: 'text/csv',
  ext: 'csv',
  documentType: 'POS_EXPORT' as DocumentType,
};

const UNKNOWN_FILE_TYPE: DetectedFileType = {
  mime: 'application/octet-stream',
  ext: '',
  documentType: null,
};

// ─── Helper Functions ────────────────────────────────────────────────────────

function matchesMagicBytes(buffer: Buffer, signature: number[]): boolean {
  if (buffer.length < signature.length) {
    return false;
  }
  return signature.every((byte, index) => buffer[index] === byte);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Detect file type from buffer magic bytes.
 * Returns detected MIME type, extension, and DocumentType (or null if unknown).
 */
export function detectFileType(buffer: Buffer): DetectedFileType {
  if (buffer.length === 0) {
    return UNKNOWN_FILE_TYPE;
  }

  for (const entry of Object.values(MAGIC_BYTES)) {
    if (matchesMagicBytes(buffer, entry.bytes)) {
      return {
        mime: entry.mime,
        ext: entry.ext,
        documentType: entry.documentType,
      };
    }
  }

  return UNKNOWN_FILE_TYPE;
}

/**
 * Validate file type and return DocumentType or null for invalid files.
 * Checks magic bytes for binary formats and structure for CSV.
 */
export function validateFileType(buffer: Buffer): FileTypeValidation {
  if (buffer.length === 0) {
    return {
      valid: false,
      detectedType: null,
      detectedMime: null,
      error: 'Empty file buffer',
    };
  }

  const detected = detectFileType(buffer);

  if (detected.documentType !== null) {
    return {
      valid: true,
      detectedType: detected.documentType,
      detectedMime: detected.mime,
    };
  }

  // Try CSV validation — CSV is text-based, no magic bytes
  const content = buffer.toString('utf-8');
  if (validateCsvStructure(content)) {
    return {
      valid: true,
      detectedType: CSV_VALIDATION.documentType,
      detectedMime: CSV_VALIDATION.mime,
    };
  }

  return {
    valid: false,
    detectedType: null,
    detectedMime: detected.mime,
    error: 'Unsupported file type. Supported formats: JPEG, PNG, PDF, CSV',
  };
}

/**
 * Check if the file buffer is a supported document type.
 */
export function isSupportedType(buffer: Buffer): boolean {
  return validateFileType(buffer).valid;
}

/**
 * Validate that a string has proper CSV structure:
 * - At least one header row and one data row
 * - Rows are comma-separated
 * - Consistent column count across rows
 */
export function validateCsvStructure(content: string): boolean {
  if (!content || content.trim().length === 0) {
    return false;
  }

  const lines = content
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  // Need at least a header row and one data row
  if (lines.length < 2) {
    return false;
  }

  const headerColumns = lines[0].split(',').length;

  // Header must have at least 2 columns to be a meaningful CSV
  if (headerColumns < 2) {
    return false;
  }

  // Check that data rows have consistent column count
  for (let i = 1; i < lines.length; i++) {
    const rowColumns = lines[i].split(',').length;
    if (rowColumns !== headerColumns) {
      return false;
    }
  }

  return true;
}
