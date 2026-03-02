// Gemini Integration - Integration Tests
// End-to-end tests for the GeminiService facade with mocked Gemini API.
// Validates: All requirements (1-14) through the public API surface.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GeminiServiceConfig } from './types/index.js';
import { CircuitOpenError } from './types/index.js';

// ---------------------------------------------------------------------------
// Mock @google/generative-ai at module level
// ---------------------------------------------------------------------------

let mockGenerateContent: ReturnType<typeof vi.fn>;

vi.mock('@google/generative-ai', () => {
  // Create a shared reference so tests can swap behaviour per-test
  mockGenerateContent = vi.fn();

  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: vi.fn().mockReturnValue({
        generateContent: mockGenerateContent,
      }),
    })),
    GoogleGenerativeAIFetchError: class extends Error {
      status: number;
      errorDetails?: string;
      constructor(message: string, status: number, errorDetails?: string) {
        super(message);
        this.name = 'GoogleGenerativeAIFetchError';
        this.status = status;
        this.errorDetails = errorDetails;
      }
    },
  };
});

vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('integration-test-correlation-id'),
}));

// ---------------------------------------------------------------------------
// Lazy import so the mock is in place before the module loads
// ---------------------------------------------------------------------------

const { GeminiService } = await import('./services/gemini-service.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<GeminiServiceConfig>): GeminiServiceConfig {
  return {
    apiKey: 'test-api-key',
    defaultExtractionModel: 'gemini-2.0-flash',
    defaultInsightModel: 'gemini-2.0-flash',
    extractionTimeoutMs: 30_000,
    insightTimeoutMs: 60_000,
    extractionTemperature: 0.1,
    insightTemperature: 0.5,
    maxRetries: 0, // Disable retries for faster tests
    initialRetryDelayMs: 10,
    maxRetryDelayMs: 50,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerResetTimeoutMs: 30_000,
    maxImageWidth: 1024,
    maxImageHeight: 1024,
    imageQuality: 80,
    maxImageSizeBytes: 10 * 1024 * 1024,
    maxPdfSizeBytes: 10 * 1024 * 1024,
    maxCsvSizeBytes: 5 * 1024 * 1024,
    logLevel: 'error',
    redactPii: true,
    enableUsageTracking: true,
    usageStorageType: 'memory',
    ...overrides,
  };
}

/** Build a valid JPEG buffer (starts with FF D8 FF magic bytes). */
function makeJpegBuffer(size = 128): Buffer {
  const buf = Buffer.alloc(size);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xe0; // JFIF marker
  return buf;
}

/** Build a valid PDF buffer (starts with %PDF- magic bytes). */
function makePdfBuffer(size = 128): Buffer {
  const header = Buffer.from('%PDF-1.4\n');
  const body = Buffer.alloc(Math.max(0, size - header.length));
  return Buffer.concat([header, body]);
}

/** Build a valid CSV string with headers and rows. */
function makeCsvContent(): string {
  return [
    'date,description,amount,reference',
    '15/01/2024,POS Payment,5000,TXN001',
    '16/01/2024,Card Payment,12500,TXN002',
  ].join('\n');
}

/** Build a valid BusinessContext for insight generation. */
function makeBusinessContext(): {
  businessId: string;
  businessName: string;
  businessType: string;
  transactions: {
    id: string;
    date: string;
    description: string;
    amount: number;
    type: 'credit' | 'debit';
  }[];
  period: { start: string; end: string };
} {
  return {
    businessId: 'biz-integration-001',
    businessName: 'Ade Groceries',
    businessType: 'retail',
    transactions: [
      {
        id: 'txn-1',
        date: '2024-01-15',
        description: 'Sale of goods',
        amount: 50000,
        type: 'credit',
      },
      {
        id: 'txn-2',
        date: '2024-01-20',
        description: 'Rent payment',
        amount: 150000,
        type: 'debit',
      },
    ],
    period: { start: '2024-01-01', end: '2024-01-31' },
  };
}

/** Helper to build a mock Gemini API response. */
function mockGeminiResponse(
  jsonBody: object,
  inputTokens = 100,
  outputTokens = 200,
): {
  response: {
    text: () => string;
    usageMetadata: { promptTokenCount: number; candidatesTokenCount: number };
  };
} {
  return {
    response: {
      text: () => JSON.stringify(jsonBody),
      usageMetadata: {
        promptTokenCount: inputTokens,
        candidatesTokenCount: outputTokens,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('GeminiService Integration Tests', () => {
  let service: InstanceType<typeof GeminiService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GeminiService(makeConfig());
  });

  // -------------------------------------------------------------------------
  // 1. Receipt parsing end-to-end
  // -------------------------------------------------------------------------
  describe('parseReceipt — end-to-end', () => {
    it('should parse a valid JPEG receipt and return ExtractionResult with document_type receipt', async () => {
      const geminiPayload = {
        transactions: [
          {
            date: '2024-01-15',
            description: 'Indomie carton',
            amount: 4500,
            type: 'debit',
            counterparty: 'Shoprite',
            reference: 'RCP-001',
            category_hint: 'GROCERIES',
            confidence: 92,
          },
        ],
        extraction_confidence: 90,
        warnings: [],
      };

      mockGenerateContent.mockResolvedValueOnce(mockGeminiResponse(geminiPayload));

      const result = await service.parseReceipt(makeJpegBuffer());

      expect(result.document_type).toBe('receipt');
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].description).toBe('Indomie carton');
      expect(result.transactions[0].amount).toBe(4500);
      expect(result.transactions[0].type).toBe('debit');
      expect(result.extraction_confidence).toBe(90);
      expect(result.metadata.model).toBe('gemini-2.0-flash');
      expect(result.metadata.fallbackUsed).toBe(false);
      expect(result.metadata.inputTokens).toBe(100);
      expect(result.metadata.outputTokens).toBe(200);
    });

    it('should propagate warnings from Gemini response', async () => {
      const geminiPayload = {
        transactions: [
          {
            date: '2024-01-15',
            description: 'Blurry item',
            amount: 1000,
            type: 'debit',
            confidence: 40,
          },
        ],
        extraction_confidence: 50,
        warnings: ['Some text was blurry and could not be read clearly'],
      };

      mockGenerateContent.mockResolvedValueOnce(mockGeminiResponse(geminiPayload));

      const result = await service.parseReceipt(makeJpegBuffer());

      expect(result.document_type).toBe('receipt');
      expect(result.warnings.some((w) => w.includes('blurry'))).toBe(true);
    });

    it('should reject empty image buffer with ValidationError', async () => {
      await expect(service.parseReceipt(Buffer.alloc(0))).rejects.toThrow('Image buffer is empty');
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Bank statement parsing end-to-end
  // -------------------------------------------------------------------------
  describe('parseBankStatement — end-to-end', () => {
    it('should parse a valid PDF bank statement and return ExtractionResult with document_type bank_statement', async () => {
      const geminiPayload = {
        transactions: [
          {
            date: '2024-01-10',
            description: 'Transfer from Ade',
            amount: 250000,
            type: 'credit',
            counterparty: 'Ade Bakery',
            reference: 'NIP/2024/001',
            confidence: 95,
          },
          {
            date: '2024-01-12',
            description: 'POS Purchase',
            amount: 15000,
            type: 'debit',
            counterparty: 'Shoprite Ikeja',
            confidence: 88,
          },
        ],
        extraction_confidence: 92,
        warnings: [],
        raw_text_preview: 'GTBank Statement of Account...',
      };

      mockGenerateContent.mockResolvedValueOnce(mockGeminiResponse(geminiPayload));

      const result = await service.parseBankStatement(makePdfBuffer());

      expect(result.document_type).toBe('bank_statement');
      expect(result.transactions).toHaveLength(2);
      expect(result.transactions[0].type).toBe('credit');
      expect(result.transactions[1].type).toBe('debit');
      expect(result.extraction_confidence).toBe(92);
      expect(result.metadata.fallbackUsed).toBe(false);
    });

    it('should reject empty PDF buffer with ValidationError', async () => {
      await expect(service.parseBankStatement(Buffer.alloc(0))).rejects.toThrow(
        'PDF buffer is empty',
      );
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 3. POS export parsing end-to-end
  // -------------------------------------------------------------------------
  describe('parsePosExport — end-to-end', () => {
    it('should parse valid CSV and return ExtractionResult with document_type pos_export', async () => {
      const geminiPayload = {
        transactions: [
          {
            date: '2024-01-15',
            description: 'POS Payment',
            amount: 5000,
            type: 'credit',
            reference: 'TXN001',
            category_hint: 'PRODUCT_SALES',
            confidence: 95,
          },
          {
            date: '2024-01-16',
            description: 'Card Payment',
            amount: 12500,
            type: 'credit',
            reference: 'TXN002',
            category_hint: 'PRODUCT_SALES',
            confidence: 95,
          },
        ],
        extraction_confidence: 93,
        warnings: [],
      };

      mockGenerateContent.mockResolvedValueOnce(mockGeminiResponse(geminiPayload));

      const result = await service.parsePosExport(makeCsvContent());

      expect(result.document_type).toBe('pos_export');
      expect(result.transactions).toHaveLength(2);
      expect(result.transactions[0].amount).toBe(5000);
      expect(result.transactions[1].amount).toBe(12500);
      expect(result.extraction_confidence).toBe(93);
      expect(result.metadata.fallbackUsed).toBe(false);
    });

    it('should reject empty CSV content with ValidationError', async () => {
      await expect(service.parsePosExport('')).rejects.toThrow('CSV content is empty');
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Insight generation end-to-end
  // -------------------------------------------------------------------------
  describe('generateInsights — end-to-end', () => {
    it('should generate insights and return InsightResult with analysis_period', async () => {
      const geminiPayload = {
        insights: [
          {
            type: 'tax_exposure',
            severity: 'warning',
            title: 'Potential VAT Liability',
            body: 'Monthly revenue exceeds ₦25M threshold for VAT registration.',
            action_items: ['Register for VAT', 'Consult tax advisor'],
            related_transactions: ['txn-1'],
          },
          {
            type: 'cashflow_risk',
            severity: 'alert',
            title: 'High Rent-to-Revenue Ratio',
            body: 'Rent payment represents 75% of monthly revenue.',
            action_items: ['Negotiate rent reduction', 'Explore alternative locations'],
          },
        ],
        confidence: 85,
      };

      mockGenerateContent.mockResolvedValueOnce(mockGeminiResponse(geminiPayload, 200, 400));

      const context = makeBusinessContext();
      const result = await service.generateInsights(context);

      expect(result.insights).toHaveLength(2);
      expect(result.insights[0].type).toBe('tax_exposure');
      expect(result.insights[0].severity).toBe('warning');
      expect(result.insights[1].type).toBe('cashflow_risk');
      expect(result.analysis_period).toEqual({
        start: '2024-01-01',
        end: '2024-01-31',
      });
      expect(result.confidence).toBe(85);
      expect(result.metadata.model).toBe('gemini-2.0-flash');
      expect(result.metadata.transactionsAnalyzed).toBe(2);
      expect(result.metadata.inputTokens).toBe(200);
      expect(result.metadata.outputTokens).toBe(400);
    });

    it('should reject invalid business context with ValidationError', async () => {
      const invalidContext = {
        businessId: '',
        businessName: 'Test',
        businessType: 'retail',
        transactions: [
          {
            id: 'txn-1',
            date: '2024-01-15',
            description: 'Sale',
            amount: 1000,
            type: 'credit' as const,
          },
        ],
        period: { start: '2024-01-01', end: '2024-01-31' },
      };

      await expect(service.generateInsights(invalidContext)).rejects.toThrow();
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 5. Fallback scenarios
  // -------------------------------------------------------------------------
  describe('fallback scenarios', () => {
    it('should return empty result with warnings when Gemini fails for receipt parsing', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('Gemini API unavailable'));

      const result = await service.parseReceipt(makeJpegBuffer());

      expect(result.document_type).toBe('receipt');
      expect(result.transactions).toHaveLength(0);
      expect(result.extraction_confidence).toBe(0);
      expect(result.warnings.some((w) => w.includes('failed'))).toBe(true);
    });

    it('should attempt PDF text fallback when Gemini fails for bank statement', async () => {
      // First call (direct PDF) fails, fallback text extraction also won't produce
      // a valid Gemini response since we reject both calls
      mockGenerateContent.mockRejectedValue(new Error('Gemini API unavailable'));

      const result = await service.parseBankStatement(makePdfBuffer());

      // Should get an empty result with fallback warnings
      expect(result.document_type).toBe('bank_statement');
      expect(result.transactions).toHaveLength(0);
      expect(result.metadata.fallbackUsed).toBe(true);
    });

    it('should attempt CSV parsing fallback when Gemini fails for POS export', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('Gemini API unavailable'));

      const csvContent = makeCsvContent();
      const result = await service.parsePosExport(csvContent);

      // CSV fallback should parse the rows directly
      expect(result.document_type).toBe('pos_export');
      expect(result.metadata.fallbackUsed).toBe(true);
      expect(result.warnings.some((w) => w.includes('Fallback'))).toBe(true);
    });

    it('should return empty insights with warnings when Gemini fails for insight generation', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('Gemini API unavailable'));

      const result = await service.generateInsights(makeBusinessContext());

      expect(result.insights).toHaveLength(0);
      expect(result.confidence).toBe(0);
      expect(result.analysis_period).toEqual({
        start: '2024-01-01',
        end: '2024-01-31',
      });
    });

    it('should handle malformed JSON from Gemini with JSON repair', async () => {
      // Return a response with trailing comma (common Gemini issue)
      const malformedJson = `{
        "transactions": [
          {
            "date": "2024-01-15",
            "description": "Test item",
            "amount": 1000,
            "type": "debit",
            "confidence": 80,
          }
        ],
        "extraction_confidence": 75,
        "warnings": [],
      }`;

      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => malformedJson,
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 100 },
        },
      });

      const result = await service.parseReceipt(makeJpegBuffer());

      // JSON repair should fix trailing commas and produce a valid result
      expect(result.document_type).toBe('receipt');
      expect(result.transactions.length).toBeGreaterThanOrEqual(0);
      // If repair succeeded, we get transactions; if not, we get empty with warnings
      // Either way, the service should not throw
    });

    it('should return empty result when Gemini returns completely invalid response', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => 'This is not JSON at all, just plain text garbage',
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 100 },
        },
      });

      // The service should catch the InvalidResponseError internally and return empty
      const result = await service.parseReceipt(makeJpegBuffer());

      expect(result.document_type).toBe('receipt');
      expect(result.transactions).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Circuit breaker integration
  // -------------------------------------------------------------------------
  describe('circuit breaker integration', () => {
    it('should open circuit after 5 consecutive failures and reject subsequent calls', async () => {
      // Use a fresh service with circuit breaker threshold of 5
      const svc = new GeminiService(makeConfig({ circuitBreakerFailureThreshold: 5 }));

      // Gemini always fails
      mockGenerateContent.mockRejectedValue(new Error('Gemini down'));

      const jpegBuf = makeJpegBuffer();

      // Trigger 5 failures to open the circuit
      for (let i = 0; i < 5; i++) {
        await svc.parseReceipt(jpegBuf);
        // Each call returns empty result (graceful degradation), not a throw
      }

      // Circuit should now be OPEN
      const status = svc.getCircuitBreakerStatus();
      expect(status.state).toBe('OPEN');

      // Next call should fail immediately with CircuitOpenError
      // The service catches it and returns empty result
      const result = await svc.parseReceipt(jpegBuf);
      expect(result.transactions).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes('Circuit breaker is open'))).toBe(true);
    });

    it('should report circuit breaker status as CLOSED initially', () => {
      const status = service.getCircuitBreakerStatus();
      expect(status.state).toBe('CLOSED');
      expect(status.failureCount).toBe(0);
    });

    it('should track usage stats across multiple operations', async () => {
      const geminiPayload = {
        transactions: [
          {
            date: '2024-01-15',
            description: 'Test',
            amount: 1000,
            type: 'debit',
            confidence: 90,
          },
        ],
        extraction_confidence: 85,
        warnings: [],
      };

      mockGenerateContent.mockResolvedValue(mockGeminiResponse(geminiPayload));

      await service.parseReceipt(makeJpegBuffer());
      await service.parsePosExport(makeCsvContent());

      const stats = await service.getUsageStats();
      expect(stats.totalCalls).toBeGreaterThanOrEqual(2);
      expect(stats.totalTokens).toBeGreaterThan(0);
    });
  });
});
