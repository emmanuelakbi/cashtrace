// Gemini Integration - Output validation for extraction and insight results
// Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6

import type { ExtractionResult } from '../types/extraction.js';
import type { InsightMetadata, InsightResult } from '../types/insights.js';

import type { InputValidationError } from './input-validator.js';
import { extractedTransactionSchema, generatedInsightSchema } from './schemas.js';
import type { ValidatedExtractedTransaction, ValidatedGeneratedInsight } from './schemas.js';

/**
 * Result of validating a raw Gemini extraction response.
 *
 * Property 10: Output Validation Field Completeness
 * Property 12: Partial Validation Exclusion
 */
export interface ValidatedExtractionResult {
  valid: boolean;
  result: ExtractionResult | null;
  errors: InputValidationError[];
  warnings: string[];
  excludedTransactions: number;
}

/**
 * Result of validating a raw Gemini insight response.
 *
 * Property 11: Insight Validation Field Completeness
 * Property 12: Partial Validation Exclusion
 */
export interface ValidatedInsightResult {
  valid: boolean;
  result: InsightResult | null;
  errors: InputValidationError[];
  warnings: string[];
  excludedInsights: number;
}

const VALID_DOCUMENT_TYPES = ['receipt', 'bank_statement', 'pos_export'] as const;

/**
 * Validates a raw Gemini extraction response against the expected schema.
 *
 * - Validates the top-level structure (transactions array, document_type, extraction_confidence)
 * - Validates each transaction using the Zod schema (date parseability, amount numeric, type enum, confidence range)
 * - Excludes invalid transactions and adds warnings for each exclusion
 * - Returns a ValidatedExtractionResult with valid transactions, excluded count, and warnings
 *
 * @param raw - The raw parsed Gemini response (unknown shape)
 * @returns ValidatedExtractionResult
 */
export function validateExtractionResult(raw: unknown): ValidatedExtractionResult {
  const errors: InputValidationError[] = [];
  const warnings: string[] = [];

  if (raw === null || raw === undefined || typeof raw !== 'object') {
    errors.push({
      field: 'response',
      code: 'INVALID_RESPONSE',
      message: 'Extraction response must be a non-null object',
    });
    return { valid: false, result: null, errors, warnings, excludedTransactions: 0 };
  }

  const response = raw as Record<string, unknown>;

  // Validate transactions array exists
  if (!Array.isArray(response.transactions)) {
    errors.push({
      field: 'transactions',
      code: 'MISSING_FIELD',
      message: 'Response must contain a transactions array',
    });
    return { valid: false, result: null, errors, warnings, excludedTransactions: 0 };
  }

  // Validate document_type
  const documentType = response.document_type;
  if (
    typeof documentType !== 'string' ||
    !VALID_DOCUMENT_TYPES.includes(documentType as (typeof VALID_DOCUMENT_TYPES)[number])
  ) {
    errors.push({
      field: 'document_type',
      code: 'INVALID_VALUE',
      message: `document_type must be one of: ${VALID_DOCUMENT_TYPES.join(', ')}`,
    });
  }

  // Validate extraction_confidence
  const extractionConfidence = response.extraction_confidence;
  if (
    typeof extractionConfidence !== 'number' ||
    !Number.isInteger(extractionConfidence) ||
    extractionConfidence < 0 ||
    extractionConfidence > 100
  ) {
    warnings.push('extraction_confidence is missing or invalid; defaulting to 0');
  }

  // Validate each transaction individually
  const validTransactions: ValidatedExtractedTransaction[] = [];
  let excludedTransactions = 0;

  for (let i = 0; i < response.transactions.length; i++) {
    const txn = response.transactions[i];
    const parseResult = extractedTransactionSchema.safeParse(txn);

    if (parseResult.success) {
      validTransactions.push(parseResult.data);
    } else {
      excludedTransactions++;
      const issueMessages = parseResult.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      warnings.push(`Transaction at index ${i} excluded: ${issueMessages}`);
    }
  }

  // If there are top-level structural errors (missing transactions array or invalid document_type),
  // the result is invalid
  if (errors.length > 0) {
    return { valid: false, result: null, errors, warnings, excludedTransactions };
  }

  const safeConfidence =
    typeof extractionConfidence === 'number' &&
    Number.isInteger(extractionConfidence) &&
    extractionConfidence >= 0 &&
    extractionConfidence <= 100
      ? extractionConfidence
      : 0;

  const result: ExtractionResult = {
    transactions: validTransactions,
    document_type: documentType as ExtractionResult['document_type'],
    extraction_confidence: safeConfidence,
    warnings: [
      ...(Array.isArray(response.warnings)
        ? (response.warnings as unknown[]).filter((w): w is string => typeof w === 'string')
        : []),
      ...warnings,
    ],
    raw_text_preview:
      typeof response.raw_text_preview === 'string' ? response.raw_text_preview : undefined,
    metadata: buildMetadata(response.metadata),
  };

  return {
    valid: true,
    result,
    errors,
    warnings,
    excludedTransactions,
  };
}

/**
 * Builds ExtractionMetadata from raw metadata, providing sensible defaults
 * for any missing or invalid fields.
 */
function buildMetadata(raw: unknown): ExtractionResult['metadata'] {
  const defaults: ExtractionResult['metadata'] = {
    model: 'gemini-2.0-flash',
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    promptVersion: 'unknown',
    fallbackUsed: false,
  };

  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return defaults;
  }

  const meta = raw as Record<string, unknown>;

  return {
    model:
      meta.model === 'gemini-2.0-flash' || meta.model === 'gemini-2.0-pro'
        ? meta.model
        : defaults.model,
    inputTokens:
      typeof meta.inputTokens === 'number' && meta.inputTokens >= 0
        ? meta.inputTokens
        : defaults.inputTokens,
    outputTokens:
      typeof meta.outputTokens === 'number' && meta.outputTokens >= 0
        ? meta.outputTokens
        : defaults.outputTokens,
    latencyMs:
      typeof meta.latencyMs === 'number' && meta.latencyMs >= 0
        ? meta.latencyMs
        : defaults.latencyMs,
    promptVersion:
      typeof meta.promptVersion === 'string' && meta.promptVersion.length > 0
        ? meta.promptVersion
        : defaults.promptVersion,
    fallbackUsed:
      typeof meta.fallbackUsed === 'boolean' ? meta.fallbackUsed : defaults.fallbackUsed,
  };
}

/**
 * Validates a raw Gemini insight response against the expected schema.
 *
 * - Validates the top-level structure (insights array, analysis_period, confidence)
 * - Validates each insight using the Zod generatedInsightSchema (type enum, severity enum, title, body)
 * - Excludes invalid insights and adds warnings for each exclusion
 * - Returns a ValidatedInsightResult with valid insights, excluded count, and warnings
 *
 * @param raw - The raw parsed Gemini response (unknown shape)
 * @returns ValidatedInsightResult
 */
export function validateInsightResult(raw: unknown): ValidatedInsightResult {
  const errors: InputValidationError[] = [];
  const warnings: string[] = [];

  if (raw === null || raw === undefined || typeof raw !== 'object') {
    errors.push({
      field: 'response',
      code: 'INVALID_RESPONSE',
      message: 'Insight response must be a non-null object',
    });
    return { valid: false, result: null, errors, warnings, excludedInsights: 0 };
  }

  const response = raw as Record<string, unknown>;

  // Validate insights array exists
  if (!Array.isArray(response.insights)) {
    errors.push({
      field: 'insights',
      code: 'MISSING_FIELD',
      message: 'Response must contain an insights array',
    });
    return { valid: false, result: null, errors, warnings, excludedInsights: 0 };
  }

  // Validate analysis_period
  const analysisPeriod = response.analysis_period;
  if (
    analysisPeriod === null ||
    analysisPeriod === undefined ||
    typeof analysisPeriod !== 'object'
  ) {
    errors.push({
      field: 'analysis_period',
      code: 'MISSING_FIELD',
      message: 'Response must contain an analysis_period object with start and end',
    });
  } else {
    const period = analysisPeriod as Record<string, unknown>;
    if (typeof period.start !== 'string' || period.start.length === 0) {
      errors.push({
        field: 'analysis_period.start',
        code: 'INVALID_VALUE',
        message: 'analysis_period.start must be a non-empty string',
      });
    }
    if (typeof period.end !== 'string' || period.end.length === 0) {
      errors.push({
        field: 'analysis_period.end',
        code: 'INVALID_VALUE',
        message: 'analysis_period.end must be a non-empty string',
      });
    }
  }

  // Validate confidence
  const confidence = response.confidence;
  if (
    typeof confidence !== 'number' ||
    !Number.isInteger(confidence) ||
    confidence < 0 ||
    confidence > 100
  ) {
    warnings.push('confidence is missing or invalid; defaulting to 0');
  }

  // Validate each insight individually
  const validInsights: ValidatedGeneratedInsight[] = [];
  let excludedInsights = 0;

  for (let i = 0; i < response.insights.length; i++) {
    const insight = response.insights[i];
    const parseResult = generatedInsightSchema.safeParse(insight);

    if (parseResult.success) {
      validInsights.push(parseResult.data);
    } else {
      excludedInsights++;
      const issueMessages = parseResult.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      warnings.push(`Insight at index ${i} excluded: ${issueMessages}`);
    }
  }

  // If there are top-level structural errors, the result is invalid
  if (errors.length > 0) {
    return { valid: false, result: null, errors, warnings, excludedInsights };
  }

  const safeConfidence =
    typeof confidence === 'number' &&
    Number.isInteger(confidence) &&
    confidence >= 0 &&
    confidence <= 100
      ? confidence
      : 0;

  const period = analysisPeriod as Record<string, unknown>;

  const result: InsightResult = {
    insights: validInsights,
    analysis_period: {
      start: period.start as string,
      end: period.end as string,
    },
    confidence: safeConfidence,
    metadata: buildInsightMetadata(response.metadata),
  };

  return {
    valid: true,
    result,
    errors,
    warnings,
    excludedInsights,
  };
}

/**
 * Builds InsightMetadata from raw metadata, providing sensible defaults
 * for any missing or invalid fields.
 */
function buildInsightMetadata(raw: unknown): InsightMetadata {
  const defaults: InsightMetadata = {
    model: 'gemini-2.0-flash',
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    promptVersion: 'unknown',
    transactionsAnalyzed: 0,
  };

  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return defaults;
  }

  const meta = raw as Record<string, unknown>;

  return {
    model:
      meta.model === 'gemini-2.0-flash' || meta.model === 'gemini-2.0-pro'
        ? meta.model
        : defaults.model,
    inputTokens:
      typeof meta.inputTokens === 'number' && meta.inputTokens >= 0
        ? meta.inputTokens
        : defaults.inputTokens,
    outputTokens:
      typeof meta.outputTokens === 'number' && meta.outputTokens >= 0
        ? meta.outputTokens
        : defaults.outputTokens,
    latencyMs:
      typeof meta.latencyMs === 'number' && meta.latencyMs >= 0
        ? meta.latencyMs
        : defaults.latencyMs,
    promptVersion:
      typeof meta.promptVersion === 'string' && meta.promptVersion.length > 0
        ? meta.promptVersion
        : defaults.promptVersion,
    transactionsAnalyzed:
      typeof meta.transactionsAnalyzed === 'number' &&
      Number.isInteger(meta.transactionsAnalyzed) &&
      meta.transactionsAnalyzed >= 0
        ? meta.transactionsAnalyzed
        : defaults.transactionsAnalyzed,
  };
}
