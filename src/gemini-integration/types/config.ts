// Gemini Integration - Configuration types

export type GeminiModel = 'gemini-2.0-flash' | 'gemini-2.0-pro';

export interface ModelConfig {
  model: GeminiModel;
  temperature: number;
  maxOutputTokens: number;
  topP: number;
  topK: number;
}

export interface GeminiServiceConfig {
  // API Configuration
  apiKey: string;
  apiKeyBackup?: string;
  baseUrl?: string;

  // Model Defaults
  defaultExtractionModel: GeminiModel;
  defaultInsightModel: GeminiModel;

  // Timeout Settings
  extractionTimeoutMs: number;
  insightTimeoutMs: number;

  // Temperature Settings
  extractionTemperature: number;
  insightTemperature: number;

  // Retry Settings
  maxRetries: number;
  initialRetryDelayMs: number;
  maxRetryDelayMs: number;

  // Circuit Breaker Settings
  circuitBreakerFailureThreshold: number;
  circuitBreakerResetTimeoutMs: number;

  // Image Processing
  maxImageWidth: number;
  maxImageHeight: number;
  imageQuality: number;

  // File Size Limits
  maxImageSizeBytes: number;
  maxPdfSizeBytes: number;
  maxCsvSizeBytes: number;

  // Logging
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  redactPii: boolean;

  // Usage Tracking
  enableUsageTracking: boolean;
  usageStorageType: 'memory' | 'database';
}
