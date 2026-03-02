/**
 * BankStatementExtractor — extracts transaction data from Nigerian bank
 * statement PDFs using Gemini AI.
 *
 * Sends the PDF buffer to Gemini with a structured prompt tailored for
 * Nigerian banks (GTBank, Access, Zenith, First Bank, UBA), parses the
 * JSON response, and maps fields to ExtractedTransaction[].
 * Amounts are converted from Naira to Kobo (×100).
 *
 * Requirements: 2.3
 * @module document-processing/bankStatementExtractor
 */

import type { DocumentExtractor } from './processingService.js';
import type { GeminiClient, GeminiExtractionResponse } from './receiptExtractor.js';
import type { Document, ExtractionResult, ExtractedTransaction } from './types.js';

// ─── Raw Gemini JSON shape ───────────────────────────────────────────────────

interface RawBankTransaction {
  date?: string;
  description?: string;
  amount?: number | string;
  type?: string;
  reference?: string;
  balance?: number | string;
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

const BANK_STATEMENT_EXTRACTION_PROMPT = `Analyze this bank statement PDF and extract all transactions.
This is a Nigerian bank statement — it may be from GTBank, Access Bank, Zenith Bank, First Bank, or UBA.

Return a JSON object with the following structure:
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "transaction narration or description",
      "amount": 1500.00,
      "type": "credit" or "debit",
      "reference": "transaction reference number",
      "balance": 50000.00
    }
  ]
}

Rules:
- Amounts must be in Nigerian Naira (₦). Return numeric values without currency symbols.
- Date must be in YYYY-MM-DD format.
- Type must be "credit" or "debit".
- Reference is the transaction reference or narration code if available.
- Balance is the account balance after the transaction if shown.
- If a field cannot be determined, omit it.
- Return ONLY valid JSON, no markdown or extra text.`;

// ─── BankStatementExtractor ──────────────────────────────────────────────────

export class BankStatementExtractor implements DocumentExtractor {
  private readonly geminiClient: GeminiClient;

  constructor(geminiClient: GeminiClient) {
    this.geminiClient = geminiClient;
  }

  async extract(buffer: Buffer, _document: Document): Promise<ExtractionResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    let response: GeminiExtractionResponse;
    try {
      response = await this.geminiClient.extractFromImage(buffer, BANK_STATEMENT_EXTRACTION_PROMPT);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Gemini AI error';
      return {
        transactions: [],
        warnings: [],
        errors: [`Gemini AI extraction failed: ${message}`],
        confidence: 0,
      };
    }

    let rawTransactions: RawBankTransaction[];
    try {
      rawTransactions = this.parseResponse(response.text);
    } catch {
      return {
        transactions: [],
        warnings: ['Failed to parse AI response as JSON'],
        errors: [],
        confidence: response.confidence,
      };
    }

    const transactions: ExtractedTransaction[] = [];

    for (const [index, raw] of rawTransactions.entries()) {
      const parsed = this.mapTransaction(raw, index, warnings);
      if (parsed) {
        transactions.push(parsed);
      }
    }

    return {
      transactions,
      warnings,
      errors,
      confidence: response.confidence,
    };
  }

  /**
   * Parse the raw AI response text into an array of raw transactions.
   */
  private parseResponse(text: string): RawBankTransaction[] {
    const parsed: unknown = JSON.parse(text);

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'transactions' in parsed &&
      Array.isArray((parsed as { transactions: unknown }).transactions)
    ) {
      return (parsed as { transactions: RawBankTransaction[] }).transactions;
    }

    if (Array.isArray(parsed)) {
      return parsed as RawBankTransaction[];
    }

    throw new Error('Unexpected JSON structure');
  }

  /**
   * Map a single raw transaction object to an ExtractedTransaction.
   * Returns null if the transaction is missing critical fields (date + amount).
   * Adds warnings for individual unparseable fields.
   */
  private mapTransaction(
    raw: RawBankTransaction,
    index: number,
    warnings: string[],
  ): ExtractedTransaction | null {
    // ── Date ──────────────────────────────────────────────────────────────
    let date: Date | null = null;
    if (raw.date) {
      const parsed = new Date(raw.date);
      if (isNaN(parsed.getTime())) {
        warnings.push(`Transaction ${index}: could not parse date "${raw.date}"`);
      } else {
        date = parsed;
      }
    } else {
      warnings.push(`Transaction ${index}: missing date field`);
    }

    // ── Amount (Naira → Kobo) ────────────────────────────────────────────
    let amountKobo: number | null = null;
    if (raw.amount !== undefined && raw.amount !== null) {
      const numericAmount = typeof raw.amount === 'string' ? parseFloat(raw.amount) : raw.amount;
      if (isNaN(numericAmount)) {
        warnings.push(`Transaction ${index}: could not parse amount "${raw.amount}"`);
      } else {
        amountKobo = Math.round(numericAmount * 100);
      }
    } else {
      warnings.push(`Transaction ${index}: missing amount field`);
    }

    // If both critical fields are missing, skip this transaction entirely
    if (date === null && amountKobo === null) {
      warnings.push(`Transaction ${index}: skipped — missing both date and amount`);
      return null;
    }

    // ── Type ─────────────────────────────────────────────────────────────
    let txType: 'credit' | 'debit' = 'debit';
    if (raw.type) {
      const normalised = raw.type.toLowerCase().trim();
      if (normalised === 'credit' || normalised === 'debit') {
        txType = normalised;
      } else {
        warnings.push(`Transaction ${index}: unknown type "${raw.type}", defaulting to debit`);
      }
    }

    // ── Description ──────────────────────────────────────────────────────
    const description = raw.description ?? `Bank transaction ${index + 1}`;

    // ── Build result ─────────────────────────────────────────────────────
    const metadata: Record<string, unknown> = {};
    if (raw.reference) {
      metadata.reference = raw.reference;
    }
    if (raw.balance !== undefined && raw.balance !== null) {
      const numericBalance =
        typeof raw.balance === 'string' ? parseFloat(raw.balance) : raw.balance;
      if (!isNaN(numericBalance)) {
        metadata.balanceKobo = Math.round(numericBalance * 100);
      }
    }

    return {
      date: date ?? new Date(),
      description,
      amount: amountKobo ?? 0,
      type: txType,
      reference: raw.reference,
      metadata,
    };
  }
}
