/**
 * Unit tests for ReceiptExtractor.
 *
 * Validates: Requirement 1.1
 * @module document-processing/receiptExtractor.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ReceiptExtractor,
  type GeminiClient,
  type GeminiExtractionResponse,
} from './receiptExtractor.js';
import type { Document } from './types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-001',
    businessId: 'biz-001',
    userId: 'user-001',
    filename: 'receipt_doc-001.jpg',
    originalFilename: 'receipt.jpg',
    documentType: 'RECEIPT_IMAGE',
    mimeType: 'image/jpeg',
    fileSize: 2048,
    s3Key: 'documents/biz-001/RECEIPT_IMAGE/2024/01/doc-001_receipt.jpg',
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

describe('ReceiptExtractor', () => {
  const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const document = makeDocument();

  describe('successful extraction with valid JSON response', () => {
    it('should extract transactions from a well-formed Gemini response', async () => {
      const geminiResponse: GeminiExtractionResponse = {
        text: JSON.stringify({
          transactions: [
            {
              date: '2024-03-15',
              description: 'Jollof rice and chicken',
              amount: 2500.0,
              type: 'debit',
              category: 'Food & Dining',
              reference: 'RCP-001',
            },
            {
              date: '2024-03-15',
              description: 'Bottled water',
              amount: 200.5,
              type: 'debit',
              category: 'Beverages',
              reference: 'RCP-002',
            },
          ],
        }),
        confidence: 0.95,
      };

      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockResolvedValue(geminiResponse),
      });
      const extractor = new ReceiptExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(2);
      expect(result.confidence).toBe(0.95);
      expect(result.errors).toHaveLength(0);

      // First transaction
      expect(result.transactions[0]!.description).toBe('Jollof rice and chicken');
      expect(result.transactions[0]!.amount).toBe(250000); // 2500 Naira → Kobo
      expect(result.transactions[0]!.type).toBe('debit');
      expect(result.transactions[0]!.category).toBe('Food & Dining');
      expect(result.transactions[0]!.reference).toBe('RCP-001');
      expect(result.transactions[0]!.date).toEqual(new Date('2024-03-15'));

      // Second transaction
      expect(result.transactions[1]!.description).toBe('Bottled water');
      expect(result.transactions[1]!.amount).toBe(20050); // 200.50 Naira → Kobo
    });
  });

  describe('handles malformed AI response gracefully', () => {
    it('should return empty transactions with warning when response is not valid JSON', async () => {
      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockResolvedValue({
          text: 'This is not JSON at all, just some random text from AI',
          confidence: 0.3,
        }),
      });
      const extractor = new ReceiptExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(0);
      expect(result.warnings).toContain('Failed to parse AI response as JSON');
      expect(result.confidence).toBe(0.3);
    });

    it('should return empty transactions with warning when JSON has unexpected structure', async () => {
      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockResolvedValue({
          text: JSON.stringify({ data: 'no transactions key' }),
          confidence: 0.5,
        }),
      });
      const extractor = new ReceiptExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(0);
      expect(result.warnings).toContain('Failed to parse AI response as JSON');
    });

    it('should return error when Gemini client throws', async () => {
      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockRejectedValue(new Error('API rate limit exceeded')),
      });
      const extractor = new ReceiptExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(0);
      expect(result.errors).toContain('Gemini AI extraction failed: API rate limit exceeded');
      expect(result.confidence).toBe(0);
    });
  });

  describe('handles missing fields in AI response', () => {
    it('should add warnings for missing date and amount but still produce a transaction if one is present', async () => {
      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            transactions: [
              {
                description: 'Unknown item',
                amount: 500,
              },
            ],
          }),
          confidence: 0.6,
        }),
      });
      const extractor = new ReceiptExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.amount).toBe(50000); // 500 Naira → Kobo
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('missing date field')]),
      );
    });

    it('should skip transaction entirely when both date and amount are missing', async () => {
      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            transactions: [
              {
                description: 'Completely incomplete item',
              },
            ],
          }),
          confidence: 0.4,
        }),
      });
      const extractor = new ReceiptExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(0);
      expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('skipped')]));
    });

    it('should warn on unparseable date but still include transaction if amount is present', async () => {
      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            transactions: [
              {
                date: 'not-a-date',
                description: 'Fuel',
                amount: 15000,
                type: 'debit',
              },
            ],
          }),
          confidence: 0.7,
        }),
      });
      const extractor = new ReceiptExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.amount).toBe(1500000); // 15000 Naira → Kobo
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('could not parse date')]),
      );
    });

    it('should default unknown type to debit with a warning', async () => {
      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            transactions: [
              {
                date: '2024-06-01',
                description: 'Refund',
                amount: 1000,
                type: 'refund',
              },
            ],
          }),
          confidence: 0.8,
        }),
      });
      const extractor = new ReceiptExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.type).toBe('debit');
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('unknown type')]),
      );
    });
  });

  describe('converts Naira amounts to Kobo', () => {
    it('should multiply amounts by 100 and round to nearest integer', async () => {
      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            transactions: [
              { date: '2024-01-01', description: 'Item A', amount: 99.99 },
              { date: '2024-01-01', description: 'Item B', amount: 0.01 },
              { date: '2024-01-01', description: 'Item C', amount: 1000 },
            ],
          }),
          confidence: 0.9,
        }),
      });
      const extractor = new ReceiptExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(3);
      expect(result.transactions[0]!.amount).toBe(9999); // 99.99 × 100
      expect(result.transactions[1]!.amount).toBe(1); // 0.01 × 100
      expect(result.transactions[2]!.amount).toBe(100000); // 1000 × 100
    });

    it('should handle string amounts by parsing them as floats', async () => {
      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            transactions: [{ date: '2024-01-01', description: 'String amount', amount: '750.50' }],
          }),
          confidence: 0.85,
        }),
      });
      const extractor = new ReceiptExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.amount).toBe(75050); // 750.50 × 100
    });
  });

  describe('passes correct prompt to Gemini', () => {
    it('should call extractFromImage with the buffer and a prompt mentioning Naira', async () => {
      const extractFromImage = vi.fn().mockResolvedValue({
        text: JSON.stringify({ transactions: [] }),
        confidence: 0.9,
      });
      const client = makeGeminiClient({ extractFromImage });
      const extractor = new ReceiptExtractor(client);

      await extractor.extract(buffer, document);

      expect(extractFromImage).toHaveBeenCalledOnce();
      const [passedBuffer, passedPrompt] = extractFromImage.mock.calls[0]!;
      expect(passedBuffer).toBe(buffer);
      expect(passedPrompt).toContain('Naira');
      expect(passedPrompt).toContain('date');
      expect(passedPrompt).toContain('description');
      expect(passedPrompt).toContain('amount');
      expect(passedPrompt).toContain('type');
      expect(passedPrompt).toContain('category');
      expect(passedPrompt).toContain('reference');
      expect(passedPrompt).toContain('credit');
      expect(passedPrompt).toContain('debit');
    });
  });

  describe('handles array-format response', () => {
    it('should accept a bare JSON array without transactions wrapper', async () => {
      const client = makeGeminiClient({
        extractFromImage: vi.fn().mockResolvedValue({
          text: JSON.stringify([
            { date: '2024-05-10', description: 'Direct array item', amount: 300 },
          ]),
          confidence: 0.75,
        }),
      });
      const extractor = new ReceiptExtractor(client);

      const result = await extractor.extract(buffer, document);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.description).toBe('Direct array item');
      expect(result.transactions[0]!.amount).toBe(30000);
    });
  });
});
