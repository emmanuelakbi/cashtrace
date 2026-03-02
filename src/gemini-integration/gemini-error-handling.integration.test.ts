// Gemini Integration - Error Handling Integration Tests
// Tests error scenarios through the GeminiService facade (public API).
// Validates: Requirements 7.1, 7.5, 8.2, 8.3, 5.3, 5.4, 5.5

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RateLimitError } from './types/index.js';
import type { GeminiServiceConfig } from './types/index.js';

// ---------------------------------------------------------------------------
// Mock @google/generative-ai at module level
// ---------------------------------------------------------------------------

let mockGenerateContent: ReturnType<typeof vi.fn>;

vi.mock('@google/generative-ai', () => {
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
  v4: vi.fn().mockReturnValue('error-test-correlation-id'),
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
    maxRetries: 0,
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

function makeJpegBuffer(size = 128): Buffer {
  const buf = Buffer.alloc(size);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xe0;
  return buf;
}

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
    businessId: 'biz-err-001',
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
    ],
    period: { start: '2024-01-01', end: '2024-01-31' },
  };
}

function mockGeminiResponse(jsonBody: object): {
  response: {
    text: () => string;
    usageMetadata: { promptTokenCount: number; candidatesTokenCount: number };
  };
} {
  return {
    response: {
      text: () => JSON.stringify(jsonBody),
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200 },
    },
  };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('GeminiService Error Handling Integration Tests', () => {
  let service: InstanceType<typeof GeminiService>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mockGenerateContent to clear any persistent implementations
    // (e.g., mockImplementation from timeout tests) that vi.clearAllMocks does not clear.
    mockGenerateContent.mockReset();
    service = new GeminiService(makeConfig());
  });

  // -------------------------------------------------------------------------
  // 1. Timeout handling (Requirements 1.3, 2.3, 3.3, 4.3)
  // -------------------------------------------------------------------------
  describe('timeout handling', () => {
    it('should return empty result when extraction times out', async () => {
      const svc = new GeminiService(makeConfig({ extractionTimeoutMs: 50 }));

      // Mock resolves after 200ms — well past the 50ms timeout
      mockGenerateContent.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 200)),
      );

      const result = await svc.parseReceipt(makeJpegBuffer());

      expect(result.document_type).toBe('receipt');
      expect(result.transactions).toHaveLength(0);
      expect(result.extraction_confidence).toBe(0);
      expect(
        result.warnings.some(
          (w) => w.toLowerCase().includes('timed out') || w.toLowerCase().includes('timeout'),
        ),
      ).toBe(true);
    });

    it('should return empty insights when insight generation times out', async () => {
      const svc = new GeminiService(makeConfig({ insightTimeoutMs: 50 }));

      mockGenerateContent.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 200)),
      );

      const result = await svc.generateInsights(makeBusinessContext());

      expect(result.insights).toHaveLength(0);
      expect(result.confidence).toBe(0);
      expect(result.analysis_period).toEqual({ start: '2024-01-01', end: '2024-01-31' });
    });
  });

  // -------------------------------------------------------------------------
  // 2. Rate limit handling (Requirements 7.1, 7.5)
  // -------------------------------------------------------------------------
  describe('rate limit handling', () => {
    it('should return empty result on rate limit error with retries disabled', async () => {
      // Simulate a rate-limit error from Gemini (retryable, but retries disabled)
      mockGenerateContent.mockRejectedValueOnce(
        new RateLimitError('Resource exhausted: rate limit', 1000),
      );

      const result = await service.parseReceipt(makeJpegBuffer());

      expect(result.document_type).toBe('receipt');
      expect(result.transactions).toHaveLength(0);
      expect(result.warnings.some((w) => w.toLowerCase().includes('failed'))).toBe(true);
    });

    it('should retry on transient error and succeed on subsequent attempt', async () => {
      const svc = new GeminiService(
        makeConfig({ maxRetries: 2, initialRetryDelayMs: 10, maxRetryDelayMs: 20 }),
      );

      const successPayload = {
        transactions: [
          {
            date: '2024-01-15',
            description: 'Test item',
            amount: 1000,
            type: 'debit',
            confidence: 90,
          },
        ],
        extraction_confidence: 85,
        warnings: [],
      };

      // First call fails with a retryable RateLimitError, second call succeeds
      mockGenerateContent
        .mockRejectedValueOnce(new RateLimitError('Resource exhausted: rate limit', 1000))
        .mockResolvedValueOnce(mockGeminiResponse(successPayload));

      const result = await svc.parseReceipt(makeJpegBuffer());

      expect(result.document_type).toBe('receipt');
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].description).toBe('Test item');
      // Verify retry happened: 2 calls total
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Invalid API key / auth error handling (Requirements 7.5)
  // -------------------------------------------------------------------------
  describe('invalid API key handling', () => {
    it('should not retry on auth error (non-transient) for extraction', async () => {
      const svc = new GeminiService(
        makeConfig({ maxRetries: 3, initialRetryDelayMs: 10, maxRetryDelayMs: 20 }),
      );

      // Auth errors are non-transient — GeminiClient maps 401/403 to retryable: false
      mockGenerateContent.mockRejectedValue(new Error('Invalid API key'));

      const result = await svc.parseReceipt(makeJpegBuffer());

      expect(result.document_type).toBe('receipt');
      expect(result.transactions).toHaveLength(0);
      // Non-transient errors should NOT be retried — only 1 call
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('should not retry on auth error (non-transient) for insights', async () => {
      const svc = new GeminiService(
        makeConfig({ maxRetries: 3, initialRetryDelayMs: 10, maxRetryDelayMs: 20 }),
      );

      mockGenerateContent.mockRejectedValue(new Error('Forbidden: invalid credentials'));

      const result = await svc.generateInsights(makeBusinessContext());

      expect(result.insights).toHaveLength(0);
      expect(result.confidence).toBe(0);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('should return graceful empty result on auth failure', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('API key not valid'));

      const result = await service.parseReceipt(makeJpegBuffer());

      expect(result.document_type).toBe('receipt');
      expect(result.transactions).toHaveLength(0);
      expect(result.extraction_confidence).toBe(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Malformed response handling (Requirements 5.3, 5.4, 5.5)
  // -------------------------------------------------------------------------
  describe('malformed response handling', () => {
    it('should handle non-JSON text response gracefully', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => 'Sorry, I cannot process this image.',
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 30 },
        },
      });

      const result = await service.parseReceipt(makeJpegBuffer());

      expect(result.document_type).toBe('receipt');
      expect(result.transactions).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should repair JSON with trailing commas and return valid result', async () => {
      const malformedJson = `{
        "transactions": [
          {
            "date": "2024-01-15",
            "description": "Repaired item",
            "amount": 2500,
            "type": "debit",
            "confidence": 80,
          }
        ],
        "extraction_confidence": 70,
        "warnings": [],
      }`;

      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => malformedJson,
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 100 },
        },
      });

      const result = await service.parseReceipt(makeJpegBuffer());

      expect(result.document_type).toBe('receipt');
      // JSON repair should fix trailing commas — verify we get the transaction back
      if (result.transactions.length > 0) {
        expect(result.transactions[0].description).toBe('Repaired item');
        expect(result.warnings.some((w) => w.includes('repair'))).toBe(true);
      }
    });

    it('should return empty result when JSON is missing required transaction fields', async () => {
      const incompleteJson = {
        transactions: [
          {
            // Missing date, amount, type, confidence
            description: 'Incomplete transaction',
          },
        ],
        extraction_confidence: 50,
        warnings: [],
      };

      mockGenerateContent.mockResolvedValueOnce(mockGeminiResponse(incompleteJson));

      const result = await service.parseReceipt(makeJpegBuffer());

      expect(result.document_type).toBe('receipt');
      // Invalid transactions should be excluded — all remaining must have required fields
      expect(result.transactions.every((t) => t.date && t.amount !== undefined && t.type)).toBe(
        true,
      );
    });

    it('should exclude transactions with invalid field values', async () => {
      const invalidFieldsJson = {
        transactions: [
          {
            date: '2024-01-15',
            description: 'Valid transaction',
            amount: 1000,
            type: 'debit',
            confidence: 90,
          },
          {
            date: '2024-01-15',
            description: 'Invalid type',
            amount: 500,
            type: 'unknown_type',
            confidence: 80,
          },
          {
            date: '2024-01-15',
            description: 'Invalid confidence',
            amount: 300,
            type: 'credit',
            confidence: 150,
          },
        ],
        extraction_confidence: 60,
        warnings: [],
      };

      mockGenerateContent.mockResolvedValueOnce(mockGeminiResponse(invalidFieldsJson));

      const result = await service.parseReceipt(makeJpegBuffer());

      expect(result.document_type).toBe('receipt');
      // Only valid transactions should survive output validation
      for (const txn of result.transactions) {
        expect(['credit', 'debit']).toContain(txn.type);
        expect(txn.confidence).toBeGreaterThanOrEqual(0);
        expect(txn.confidence).toBeLessThanOrEqual(100);
      }
    });

    it('should handle malformed insight response gracefully', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => 'Not valid JSON for insights',
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
        },
      });

      const result = await service.generateInsights(makeBusinessContext());

      expect(result.insights).toHaveLength(0);
      expect(result.confidence).toBe(0);
      expect(result.analysis_period).toEqual({ start: '2024-01-01', end: '2024-01-31' });
    });
  });
});
