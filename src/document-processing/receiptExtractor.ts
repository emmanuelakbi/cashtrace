/**
 * ReceiptExtractor — extracts transaction data from receipt images
 * using Gemini AI.
 *
 * Sends the image buffer to Gemini with a structured prompt, parses
 * the JSON response, and maps fields to ExtractedTransaction[].
 * Amounts are converted from Naira to Kobo (×100).
 *
 * Requirements: 1.1
 * @module document-processing/receiptExtractor
 */

import type { DocumentExtractor } from './processingService.js';
import type { Document, ExtractionResult, ExtractedTransaction } from './types.js';

// ─── Gemini Client Interface ─────────────────────────────────────────────────

/**
 * Abstraction over the Gemini AI client. The concrete implementation
 * lives in the gemini-integration module — this module only depends
 * on the interface.
 */
export interface GeminiClient {
  extractFromImage(imageBuffer: Buffer, prompt: string): Promise<GeminiExtractionResponse>;
}

export interface GeminiExtractionResponse {
  text: string;
  confidence: number;
}

// ─── Raw Gemini JSON shape ───────────────────────────────────────────────────

interface RawTransaction {
  date?: string;
  description?: string;
  amount?: number | string;
  type?: string;
  category?: string;
  reference?: string;
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

const RECEIPT_EXTRACTION_PROMPT = `Analyze this receipt image and extract all transaction data.
Return a JSON object with the following structure:
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "item or service description",
      "amount": 1500.00,
      "type": "debit",
      "category": "category if identifiable",
      "reference": "receipt or reference number if visible"
    }
  ]
}

Rules:
- Amounts must be in Nigerian Naira (₦). Return numeric values without currency symbols.
- Date must be in YYYY-MM-DD format.
- Type should be "credit" or "debit". Most receipt items are "debit".
- If a field cannot be determined, omit it.
- Return ONLY valid JSON, no markdown or extra text.`;

// ─── ReceiptExtractor ────────────────────────────────────────────────────────

export class ReceiptExtractor implements DocumentExtractor {
  private readonly geminiClient: GeminiClient;

  constructor(geminiClient: GeminiClient) {
    this.geminiClient = geminiClient;
  }

  async extract(buffer: Buffer, _document: Document): Promise<ExtractionResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    let response: GeminiExtractionResponse;
    try {
      response = await this.geminiClient.extractFromImage(buffer, RECEIPT_EXTRACTION_PROMPT);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Gemini AI error';
      return {
        transactions: [],
        warnings: [],
        errors: [`Gemini AI extraction failed: ${message}`],
        confidence: 0,
      };
    }

    let rawTransactions: RawTransaction[];
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
  private parseResponse(text: string): RawTransaction[] {
    const parsed: unknown = JSON.parse(text);

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'transactions' in parsed &&
      Array.isArray((parsed as { transactions: unknown }).transactions)
    ) {
      return (parsed as { transactions: RawTransaction[] }).transactions;
    }

    if (Array.isArray(parsed)) {
      return parsed as RawTransaction[];
    }

    throw new Error('Unexpected JSON structure');
  }

  /**
   * Map a single raw transaction object to an ExtractedTransaction.
   * Returns null if the transaction is missing critical fields (date + amount).
   * Adds warnings for individual unparseable fields.
   */
  private mapTransaction(
    raw: RawTransaction,
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
    const description = raw.description ?? `Receipt item ${index + 1}`;

    // ── Build result ─────────────────────────────────────────────────────
    const metadata: Record<string, unknown> = {};
    if (raw.category) {
      metadata.category = raw.category;
    }
    if (raw.reference) {
      metadata.reference = raw.reference;
    }

    return {
      date: date ?? new Date(),
      description,
      amount: amountKobo ?? 0,
      type: txType,
      category: raw.category,
      reference: raw.reference,
      metadata,
    };
  }
}
