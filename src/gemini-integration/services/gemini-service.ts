// Gemini Integration - GeminiService Facade
// Main entry point for all Gemini operations.
// Wires together all internal components and delegates to specialized services.

import { DEFAULT_EXTRACTION_CONFIG, DEFAULT_INSIGHT_CONFIG } from '../config/index.js';
import { GeminiLogger } from '../monitoring/logger.js';
import { InMemoryUsageStorage } from '../monitoring/usage-storage.js';
import type { UsageStats, UsageTracker } from '../monitoring/usage-tracker.js';
import { UsageTrackerImpl } from '../monitoring/usage-tracker.js';
import { PromptManagerImpl } from '../prompts/prompt-manager.js';
import {
  BANK_STATEMENT_EXTRACTION_PROMPT,
  INSIGHT_GENERATION_PROMPT,
  POS_EXPORT_EXTRACTION_PROMPT,
  RECEIPT_EXTRACTION_PROMPT,
} from '../prompts/templates/index.js';
import { CircuitBreaker } from '../resilience/circuit-breaker.js';
import type { CircuitBreakerStatus } from '../resilience/circuit-breaker.js';
import type { BusinessContext, GeminiServiceConfig, InsightResult } from '../types/index.js';
import type { ExtractionResult } from '../types/index.js';
import type { UsageStatsOptions } from '../monitoring/usage-storage.js';

import { ExtractionServiceImpl } from './extraction-service.js';
import { GeminiClient } from './gemini-client.js';
import { InsightServiceImpl } from './insight-service.js';

export interface GeminiServiceInterface {
  parseReceipt(imageBuffer: Buffer): Promise<ExtractionResult>;
  parseBankStatement(pdfBuffer: Buffer): Promise<ExtractionResult>;
  parsePosExport(csvContent: string): Promise<ExtractionResult>;
  generateInsights(context: BusinessContext): Promise<InsightResult>;
  getUsageStats(options?: UsageStatsOptions): Promise<UsageStats>;
  getCircuitBreakerStatus(): CircuitBreakerStatus;
}

export class GeminiService implements GeminiServiceInterface {
  private readonly extractionService: ExtractionServiceImpl;
  private readonly insightService: InsightServiceImpl;
  private readonly usageTracker: UsageTracker;
  private readonly circuitBreaker: CircuitBreaker;

  constructor(config: GeminiServiceConfig) {
    // 1. Instantiate shared infrastructure
    const logger = new GeminiLogger({
      level: config.logLevel,
      redactPii: config.redactPii,
    });

    const circuitBreaker = new CircuitBreaker({
      failureThreshold: config.circuitBreakerFailureThreshold,
      resetTimeoutMs: config.circuitBreakerResetTimeoutMs,
    });

    const storage = new InMemoryUsageStorage();
    const usageTracker = new UsageTrackerImpl(storage);

    const client = new GeminiClient({
      apiKey: config.apiKey,
      apiKeyBackup: config.apiKeyBackup,
    });

    // 2. Set up prompt manager with all templates
    const promptManager = new PromptManagerImpl();
    promptManager.registerPrompt(RECEIPT_EXTRACTION_PROMPT, 'Receipt extraction v1');
    promptManager.registerPrompt(BANK_STATEMENT_EXTRACTION_PROMPT, 'Bank statement extraction v1');
    promptManager.registerPrompt(POS_EXPORT_EXTRACTION_PROMPT, 'POS export extraction v1');
    promptManager.registerPrompt(INSIGHT_GENERATION_PROMPT, 'Insight generation v1');

    // 3. Wire extraction service
    this.extractionService = new ExtractionServiceImpl({
      client,
      promptManager,
      circuitBreaker,
      usageTracker,
      logger,
      config: {
        extractionTimeoutMs: config.extractionTimeoutMs,
        extractionTemperature: config.extractionTemperature,
        defaultModel: config.defaultExtractionModel,
        maxOutputTokens: DEFAULT_EXTRACTION_CONFIG.maxOutputTokens,
      },
    });

    // 4. Wire insight service
    this.insightService = new InsightServiceImpl({
      client,
      promptManager,
      circuitBreaker,
      usageTracker,
      logger,
      config: {
        insightTimeoutMs: config.insightTimeoutMs,
        insightTemperature: config.insightTemperature,
        defaultModel: config.defaultInsightModel,
        maxOutputTokens: DEFAULT_INSIGHT_CONFIG.maxOutputTokens,
      },
    });

    // 5. Store references for status/stats methods
    this.usageTracker = usageTracker;
    this.circuitBreaker = circuitBreaker;
  }

  async parseReceipt(imageBuffer: Buffer): Promise<ExtractionResult> {
    return this.extractionService.extractFromReceipt(imageBuffer);
  }

  async parseBankStatement(pdfBuffer: Buffer): Promise<ExtractionResult> {
    return this.extractionService.extractFromBankStatement(pdfBuffer);
  }

  async parsePosExport(csvContent: string): Promise<ExtractionResult> {
    return this.extractionService.extractFromPosExport(csvContent);
  }

  async generateInsights(context: BusinessContext): Promise<InsightResult> {
    return this.insightService.generateInsights(context);
  }

  async getUsageStats(options?: UsageStatsOptions): Promise<UsageStats> {
    return this.usageTracker.getStats(options);
  }

  getCircuitBreakerStatus(): CircuitBreakerStatus {
    return this.circuitBreaker.getStatus();
  }
}
