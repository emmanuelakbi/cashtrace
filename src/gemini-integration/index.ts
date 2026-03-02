// Gemini Integration Module
// Main barrel file - re-exports public API
//
// This module provides an isolated AI service layer for all Gemini API
// interactions in CashTrace, handling document parsing (receipts, bank
// statements, POS exports) and narrative insights generation.
//
// Public API surface:
// - GeminiService (facade class) and GeminiServiceInterface
// - All domain types (extraction, insights, config)
// - All error classes
// - CircuitBreakerStatus for monitoring
// - UsageStats and related types for usage tracking
//
// Internal details (NOT exported):
// - ExtractionServiceImpl, InsightServiceImpl
// - GeminiClient, ImageProcessor, PdfExtractor, CsvParser, PiiRedactor
// - InputValidator, OutputValidator, schemas
// - RetryHandler, CircuitBreaker internals
// - Logger, UsageStorage, PromptManager

// --- Service facade (main entry point) ---
export { GeminiService } from './services/gemini-service.js';
export type { GeminiServiceInterface } from './services/gemini-service.js';

// --- Domain types: extraction ---
export type {
  ExtractedTransaction,
  ExtractionMetadata,
  ExtractionResult,
} from './types/extraction.js';

// --- Domain types: insights ---
export type {
  BusinessContext,
  GeneratedInsight,
  InsightMetadata,
  InsightResult,
  InsightSeverity,
  InsightType,
  TransactionSummary,
} from './types/insights.js';

// --- Domain types: config ---
export type { GeminiModel, GeminiServiceConfig, ModelConfig } from './types/config.js';

// --- Error classes ---
export {
  CircuitOpenError,
  FallbackUsedError,
  GeminiServiceError,
  InvalidResponseError,
  QuotaExceededError,
  RateLimitError,
  TimeoutError,
  ValidationError,
} from './types/errors.js';

// --- Circuit breaker status (for monitoring) ---
export type { CircuitBreakerStatus } from './resilience/circuit-breaker.js';

// --- Usage tracking types (for monitoring) ---
export type { UsageStats } from './monitoring/usage-tracker.js';
export type { UsageStatsOptions } from './monitoring/usage-storage.js';
