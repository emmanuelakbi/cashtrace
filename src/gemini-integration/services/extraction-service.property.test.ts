// Gemini Integration - ExtractionService property-based tests
// Uses fast-check to verify universal correctness properties across random inputs

import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GeminiLogger } from '../monitoring/index.js';
import type { UsageTrackerImpl } from '../monitoring/index.js';
import type { PromptManagerImpl, SystemPrompt } from '../prompts/index.js';
import { CircuitBreaker } from '../resilience/index.js';
import { ValidationError } from '../types/index.js';
import { validateExtractionResult } from '../validators/index.js';

import type { ExtractionServiceConfig, ExtractionServiceDeps } from './extraction-service.js';
import { ExtractionServiceImpl } from './extraction-service.js';
import type { GeminiClient, GeminiResponse } from './gemini-client.js';

// --- Constants ---

const VALID_JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const VALID_PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

// --- Helpers ---

function makeJpegBuffer(size: number): Buffer {
  const buf = Buffer.alloc(Math.max(size, 4));
  VALID_JPEG_HEADER.copy(buf);
  return buf;
}

function makePngBuffer(size: number): Buffer {
  const buf = Buffer.alloc(Math.max(size, 4));
  VALID_PNG_HEADER.copy(buf);
  return buf;
}

const VALID_PDF_HEADER = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF

function makePdfBuffer(size: number): Buffer {
  const buf = Buffer.alloc(Math.max(size, 4));
  VALID_PDF_HEADER.copy(buf);
  return buf;
}

function makeGeminiExtractionResponse(documentType: string = 'receipt'): string {
  return JSON.stringify({
    transactions: [
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

// --- Arbitraries ---

/** Generate random buffer sizes for valid JPEG images */
const jpegBufferSizeArb = fc.integer({ min: 10, max: 2048 });

/** Generate random buffer sizes for valid PNG images */
const pngBufferSizeArb = fc.integer({ min: 10, max: 2048 });

/** Generate random buffer sizes for valid PDF documents */
const pdfBufferSizeArb = fc.integer({ min: 10, max: 2048 });

/** Generate valid CSV content with a header row and at least one data row */
const csvContentArb = fc
  .tuple(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 2, max: 5 }))
  .chain(([rowCount, colCount]) => {
    const headers = Array.from(
      { length: colCount },
      (_, i) => ['date', 'description', 'amount', 'type', 'reference'][i % 5],
    );
    const headerLine = headers.join(',');
    return fc
      .array(
        fc.array(
          fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 '), {
            minLength: 1,
            maxLength: 20,
          }),
          {
            minLength: colCount,
            maxLength: colCount,
          },
        ),
        { minLength: rowCount, maxLength: rowCount },
      )
      .map((rows) => {
        const dataLines = rows.map((row) => row.join(','));
        return [headerLine, ...dataLines].join('\n');
      });
  });

// --- Property Tests ---

describe('ExtractionService Property Tests', () => {
  let deps: ExtractionServiceDeps;
  let service: ExtractionServiceImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createDeps();
    service = new ExtractionServiceImpl(deps);
  });

  /**
   * Property 3: Receipt Document Type
   *
   * For any successful receipt extraction, the returned ExtractionResult
   * SHALL have document_type equal to 'receipt'.
   *
   * **Validates: Requirements 1.6**
   */
  describe('Property 3: Receipt Document Type', () => {
    it('should always return document_type "receipt" for JPEG buffers of any valid size', async () => {
      await fc.assert(
        fc.asyncProperty(jpegBufferSizeArb, async (size) => {
          vi.clearAllMocks();
          const freshDeps = createDeps();
          const freshService = new ExtractionServiceImpl(freshDeps);
          const buffer = makeJpegBuffer(size);

          const result = await freshService.extractFromReceipt(buffer);

          expect(result.document_type).toBe('receipt');
        }),
        { numRuns: 100 },
      );
    });

    it('should always return document_type "receipt" for PNG buffers of any valid size', async () => {
      await fc.assert(
        fc.asyncProperty(pngBufferSizeArb, async (size) => {
          vi.clearAllMocks();
          const freshDeps = createDeps();
          const freshService = new ExtractionServiceImpl(freshDeps);
          const buffer = makePngBuffer(size);

          const result = await freshService.extractFromReceipt(buffer);

          expect(result.document_type).toBe('receipt');
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 4: Bank Statement Document Type
   *
   * For any successful bank statement extraction, the returned ExtractionResult
   * SHALL have document_type equal to 'bank_statement'.
   *
   * **Validates: Requirements 2.6**
   */
  describe('Property 4: Bank Statement Document Type', () => {
    it('should always return document_type "bank_statement" for PDF buffers of any valid size', async () => {
      await fc.assert(
        fc.asyncProperty(pdfBufferSizeArb, async (size) => {
          vi.clearAllMocks();
          const bankStatementClient = createMockClient(
            makeGeminiResponse(makeGeminiExtractionResponse('bank_statement')),
          );
          const freshDeps = createDeps({ client: bankStatementClient });
          const freshService = new ExtractionServiceImpl(freshDeps);
          const buffer = makePdfBuffer(size);

          const result = await freshService.extractFromBankStatement(buffer);

          expect(result.document_type).toBe('bank_statement');
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 5: POS Export Document Type
   *
   * For any successful POS export extraction, the returned ExtractionResult
   * SHALL have document_type equal to 'pos_export'.
   *
   * **Validates: Requirements 3.5**
   */
  describe('Property 5: POS Export Document Type', () => {
    it('should always return document_type "pos_export" for valid CSV content of any shape', async () => {
      await fc.assert(
        fc.asyncProperty(csvContentArb, async (csvContent) => {
          vi.clearAllMocks();
          const posExportClient = createMockClient(
            makeGeminiResponse(makeGeminiExtractionResponse('pos_export')),
          );
          const freshDeps = createDeps({ client: posExportClient });
          const freshService = new ExtractionServiceImpl(freshDeps);

          const result = await freshService.extractFromPosExport(csvContent);

          expect(result.document_type).toBe('pos_export');
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 2: Schema Validation Completeness
   *
   * For any Gemini API response (extraction), the output validator SHALL either:
   * - Accept the response if it conforms to the ExtractedTransaction schema
   * - Reject non-conforming items and include them in the warnings array
   *
   * **Validates: Requirements 1.5, 2.5, 3.4, 5.3**
   */
  describe('Property 2: Schema Validation Completeness', () => {
    /** Arbitrary for a fully valid transaction object */
    const validTransactionArb = fc.record({
      date: fc.constantFrom('2024-01-15', '2023-06-30', '2024-12-01'),
      description: fc.string({ minLength: 1, maxLength: 50 }),
      amount: fc.double({ min: 0.01, max: 1_000_000, noNaN: true }),
      type: fc.constantFrom('credit' as const, 'debit' as const),
      confidence: fc.integer({ min: 0, max: 100 }),
    });

    /** Arbitrary for an invalid transaction (missing or wrong-typed fields) */
    const invalidTransactionArb = fc.oneof(
      // Missing date
      fc.record({
        description: fc.string({ minLength: 1, maxLength: 20 }),
        amount: fc.double({ min: 0.01, max: 1000, noNaN: true }),
        type: fc.constantFrom('credit' as const, 'debit' as const),
        confidence: fc.integer({ min: 0, max: 100 }),
      }),
      // Invalid type
      fc.record({
        date: fc.constant('2024-01-15'),
        description: fc.string({ minLength: 1, maxLength: 20 }),
        amount: fc.double({ min: 0.01, max: 1000, noNaN: true }),
        type: fc.constant('unknown'),
        confidence: fc.integer({ min: 0, max: 100 }),
      }),
      // Negative amount
      fc.record({
        date: fc.constant('2024-01-15'),
        description: fc.string({ minLength: 1, maxLength: 20 }),
        amount: fc.double({ min: -1000, max: -0.01, noNaN: true }),
        type: fc.constantFrom('credit' as const, 'debit' as const),
        confidence: fc.integer({ min: 0, max: 100 }),
      }),
      // Confidence out of range
      fc.record({
        date: fc.constant('2024-01-15'),
        description: fc.string({ minLength: 1, maxLength: 20 }),
        amount: fc.double({ min: 0.01, max: 1000, noNaN: true }),
        type: fc.constantFrom('credit' as const, 'debit' as const),
        confidence: fc.integer({ min: 101, max: 999 }),
      }),
      // Empty description
      fc.record({
        date: fc.constant('2024-01-15'),
        description: fc.constant(''),
        amount: fc.double({ min: 0.01, max: 1000, noNaN: true }),
        type: fc.constantFrom('credit' as const, 'debit' as const),
        confidence: fc.integer({ min: 0, max: 100 }),
      }),
    );

    it('should accept all valid transactions and produce correct structure', () => {
      fc.assert(
        fc.property(
          fc.array(validTransactionArb, { minLength: 0, maxLength: 5 }),
          (transactions) => {
            const raw = {
              transactions,
              document_type: 'receipt',
              extraction_confidence: 90,
              warnings: [],
            };

            const validated = validateExtractionResult(raw);

            expect(validated.valid).toBe(true);
            expect(validated.result).not.toBeNull();
            expect(validated.result!.transactions).toHaveLength(transactions.length);
            expect(validated.excludedTransactions).toBe(0);
            expect(validated.result!.document_type).toBe('receipt');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should reject invalid transactions and add warnings for each', () => {
      fc.assert(
        fc.property(
          fc.array(invalidTransactionArb, { minLength: 1, maxLength: 5 }),
          (invalidTxns) => {
            const raw = {
              transactions: invalidTxns,
              document_type: 'receipt',
              extraction_confidence: 90,
              warnings: [],
            };

            const validated = validateExtractionResult(raw);

            expect(validated.valid).toBe(true);
            expect(validated.result).not.toBeNull();
            expect(validated.result!.transactions).toHaveLength(0);
            expect(validated.excludedTransactions).toBe(invalidTxns.length);
            // Each excluded transaction should produce a warning
            const exclusionWarnings = validated.result!.warnings.filter((w) =>
              w.includes('excluded'),
            );
            expect(exclusionWarnings).toHaveLength(invalidTxns.length);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should correctly partition mixed valid and invalid transactions', () => {
      fc.assert(
        fc.property(
          fc.array(validTransactionArb, { minLength: 1, maxLength: 3 }),
          fc.array(invalidTransactionArb, { minLength: 1, maxLength: 3 }),
          (validTxns, invalidTxns) => {
            const allTxns = [...validTxns, ...invalidTxns];
            const raw = {
              transactions: allTxns,
              document_type: 'bank_statement',
              extraction_confidence: 80,
              warnings: [],
            };

            const validated = validateExtractionResult(raw);

            expect(validated.valid).toBe(true);
            expect(validated.result).not.toBeNull();
            expect(validated.result!.transactions).toHaveLength(validTxns.length);
            expect(validated.excludedTransactions).toBe(invalidTxns.length);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 6: Warning Propagation
   *
   * For any extraction that produces warnings (from Gemini or validation),
   * all warnings SHALL be included in the ExtractionResult.warnings array.
   *
   * **Validates: Requirements 1.7, 1.8, 2.8, 3.7**
   */
  describe('Property 6: Warning Propagation', () => {
    /** Arbitrary for warning strings that Gemini might include in its response */
    const warningStringArb = fc
      .string({ minLength: 1, maxLength: 80 })
      .filter((s) => s.trim().length > 0);

    it('should propagate Gemini response warnings into the final ExtractionResult', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(warningStringArb, { minLength: 1, maxLength: 5 }),
          async (geminiWarnings) => {
            vi.clearAllMocks();

            const responseJson = JSON.stringify({
              transactions: [
                {
                  date: '2024-01-15',
                  description: 'Test purchase',
                  amount: 5000,
                  type: 'debit',
                  confidence: 85,
                },
              ],
              document_type: 'receipt',
              extraction_confidence: 90,
              warnings: geminiWarnings,
            });

            const client = createMockClient(makeGeminiResponse(responseJson));
            const freshDeps = createDeps({ client });
            const freshService = new ExtractionServiceImpl(freshDeps);
            const buffer = makeJpegBuffer(100);

            const result = await freshService.extractFromReceipt(buffer);

            // All Gemini warnings should appear in the result
            for (const warning of geminiWarnings) {
              expect(result.warnings).toContain(warning);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should propagate input validation warnings (e.g., PNG format) through extraction', async () => {
      await fc.assert(
        fc.asyncProperty(pngBufferSizeArb, async (size) => {
          vi.clearAllMocks();
          const freshDeps = createDeps();
          const freshService = new ExtractionServiceImpl(freshDeps);
          const buffer = makePngBuffer(size);

          const result = await freshService.extractFromReceipt(buffer);

          // PNG format warning should be propagated
          const hasPngWarning = result.warnings.some((w) => w.toLowerCase().includes('png'));
          expect(hasPngWarning).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('should propagate validation exclusion warnings for invalid transactions', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 5 }), (invalidCount) => {
          const invalidTxns = Array.from({ length: invalidCount }, () => ({
            date: 'not-a-date',
            description: 'Test',
            amount: -1,
            type: 'invalid',
            confidence: 200,
          }));

          const raw = {
            transactions: invalidTxns,
            document_type: 'receipt',
            extraction_confidence: 90,
            warnings: ['some gemini warning'],
          };

          const validated = validateExtractionResult(raw);

          expect(validated.result).not.toBeNull();
          // Original Gemini warning should be present
          expect(validated.result!.warnings).toContain('some gemini warning');
          // Exclusion warnings should also be present
          const exclusionWarnings = validated.result!.warnings.filter((w) =>
            w.includes('excluded'),
          );
          expect(exclusionWarnings).toHaveLength(invalidCount);
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 7: Invalid Input Graceful Handling
   *
   * For any invalid or unreadable input (corrupted image, malformed CSV),
   * the service SHALL throw a ValidationError.
   *
   * **Validates: Requirements 1.8, 2.8, 3.7, 5.3**
   */
  describe('Property 7: Invalid Input Graceful Handling', () => {
    /**
     * Arbitrary for random buffers that do NOT start with valid magic bytes.
     * Avoids JPEG (0xff 0xd8), PNG (0x89 0x50 0x4e 0x47), PDF (0x25 0x50 0x44 0x46).
     */
    const invalidBufferArb = fc
      .integer({ min: 4, max: 256 })
      .chain((size) =>
        fc.array(fc.integer({ min: 0, max: 255 }), { minLength: size, maxLength: size }),
      )
      .map((bytes) => Buffer.from(bytes))
      .filter((buf) => {
        // Exclude buffers that accidentally start with valid magic bytes
        if (buf[0] === 0xff && buf[1] === 0xd8) return false; // JPEG
        if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return false; // PNG
        if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return false; // PDF
        return true;
      });

    it('should throw ValidationError for invalid image buffers in extractFromReceipt', async () => {
      await fc.assert(
        fc.asyncProperty(invalidBufferArb, async (buffer) => {
          vi.clearAllMocks();
          const freshDeps = createDeps();
          const freshService = new ExtractionServiceImpl(freshDeps);

          await expect(freshService.extractFromReceipt(buffer)).rejects.toThrow(ValidationError);
        }),
        { numRuns: 100 },
      );
    });

    it('should throw ValidationError for invalid PDF buffers in extractFromBankStatement', async () => {
      await fc.assert(
        fc.asyncProperty(invalidBufferArb, async (buffer) => {
          vi.clearAllMocks();
          const freshDeps = createDeps();
          const freshService = new ExtractionServiceImpl(freshDeps);

          await expect(freshService.extractFromBankStatement(buffer)).rejects.toThrow(
            ValidationError,
          );
        }),
        { numRuns: 100 },
      );
    });

    it('should throw ValidationError for empty string in extractFromPosExport', async () => {
      await fc.assert(
        fc.asyncProperty(fc.constant(''), async (csvContent) => {
          vi.clearAllMocks();
          const freshDeps = createDeps();
          const freshService = new ExtractionServiceImpl(freshDeps);

          await expect(freshService.extractFromPosExport(csvContent)).rejects.toThrow(
            ValidationError,
          );
        }),
        { numRuns: 100 },
      );
    });

    it('should throw ValidationError for empty buffers', async () => {
      vi.clearAllMocks();
      const freshDeps = createDeps();
      const freshService = new ExtractionServiceImpl(freshDeps);

      await expect(freshService.extractFromReceipt(Buffer.alloc(0))).rejects.toThrow(
        ValidationError,
      );
      await expect(freshService.extractFromBankStatement(Buffer.alloc(0))).rejects.toThrow(
        ValidationError,
      );
    });
  });
});
