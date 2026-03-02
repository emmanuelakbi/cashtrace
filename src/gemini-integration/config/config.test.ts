import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { GeminiServiceConfig } from '../types/config.js';

import {
  DEFAULT_EXTRACTION_CONFIG,
  DEFAULT_INSIGHT_CONFIG,
  DEFAULT_SERVICE_CONFIG,
  loadConfig,
} from './index.js';

describe('config/defaults', () => {
  it('DEFAULT_EXTRACTION_CONFIG uses flash model with low temperature', () => {
    expect(DEFAULT_EXTRACTION_CONFIG).toEqual({
      model: 'gemini-2.0-flash',
      temperature: 0.1,
      maxOutputTokens: 4096,
      topP: 0.95,
      topK: 40,
    });
  });

  it('DEFAULT_INSIGHT_CONFIG uses flash model with moderate temperature', () => {
    expect(DEFAULT_INSIGHT_CONFIG).toEqual({
      model: 'gemini-2.0-flash',
      temperature: 0.5,
      maxOutputTokens: 2048,
      topP: 0.95,
      topK: 40,
    });
  });

  it('DEFAULT_SERVICE_CONFIG has correct default values', () => {
    expect(DEFAULT_SERVICE_CONFIG.extractionTimeoutMs).toBe(30_000);
    expect(DEFAULT_SERVICE_CONFIG.insightTimeoutMs).toBe(60_000);
    expect(DEFAULT_SERVICE_CONFIG.maxRetries).toBe(3);
    expect(DEFAULT_SERVICE_CONFIG.initialRetryDelayMs).toBe(1_000);
    expect(DEFAULT_SERVICE_CONFIG.maxRetryDelayMs).toBe(10_000);
    expect(DEFAULT_SERVICE_CONFIG.circuitBreakerFailureThreshold).toBe(5);
    expect(DEFAULT_SERVICE_CONFIG.circuitBreakerResetTimeoutMs).toBe(30_000);
    expect(DEFAULT_SERVICE_CONFIG.maxImageWidth).toBe(1024);
    expect(DEFAULT_SERVICE_CONFIG.maxImageHeight).toBe(1024);
    expect(DEFAULT_SERVICE_CONFIG.imageQuality).toBe(80);
    expect(DEFAULT_SERVICE_CONFIG.maxImageSizeBytes).toBe(10 * 1024 * 1024);
    expect(DEFAULT_SERVICE_CONFIG.maxPdfSizeBytes).toBe(10 * 1024 * 1024);
    expect(DEFAULT_SERVICE_CONFIG.maxCsvSizeBytes).toBe(5 * 1024 * 1024);
    expect(DEFAULT_SERVICE_CONFIG.logLevel).toBe('info');
    expect(DEFAULT_SERVICE_CONFIG.redactPii).toBe(true);
    expect(DEFAULT_SERVICE_CONFIG.enableUsageTracking).toBe(true);
    expect(DEFAULT_SERVICE_CONFIG.usageStorageType).toBe('memory');
  });
});

describe('loadConfig', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    // Clear all GEMINI_ env vars before each test
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('GEMINI_')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('returns a valid config when apiKey is provided via overrides', () => {
    const config = loadConfig({ apiKey: 'test-key' });
    expect(config.apiKey).toBe('test-key');
    expect(config.defaultExtractionModel).toBe('gemini-2.0-flash');
    expect(config.logLevel).toBe('info');
  });

  it('throws when apiKey is missing', () => {
    expect(() => loadConfig()).toThrow('apiKey is required');
  });

  it('reads apiKey from GEMINI_API_KEY env var', () => {
    process.env.GEMINI_API_KEY = 'env-key';
    const config = loadConfig();
    expect(config.apiKey).toBe('env-key');
  });

  it('overrides take precedence over env vars', () => {
    process.env.GEMINI_API_KEY = 'env-key';
    process.env.GEMINI_LOG_LEVEL = 'debug';
    const config = loadConfig({ apiKey: 'override-key', logLevel: 'error' });
    expect(config.apiKey).toBe('override-key');
    expect(config.logLevel).toBe('error');
  });

  it('env vars take precedence over defaults', () => {
    process.env.GEMINI_API_KEY = 'env-key';
    process.env.GEMINI_MAX_RETRIES = '5';
    process.env.GEMINI_EXTRACTION_TIMEOUT_MS = '45000';
    const config = loadConfig();
    expect(config.maxRetries).toBe(5);
    expect(config.extractionTimeoutMs).toBe(45_000);
  });

  it('reads model overrides from env vars', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_EXTRACTION_MODEL = 'gemini-2.0-pro';
    process.env.GEMINI_INSIGHT_MODEL = 'gemini-2.0-pro';
    const config = loadConfig();
    expect(config.defaultExtractionModel).toBe('gemini-2.0-pro');
    expect(config.defaultInsightModel).toBe('gemini-2.0-pro');
  });

  it('ignores invalid model values from env vars', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_EXTRACTION_MODEL = 'invalid-model';
    const config = loadConfig();
    expect(config.defaultExtractionModel).toBe('gemini-2.0-flash');
  });

  it('reads boolean env vars correctly', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_REDACT_PII = 'false';
    process.env.GEMINI_ENABLE_USAGE_TRACKING = '0';
    const config = loadConfig();
    expect(config.redactPii).toBe(false);
    expect(config.enableUsageTracking).toBe(false);
  });

  it('reads temperature overrides from env vars', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_EXTRACTION_TEMPERATURE = '0.3';
    process.env.GEMINI_INSIGHT_TEMPERATURE = '0.7';
    const config = loadConfig();
    expect(config.extractionTemperature).toBeCloseTo(0.3);
    expect(config.insightTemperature).toBeCloseTo(0.7);
  });

  it('reads backup key and base URL from env vars', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_API_KEY_BACKUP = 'backup-key';
    process.env.GEMINI_BASE_URL = 'https://custom.api.example.com';
    const config = loadConfig();
    expect(config.apiKeyBackup).toBe('backup-key');
    expect(config.baseUrl).toBe('https://custom.api.example.com');
  });

  it('reads file size limits from env vars', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_MAX_IMAGE_SIZE_BYTES = '5242880';
    process.env.GEMINI_MAX_PDF_SIZE_BYTES = '20971520';
    process.env.GEMINI_MAX_CSV_SIZE_BYTES = '1048576';
    const config = loadConfig();
    expect(config.maxImageSizeBytes).toBe(5_242_880);
    expect(config.maxPdfSizeBytes).toBe(20_971_520);
    expect(config.maxCsvSizeBytes).toBe(1_048_576);
  });

  it('reads usage storage type from env var', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_USAGE_STORAGE_TYPE = 'database';
    const config = loadConfig();
    expect(config.usageStorageType).toBe('database');
  });

  it('ignores invalid usage storage type from env var', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_USAGE_STORAGE_TYPE = 'redis';
    const config = loadConfig();
    expect(config.usageStorageType).toBe('memory');
  });

  describe('validation', () => {
    it('throws for extractionTemperature out of range', () => {
      expect(() => loadConfig({ apiKey: 'k', extractionTemperature: 1.5 })).toThrow(
        'extractionTemperature must be between 0 and 1',
      );
    });

    it('throws for insightTemperature out of range', () => {
      expect(() => loadConfig({ apiKey: 'k', insightTemperature: -0.1 })).toThrow(
        'insightTemperature must be between 0 and 1',
      );
    });

    it('throws for negative maxRetries', () => {
      expect(() => loadConfig({ apiKey: 'k', maxRetries: -1 })).toThrow('maxRetries must be >= 0');
    });

    it('throws for zero extractionTimeoutMs', () => {
      expect(() => loadConfig({ apiKey: 'k', extractionTimeoutMs: 0 })).toThrow(
        'extractionTimeoutMs must be > 0',
      );
    });

    it('throws for zero insightTimeoutMs', () => {
      expect(() => loadConfig({ apiKey: 'k', insightTimeoutMs: 0 })).toThrow(
        'insightTimeoutMs must be > 0',
      );
    });

    it('throws for zero circuitBreakerFailureThreshold', () => {
      expect(() => loadConfig({ apiKey: 'k', circuitBreakerFailureThreshold: 0 })).toThrow(
        'circuitBreakerFailureThreshold must be > 0',
      );
    });

    it('throws for imageQuality out of range', () => {
      expect(() => loadConfig({ apiKey: 'k', imageQuality: 0 })).toThrow(
        'imageQuality must be between 1 and 100',
      );
      expect(() => loadConfig({ apiKey: 'k', imageQuality: 101 })).toThrow(
        'imageQuality must be between 1 and 100',
      );
    });

    it('throws for invalid defaultExtractionModel', () => {
      expect(() =>
        loadConfig({
          apiKey: 'k',
          defaultExtractionModel: 'bad-model' as GeminiServiceConfig['defaultExtractionModel'],
        }),
      ).toThrow('invalid defaultExtractionModel');
    });

    it('throws for invalid defaultInsightModel', () => {
      expect(() =>
        loadConfig({
          apiKey: 'k',
          defaultInsightModel: 'bad-model' as GeminiServiceConfig['defaultInsightModel'],
        }),
      ).toThrow('invalid defaultInsightModel');
    });

    it('accepts boundary temperature values', () => {
      const config = loadConfig({
        apiKey: 'k',
        extractionTemperature: 0,
        insightTemperature: 1,
      });
      expect(config.extractionTemperature).toBe(0);
      expect(config.insightTemperature).toBe(1);
    });
  });
});
