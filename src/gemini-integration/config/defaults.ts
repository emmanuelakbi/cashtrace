// Gemini Integration - Configuration defaults

import type { GeminiServiceConfig, ModelConfig } from '../types/config.js';

/**
 * Default model configuration for document extraction operations.
 * Uses low temperature (0.1) for deterministic, consistent output.
 */
export const DEFAULT_EXTRACTION_CONFIG: ModelConfig = {
  model: 'gemini-2.0-flash',
  temperature: 0.1,
  maxOutputTokens: 4096,
  topP: 0.95,
  topK: 40,
};

/**
 * Default model configuration for insight generation operations.
 * Uses moderate temperature (0.5) for balanced creativity.
 */
export const DEFAULT_INSIGHT_CONFIG: ModelConfig = {
  model: 'gemini-2.0-flash',
  temperature: 0.5,
  maxOutputTokens: 2048,
  topP: 0.95,
  topK: 40,
};

/**
 * Default values for GeminiServiceConfig (excluding apiKey which is required).
 */
export const DEFAULT_SERVICE_CONFIG: Omit<GeminiServiceConfig, 'apiKey'> = {
  defaultExtractionModel: DEFAULT_EXTRACTION_CONFIG.model,
  defaultInsightModel: DEFAULT_INSIGHT_CONFIG.model,

  extractionTimeoutMs: 30_000,
  insightTimeoutMs: 60_000,

  extractionTemperature: DEFAULT_EXTRACTION_CONFIG.temperature,
  insightTemperature: DEFAULT_INSIGHT_CONFIG.temperature,

  maxRetries: 3,
  initialRetryDelayMs: 1_000,
  maxRetryDelayMs: 10_000,

  circuitBreakerFailureThreshold: 5,
  circuitBreakerResetTimeoutMs: 30_000,

  maxImageWidth: 1024,
  maxImageHeight: 1024,
  imageQuality: 80,

  maxImageSizeBytes: 10 * 1024 * 1024,
  maxPdfSizeBytes: 10 * 1024 * 1024,
  maxCsvSizeBytes: 5 * 1024 * 1024,

  logLevel: 'info',
  redactPii: true,

  enableUsageTracking: true,
  usageStorageType: 'memory',
};
