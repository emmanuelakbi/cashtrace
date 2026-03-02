/**
 * Unit tests for BankStatementExtractor.
 *
 * Validates: Requirement 2.3
 * @module document-processing/bankStatementExtractor.test
 */

import { describe, expect, it, vi } from 'vitest';

import { BankStatementExtractor } from './bankStatementExtractor.js';
import type { GeminiClient, GeminiExtractionResponse } from './receiptExtractor.js';
import type { Document } from './types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-001',
    businessId: 'biz-001',
    userId: 'user-001',
    filename: 'statement_doc-001.pdf',
    originalFilename: 'gtbank_statement.pdf',
    documentType: 'BANK_STATEMENT',
    mimeType: 'application/pdf',
    fileSize: 102400,
    s3Key: 'documents/biz-001/BANK_STATEMENT/2024/01/doc-001_statement.pdf',
    s3Bucket: 'cashtrace-docs',
    status: 'PROCESSING',
    processingStartedAt: new Date('2024-01-15T10:00:00Z'),
    processingCompletedAt: null,
    processingDurationMs: null,
    transactionsExtracted: null,
    processingWarnings: [],
    processingErrors: [],
    idempotencyKey: null,
    uploadedAt: new Date('2024-01-15T09:00:00Z'),
    updatedAt: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

function makeGeminiClient(overrides: Partial<GeminiClient> = {}): GeminiClient {
  return {
    extractFromImage: vi.fn<GeminiClient['extractFromImage']>().mockResolvedValue({
      text: JSON.stringify({ transactions: [] }),
      confidence: 0.9,
    }),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('BankStatementExtractor', () => {
  const buffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e]); // %PDF-1.
  const document = makeDocument();

  describe('successful extraction with valid JSON response', () => {
    it('should extract transactions from a well-formed Gemini response', async () => {
      const geminiResponse: GeminiExtractionResponse = {
        text: JSON.stringify({
          transactions: [
            {
              date: '2024-03-01',
              description: 'POS Purchase - Shoprite Ikeja',
              amount: 15750.0,
              type: 'debit',
              reference: 'TRF/GTB/2024030100001',
              balance: 234250.0,
            },
            {
              date: '2024-03-02',
              description: 'Salary Credit - ABC Ltd',
              amount: 350000.0,
              type: 'credit',
              reference: 'NIP/ACC/2024030200042',
              balance: 584250.0,
            },
          ],
        }),
        confidence: 0.92,
      };

      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockResolvedValue(geminiResponse),
      });
      const extractor = new BankStatementExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(2);
      expect(result.confidence).toBe(0.92);
      expect(result.errors).toHaveLength(0);

      // First transaction — debit
      expect(result.transactions[0]!.description).toBe('POS Purchase - Shoprite Ikeja');
      expect(result.transactions[0]!.amount).toBe(1575000); // 15750 Naira → Kobo
      expect(result.transactions[0]!.type).toBe('debit');
      expect(result.transactions[0]!.reference).toBe('TRF/GTB/2024030100001');
      expect(result.transactions[0]!.date).toEqual(new Date('2024-03-01'));
      expect(result.transactions[0]!.metadata.balanceKobo).toBe(23425000);

      // Second transaction — credit
      expect(result.transactions[1]!.description).toBe('Salary Credit - ABC Ltd');
      expect(result.transactions[1]!.amount).toBe(35000000); // 350000 Naira → Kobo
      expect(result.transactions[1]!.type).toBe('credit');
      expect(result.transactions[1]!.reference).toBe('NIP/ACC/2024030200042');
      expect(result.transactions[1]!.metadata.balanceKobo).toBe(58425000);
    });
  });

  describe('handles malformed AI response gracefully', () => {
    it('should return empty transactions with warning when response is not valid JSON', async () => {
      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockResolvedValue({
          text: 'Sorry, I could not read this bank statement clearly.',
          confidence: 0.2,
        }),
      });
      const extractor = new BankStatementExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(0);
      expect(result.warnings).toContain('Failed to parse AI response as JSON');
      expect(result.confidence).toBe(0.2);
    });

    it('should return empty transactions with warning when JSON has unexpected structure', async () => {
      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockResolvedValue({
          text: JSON.stringify({ statement: 'no transactions key here' }),
          confidence: 0.4,
        }),
      });
      const extractor = new BankStatementExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(0);
      expect(result.warnings).toContain('Failed to parse AI response as JSON');
    });
  });

  describe('converts Naira amounts to Kobo', () => {
    it('should multiply amounts by 100 and round to nearest integer', async () => {
      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            transactions: [
              { date: '2024-01-10', description: 'Transfer', amount: 99.99 },
              { date: '2024-01-11', description: 'Charge', amount: 0.5 },
              { date: '2024-01-12', description: 'Deposit', amount: 500000 },
            ],
          }),
          confidence: 0.88,
        }),
      });
      const extractor = new BankStatementExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(3);
      expect(result.transactions[0]!.amount).toBe(9999); // 99.99 × 100
      expect(result.transactions[1]!.amount).toBe(50); // 0.50 × 100
      expect(result.transactions[2]!.amount).toBe(50000000); // 500000 × 100
    });

    it('should handle string amounts by parsing them as floats', async () => {
      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            transactions: [
              { date: '2024-02-01', description: 'Wire transfer', amount: '12500.75' },
            ],
          }),
          confidence: 0.85,
        }),
      });
      const extractor = new BankStatementExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.amount).toBe(1250075); // 12500.75 × 100
    });
  });

  describe('handles multiple transactions from a statement', () => {
    it('should extract all transactions from a multi-entry statement', async () => {
      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            transactions: [
              { date: '2024-04-01', description: 'Opening balance', amount: 0, type: 'credit' },
              { date: '2024-04-02', description: 'ATM Withdrawal', amount: 20000, type: 'debit' },
              {
                date: '2024-04-03',
                description: 'NIP Transfer In',
                amount: 150000,
                type: 'credit',
              },
              {
                date: '2024-04-04',
                description: 'POS - Chicken Republic',
                amount: 3500,
                type: 'debit',
              },
              { date: '2024-04-05', description: 'Bank Charges', amount: 52.5, type: 'debit' },
            ],
          }),
          confidence: 0.91,
        }),
      });
      const extractor = new BankStatementExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(5);
      expect(result.transactions[0]!.type).toBe('credit');
      expect(result.transactions[1]!.type).toBe('debit');
      expect(result.transactions[2]!.amount).toBe(15000000); // 150000 Naira
      expect(result.transactions[3]!.description).toBe('POS - Chicken Republic');
      expect(result.transactions[4]!.amount).toBe(5250); // 52.50 Naira → Kobo
    });

    it('should handle a bare JSON array without transactions wrapper', async () => {
      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockResolvedValue({
          text: JSON.stringify([
            { date: '2024-06-01', description: 'Direct array item', amount: 1000, type: 'debit' },
          ]),
          confidence: 0.7,
        }),
      });
      const extractor = new BankStatementExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.description).toBe('Direct array item');
      expect(result.transactions[0]!.amount).toBe(100000);
    });
  });

  describe('handles Gemini client errors gracefully', () => {
    it('should return error when Gemini client throws', async () => {
      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockRejectedValue(new Error('Service unavailable')),
      });
      const extractor = new BankStatementExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(0);
      expect(result.errors).toContain('Gemini AI extraction failed: Service unavailable');
      expect(result.confidence).toBe(0);
    });

    it('should handle non-Error thrown values', async () => {
      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockRejectedValue('string error'),
      });
      const extractor = new BankStatementExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(0);
      expect(result.errors).toContain('Gemini AI extraction failed: Unknown Gemini AI error');
      expect(result.confidence).toBe(0);
    });
  });

  describe('passes correct prompt to Gemini', () => {
    it('should call extractFromImage with a prompt mentioning Nigerian banks', async () => {
      const extractFromImage = vi.fn().mockResolvedValue({
        text: JSON.stringify({ transactions: [] }),
        confidence: 0.9,
      });
      const client = makeGeminiClient({ extractFromImage });
      const extractor = new BankStatementExtractor(client);

      await extractor.extract(buffer, document);

      expect(extractFromImage).toHaveBeenCalledOnce();
      const [passedBuffer, passedPrompt] = extractFromImage.mock.calls[0]!;
      expect(passedBuffer).toBe(buffer);
      expect(passedPrompt).toContain('GTBank');
      expect(passedPrompt).toContain('Access Bank');
      expect(passedPrompt).toContain('Zenith Bank');
      expect(passedPrompt).toContain('First Bank');
      expect(passedPrompt).toContain('UBA');
      expect(passedPrompt).toContain('Naira');
      expect(passedPrompt).toContain('date');
      expect(passedPrompt).toContain('description');
      expect(passedPrompt).toContain('amount');
      expect(passedPrompt).toContain('type');
      expect(passedPrompt).toContain('reference');
      expect(passedPrompt).toContain('balance');
    });
  });

  describe('handles missing and invalid fields', () => {
    it('should skip transaction when both date and amount are missing', async () => {
      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            transactions: [{ description: 'Incomplete entry' }],
          }),
          confidence: 0.3,
        }),
      });
      const extractor = new BankStatementExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(0);
      expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('skipped')]));
    });

    it('should default unknown type to debit with a warning', async () => {
      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            transactions: [
              { date: '2024-07-01', description: 'Reversal', amount: 5000, type: 'reversal' },
            ],
          }),
          confidence: 0.6,
        }),
      });
      const extractor = new BankStatementExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.type).toBe('debit');
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('unknown type')]),
      );
    });

    it('should use default description when description is missing', async () => {
      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            transactions: [{ date: '2024-08-01', amount: 2000 }],
          }),
          confidence: 0.5,
        }),
      });
      const extractor = new BankStatementExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.description).toBe('Bank transaction 1');
    });
  });
});
