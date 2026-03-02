// ============================================================================
// Transaction Engine Module — Normalization Service
// ============================================================================

import type {
  NormalizedTransaction,
  RawExtractedTransaction,
  SourceType,
  TransactionType,
} from './types.js';

/**
 * Convert a Naira amount to kobo (integer).
 * Multiplies by 100 and rounds to the nearest integer to handle
 * floating-point precision issues.
 *
 * @param naira - Amount in Naira (may have decimals)
 * @returns Amount in kobo as an integer
 */
export function nairaToKobo(naira: number): number {
  return Math.round(naira * 100);
}

/**
 * Convert a kobo amount to Naira.
 *
 * @param kobo - Amount in kobo (integer)
 * @returns Amount in Naira
 */
export function koboToNaira(kobo: number): number {
  return kobo / 100;
}

/**
 * Format a kobo amount as a Naira string with the ₦ symbol,
 * thousands separators, and two decimal places.
 *
 * @example formatAsNaira(123456) => "₦1,234.56"
 * @param kobo - Amount in kobo (integer)
 * @returns Formatted Naira string
 */
export function formatAsNaira(kobo: number): string {
  const naira = koboToNaira(kobo);
  const formatted = naira.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `₦${formatted}`;
}

// ---------------------------------------------------------------------------
// Bank-statement counterparty patterns
// Common Nigerian bank statement formats:
//   "TRF FROM John Doe", "TRF TO Jane Smith", "POS Purchase at ShopName"
//   "NIP/FRM John Doe/...", "NIP/TO Jane Smith/..."
// ---------------------------------------------------------------------------

const BANK_STATEMENT_PATTERNS: RegExp[] = [
  /\bTRF\s+FROM\s+(.+?)(?:\s*\/|$)/i,
  /\bTRF\s+TO\s+(.+?)(?:\s*\/|$)/i,
  /\bFROM\s+(.+?)(?:\s*\/|$)/i,
  /\bTO\s+(.+?)(?:\s*\/|$)/i,
  /\bNIP\/FRM\s+(.+?)(?:\s*\/|$)/i,
  /\bNIP\/TO\s+(.+?)(?:\s*\/|$)/i,
  /\bPOS\s+(?:Purchase\s+)?(?:at\s+)?(.+?)(?:\s*\/|$)/i,
];

const POS_PATTERNS: RegExp[] = [/\bMerchant:\s*(.+)/i, /\bTerminal:\s*(.+?)(?:\s*\/|$)/i];

/**
 * Determine the transaction type (INFLOW or OUTFLOW) from raw extracted data.
 *
 * - If `raw.type` is explicitly 'credit', returns 'INFLOW'.
 * - If `raw.type` is explicitly 'debit', returns 'OUTFLOW'.
 * - Otherwise defaults to 'OUTFLOW' (most transactions are expenses).
 *
 * @param raw - The raw extracted transaction data
 * @returns The determined TransactionType
 */
export function determineTransactionType(raw: RawExtractedTransaction): TransactionType {
  if (raw.type === 'credit') {
    return 'INFLOW';
  }
  if (raw.type === 'debit') {
    return 'OUTFLOW';
  }
  // Default to OUTFLOW when type is not specified
  return 'OUTFLOW';
}

/**
 * Extract a counterparty name from a transaction description based on source type.
 *
 * For BANK_STATEMENT: tries common Nigerian bank transfer patterns.
 * For POS_EXPORT: tries merchant/terminal patterns.
 * For RECEIPT / MANUAL: returns null (counterparty should come from raw data).
 *
 * @param description - The transaction description text
 * @param sourceType  - The source type of the transaction
 * @returns The extracted counterparty name, or null if none found
 */
export function extractCounterparty(description: string, sourceType: SourceType): string | null {
  const patterns =
    sourceType === 'BANK_STATEMENT'
      ? BANK_STATEMENT_PATTERNS
      : sourceType === 'POS_EXPORT'
        ? POS_PATTERNS
        : [];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match?.[1]) {
      const trimmed = match[1].trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return null;
}

/**
 * Normalize a single raw extracted transaction into the unified format.
 *
 * - Converts the date to a Date object
 * - Converts the amount from Naira to kobo (integer)
 * - Determines the transaction type
 * - Extracts or preserves the counterparty
 * - Preserves the reference and raw metadata
 *
 * @param raw        - The raw extracted transaction data
 * @param sourceType - The source type of the transaction
 * @returns A NormalizedTransaction
 */
export function normalize(
  raw: RawExtractedTransaction,
  sourceType: SourceType,
): NormalizedTransaction {
  const transactionDate = raw.date instanceof Date ? raw.date : new Date(raw.date);

  const amountKobo = nairaToKobo(Math.abs(raw.amount));

  const transactionType = determineTransactionType(raw);

  // Use explicit counterparty from raw data first, then try to extract from description
  const counterparty = raw.counterparty?.trim() || extractCounterparty(raw.description, sourceType);

  const reference = raw.reference?.trim() || null;

  const rawMetadata: Record<string, unknown> = raw.metadata ?? {};

  return {
    transactionDate,
    description: raw.description,
    amountKobo,
    transactionType,
    counterparty,
    reference,
    rawMetadata,
  };
}

/**
 * Normalize a batch of raw extracted transactions.
 *
 * @param raw        - Array of raw extracted transactions
 * @param sourceType - The source type for all transactions in the batch
 * @returns Array of NormalizedTransactions
 */
export function normalizeBatch(
  raw: RawExtractedTransaction[],
  sourceType: SourceType,
): NormalizedTransaction[] {
  return raw.map((r) => normalize(r, sourceType));
}
