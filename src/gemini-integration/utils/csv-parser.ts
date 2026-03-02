// Gemini Integration - CSV parsing utility
// Validates: Requirements 3.6

import Papa from 'papaparse';

/**
 * Options for CSV parsing.
 */
export interface CsvOptions {
  delimiter?: string;
  hasHeader?: boolean;
  skipEmptyLines?: boolean;
}

/**
 * Result of parsing CSV content.
 */
export interface CsvParseResult {
  success: boolean;
  headers: string[];
  rows: Record<string, string>[];
  warnings: string[];
}

/**
 * Result of validating CSV structure.
 */
export interface CsvValidationResult {
  valid: boolean;
  rowCount: number;
  columnCount: number;
  errors: string[];
}

/**
 * Detected CSV dialect (delimiter, quote char, escape char).
 */
export interface CsvDialect {
  delimiter: string;
  quoteChar: string;
  escapeChar: string;
}

const KNOWN_DELIMITERS = [',', '\t', ';', '|'] as const;

/**
 * Detects the CSV dialect by analysing the first few lines of content.
 *
 * Uses a frequency-based heuristic: for each candidate delimiter the function
 * counts occurrences per line and picks the delimiter that appears most
 * consistently across lines.
 *
 * @param content - Raw CSV string
 * @returns CsvDialect with detected delimiter, quote char, and escape char
 */
export function detectDialect(content: string): CsvDialect {
  const defaultDialect: CsvDialect = {
    delimiter: ',',
    quoteChar: '"',
    escapeChar: '"',
  };

  if (!content || content.trim().length === 0) {
    return defaultDialect;
  }

  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const sampleLines = lines.slice(0, Math.min(lines.length, 10));

  if (sampleLines.length === 0) {
    return defaultDialect;
  }

  let bestDelimiter = ',';
  let bestScore = -1;

  for (const delimiter of KNOWN_DELIMITERS) {
    const counts = sampleLines.map((line) => countDelimiterOutsideQuotes(line, delimiter));
    const nonZeroCounts = counts.filter((c) => c > 0);

    if (nonZeroCounts.length === 0) {
      continue;
    }

    // Consistency: how many lines have the same count
    const mode = findMode(nonZeroCounts);
    const consistent = nonZeroCounts.filter((c) => c === mode).length;

    // Score = consistency × count — prefer delimiters that appear uniformly
    const score = consistent * mode;

    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter;
    }
  }

  return {
    delimiter: bestDelimiter,
    quoteChar: '"',
    escapeChar: '"',
  };
}

/**
 * Counts occurrences of a delimiter character outside of quoted strings.
 */
function countDelimiterOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      count++;
    }
  }

  return count;
}

/**
 * Finds the most frequent value in an array of numbers.
 */
function findMode(values: number[]): number {
  const freq = new Map<number, number>();
  let maxCount = 0;
  let mode = values[0] ?? 0;

  for (const v of values) {
    const count = (freq.get(v) ?? 0) + 1;
    freq.set(v, count);
    if (count > maxCount) {
      maxCount = count;
      mode = v;
    }
  }

  return mode;
}

/**
 * Validates the structure of CSV content without fully parsing it.
 *
 * Checks that the content is non-empty, has consistent column counts across
 * rows, and contains at least one data row beyond the header.
 *
 * @param content - Raw CSV string
 * @returns CsvValidationResult with validity, row/column counts, and errors
 */
export function validateStructure(content: string): CsvValidationResult {
  const errors: string[] = [];

  if (!content || content.trim().length === 0) {
    return { valid: false, rowCount: 0, columnCount: 0, errors: ['CSV content is empty'] };
  }

  const dialect = detectDialect(content);

  const result = Papa.parse<string[]>(content, {
    delimiter: dialect.delimiter,
    header: false,
    skipEmptyLines: true,
  });

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      errors.push(`Row ${err.row}: ${err.message}`);
    }
  }

  const rows = result.data;

  if (rows.length === 0) {
    return { valid: false, rowCount: 0, columnCount: 0, errors: ['CSV contains no data rows'] };
  }

  const headerRow = rows[0];
  if (!headerRow || headerRow.length === 0) {
    return { valid: false, rowCount: 0, columnCount: 0, errors: ['CSV header row is empty'] };
  }

  const columnCount = headerRow.length;
  const dataRows = rows.slice(1);

  // Check for inconsistent column counts
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (row && row.length !== columnCount) {
      errors.push(`Row ${i + 2} has ${row.length} columns, expected ${columnCount}`);
    }
  }

  const valid = errors.length === 0;

  return {
    valid,
    rowCount: dataRows.length,
    columnCount,
    errors,
  };
}

/**
 * Parses CSV content into structured data using papaparse.
 *
 * Auto-detects the delimiter when not specified. Supports header and
 * headerless modes, and skips empty lines by default.
 *
 * @param content - Raw CSV string
 * @param options - Optional parsing configuration
 * @returns CsvParseResult with headers, rows, and any warnings
 */
export function parse(content: string, options?: CsvOptions): CsvParseResult {
  const warnings: string[] = [];

  if (!content || content.trim().length === 0) {
    return { success: false, headers: [], rows: [], warnings: ['CSV content is empty'] };
  }

  const hasHeader = options?.hasHeader ?? true;
  const skipEmptyLines = options?.skipEmptyLines ?? true;
  const delimiter = options?.delimiter ?? detectDialect(content).delimiter;

  const result = Papa.parse<string[]>(content, {
    delimiter,
    header: false,
    skipEmptyLines,
  });

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      warnings.push(`Parse warning at row ${err.row}: ${err.message}`);
    }
  }

  const rawRows = result.data;

  if (rawRows.length === 0) {
    return { success: false, headers: [], rows: [], warnings: ['CSV contains no data'] };
  }

  let headers: string[];
  let dataStartIndex: number;

  if (hasHeader) {
    const headerRow = rawRows[0];
    if (!headerRow || headerRow.length === 0) {
      return { success: false, headers: [], rows: [], warnings: ['CSV header row is empty'] };
    }
    headers = headerRow.map((h) => h.trim());
    dataStartIndex = 1;
  } else {
    const firstRow = rawRows[0];
    if (!firstRow) {
      return { success: false, headers: [], rows: [], warnings: ['CSV contains no data'] };
    }
    headers = firstRow.map((_, i) => `column_${i}`);
    dataStartIndex = 0;
  }

  const rows: Record<string, string>[] = [];

  for (let i = dataStartIndex; i < rawRows.length; i++) {
    const rawRow = rawRows[i];
    if (!rawRow) {
      continue;
    }

    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      if (header !== undefined) {
        row[header] = rawRow[j] ?? '';
      }
    }
    rows.push(row);
  }

  if (rows.length === 0) {
    warnings.push('CSV has headers but no data rows');
  }

  return {
    success: true,
    headers,
    rows,
    warnings,
  };
}
