// Gemini Integration - ExtractionService unit tests
// Tests: extractFromReceipt, extractFromBankStatement, extractFromPosExport

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GeminiLogger } from '../monitoring/index.js';
import type { UsageTrackerImpl } from '../monitoring/index.js';
import type { PromptManagerImpl, SystemPrompt } from '../prompts/index.js';
import { CircuitBreaker } from '../resilience/index.js';
import { GeminiServiceError, InvalidResponseError, ValidationError } from '../types/index.js';

import type { ExtractionServiceConfig, ExtractionServiceDeps } from './extraction-service.js';
import { ExtractionServiceImpl } from './extraction-service.js';
import type { GeminiClient, GeminiResponse } from './gemini-client.js';

// --- Helpers ---

const VALID_JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const VALID_PDF_HEADER = Buffer.from('%PDF-1.4 test content here for size');

function makeJpegBuffer(size = 100): Buffer {
  const buf = Buffer.alloc(size);
  VALID_JPEG_HEADER.copy(buf);
  return buf;
}

function makePdfBuffer(size = 100): Buffer {
  const buf = Buffer.alloc(size);
  VALID_PDF_HEADER.copy(buf);
  return buf;
}

function makeValidCsv(): string {
  return 'date,description,amount,type\n2024-01-15,POS Payment,5000,credit\n2024-01-16,POS Payment,3000,credit';
}

function makeGeminiExtractionResponse(
  documentType: string = 'receipt',
  transactions: object[] = [],
): string {
  return JSON.stringify({
    transactions:
      transactions.length > 0
        ? transactions
        : [
            {
              date: '2024-01-15',
              description: 'Purchase at Shoprite',
              amount: 5000,
              type: 'debit',
              confidence: 85,
            },
          ],
    document_type: documentType,
    extraction_confidence: 90,
    warnings: [],
  });
}

function makePrompt(type: string = 'receipt_extraction'): SystemPrompt {
  return {
    type: type as SystemPrompt['type'],
    version: '1.0.0',
    systemInstruction: 'Extract transactions from the document.',
    exampleOutputs: ['{}'],
    jsonSchema: {},
  };
}

function makeGeminiResponse(text: string, inputTokens = 100, outputTokens = 200): GeminiResponse {
  return { text, inputTokens, outputTokens };
}

// --- Mock factories ---

function createMockClient(response?: GeminiResponse): GeminiClient {
  return {
    generate: vi
      .fn()
      .mockResolvedValue(response ?? makeGeminiResponse(makeGeminiExtractionResponse())),
  } as unknown as GeminiClient;
}

function createMockPromptManager(): PromptManagerImpl {
  return {
    getPrompt: vi.fn().mockImplementation((type: string) => makePrompt(type)),
    getActiveVersion: vi.fn().mockReturnValue('1.0.0'),
    listVersions: vi.fn().mockReturnValue([]),
    setActiveVersion: vi.fn(),
    registerPrompt: vi.fn(),
  } as unknown as PromptManagerImpl;
}

function createMockUsageTracker(): UsageTrackerImpl {
  return {
    recordUsage: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockResolvedValue({}),
    getStatsByOperation: vi.fn().mockResolvedValue({}),
  } as unknown as UsageTrackerImpl;
}

function createMockLogger(): GeminiLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    getEntries: vi.fn().mockReturnValue([]),
    clear: vi.fn(),
  } as unknown as GeminiLogger;
}

const defaultConfig: ExtractionServiceConfig = {
  extractionTimeoutMs: 30_000,
  extractionTemperature: 0.1,
  defaultModel: 'gemini-2.0-flash',
  maxOutputTokens: 4096,
};

function createDeps(overrides?: Partial<ExtractionServiceDeps>): ExtractionServiceDeps {
  return {
    client: createMockClient(),
    promptManager: createMockPromptManager(),
    retryHandler: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
    circuitBreaker: new CircuitBreaker(),
    usageTracker: createMockUsageTracker(),
    logger: createMockLogger(),
    config: defaultConfig,
    ...overrides,
  };
}

// Mock sharp (image preprocessing)
vi.mock('sharp', () => {
  const mockSharp = vi.fn().mockReturnValue({
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])),
    metadata: vi.fn().mockResolvedValue({ width: 800, height: 600, format: 'jpeg' }),
  });
  return { default: mockSharp };
});

// Mock pdf-parse
vi.mock('pdf-parse', () => ({
  default: vi.fn().mockResolvedValue({
    text: 'Date: 15/01/2024\nDescription: Transfer\nAmount: 5000\nType: credit',
    numpages: 1,
    info: {},
  }),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('test-correlation-id'),
}));

// --- Tests ---

describe('ExtractionServiceImpl', () => {
  let deps: ExtractionServiceDeps;
  let service: ExtractionServiceImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createDeps();
    service = new ExtractionServiceImpl(deps);
  });

  describe('extractFromReceipt', () => {
    it('should extract transactions from a valid receipt image', async () => {
      const result = await service.extractFromReceipt(makeJpegBuffer());

      expect(result.document_type).toBe('receipt');
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]?.description).toBe('Purchase at Shoprite');
      expect(result.metadata.model).toBe('gemini-2.0-flash');
      expect(result.metadata.fallbackUsed).toBe(false);
    });

    it('should throw ValidationError for empty buffer', async () => {
      await expect(service.extractFromReceipt(Buffer.alloc(0))).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid image format', async () => {
      const invalidBuffer = Buffer.from('not an image');
      await expect(service.extractFromReceipt(invalidBuffer)).rejects.toThrow(ValidationError);
    });

    it('should use receipt extraction prompt', async () => {
      await service.extractFromReceipt(makeJpegBuffer());

      expect(deps.promptManager.getPrompt).toHaveBeenCalledWith('receipt_extraction');
    });

    it('should set document_type to receipt', async () => {
      const result = await service.extractFromReceipt(makeJpegBuffer());

      expect(result.document_type).toBe('receipt');
    });

    it('should use default temperature 0.1', async () => {
      await service.extractFromReceipt(makeJpegBuffer());

      const retryFn = deps.retryHandler as ReturnType<typeof vi.fn>;
      expect(retryFn).toHaveBeenCalled();
    });

    it('should allow overriding model via options', async () => {
      const clientMock = deps.client as { generate: ReturnType<typeof vi.fn> };
      await service.extractFromReceipt(makeJpegBuffer(), { model: 'gemini-2.0-pro' });

      expect(clientMock.generate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-2.0-pro' }),
      );
    });

    it('should skip preprocessing when skipPreprocessing is true', async () => {
      const clientMock = deps.client as { generate: ReturnType<typeof vi.fn> };
      const buf = makeJpegBuffer();
      await service.extractFromReceipt(buf, { skipPreprocessing: true });

      // The inline data should be the original buffer's base64
      const callArgs = clientMock.generate.mock.calls[0]?.[0];
      const parts = callArgs?.contents?.[0]?.parts;
      const inlineData = parts?.find((p: Record<string, unknown>) => 'inlineData' in p)?.inlineData;
      expect(inlineData?.data).toBe(buf.toString('base64'));
    });

    it('should record usage on success', async () => {
      await service.extractFromReceipt(makeJpegBuffer());

      const tracker = deps.usageTracker as { recordUsage: ReturnType<typeof vi.fn> };
      expect(tracker.recordUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          operationType: 'receipt_extraction',
          success: true,
        }),
      );
    });

    it('should return empty result with warnings when Gemini fails', async () => {
      const failingClient = createMockClient();
      (failingClient.generate as ReturnType<typeof vi.fn>).mockRejectedValue(
        new GeminiServiceError('API error', 'SERVER_ERROR', true),
      );
      // Make retry handler propagate the error
      const failDeps = createDeps({
        client: failingClient,
        retryHandler: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
      });
      const failService = new ExtractionServiceImpl(failDeps);

      const result = await failService.extractFromReceipt(makeJpegBuffer());

      expect(result.document_type).toBe('receipt');
      expect(result.transactions).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should include input validation warnings in result', async () => {
      // PNG images produce a warning about token usage
      const pngBuffer = Buffer.alloc(100);
      Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(pngBuffer);

      const result = await service.extractFromReceipt(pngBuffer);

      expect(result.warnings.some((w) => w.includes('PNG'))).toBe(true);
    });

    it('should handle JSON repair when response is malformed', async () => {
      const malformedResponse = makeGeminiResponse(
        '```json\n' + makeGeminiExtractionResponse() + '\n```',
      );
      const clientWithMalformed = createMockClient(malformedResponse);
      const malformedDeps = createDeps({ client: clientWithMalformed });
      const malformedService = new ExtractionServiceImpl(malformedDeps);

      const result = await malformedService.extractFromReceipt(makeJpegBuffer());

      expect(result.transactions).toHaveLength(1);
      expect(result.warnings.some((w) => w.includes('repair'))).toBe(true);
    });
  });

  describe('extractFromBankStatement', () => {
    it('should extract transactions from a valid PDF', async () => {
      const bankResponse = makeGeminiResponse(makeGeminiExtractionResponse('bank_statement'));
      const bankDeps = createDeps({ client: createMockClient(bankResponse) });
      const bankService = new ExtractionServiceImpl(bankDeps);

      const result = await bankService.extractFromBankStatement(makePdfBuffer());

      expect(result.document_type).toBe('bank_statement');
      expect(result.transactions).toHaveLength(1);
      expect(result.metadata.fallbackUsed).toBe(false);
    });

    it('should throw ValidationError for empty buffer', async () => {
      await expect(service.extractFromBankStatement(Buffer.alloc(0))).rejects.toThrow(
        ValidationError,
      );
    });

    it('should throw ValidationError for invalid PDF format', async () => {
      const invalidBuffer = Buffer.from('not a pdf');
      await expect(service.extractFromBankStatement(invalidBuffer)).rejects.toThrow(
        ValidationError,
      );
    });

    it('should use bank_statement_extraction prompt', async () => {
      const bankResponse = makeGeminiResponse(makeGeminiExtractionResponse('bank_statement'));
      const bankDeps = createDeps({ client: createMockClient(bankResponse) });
      const bankService = new ExtractionServiceImpl(bankDeps);

      await bankService.extractFromBankStatement(makePdfBuffer());

      expect(bankDeps.promptManager.getPrompt).toHaveBeenCalledWith('bank_statement_extraction');
    });

    it('should set document_type to bank_statement', async () => {
      const bankResponse = makeGeminiResponse(makeGeminiExtractionResponse('bank_statement'));
      const bankDeps = createDeps({ client: createMockClient(bankResponse) });
      const bankService = new ExtractionServiceImpl(bankDeps);

      const result = await bankService.extractFromBankStatement(makePdfBuffer());

      expect(result.document_type).toBe('bank_statement');
    });

    it('should attempt PDF text fallback when Gemini fails', async () => {
      const failingClient = createMockClient();
      (failingClient.generate as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new GeminiServiceError('API error', 'SERVER_ERROR', true))
        .mockResolvedValueOnce(makeGeminiResponse(makeGeminiExtractionResponse('bank_statement')));

      const fallbackDeps = createDeps({
        client: failingClient,
        retryHandler: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
      });
      const fallbackService = new ExtractionServiceImpl(fallbackDeps);

      const result = await fallbackService.extractFromBankStatement(makePdfBuffer());

      expect(result.document_type).toBe('bank_statement');
      expect(result.metadata.fallbackUsed).toBe(true);
      expect(result.warnings.some((w) => w.includes('Fallback'))).toBe(true);
    });

    it('should return empty result when both Gemini and fallback fail', async () => {
      const failingClient = createMockClient();
      (failingClient.generate as ReturnType<typeof vi.fn>).mockRejectedValue(
        new GeminiServiceError('API error', 'SERVER_ERROR', true),
      );

      const failDeps = createDeps({
        client: failingClient,
        retryHandler: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
      });
      const failService = new ExtractionServiceImpl(failDeps);

      const result = await failService.extractFromBankStatement(makePdfBuffer());

      expect(result.document_type).toBe('bank_statement');
      expect(result.transactions).toHaveLength(0);
      expect(result.metadata.fallbackUsed).toBe(true);
    });

    it('should record usage on success', async () => {
      const bankResponse = makeGeminiResponse(makeGeminiExtractionResponse('bank_statement'));
      const bankDeps = createDeps({ client: createMockClient(bankResponse) });
      const bankService = new ExtractionServiceImpl(bankDeps);

      await bankService.extractFromBankStatement(makePdfBuffer());

      const tracker = bankDeps.usageTracker as { recordUsage: ReturnType<typeof vi.fn> };
      expect(tracker.recordUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          operationType: 'bank_statement_extraction',
          success: true,
        }),
      );
    });
  });

  describe('extractFromPosExport', () => {
    it('should extract transactions from valid CSV', async () => {
      const posResponse = makeGeminiResponse(
        makeGeminiExtractionResponse('pos_export', [
          {
            date: '2024-01-15',
            description: 'POS Payment',
            amount: 5000,
            type: 'credit',
            confidence: 95,
          },
        ]),
      );
      const posDeps = createDeps({ client: createMockClient(posResponse) });
      const posService = new ExtractionServiceImpl(posDeps);

      const result = await posService.extractFromPosExport(makeValidCsv());

      expect(result.document_type).toBe('pos_export');
      expect(result.transactions).toHaveLength(1);
      expect(result.metadata.fallbackUsed).toBe(false);
    });

    it('should throw ValidationError for empty CSV', async () => {
      await expect(service.extractFromPosExport('')).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for CSV with only header', async () => {
      await expect(service.extractFromPosExport('date,amount')).rejects.toThrow(ValidationError);
    });

    it('should use pos_export_extraction prompt', async () => {
      const posResponse = makeGeminiResponse(makeGeminiExtractionResponse('pos_export'));
      const posDeps = createDeps({ client: createMockClient(posResponse) });
      const posService = new ExtractionServiceImpl(posDeps);

      await posService.extractFromPosExport(makeValidCsv());

      expect(posDeps.promptManager.getPrompt).toHaveBeenCalledWith('pos_export_extraction');
    });

    it('should set document_type to pos_export', async () => {
      const posResponse = makeGeminiResponse(makeGeminiExtractionResponse('pos_export'));
      const posDeps = createDeps({ client: createMockClient(posResponse) });
      const posService = new ExtractionServiceImpl(posDeps);

      const result = await posService.extractFromPosExport(makeValidCsv());

      expect(result.document_type).toBe('pos_export');
    });

    it('should attempt CSV parsing fallback when Gemini fails', async () => {
      const failingClient = createMockClient();
      (failingClient.generate as ReturnType<typeof vi.fn>).mockRejectedValue(
        new GeminiServiceError('API error', 'SERVER_ERROR', true),
      );

      const fallbackDeps = createDeps({
        client: failingClient,
        retryHandler: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
      });
      const fallbackService = new ExtractionServiceImpl(fallbackDeps);

      const result = await fallbackService.extractFromPosExport(makeValidCsv());

      expect(result.document_type).toBe('pos_export');
      expect(result.metadata.fallbackUsed).toBe(true);
      expect(result.warnings.some((w) => w.includes('Fallback'))).toBe(true);
      expect(result.transactions.length).toBeGreaterThan(0);
    });

    it('should map CSV rows to transactions in fallback', async () => {
      const failingClient = createMockClient();
      (failingClient.generate as ReturnType<typeof vi.fn>).mockRejectedValue(
        new GeminiServiceError('API error', 'SERVER_ERROR', true),
      );

      const fallbackDeps = createDeps({
        client: failingClient,
        retryHandler: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
      });
      const fallbackService = new ExtractionServiceImpl(fallbackDeps);

      const result = await fallbackService.extractFromPosExport(makeValidCsv());

      expect(result.transactions[0]?.type).toBe('credit');
      expect(result.transactions[0]?.category_hint).toBe('PRODUCT_SALES');
      expect(result.extraction_confidence).toBe(50);
    });

    it('should record usage on success', async () => {
      const posResponse = makeGeminiResponse(makeGeminiExtractionResponse('pos_export'));
      const posDeps = createDeps({ client: createMockClient(posResponse) });
      const posService = new ExtractionServiceImpl(posDeps);

      await posService.extractFromPosExport(makeValidCsv());

      const tracker = posDeps.usageTracker as { recordUsage: ReturnType<typeof vi.fn> };
      expect(tracker.recordUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          operationType: 'pos_export_extraction',
          success: true,
        }),
      );
    });
  });

  describe('resilience integration', () => {
    it('should use retry handler for API calls', async () => {
      const retryFn = vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn());
      const retryDeps = createDeps({ retryHandler: retryFn });
      const retryService = new ExtractionServiceImpl(retryDeps);

      await retryService.extractFromReceipt(makeJpegBuffer());

      expect(retryFn).toHaveBeenCalled();
    });

    it('should check circuit breaker before API call', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      cb.recordFailure(new Error('fail'));
      // Circuit is now open

      const cbDeps = createDeps({
        circuitBreaker: cb,
        retryHandler: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
      });
      const cbService = new ExtractionServiceImpl(cbDeps);

      const result = await cbService.extractFromReceipt(makeJpegBuffer());

      // Should return empty result since circuit is open
      expect(result.transactions).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes('failed') || w.includes('Circuit'))).toBe(true);
    });

    it('should record circuit breaker success on successful API call', async () => {
      const cb = new CircuitBreaker();
      const spy = vi.spyOn(cb, 'recordSuccess');

      const cbDeps = createDeps({
        circuitBreaker: cb,
        retryHandler: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
      });
      const cbService = new ExtractionServiceImpl(cbDeps);

      await cbService.extractFromReceipt(makeJpegBuffer());

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('should log start of extraction', async () => {
      await service.extractFromReceipt(makeJpegBuffer());

      const logger = deps.logger as { info: ReturnType<typeof vi.fn> };
      expect(logger.info).toHaveBeenCalledWith(
        'Starting receipt extraction',
        expect.any(String),
        expect.any(Object),
      );
    });

    it('should log validation failures', async () => {
      try {
        await service.extractFromReceipt(Buffer.alloc(0));
      } catch {
        // expected
      }

      const logger = deps.logger as { warn: ReturnType<typeof vi.fn> };
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('validation failed'),
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  describe('usage tracking failure resilience', () => {
    it('should not throw when usage tracking fails', async () => {
      const failingTracker = createMockUsageTracker();
      (failingTracker.recordUsage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Storage error'),
      );

      const trackDeps = createDeps({ usageTracker: failingTracker });
      const trackService = new ExtractionServiceImpl(trackDeps);

      // Should not throw despite tracking failure
      const result = await trackService.extractFromReceipt(makeJpegBuffer());
      expect(result.document_type).toBe('receipt');
    });
  });
});
