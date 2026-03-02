/**
 * PosExportExtractor — extracts transaction data from Nigerian POS
 * export CSV files using local parsing (no AI dependency).
 *
 * Parses CSV content, maps columns to transaction fields using flexible
 * column name matching, and converts Naira amounts to Kobo (×100).
 * Confidence is always 1.0 since CSV parsing is deterministic.
 *
 * Requirements: 3.1
 * @module document-processing/posExportExtractor
 */

import type { DocumentExtractor } from './processingService.js';
import type { Document, ExtractionResult, ExtractedTransaction } from './types.js';

// ─── Column Name Mappings ────────────────────────────────────────────────────

const DATE_COLUMNS = ['date', 'transaction_date', 'trans_date', 'txn_date'];
const DESCRIPTION_COLUMNS = ['description', 'narration', 'details', 'memo'];
const AMOUNT_COLUMNS = ['amount', 'value', 'total'];
const TYPE_COLUMNS = ['type', 'transaction_type', 'txn_type', 'dr_cr'];
const REFERENCE_COLUMNS = ['reference', 'ref', 'ref_no', 'terminal_id'];

// ─── CSV Parser ──────────────────────────────────────────────────────────────

/**
 * Parse CSV content into rows of string arrays.
 * Handles quoted fields, escaped quotes (doubled), commas within quotes,
 * and newlines within quoted fields.
 */
function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < content.length) {
    const char = content[i]!;

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote (doubled)
        if (i + 1 < content.length && content[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        }
        // End of quoted field
        inQuotes = false;
        i++;
        continue;
      }
      currentField += char;
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (char === ',') {
      currentRow.push(currentField.trim());
      currentField = '';
      i++;
      continue;
    }

    if (char === '\r') {
      // Handle \r\n or standalone \r
      if (i + 1 < content.length && content[i + 1] === '\n') {
        i++;
      }
      currentRow.push(currentField.trim());
      currentField = '';
      if (currentRow.some((f) => f.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      i++;
      continue;
    }

    if (char === '\n') {
      currentRow.push(currentField.trim());
      currentField = '';
      if (currentRow.some((f) => f.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      i++;
      continue;
    }

    currentField += char;
    i++;
  }

  // Flush last field/row
  currentRow.push(currentField.trim());
  if (currentRow.some((f) => f.length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

// ─── Column Index Resolution ─────────────────────────────────────────────────

interface ColumnIndices {
  date: number;
  description: number;
  amount: number;
  type: number;
  reference: number;
}

/**
 * Find column indices by matching header names against known aliases.
 * Returns -1 for columns that are not found.
 */
function resolveColumnIndices(headers: string[]): ColumnIndices {
  const normalised = headers.map((h) => h.toLowerCase().trim().replace(/\s+/g, '_'));

  const findIndex = (aliases: string[]): number => normalised.findIndex((h) => aliases.includes(h));

  return {
    date: findIndex(DATE_COLUMNS),
    description: findIndex(DESCRIPTION_COLUMNS),
    amount: findIndex(AMOUNT_COLUMNS),
    type: findIndex(TYPE_COLUMNS),
    reference: findIndex(REFERENCE_COLUMNS),
  };
}

// ─── PosExportExtractor ──────────────────────────────────────────────────────

export class PosExportExtractor implements DocumentExtractor {
  async extract(_buffer: Buffer, _document: Document): Promise<ExtractionResult> {
    const warnings: string[] = [];
    const errors: string[] = [];
    const content = _buffer.toString('utf-8');

    // Parse CSV
    const rows = parseCsv(content);

    // Empty CSV
    if (rows.length === 0) {
      warnings.push('CSV file is empty');
      return { transactions: [], warnings, errors, confidence: 1.0 };
    }

    // First row is headers
    const headers = rows[0]!;
    const dataRows = rows.slice(1);

    if (dataRows.length === 0) {
      warnings.push('CSV file contains only headers, no data rows');
      return { transactions: [], warnings, errors, confidence: 1.0 };
    }

    // Resolve column indices
    const indices = resolveColumnIndices(headers);

    // Warn about missing required columns
    if (indices.date === -1) {
      warnings.push('Missing date column — transactions will use current date');
    }
    if (indices.amount === -1) {
      warnings.push('Missing amount column — cannot extract transaction amounts');
    }
    if (indices.description === -1) {
      warnings.push('Missing description column');
    }

    const transactions: ExtractedTransaction[] = [];

    for (const [rowIndex, row] of dataRows.entries()) {
      const parsed = this.mapRow(row, rowIndex, indices, warnings);
      if (parsed) {
        transactions.push(parsed);
      }
    }

    return { transactions, warnings, errors, confidence: 1.0 };
  }

  /**
   * Map a single CSV row to an ExtractedTransaction.
   * Returns null if the row cannot be parsed at all.
   */
  private mapRow(
    row: string[],
    rowIndex: number,
    indices: ColumnIndices,
    warnings: string[],
  ): ExtractedTransaction | null {
    const rowNum = rowIndex + 2; // 1-indexed, +1 for header row

    // ── Amount (Naira → Kobo) ────────────────────────────────────────────
    let amountKobo: number | null = null;
    let rawAmount = 0;
    if (indices.amount !== -1) {
      const amountStr = row[indices.amount];
      if (amountStr !== undefined && amountStr.length > 0) {
        // Strip currency symbols and commas
        const cleaned = amountStr.replace(/[₦,NGN\s]/g, '');
        const parsed = parseFloat(cleaned);
        if (isNaN(parsed)) {
          warnings.push(`Row ${rowNum}: could not parse amount "${amountStr}"`);
        } else {
          rawAmount = parsed;
          amountKobo = Math.round(Math.abs(parsed) * 100);
        }
      }
    }

    // ── Date ─────────────────────────────────────────────────────────────
    let date: Date | null = null;
    if (indices.date !== -1) {
      const dateStr = row[indices.date];
      if (dateStr !== undefined && dateStr.length > 0) {
        const parsed = new Date(dateStr);
        if (isNaN(parsed.getTime())) {
          warnings.push(`Row ${rowNum}: could not parse date "${dateStr}"`);
        } else {
          date = parsed;
        }
      }
    }

    // Skip row if both date and amount are missing/unparseable
    if (date === null && amountKobo === null) {
      warnings.push(`Row ${rowNum}: skipped — missing both date and amount`);
      return null;
    }

    // ── Type ─────────────────────────────────────────────────────────────
    let txType: 'credit' | 'debit' = 'debit';
    if (indices.type !== -1) {
      const typeStr = row[indices.type];
      if (typeStr !== undefined && typeStr.length > 0) {
        const normalised = typeStr.toLowerCase().trim();
        if (normalised === 'credit' || normalised === 'cr') {
          txType = 'credit';
        } else if (normalised === 'debit' || normalised === 'dr') {
          txType = 'debit';
        } else {
          warnings.push(`Row ${rowNum}: unknown type "${typeStr}", defaulting to debit`);
        }
      }
    } else {
      // Infer from amount sign when no type column exists
      if (rawAmount > 0) {
        txType = 'credit';
      } else if (rawAmount < 0) {
        txType = 'debit';
      }
    }

    // ── Description ──────────────────────────────────────────────────────
    let description = `POS transaction ${rowNum}`;
    if (indices.description !== -1) {
      const descStr = row[indices.description];
      if (descStr !== undefined && descStr.length > 0) {
        description = descStr;
      }
    }

    // ── Reference ────────────────────────────────────────────────────────
    let reference: string | undefined;
    if (indices.reference !== -1) {
      const refStr = row[indices.reference];
      if (refStr !== undefined && refStr.length > 0) {
        reference = refStr;
      }
    }

    // ── Build result ─────────────────────────────────────────────────────
    const metadata: Record<string, unknown> = { source: 'pos_export' };

    return {
      date: date ?? new Date(),
      description,
      amount: amountKobo ?? 0,
      type: txType,
      reference,
      metadata,
    };
  }
}
