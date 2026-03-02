/**
 * Property-based tests for Output Validation (Properties 10, 11, 12)
 *
 * **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 4.6, 4.7**
 *
 * Property 10: Output Validation Field Completeness
 *   For any extracted transaction that passes validation, it SHALL have all required
 *   fields with valid values: date parseable to a valid Date, amount > 0,
 *   type 'credit' or 'debit', confidence integer 0–100.
 *
 * Property 11: Insight Validation Field Completeness
 *   For any generated insight that passes validation, it SHALL have all required
 *   fields with valid enum values: type (5 variants), severity (3 variants),
 *   title non-empty, body non-empty.
 *
 * Property 12: Partial Validation Exclusion
 *   For any Gemini response containing a mix of valid and invalid items, the invalid
 *   items SHALL be excluded from the result and a warning SHALL be added for each
 *   excluded item.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { validateExtractionResult, validateInsightResult } from './output-validator.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_INSIGHT_TYPES = [
  'tax_exposure',
  'personal_spend',
  'cashflow_risk',
  'cost_optimization',
  'revenue_opportunity',
] as const;

const VALID_SEVERITIES = ['info', 'warning', 'alert'] as const;

const VALID_DOCUMENT_TYPES = ['receipt', 'bank_statement', 'pos_export'] as const;

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid ISO date string (YYYY-MM-DD). */
const isoDateArb = fc
  .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
  .map((d) => d.toISOString().split('T')[0] as string);

/** Generate a valid transaction object that should pass schema validation. */
const validTransactionArb = fc.record({
  date: isoDateArb,
  description: fc.string({ minLength: 1, maxLength: 100 }),
  amount: fc.double({ min: 0.01, max: 10_000_000, noNaN: true }),
  type: fc.constantFrom('credit' as const, 'debit' as const),
  confidence: fc.integer({ min: 0, max: 100 }),
});

/** Generate a valid insight object that should pass schema validation. */
const validInsightArb = fc.record({
  type: fc.constantFrom(...VALID_INSIGHT_TYPES),
  severity: fc.constantFrom(...VALID_SEVERITIES),
  title: fc.string({ minLength: 1, maxLength: 80 }),
  body: fc.string({ minLength: 1, maxLength: 500 }),
});

/** Generate an invalid transaction (at least one field is wrong). */
const invalidTransactionArb = fc.oneof(
  // Missing / empty date
  fc.record({
    date: fc.constant(''),
    description: fc.string({ minLength: 1, maxLength: 50 }),
    amount: fc.double({ min: 0.01, max: 1000, noNaN: true }),
    type: fc.constantFrom('credit' as const, 'debit' as const),
    confidence: fc.integer({ min: 0, max: 100 }),
  }),
  // Non-positive amount
  fc.record({
    date: isoDateArb,
    description: fc.string({ minLength: 1, maxLength: 50 }),
    amount: fc.constantFrom(0, -1, -100),
    type: fc.constantFrom('credit' as const, 'debit' as const),
    confidence: fc.integer({ min: 0, max: 100 }),
  }),
  // Invalid type
  fc.record({
    date: isoDateArb,
    description: fc.string({ minLength: 1, maxLength: 50 }),
    amount: fc.double({ min: 0.01, max: 1000, noNaN: true }),
    type: fc.constantFrom('invalid', 'transfer', 'refund'),
    confidence: fc.integer({ min: 0, max: 100 }),
  }),
  // Confidence out of range
  fc.record({
    date: isoDateArb,
    description: fc.string({ minLength: 1, maxLength: 50 }),
    amount: fc.double({ min: 0.01, max: 1000, noNaN: true }),
    type: fc.constantFrom('credit' as const, 'debit' as const),
    confidence: fc.oneof(fc.integer({ min: 101, max: 999 }), fc.integer({ min: -999, max: -1 })),
  }),
);

/** Generate an invalid insight (at least one field is wrong). */
const invalidInsightArb = fc.oneof(
  // Invalid type
  fc.record({
    type: fc.constantFrom('bad_type', 'unknown', 'other'),
    severity: fc.constantFrom(...VALID_SEVERITIES),
    title: fc.string({ minLength: 1, maxLength: 50 }),
    body: fc.string({ minLength: 1, maxLength: 100 }),
  }),
  // Invalid severity
  fc.record({
    type: fc.constantFrom(...VALID_INSIGHT_TYPES),
    severity: fc.constantFrom('critical', 'low', 'high'),
    title: fc.string({ minLength: 1, maxLength: 50 }),
    body: fc.string({ minLength: 1, maxLength: 100 }),
  }),
  // Empty title
  fc.record({
    type: fc.constantFrom(...VALID_INSIGHT_TYPES),
    severity: fc.constantFrom(...VALID_SEVERITIES),
    title: fc.constant(''),
    body: fc.string({ minLength: 1, maxLength: 100 }),
  }),
  // Empty body
  fc.record({
    type: fc.constantFrom(...VALID_INSIGHT_TYPES),
    severity: fc.constantFrom(...VALID_SEVERITIES),
    title: fc.string({ minLength: 1, maxLength: 50 }),
    body: fc.constant(''),
  }),
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Wrap transactions in a full extraction response envelope. */
function makeExtractionResponse(
  transactions: unknown[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    transactions,
    document_type: 'receipt',
    extraction_confidence: 85,
    warnings: [],
    metadata: {
      model: 'gemini-2.0-flash',
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 200,
      promptVersion: 'v1',
      fallbackUsed: false,
    },
    ...overrides,
  };
}

/** Wrap insights in a full insight response envelope. */
function makeInsightResponse(
  insights: unknown[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    insights,
    analysis_period: { start: '2024-01-01', end: '2024-03-31' },
    confidence: 80,
    metadata: {
      model: 'gemini-2.0-flash',
      inputTokens: 200,
      outputTokens: 100,
      latencyMs: 500,
      promptVersion: 'v1',
      transactionsAnalyzed: 50,
    },
    ...overrides,
  };
}

// ─── Property 10: Output Validation Field Completeness ───────────────────────

describe('Property 10: Output Validation Field Completeness', () => {
  /**
   * **Validates: Requirements 10.1, 10.2, 10.3**
   *
   * For any extracted transaction that passes validation, it SHALL have all
   * required fields with valid values:
   * - date: parseable to a valid Date
   * - amount: numeric value > 0
   * - type: either 'credit' or 'debit'
   * - confidence: integer between 0 and 100 inclusive
   */
  it('valid transactions always have all required fields with correct value constraints', () => {
    fc.assert(
      fc.property(
        fc.array(validTransactionArb, { minLength: 1, maxLength: 10 }),
        fc.constantFrom(...VALID_DOCUMENT_TYPES),
        (transactions, docType) => {
          const raw = makeExtractionResponse(transactions, { document_type: docType });
          const validated = validateExtractionResult(raw);

          expect(validated.valid).toBe(true);
          expect(validated.result).not.toBeNull();
          expect(validated.excludedTransactions).toBe(0);

          for (const txn of validated.result!.transactions) {
            // date is parseable to a valid Date
            const parsed = new Date(txn.date);
            expect(parsed.getTime()).not.toBeNaN();

            // amount is numeric and > 0
            expect(typeof txn.amount).toBe('number');
            expect(txn.amount).toBeGreaterThan(0);

            // type is 'credit' or 'debit'
            expect(['credit', 'debit']).toContain(txn.type);

            // confidence is integer in [0, 100]
            expect(Number.isInteger(txn.confidence)).toBe(true);
            expect(txn.confidence).toBeGreaterThanOrEqual(0);
            expect(txn.confidence).toBeLessThanOrEqual(100);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 11: Insight Validation Field Completeness ──────────────────────

describe('Property 11: Insight Validation Field Completeness', () => {
  /**
   * **Validates: Requirements 10.4, 10.5, 4.6, 4.7**
   *
   * For any generated insight that passes validation, it SHALL have all
   * required fields with valid enum values:
   * - type: one of tax_exposure, personal_spend, cashflow_risk, cost_optimization, revenue_opportunity
   * - severity: one of info, warning, alert
   * - title: non-empty string
   * - body: non-empty string
   */
  it('valid insights always have all required fields with correct enum values', () => {
    fc.assert(
      fc.property(fc.array(validInsightArb, { minLength: 1, maxLength: 10 }), (insights) => {
        const raw = makeInsightResponse(insights);
        const validated = validateInsightResult(raw);

        expect(validated.valid).toBe(true);
        expect(validated.result).not.toBeNull();
        expect(validated.excludedInsights).toBe(0);

        for (const insight of validated.result!.insights) {
          // type is a valid InsightType
          expect(VALID_INSIGHT_TYPES).toContain(insight.type);

          // severity is a valid InsightSeverity
          expect(VALID_SEVERITIES).toContain(insight.severity);

          // title is non-empty
          expect(typeof insight.title).toBe('string');
          expect(insight.title.length).toBeGreaterThan(0);

          // body is non-empty
          expect(typeof insight.body).toBe('string');
          expect(insight.body.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 12: Partial Validation Exclusion ───────────────────────────────

describe('Property 12: Partial Validation Exclusion', () => {
  /**
   * **Validates: Requirements 10.6**
   *
   * For any Gemini response containing a mix of valid and invalid items,
   * the invalid items SHALL be excluded from the result and a warning
   * SHALL be added for each excluded item.
   */
  it('invalid transactions are excluded and each produces a warning', () => {
    fc.assert(
      fc.property(
        fc.array(validTransactionArb, { minLength: 1, maxLength: 5 }),
        fc.array(invalidTransactionArb, { minLength: 1, maxLength: 5 }),
        (validTxns, invalidTxns) => {
          // Interleave valid and invalid transactions
          const allTxns: unknown[] = [];
          const maxLen = Math.max(validTxns.length, invalidTxns.length);
          for (let i = 0; i < maxLen; i++) {
            if (i < validTxns.length) allTxns.push(validTxns[i]);
            if (i < invalidTxns.length) allTxns.push(invalidTxns[i]);
          }

          const raw = makeExtractionResponse(allTxns);
          const validated = validateExtractionResult(raw);

          expect(validated.valid).toBe(true);
          expect(validated.result).not.toBeNull();

          // Valid transactions are kept
          expect(validated.result!.transactions.length).toBe(validTxns.length);

          // Invalid transactions are excluded
          expect(validated.excludedTransactions).toBe(invalidTxns.length);

          // Each excluded transaction produces a warning containing "excluded"
          const exclusionWarnings = validated.result!.warnings.filter((w) =>
            w.toLowerCase().includes('excluded'),
          );
          expect(exclusionWarnings.length).toBe(invalidTxns.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('invalid insights are excluded and each produces a warning', () => {
    fc.assert(
      fc.property(
        fc.array(validInsightArb, { minLength: 1, maxLength: 5 }),
        fc.array(invalidInsightArb, { minLength: 1, maxLength: 5 }),
        (validInsights, invalidInsights) => {
          // Interleave valid and invalid insights
          const allInsights: unknown[] = [];
          const maxLen = Math.max(validInsights.length, invalidInsights.length);
          for (let i = 0; i < maxLen; i++) {
            if (i < validInsights.length) allInsights.push(validInsights[i]);
            if (i < invalidInsights.length) allInsights.push(invalidInsights[i]);
          }

          const raw = makeInsightResponse(allInsights);
          const validated = validateInsightResult(raw);

          expect(validated.valid).toBe(true);
          expect(validated.result).not.toBeNull();

          // Valid insights are kept
          expect(validated.result!.insights.length).toBe(validInsights.length);

          // Invalid insights are excluded
          expect(validated.excludedInsights).toBe(invalidInsights.length);

          // Each excluded insight produces a warning containing "excluded"
          // Note: InsightResult has no warnings field; exclusion warnings live on
          // the ValidatedInsightResult.warnings array.
          const exclusionWarnings = validated.warnings.filter((w) =>
            w.toLowerCase().includes('excluded'),
          );
          expect(exclusionWarnings.length).toBe(invalidInsights.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
