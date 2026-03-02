// Gemini Integration - Insight Service
// Handles narrative insight generation from business transaction data via Gemini API
// Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8

import { v4 as uuidv4 } from 'uuid';

import type { GeminiLogger } from '../monitoring/index.js';
import type { UsageTrackerImpl } from '../monitoring/index.js';
import type { PromptManagerImpl, SystemPrompt } from '../prompts/index.js';
import type { CircuitBreaker } from '../resilience/index.js';
import { executeWithRetry, executeWithTimeout } from '../resilience/index.js';
import type {
  BusinessContext,
  GeminiModel,
  InsightMetadata,
  InsightResult,
} from '../types/index.js';
import { GeminiServiceError, InvalidResponseError, ValidationError } from '../types/index.js';
import { repairJson } from '../utils/index.js';
import { validateBusinessContext, validateInsightResult } from '../validators/index.js';

import type { GeminiClient, GeminiContent, GeminiResponse } from './gemini-client.js';

export interface InsightOptions {
  model?: GeminiModel;
  temperature?: number;
  timeout?: number;
}

export interface InsightServiceConfig {
  insightTimeoutMs: number;
  insightTemperature: number;
  defaultModel: GeminiModel;
  maxOutputTokens: number;
}

export interface InsightServiceDeps {
  client: GeminiClient;
  promptManager: PromptManagerImpl;
  retryHandler?: typeof executeWithRetry;
  circuitBreaker: CircuitBreaker;
  usageTracker: UsageTrackerImpl;
  logger: GeminiLogger;
  config: InsightServiceConfig;
}

const DEFAULT_CONFIG: InsightServiceConfig = {
  insightTimeoutMs: 60_000,
  insightTemperature: 0.5,
  defaultModel: 'gemini-2.0-flash',
  maxOutputTokens: 2048,
};

export class InsightServiceImpl {
  private readonly client: GeminiClient;
  private readonly promptManager: PromptManagerImpl;
  private readonly retry: typeof executeWithRetry;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly usageTracker: UsageTrackerImpl;
  private readonly logger: GeminiLogger;
  private readonly config: InsightServiceConfig;

  constructor(deps: InsightServiceDeps) {
    this.client = deps.client;
    this.promptManager = deps.promptManager;
    this.retry = deps.retryHandler ?? executeWithRetry;
    this.circuitBreaker = deps.circuitBreaker;
    this.usageTracker = deps.usageTracker;
    this.logger = deps.logger;
    this.config = { ...DEFAULT_CONFIG, ...deps.config };
  }

  /**
   * Generate narrative insights from business transaction data.
   * Flow: validate → prompt → retry(circuit(timeout(gemini))) → validate output → track
   * Sets analysis_period from the input BusinessContext period.
   */
  async generateInsights(
    context: BusinessContext,
    options?: InsightOptions,
  ): Promise<InsightResult> {
    const correlationId = uuidv4();
    const startTime = Date.now();

    this.logger.info('Starting insight generation', correlationId, {
      businessId: context.businessId,
      transactionCount: context.transactions.length,
    });

    // 1. Validate input
    const validation = validateBusinessContext(context);
    if (!validation.valid) {
      const errorMsg = validation.errors.map((e) => e.message).join('; ');
      this.logger.warn('Business context validation failed', correlationId, {
        errors: errorMsg,
      });
      throw new ValidationError(errorMsg, 'businessContext');
    }

    // 2. Get prompt
    const prompt = this.promptManager.getPrompt('insight_generation');

    // 3. Build content with business context
    const contextPayload = JSON.stringify({
      businessName: context.businessName,
      businessType: context.businessType,
      period: context.period,
      transactions: context.transactions,
      previousPeriodComparison: context.previousPeriodComparison,
      customPromptContext: context.customPromptContext,
    });

    const contents: GeminiContent[] = [
      {
        role: 'user',
        parts: [
          {
            text: `Generate business insights for this Nigerian SME:\n\n${contextPayload}`,
          },
        ],
      },
    ];

    // 4. Execute with resilience stack
    const model = options?.model ?? this.config.defaultModel;
    const temperature = options?.temperature ?? this.config.insightTemperature;
    const timeoutMs = options?.timeout ?? this.config.insightTimeoutMs;

    try {
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
        context,
        model,
        prompt.version,
        startTime,
        validation.warnings,
        correlationId,
      );

      // 6. Track usage
      await this.trackUsage(model, response, startTime, true);

      return result;
    } catch (error: unknown) {
      if (error instanceof ValidationError) {
        throw error;
      }

      await this.trackUsage(model, null, startTime, false);

      this.logger.error('Insight generation failed', correlationId, {
        error: error instanceof Error ? error.message : String(error),
      });

      return this.buildEmptyResult(context, model, prompt.version, startTime, [
        ...validation.warnings,
        `Insight generation failed: ${error instanceof Error ? error.message : String(error)}`,
      ]);
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
   * validate against the insight schema, and build the final InsightResult.
   * Ensures analysis_period matches the input BusinessContext period.
   */
  private parseAndValidateResponse(
    response: GeminiResponse,
    context: BusinessContext,
    model: GeminiModel,
    promptVersion: string,
    startTime: number,
    inputWarnings: string[],
    correlationId: string,
  ): InsightResult {
    const latencyMs = Date.now() - startTime;

    // Try parsing JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      // Attempt JSON repair
      const repairResult = repairJson(response.text);
      if (!repairResult.success) {
        this.logger.warn('Failed to parse or repair Gemini insight response', correlationId, {
          rawPreview: response.text.slice(0, 200),
        });
        throw new InvalidResponseError(
          'Failed to parse Gemini insight response as JSON',
          response.text,
        );
      }
      parsed = repairResult.repairedJson;
      inputWarnings.push(`JSON response required repair: ${repairResult.repairs.join(', ')}`);
    }

    // Inject analysis_period from input context to ensure consistency
    if (parsed && typeof parsed === 'object') {
      (parsed as Record<string, unknown>).analysis_period = {
        start: context.period.start,
        end: context.period.end,
      };
    }

    // Validate insight result
    const validated = validateInsightResult(parsed);

    if (!validated.valid || !validated.result) {
      const errorMsg = validated.errors.map((e) => e.message).join('; ');
      this.logger.warn('Insight output validation failed', correlationId, {
        errors: errorMsg,
      });
      throw new InvalidResponseError(`Output validation failed: ${errorMsg}`, response.text);
    }

    // Build metadata
    const metadata: InsightMetadata = {
      model,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      latencyMs,
      promptVersion,
      transactionsAnalyzed: context.transactions.length,
    };

    // Merge all warning sources
    const allWarnings = [...inputWarnings, ...validated.warnings];

    return {
      insights: validated.result.insights,
      analysis_period: {
        start: context.period.start,
        end: context.period.end,
      },
      confidence: validated.result.confidence,
      metadata,
    };
  }

  /**
   * Build an empty InsightResult for error/fallback scenarios.
   */
  private buildEmptyResult(
    context: BusinessContext,
    model: GeminiModel,
    promptVersion: string,
    startTime: number,
    warnings: string[],
  ): InsightResult {
    return {
      insights: [],
      analysis_period: {
        start: context.period.start,
        end: context.period.end,
      },
      confidence: 0,
      metadata: {
        model,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - startTime,
        promptVersion,
        transactionsAnalyzed: context.transactions.length,
      },
    };
  }

  /**
   * Record usage to the usage tracker.
   */
  private async trackUsage(
    model: GeminiModel,
    response: GeminiResponse | null,
    startTime: number,
    success: boolean,
  ): Promise<void> {
    try {
      await this.usageTracker.recordUsage({
        operationType: 'insight_generation',
        model,
        inputTokens: response?.inputTokens ?? 0,
        outputTokens: response?.outputTokens ?? 0,
        latencyMs: Date.now() - startTime,
        success,
        timestamp: new Date(),
      });
    } catch {
      // Usage tracking failure should not break insight generation
    }
  }
}
