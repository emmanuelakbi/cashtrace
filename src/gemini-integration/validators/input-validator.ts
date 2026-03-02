// Gemini Integration - Input validation layer

import type { BusinessContext } from '../types/insights.js';
const DEFAULT_MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// JPEG magic bytes: 0xFF 0xD8 0xFF
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;

// PNG magic bytes: 0x89 0x50 0x4E 0x47
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47] as const;

/**
 * A simple validation error for input validation results.
 * Distinct from the ValidationError class in types/errors.ts which extends GeminiServiceError.
 */
export interface InputValidationError {
  field: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: InputValidationError[];
  warnings: string[];
}

function matchesMagicBytes(buffer: Buffer, magic: readonly number[]): boolean {
  if (buffer.length < magic.length) {
    return false;
  }
  return magic.every((byte, i) => buffer[i] === byte);
}

function detectImageFormat(buffer: Buffer): 'jpeg' | 'png' | null {
  if (matchesMagicBytes(buffer, JPEG_MAGIC)) {
    return 'jpeg';
  }
  if (matchesMagicBytes(buffer, PNG_MAGIC)) {
    return 'png';
  }
  return null;
}

const DEFAULT_MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// PDF magic bytes: %PDF → 0x25 0x50 0x44 0x46
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] as const;

/**
 * Checks whether a PDF buffer contains the "/Encrypt" dictionary entry,
 * which indicates the PDF is password-protected.
 */
function isPdfEncrypted(buffer: Buffer): boolean {
  const marker = '/Encrypt';
  const content = buffer.toString('latin1');
  return content.includes(marker);
}

/**
 * Validates a PDF buffer for bank statement parsing.
 *
 * Checks:
 * - Buffer is non-empty
 * - Buffer does not exceed maxSizeBytes
 * - Buffer starts with valid PDF magic bytes (%PDF)
 * - Detects password-protected PDFs (adds warning)
 *
 * @param buffer - The PDF buffer to validate
 * @param maxSizeBytes - Maximum allowed size in bytes (default: 10MB)
 * @returns ValidationResult with errors and warnings
 */
export function validatePdfInput(
  buffer: Buffer,
  maxSizeBytes: number = DEFAULT_MAX_PDF_SIZE_BYTES,
): ValidationResult {
  const errors: InputValidationError[] = [];
  const warnings: string[] = [];

  if (buffer.length === 0) {
    errors.push({
      field: 'pdfBuffer',
      code: 'EMPTY_BUFFER',
      message: 'PDF buffer is empty',
    });
    return { valid: false, errors, warnings };
  }

  if (buffer.length > maxSizeBytes) {
    const sizeMb = (buffer.length / (1024 * 1024)).toFixed(2);
    const limitMb = (maxSizeBytes / (1024 * 1024)).toFixed(2);
    errors.push({
      field: 'pdfBuffer',
      code: 'FILE_TOO_LARGE',
      message: `PDF size ${sizeMb}MB exceeds maximum ${limitMb}MB`,
    });
    return { valid: false, errors, warnings };
  }

  if (!matchesMagicBytes(buffer, PDF_MAGIC)) {
    errors.push({
      field: 'pdfBuffer',
      code: 'INVALID_FORMAT',
      message: 'Buffer is not a valid PDF file',
    });
    return { valid: false, errors, warnings };
  }

  if (isPdfEncrypted(buffer)) {
    warnings.push('PDF appears to be password-protected; extraction may be incomplete');
  }

  return { valid: true, errors, warnings };
}

/**
 * Validates an image buffer for receipt parsing.
 *
 * Checks:
 * - Buffer is non-empty
 * - Buffer does not exceed maxSizeBytes
 * - Buffer starts with valid JPEG or PNG magic bytes
 *
 * @param buffer - The image buffer to validate
 * @param maxSizeBytes - Maximum allowed size in bytes (default: 10MB)
 * @returns ValidationResult with errors and warnings
 */
export function validateImageInput(
  buffer: Buffer,
  maxSizeBytes: number = DEFAULT_MAX_IMAGE_SIZE_BYTES,
): ValidationResult {
  const errors: InputValidationError[] = [];
  const warnings: string[] = [];

  if (buffer.length === 0) {
    errors.push({
      field: 'imageBuffer',
      code: 'EMPTY_BUFFER',
      message: 'Image buffer is empty',
    });
    return { valid: false, errors, warnings };
  }

  if (buffer.length > maxSizeBytes) {
    const sizeMb = (buffer.length / (1024 * 1024)).toFixed(2);
    const limitMb = (maxSizeBytes / (1024 * 1024)).toFixed(2);
    errors.push({
      field: 'imageBuffer',
      code: 'FILE_TOO_LARGE',
      message: `Image size ${sizeMb}MB exceeds maximum ${limitMb}MB`,
    });
    return { valid: false, errors, warnings };
  }

  const format = detectImageFormat(buffer);
  if (format === null) {
    errors.push({
      field: 'imageBuffer',
      code: 'INVALID_FORMAT',
      message: 'Image is not a valid JPEG or PNG file',
    });
    return { valid: false, errors, warnings };
  }

  if (format === 'png') {
    warnings.push(
      'PNG images may use more tokens than JPEG; consider converting for cost efficiency',
    );
  }

  return { valid: true, errors, warnings };
}

const DEFAULT_MAX_CSV_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

const CSV_DELIMITERS = [',', ';', '\t', '|'] as const;

/**
 * Detects the most likely delimiter used in a CSV line by counting occurrences
 * of common delimiters and returning the one with the highest count.
 * Falls back to comma if no delimiter is detected.
 */
function detectDelimiter(firstLine: string): string {
  let bestDelimiter = ',';
  let bestCount = 0;

  for (const delimiter of CSV_DELIMITERS) {
    const count = firstLine.split(delimiter).length - 1;
    if (count > bestCount) {
      bestCount = count;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}

/**
 * Validates CSV content for POS export parsing.
 *
 * Checks:
 * - Content is non-empty (not just whitespace)
 * - Content size does not exceed maxSizeBytes (measured as UTF-8 byte length)
 * - Has at least 2 non-empty lines (header + at least 1 data row)
 * - Auto-detects delimiter from first line
 * - Warns if inconsistent column counts across rows
 *
 * @param content - The CSV string content to validate
 * @param maxSizeBytes - Maximum allowed size in bytes (default: 5MB)
 * @returns ValidationResult with errors and warnings
 */
export function validateCsvInput(
  content: string,
  maxSizeBytes: number = DEFAULT_MAX_CSV_SIZE_BYTES,
): ValidationResult {
  const errors: InputValidationError[] = [];
  const warnings: string[] = [];

  if (content.trim().length === 0) {
    errors.push({
      field: 'csvContent',
      code: 'EMPTY_CONTENT',
      message: 'CSV content is empty',
    });
    return { valid: false, errors, warnings };
  }

  const byteLength = Buffer.byteLength(content, 'utf-8');
  if (byteLength > maxSizeBytes) {
    const sizeMb = (byteLength / (1024 * 1024)).toFixed(2);
    const limitMb = (maxSizeBytes / (1024 * 1024)).toFixed(2);
    errors.push({
      field: 'csvContent',
      code: 'FILE_TOO_LARGE',
      message: `CSV size ${sizeMb}MB exceeds maximum ${limitMb}MB`,
    });
    return { valid: false, errors, warnings };
  }

  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    errors.push({
      field: 'csvContent',
      code: 'INSUFFICIENT_ROWS',
      message: 'CSV must have at least a header row and one data row',
    });
    return { valid: false, errors, warnings };
  }

  const delimiter = detectDelimiter(lines[0]!);
  const headerColumnCount = lines[0]!.split(delimiter).length;

  let inconsistentRows = 0;
  for (let i = 1; i < lines.length; i++) {
    const columnCount = lines[i]!.split(delimiter).length;
    if (columnCount !== headerColumnCount) {
      inconsistentRows++;
    }
  }

  if (inconsistentRows > 0) {
    warnings.push(
      `${inconsistentRows} row(s) have inconsistent column count (expected ${headerColumnCount} columns)`,
    );
  }

  return { valid: true, errors, warnings };
}
const LARGE_TRANSACTION_THRESHOLD = 1000;

/**
 * Validates a BusinessContext object for insight generation.
 *
 * Checks:
 * - businessId is a non-empty string
 * - businessName is a non-empty string
 * - businessType is a non-empty string
 * - transactions is a non-empty array
 * - period has start and end as non-empty strings
 * - period.start is parseable as a date
 * - period.end is parseable as a date
 * - period.end >= period.start
 * - Warns if transactions array is very large (>1000 items)
 *
 * @param context - The BusinessContext to validate
 * @returns ValidationResult with errors and warnings
 */
export function validateBusinessContext(context: BusinessContext): ValidationResult {
  const errors: InputValidationError[] = [];
  const warnings: string[] = [];

  if (!context.businessId || context.businessId.trim().length === 0) {
    errors.push({
      field: 'businessId',
      code: 'REQUIRED_FIELD',
      message: 'businessId must be a non-empty string',
    });
  }

  if (!context.businessName || context.businessName.trim().length === 0) {
    errors.push({
      field: 'businessName',
      code: 'REQUIRED_FIELD',
      message: 'businessName must be a non-empty string',
    });
  }

  if (!context.businessType || context.businessType.trim().length === 0) {
    errors.push({
      field: 'businessType',
      code: 'REQUIRED_FIELD',
      message: 'businessType must be a non-empty string',
    });
  }

  if (!Array.isArray(context.transactions) || context.transactions.length === 0) {
    errors.push({
      field: 'transactions',
      code: 'EMPTY_ARRAY',
      message: 'transactions must be a non-empty array',
    });
  } else if (context.transactions.length > LARGE_TRANSACTION_THRESHOLD) {
    warnings.push(
      `transactions array has ${context.transactions.length} items (>${LARGE_TRANSACTION_THRESHOLD}); this may increase token usage`,
    );
  }

  if (!context.period) {
    errors.push({
      field: 'period',
      code: 'REQUIRED_FIELD',
      message: 'period is required',
    });
  } else {
    const hasStart =
      typeof context.period.start === 'string' && context.period.start.trim().length > 0;
    const hasEnd = typeof context.period.end === 'string' && context.period.end.trim().length > 0;

    if (!hasStart) {
      errors.push({
        field: 'period.start',
        code: 'REQUIRED_FIELD',
        message: 'period.start must be a non-empty string',
      });
    }

    if (!hasEnd) {
      errors.push({
        field: 'period.end',
        code: 'REQUIRED_FIELD',
        message: 'period.end must be a non-empty string',
      });
    }

    if (hasStart && hasEnd) {
      const startDate = new Date(context.period.start);
      const endDate = new Date(context.period.end);

      if (isNaN(startDate.getTime())) {
        errors.push({
          field: 'period.start',
          code: 'INVALID_DATE',
          message: 'period.start is not a valid date',
        });
      }

      if (isNaN(endDate.getTime())) {
        errors.push({
          field: 'period.end',
          code: 'INVALID_DATE',
          message: 'period.end is not a valid date',
        });
      }

      if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime()) && endDate < startDate) {
        errors.push({
          field: 'period',
          code: 'INVALID_RANGE',
          message: 'period.end must be greater than or equal to period.start',
        });
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
