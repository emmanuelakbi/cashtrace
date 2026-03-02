// Gemini Integration - Configuration module
// Barrel file for configuration exports

import type { GeminiModel, GeminiServiceConfig } from '../types/config.js';

import {
  DEFAULT_EXTRACTION_CONFIG,
  DEFAULT_INSIGHT_CONFIG,
  DEFAULT_SERVICE_CONFIG,
} from './defaults.js';

export { DEFAULT_EXTRACTION_CONFIG, DEFAULT_INSIGHT_CONFIG, DEFAULT_SERVICE_CONFIG };

/**
 * Read a string environment variable, returning undefined if not set.
 */
function envString(name: string): string | undefined {
  const value = process.env[name];
  return value !== undefined && value !== '' ? value : undefined;
}

/**
 * Read an integer environment variable, returning undefined if not set or invalid.
 */
function envInt(name: string): number | undefined {
  const raw = envString(name);
  if (raw === undefined) return undefined;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Read a boolean environment variable, returning undefined if not set.
 * Accepts 'true'/'1' as true, 'false'/'0' as false.
 */
function envBool(name: string): boolean | undefined {
  const raw = envString(name);
  if (raw === undefined) return undefined;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return undefined;
}

const VALID_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const VALID_MODELS = new Set(['gemini-2.0-flash', 'gemini-2.0-pro']);
const VALID_STORAGE_TYPES = new Set(['memory', 'database']);

/**
 * Load environment variable overrides for GeminiServiceConfig.
 * All env vars use the GEMINI_ prefix.
 */
function loadEnvOverrides(): Partial<GeminiServiceConfig> {
  const overrides: Partial<GeminiServiceConfig> = {};

  const apiKey = envString('GEMINI_API_KEY');
  if (apiKey !== undefined) overrides.apiKey = apiKey;

  const apiKeyBackup = envString('GEMINI_API_KEY_BACKUP');
  if (apiKeyBackup !== undefined) overrides.apiKeyBackup = apiKeyBackup;

  const baseUrl = envString('GEMINI_BASE_URL');
  if (baseUrl !== undefined) overrides.baseUrl = baseUrl;

  const extractionModel = envString('GEMINI_EXTRACTION_MODEL');
  if (extractionModel !== undefined && VALID_MODELS.has(extractionModel)) {
    overrides.defaultExtractionModel = extractionModel as GeminiModel;
  }

  const insightModel = envString('GEMINI_INSIGHT_MODEL');
  if (insightModel !== undefined && VALID_MODELS.has(insightModel)) {
    overrides.defaultInsightModel = insightModel as GeminiModel;
  }

  const extractionTimeout = envInt('GEMINI_EXTRACTION_TIMEOUT_MS');
  if (extractionTimeout !== undefined) overrides.extractionTimeoutMs = extractionTimeout;

  const insightTimeout = envInt('GEMINI_INSIGHT_TIMEOUT_MS');
  if (insightTimeout !== undefined) overrides.insightTimeoutMs = insightTimeout;

  const extractionTemp = envString('GEMINI_EXTRACTION_TEMPERATURE');
  if (extractionTemp !== undefined) {
    const parsed = parseFloat(extractionTemp);
    if (Number.isFinite(parsed)) overrides.extractionTemperature = parsed;
  }

  const insightTemp = envString('GEMINI_INSIGHT_TEMPERATURE');
  if (insightTemp !== undefined) {
    const parsed = parseFloat(insightTemp);
    if (Number.isFinite(parsed)) overrides.insightTemperature = parsed;
  }

  const maxRetries = envInt('GEMINI_MAX_RETRIES');
  if (maxRetries !== undefined) overrides.maxRetries = maxRetries;

  const initialRetryDelay = envInt('GEMINI_INITIAL_RETRY_DELAY_MS');
  if (initialRetryDelay !== undefined) overrides.initialRetryDelayMs = initialRetryDelay;

  const maxRetryDelay = envInt('GEMINI_MAX_RETRY_DELAY_MS');
  if (maxRetryDelay !== undefined) overrides.maxRetryDelayMs = maxRetryDelay;

  const cbFailureThreshold = envInt('GEMINI_CB_FAILURE_THRESHOLD');
  if (cbFailureThreshold !== undefined) {
    overrides.circuitBreakerFailureThreshold = cbFailureThreshold;
  }

  const cbResetTimeout = envInt('GEMINI_CB_RESET_TIMEOUT_MS');
  if (cbResetTimeout !== undefined) overrides.circuitBreakerResetTimeoutMs = cbResetTimeout;

  const maxImageWidth = envInt('GEMINI_MAX_IMAGE_WIDTH');
  if (maxImageWidth !== undefined) overrides.maxImageWidth = maxImageWidth;

  const maxImageHeight = envInt('GEMINI_MAX_IMAGE_HEIGHT');
  if (maxImageHeight !== undefined) overrides.maxImageHeight = maxImageHeight;

  const imageQuality = envInt('GEMINI_IMAGE_QUALITY');
  if (imageQuality !== undefined) overrides.imageQuality = imageQuality;

  const maxImageSize = envInt('GEMINI_MAX_IMAGE_SIZE_BYTES');
  if (maxImageSize !== undefined) overrides.maxImageSizeBytes = maxImageSize;

  const maxPdfSize = envInt('GEMINI_MAX_PDF_SIZE_BYTES');
  if (maxPdfSize !== undefined) overrides.maxPdfSizeBytes = maxPdfSize;

  const maxCsvSize = envInt('GEMINI_MAX_CSV_SIZE_BYTES');
  if (maxCsvSize !== undefined) overrides.maxCsvSizeBytes = maxCsvSize;

  const logLevel = envString('GEMINI_LOG_LEVEL');
  if (logLevel !== undefined && VALID_LOG_LEVELS.has(logLevel)) {
    overrides.logLevel = logLevel as GeminiServiceConfig['logLevel'];
  }

  const redactPii = envBool('GEMINI_REDACT_PII');
  if (redactPii !== undefined) overrides.redactPii = redactPii;

  const enableUsageTracking = envBool('GEMINI_ENABLE_USAGE_TRACKING');
  if (enableUsageTracking !== undefined) overrides.enableUsageTracking = enableUsageTracking;

  const usageStorageType = envString('GEMINI_USAGE_STORAGE_TYPE');
  if (usageStorageType !== undefined && VALID_STORAGE_TYPES.has(usageStorageType)) {
    overrides.usageStorageType = usageStorageType as GeminiServiceConfig['usageStorageType'];
  }

  return overrides;
}

/**
 * Validate a fully-resolved GeminiServiceConfig.
 * Throws if required fields are missing or values are out of range.
 */
function validateConfig(config: GeminiServiceConfig): void {
  if (!config.apiKey) {
    throw new Error(
      'GeminiServiceConfig: apiKey is required. Set GEMINI_API_KEY or pass it via overrides.',
    );
  }

  if (!VALID_MODELS.has(config.defaultExtractionModel)) {
    throw new Error(
      `GeminiServiceConfig: invalid defaultExtractionModel "${config.defaultExtractionModel}".`,
    );
  }

  if (!VALID_MODELS.has(config.defaultInsightModel)) {
    throw new Error(
      `GeminiServiceConfig: invalid defaultInsightModel "${config.defaultInsightModel}".`,
    );
  }

  if (config.extractionTemperature < 0 || config.extractionTemperature > 1) {
    throw new Error('GeminiServiceConfig: extractionTemperature must be between 0 and 1.');
  }

  if (config.insightTemperature < 0 || config.insightTemperature > 1) {
    throw new Error('GeminiServiceConfig: insightTemperature must be between 0 and 1.');
  }

  if (config.maxRetries < 0) {
    throw new Error('GeminiServiceConfig: maxRetries must be >= 0.');
  }

  if (config.extractionTimeoutMs <= 0) {
    throw new Error('GeminiServiceConfig: extractionTimeoutMs must be > 0.');
  }

  if (config.insightTimeoutMs <= 0) {
    throw new Error('GeminiServiceConfig: insightTimeoutMs must be > 0.');
  }

  if (config.circuitBreakerFailureThreshold <= 0) {
    throw new Error('GeminiServiceConfig: circuitBreakerFailureThreshold must be > 0.');
  }

  if (config.imageQuality < 1 || config.imageQuality > 100) {
    throw new Error('GeminiServiceConfig: imageQuality must be between 1 and 100.');
  }
}

/**
 * Load a fully-resolved GeminiServiceConfig.
 *
 * Priority (highest to lowest):
 *   1. Explicit overrides passed as argument
 *   2. Environment variables (GEMINI_ prefix)
 *   3. Built-in defaults
 *
 * Throws if the resulting config is invalid (e.g. missing apiKey).
 */
export function loadConfig(overrides?: Partial<GeminiServiceConfig>): GeminiServiceConfig {
  const envOverrides = loadEnvOverrides();

  const config: GeminiServiceConfig = {
    ...DEFAULT_SERVICE_CONFIG,
    apiKey: '', // placeholder — must be provided via env or overrides
    ...envOverrides,
    ...overrides,
  };

  validateConfig(config);

  return config;
}
