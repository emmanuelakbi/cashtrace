// Gemini Integration - Extraction Service
// Handles document extraction (receipts, bank statements, POS exports) via Gemini API
// Validates: Requirements 1.1-1.8, 2.1-2.8, 3.1-3.7

import { v4 as uuidv4 } from 'uuid';

import type { GeminiLogger } from '../monitoring/index.js';
import type { UsageTrackerImpl } from '../monitoring/index.js';
import type { PromptManagerImpl, SystemPrompt } from '../prompts/index.js';
import type { CircuitBreaker } from '../resilience/index.js';
import { executeWithRetry, executeWithTimeout } from '../resilience/index.js';
import type { ExtractionMetadata, ExtractionResult, GeminiModel } from '../types/index.js';
import { GeminiServiceError, InvalidResponseError, ValidationError } from '../types/index.js';
import { extractText, parseCsv, preprocess, repairJson } from '../utils/index.js';
import {
  validateCsvInput,
  validateExtractionResult,
  validateImageInput,
  validatePdfInput,
} from '../validators/index.js';

import type { GeminiClient, GeminiContent, GeminiResponse } from './gemini-client.js';

export interface ExtractionOptions {
  model?: GeminiModel;
  temperature?: number;
  timeout?: number;
  skipPreprocessing?: boolean;
}

export interface ExtractionServiceConfig {
  extractionTimeoutMs: number;
  extractionTemperature: number;
  defaultModel: GeminiModel;
  maxOutputTokens: number;
}

export interface ExtractionServiceDeps {
  client: GeminiClient;
  promptManager: PromptManagerImpl;
  retryHandler?: typeof executeWithRetry;
  circuitBreaker: CircuitBreaker;
  usageTracker: UsageTrackerImpl;
  logger: GeminiLogger;
  config: ExtractionServiceConfig;
}

const DEFAULT_CONFIG: ExtractionServiceConfig = {
  extractionTimeoutMs: 30_000,
  extractionTemperature: 0.1,
  defaultModel: 'gemini-2.0-flash',
  maxOutputTokens: 4096,
};

export class ExtractionServiceImpl {
  private readonly client: GeminiClient;
  private readonly promptManager: PromptManagerImpl;
  private readonly retry: typeof executeWithRetry;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly usageTracker: UsageTrackerImpl;
  private readonly logger: GeminiLogger;
  private readonly config: ExtractionServiceConfig;

  constructor(deps: ExtractionServiceDeps) {
    this.client = deps.client;
    this.promptManager = deps.promptManager;
    this.retry = deps.retryHandler ?? executeWithRetry;
    this.circuitBreaker = deps.circuitBreaker;
    this.usageTracker = deps.usageTracker;
    this.logger = deps.logger;
    this.config = { ...DEFAULT_CONFIG, ...deps.config };
  }

  /**
   * Extract transactions from a receipt image.
   * Flow: validate → preprocess → prompt → retry(circuit(timeout(gemini))) → validate output → track
   * Sets document_type to 'receipt'.
   */
  async extractFromReceipt(
    imageBuffer: Buffer,
    options?: ExtractionOptions,
  ): Promise<ExtractionResult> {
    const correlationId = uuidv4();
    const startTime = Date.now();

    this.logger.info('Starting receipt extraction', correlationId, {
      bufferSize: imageBuffer.length,
    });

    // 1. Validate input
    const validation = validateImageInput(imageBuffer);
    if (!validation.valid) {
      const errorMsg = validation.errors.map((e) => e.message).join('; ');
      this.logger.warn('Receipt image validation failed', correlationId, { errors: errorMsg });
      throw new ValidationError(errorMsg, 'imageBuffer');
    }

    // 2. Preprocess image (resize, compress)
    let processedBuffer = imageBuffer;
    if (!options?.skipPreprocessing) {
      try {
        processedBuffer = await preprocess(imageBuffer);
        this.logger.debug('Image preprocessed', correlationId, {
          originalSize: imageBuffer.length,
          processedSize: processedBuffer.length,
        });
      } catch (err: unknown) {
        this.logger.warn('Image preprocessing failed, using original', correlationId);
        processedBuffer = imageBuffer;
      }
    }

    // 3. Get prompt
    const prompt = this.promptManager.getPrompt('receipt_extraction');

    // 4. Build content with inline image
    const base64Image = processedBuffer.toString('base64');
    const contents: GeminiContent[] = [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
          { text: 'Extract all transactions from this receipt image.' },
        ],
      },
    ];

    // 5. Execute with resilience stack
    const model = options?.model ?? this.config.defaultModel;
    const temperature = options?.temperature ?? this.config.extractionTemperature;
    const timeoutMs = options?.timeout ?? this.config.extractionTimeoutMs;

    try {
      const response = await this.executeWithResilience(
        contents,
        prompt,
        model,
        temperature,
        timeoutMs,
        correlationId,
      );

      // 6. Parse and validate output
      const result = this.parseAndValidateResponse(
        response,
        'receipt',
        model,
        prompt.version,
        startTime,
        validation.warnings,
        correlationId,
      );

      // 7. Track usage
      await this.trackUsage('receipt_extraction', model, response, startTime, true);

      return result;
    } catch (error: unknown) {
      // For invalid inputs / unreadable images, return empty result with warnings
      if (error instanceof ValidationError) {
        throw error;
      }

      await this.trackUsage('receipt_extraction', model, null, startTime, false);

      this.logger.error('Receipt extraction failed', correlationId, {
        error: error instanceof Error ? error.message : String(error),
      });

      return this.buildEmptyResult(
        'receipt',
        model,
        prompt.version,
        startTime,
        [
          ...validation.warnings,
          `Extraction failed: ${error instanceof Error ? error.message : String(error)}`,
        ],
        false,
      );
    }
  }

  /**
   * Extract transactions from a bank statement PDF.
   * Flow: validate → prompt → retry(circuit(timeout(gemini))) → validate output → fallback if needed → track
   * Sets document_type to 'bank_statement'.
   */
  async extractFromBankStatement(
    pdfBuffer: Buffer,
    options?: ExtractionOptions,
  ): Promise<ExtractionResult> {
    const correlationId = uuidv4();
    const startTime = Date.now();

    this.logger.info('Starting bank statement extraction', correlationId, {
      bufferSize: pdfBuffer.length,
    });

    // 1. Validate input
    const validation = validatePdfInput(pdfBuffer);
    if (!validation.valid) {
      const errorMsg = validation.errors.map((e) => e.message).join('; ');
      this.logger.warn('Bank statement PDF validation failed', correlationId, {
        errors: errorMsg,
      });
      throw new ValidationError(errorMsg, 'pdfBuffer');
    }

    // 2. Get prompt
    const prompt = this.promptManager.getPrompt('bank_statement_extraction');

    // 3. Build content with PDF as base64
    const base64Pdf = pdfBuffer.toString('base64');
    const contents: GeminiContent[] = [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
          { text: 'Extract all transactions from this bank statement.' },
        ],
      },
    ];

    const model = options?.model ?? this.config.defaultModel;
    const temperature = options?.temperature ?? this.config.extractionTemperature;
    const timeoutMs = options?.timeout ?? this.config.extractionTimeoutMs;

    try {
      // 4. Execute with resilience stack
      const response = await this.executeWithResilience(
        contents,
        prompt,
        model,
        temperature,
        timeoutMs,
        correlationId,
      );

      // 5. Parse and validate output
      const result = this.parseAndValidateResponse(
        response,
        'bank_statement',
        model,
        prompt.version,
        startTime,
        validation.warnings,
        correlationId,
      );

      await this.trackUsage('bank_statement_extraction', model, response, startTime, true);

      return result;
    } catch (error: unknown) {
      if (error instanceof ValidationError) {
        throw error;
      }

      this.logger.warn(
        'Gemini bank statement extraction failed, trying PDF text fallback',
        correlationId,
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );

      // 6. Fallback: extract text from PDF and re-attempt
      return this.bankStatementFallback(
        pdfBuffer,
        prompt,
        model,
        temperature,
        timeoutMs,
        startTime,
        validation.warnings,
        correlationId,
      );
    }
  }

  private async bankStatementFallback(
    pdfBuffer: Buffer,
    prompt: SystemPrompt,
    model: GeminiModel,
    temperature: number,
    timeoutMs: number,
    startTime: number,
    inputWarnings: string[],
    correlationId: string,
  ): Promise<ExtractionResult> {
    try {
      const pdfResult = await extractText(pdfBuffer);

      if (!pdfResult.success || pdfResult.text.trim().length === 0) {
        await this.trackUsage('bank_statement_extraction', model, null, startTime, false);
        return this.buildEmptyResult(
          'bank_statement',
          model,
          prompt.version,
          startTime,
          [
            ...inputWarnings,
            ...pdfResult.warnings,
            'PDF text extraction fallback failed: no text extracted',
          ],
          true,
        );
      }

      // Re-attempt with extracted text
      const contents: GeminiContent[] = [
        {
          role: 'user',
          parts: [
            {
              text: `Extract all transactions from this bank statement text:\n\n${pdfResult.text}`,
            },
          ],
        },
      ];

      const response = await this.executeWithResilience(
        contents,
        prompt,
        model,
        temperature,
        timeoutMs,
        correlationId,
      );

      const result = this.parseAndValidateResponse(
        response,
        'bank_statement',
        model,
        prompt.version,
        startTime,
        [...inputWarnings, 'Fallback: used PDF text extraction instead of direct PDF parsing'],
        correlationId,
      );

      result.metadata.fallbackUsed = true;

      await this.trackUsage('bank_statement_extraction', model, response, startTime, true);

      return result;
    } catch (fallbackError: unknown) {
      await this.trackUsage('bank_statement_extraction', model, null, startTime, false);

      this.logger.error('Bank statement fallback also failed', correlationId, {
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      });

      return this.buildEmptyResult(
        'bank_statement',
        model,
        prompt.version,
        startTime,
        [
          ...inputWarnings,
          `Extraction and fallback both failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
        ],
        true,
      );
    }
  }

  /**
   * Extract transactions from a POS export CSV.
   * Flow: validate → prompt → retry(circuit(timeout(gemini))) → validate output → fallback if needed → track
   * Sets document_type to 'pos_export'.
   */
  async extractFromPosExport(
    csvContent: string,
    options?: ExtractionOptions,
  ): Promise<ExtractionResult> {
    const correlationId = uuidv4();
    const startTime = Date.now();

    this.logger.info('Starting POS export extraction', correlationId, {
      contentLength: csvContent.length,
    });

    // 1. Validate input
    const validation = validateCsvInput(csvContent);
    if (!validation.valid) {
      const errorMsg = validation.errors.map((e) => e.message).join('; ');
      this.logger.warn('POS export CSV validation failed', correlationId, { errors: errorMsg });
      throw new ValidationError(errorMsg, 'csvContent');
    }

    // 2. Get prompt
    const prompt = this.promptManager.getPrompt('pos_export_extraction');

    // 3. Build content with CSV text
    const contents: GeminiContent[] = [
      {
        role: 'user',
        parts: [
          {
            text: `Extract all transactions from this POS export CSV:\n\n${csvContent}`,
          },
        ],
      },
    ];

    const model = options?.model ?? this.config.defaultModel;
    const temperature = options?.temperature ?? this.config.extractionTemperature;
    const timeoutMs = options?.timeout ?? this.config.extractionTimeoutMs;

    try {
      // 4. Execute with resilience stack
      const response = await this.executeWithResilience(
        contents,
        prompt,
        model,
        temperature,
        timeoutMs,
        correlationId,
      );

      // 5. Parse and validate output
      const result = this.parseAndValidateResponse(
        response,
        'pos_export',
        model,
        prompt.version,
        startTime,
        validation.warnings,
        correlationId,
      );

      await this.trackUsage('pos_export_extraction', model, response, startTime, true);

      return result;
    } catch (error: unknown) {
      if (error instanceof ValidationError) {
        throw error;
      }

      this.logger.warn(
        'Gemini POS export extraction failed, trying CSV parsing fallback',
        correlationId,
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );

      // 6. Fallback: parse CSV directly
      return this.posExportFallback(
        csvContent,
        model,
        prompt.version,
        startTime,
        validation.warnings,
        correlationId,
      );
    }
  }

  private posExportFallback(
    csvContent: string,
    model: GeminiModel,
    promptVersion: string,
    startTime: number,
    inputWarnings: string[],
    correlationId: string,
  ): ExtractionResult {
    try {
      const csvResult = parseCsv(csvContent);

      if (!csvResult.success || csvResult.rows.length === 0) {
        return this.buildEmptyResult(
          'pos_export',
          model,
          promptVersion,
          startTime,
          [
            ...inputWarnings,
            ...csvResult.warnings,
            'CSV parsing fallback failed: no data rows extracted',
          ],
          true,
        );
      }

      // Map CSV rows to transactions
      const transactions = csvResult.rows.map((row) => {
        const date = row['date'] ?? row['Date'] ?? row['DATE'] ?? '';
        const description =
          row['description'] ??
          row['Description'] ??
          row['narration'] ??
          row['Narration'] ??
          'POS payment';
        const amountStr = row['amount'] ?? row['Amount'] ?? row['AMOUNT'] ?? '0';
        const amount = parseFloat(amountStr.replace(/[^0-9.-]/g, '')) || 0;
        const reference =
          row['reference'] ?? row['Reference'] ?? row['transaction_id'] ?? row['ID'] ?? '';

        return {
          date,
          description,
          amount: Math.abs(amount),
          type: 'credit' as const,
          reference,
          category_hint: 'PRODUCT_SALES',
          confidence: 60,
        };
      });

      const latencyMs = Date.now() - startTime;

      this.logger.info('POS export CSV fallback succeeded', correlationId, {
        transactionCount: transactions.length,
      });

      return {
        transactions,
        document_type: 'pos_export',
        extraction_confidence: 50,
        warnings: [
          ...inputWarnings,
          'Fallback: used direct CSV parsing instead of Gemini extraction',
          ...csvResult.warnings,
        ],
        metadata: {
          model,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs,
          promptVersion,
          fallbackUsed: true,
        },
      };
    } catch (fallbackError: unknown) {
      this.logger.error('POS export CSV fallback also failed', correlationId, {
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      });

      return this.buildEmptyResult(
        'pos_export',
        model,
        promptVersion,
        startTime,
        [
          ...inputWarnings,
          `Extraction and CSV fallback both failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
        ],
        true,
      );
    }
  }

  /**
   * Execute a Gemini API call with the full resilience stack:
   * retry → circuit breaker → timeout → client.generate
   */
  private async executeWithResilience(
    contents: GeminiContent[],
    prompt: SystemPrompt,
    model: GeminiModel,
    temperature: number,
    timeoutMs: number,
    correlationId: string,
  ): Promise<GeminiResponse> {
    return this.retry(async () => {
      // Check circuit breaker
      if (!this.circuitBreaker.canExecute()) {
        throw this.circuitBreaker.createCircuitOpenError();
      }

      try {
        const response = await executeWithTimeout(
          () =>
            this.client.generate({
              model,
              systemInstruction: prompt.systemInstruction,
              temperature,
              maxOutputTokens: this.config.maxOutputTokens,
              contents,
              jsonMode: true,
            }),
          { timeoutMs },
        );

        this.circuitBreaker.recordSuccess();
        this.logger.debug('Gemini API call succeeded', correlationId, {
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
        });

        return response;
      } catch (error: unknown) {
        if (error instanceof Error) {
          this.circuitBreaker.recordFailure(error);
        }
        throw error;
      }
    });
  }

  /**
   * Parse the raw Gemini response text, repair JSON if needed,
   * validate against the extraction schema, and build the final ExtractionResult.
   */
  private parseAndValidateResponse(
    response: GeminiResponse,
    documentType: ExtractionResult['document_type'],
    model: GeminiModel,
    promptVersion: string,
    startTime: number,
    inputWarnings: string[],
    correlationId: string,
  ): ExtractionResult {
    const latencyMs = Date.now() - startTime;

    // Try parsing JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      // Attempt JSON repair
      const repairResult = repairJson(response.text);
      if (!repairResult.success) {
        this.logger.warn('Failed to parse or repair Gemini response', correlationId, {
          rawPreview: response.text.slice(0, 200),
        });
        throw new InvalidResponseError('Failed to parse Gemini response as JSON', response.text);
      }
      parsed = repairResult.repairedJson;
      inputWarnings.push(`JSON response required repair: ${repairResult.repairs.join(', ')}`);
    }

    // Inject document_type before validation
    if (parsed && typeof parsed === 'object') {
      (parsed as Record<string, unknown>).document_type = documentType;
    }

    // Validate extraction result
    const validated = validateExtractionResult(parsed);

    if (!validated.valid || !validated.result) {
      const errorMsg = validated.errors.map((e) => e.message).join('; ');
      this.logger.warn('Extraction output validation failed', correlationId, {
        errors: errorMsg,
      });
      throw new InvalidResponseError(`Output validation failed: ${errorMsg}`, response.text);
    }

    // Build metadata
    const metadata: ExtractionMetadata = {
      model,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      latencyMs,
      promptVersion,
      fallbackUsed: false,
    };

    // Merge all warning sources:
    // 1. inputWarnings: from input validation (e.g., PNG format) and JSON repair
    // 2. validated.result.warnings: from Gemini response + exclusion warnings from output validator
    const allWarnings = [...inputWarnings, ...validated.result.warnings];

    return {
      transactions: validated.result.transactions,
      document_type: documentType,
      extraction_confidence: validated.result.extraction_confidence,
      warnings: allWarnings,
      raw_text_preview: validated.result.raw_text_preview,
      metadata,
    };
  }

  /**
   * Build an empty ExtractionResult for error/fallback scenarios.
   */
  private buildEmptyResult(
    documentType: ExtractionResult['document_type'],
    model: GeminiModel,
    promptVersion: string,
    startTime: number,
    warnings: string[],
    fallbackUsed: boolean,
  ): ExtractionResult {
    return {
      transactions: [],
      document_type: documentType,
      extraction_confidence: 0,
      warnings,
      metadata: {
        model,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - startTime,
        promptVersion,
        fallbackUsed,
      },
    };
  }

  /**
   * Record usage to the usage tracker.
   */
  private async trackUsage(
    operationType: 'receipt_extraction' | 'bank_statement_extraction' | 'pos_export_extraction',
    model: GeminiModel,
    response: GeminiResponse | null,
    startTime: number,
    success: boolean,
  ): Promise<void> {
    try {
      await this.usageTracker.recordUsage({
        operationType,
        model,
        inputTokens: response?.inputTokens ?? 0,
        outputTokens: response?.outputTokens ?? 0,
        latencyMs: Date.now() - startTime,
        success,
        timestamp: new Date(),
      });
    } catch {
      // Usage tracking failure should not break extraction
    }
  }
}
