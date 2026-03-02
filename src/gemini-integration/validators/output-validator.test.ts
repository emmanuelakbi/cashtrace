// Gemini Integration - Unit tests for output-validator
// Validates: Requirements 10.1, 10.2, 10.3, 10.6

import { describe, expect, it } from 'vitest';

import { validateExtractionResult, validateInsightResult } from './output-validator.js';

/**
 * Helper to build a valid raw extraction response for testing.
 */
function makeRawExtractionResponse(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    transactions: [
      {
        date: '2024-01-15',
        description: 'Office supplies',
        amount: 5000,
        type: 'debit',
        confidence: 85,
      },
    ],
    document_type: 'receipt',
    extraction_confidence: 90,
    warnings: [],
    metadata: {
      model: 'gemini-2.0-flash',
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 1200,
      promptVersion: 'v1.0',
      fallbackUsed: false,
    },
    ...overrides,
  };
}

describe('validateExtractionResult', () => {
  describe('valid responses', () => {
    it('should accept a fully valid extraction response', () => {
      const raw = makeRawExtractionResponse();
      const result = validateExtractionResult(raw);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.excludedTransactions).toBe(0);
      expect(result.result).not.toBeNull();
      expect(result.result!.transactions).toHaveLength(1);
      expect(result.result!.document_type).toBe('receipt');
      expect(result.result!.extraction_confidence).toBe(90);
    });

    it('should accept response with multiple valid transactions', () => {
      const raw = makeRawExtractionResponse({
        transactions: [
          {
            date: '2024-01-15',
            description: 'Office supplies',
            amount: 5000,
            type: 'debit',
            confidence: 85,
          },
          {
            date: '2024-02-01',
            description: 'Client payment',
            amount: 150000,
            type: 'credit',
            counterparty: 'Acme Ltd',
            reference: 'INV-001',
            category_hint: 'REVENUE',
            confidence: 95,
          },
        ],
      });
      const result = validateExtractionResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.transactions).toHaveLength(2);
      expect(result.excludedTransactions).toBe(0);
    });

    it('should accept response with empty transactions array', () => {
      const raw = makeRawExtractionResponse({ transactions: [] });
      const result = validateExtractionResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.transactions).toHaveLength(0);
      expect(result.excludedTransactions).toBe(0);
    });

    it('should preserve raw_text_preview when present', () => {
      const raw = makeRawExtractionResponse({ raw_text_preview: 'First 200 chars...' });
      const result = validateExtractionResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.raw_text_preview).toBe('First 200 chars...');
    });

    it('should preserve original warnings from Gemini response', () => {
      const raw = makeRawExtractionResponse({
        warnings: ['Low image quality', 'Partial text detected'],
      });
      const result = validateExtractionResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.warnings).toContain('Low image quality');
      expect(result.result!.warnings).toContain('Partial text detected');
    });
  });

  describe('invalid top-level structure', () => {
    it('should reject null input', () => {
      const result = validateExtractionResult(null);

      expect(result.valid).toBe(false);
      expect(result.result).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.code).toBe('INVALID_RESPONSE');
    });

    it('should reject undefined input', () => {
      const result = validateExtractionResult(undefined);

      expect(result.valid).toBe(false);
      expect(result.result).toBeNull();
    });

    it('should reject non-object input', () => {
      const result = validateExtractionResult('not an object');

      expect(result.valid).toBe(false);
      expect(result.result).toBeNull();
      expect(result.errors[0]!.code).toBe('INVALID_RESPONSE');
    });

    it('should reject response without transactions array', () => {
      const result = validateExtractionResult({
        document_type: 'receipt',
        extraction_confidence: 90,
      });

      expect(result.valid).toBe(false);
      expect(result.result).toBeNull();
      expect(result.errors.some((e) => e.field === 'transactions')).toBe(true);
    });

    it('should reject response with invalid document_type', () => {
      const raw = makeRawExtractionResponse({ document_type: 'invoice' });
      const result = validateExtractionResult(raw);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'document_type')).toBe(true);
    });
  });

  describe('transaction validation and exclusion', () => {
    it('should exclude transaction with unparseable date', () => {
      const raw = makeRawExtractionResponse({
        transactions: [
          {
            date: 'not-a-date',
            description: 'Test',
            amount: 100,
            type: 'debit',
            confidence: 50,
          },
        ],
      });
      const result = validateExtractionResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.transactions).toHaveLength(0);
      expect(result.excludedTransactions).toBe(1);
      expect(result.warnings.some((w) => w.includes('index 0'))).toBe(true);
    });

    it('should exclude transaction with non-positive amount', () => {
      const raw = makeRawExtractionResponse({
        transactions: [
          {
            date: '2024-01-15',
            description: 'Test',
            amount: -500,
            type: 'debit',
            confidence: 50,
          },
        ],
      });
      const result = validateExtractionResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.transactions).toHaveLength(0);
      expect(result.excludedTransactions).toBe(1);
    });

    it('should exclude transaction with invalid type', () => {
      const raw = makeRawExtractionResponse({
        transactions: [
          {
            date: '2024-01-15',
            description: 'Test',
            amount: 100,
            type: 'transfer',
            confidence: 50,
          },
        ],
      });
      const result = validateExtractionResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.transactions).toHaveLength(0);
      expect(result.excludedTransactions).toBe(1);
    });

    it('should exclude transaction with out-of-range confidence', () => {
      const raw = makeRawExtractionResponse({
        transactions: [
          {
            date: '2024-01-15',
            description: 'Test',
            amount: 100,
            type: 'debit',
            confidence: 150,
          },
        ],
      });
      const result = validateExtractionResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.transactions).toHaveLength(0);
      expect(result.excludedTransactions).toBe(1);
    });

    it('should exclude transaction with missing description', () => {
      const raw = makeRawExtractionResponse({
        transactions: [
          {
            date: '2024-01-15',
            description: '',
            amount: 100,
            type: 'debit',
            confidence: 50,
          },
        ],
      });
      const result = validateExtractionResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.transactions).toHaveLength(0);
      expect(result.excludedTransactions).toBe(1);
    });

    it('should keep valid transactions and exclude invalid ones', () => {
      const raw = makeRawExtractionResponse({
        transactions: [
          {
            date: '2024-01-15',
            description: 'Valid transaction',
            amount: 5000,
            type: 'debit',
            confidence: 85,
          },
          {
            date: 'bad-date',
            description: 'Invalid transaction',
            amount: 100,
            type: 'debit',
            confidence: 50,
          },
          {
            date: '2024-02-01',
            description: 'Another valid one',
            amount: 10000,
            type: 'credit',
            confidence: 90,
          },
        ],
      });
      const result = validateExtractionResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.transactions).toHaveLength(2);
      expect(result.excludedTransactions).toBe(1);
      expect(result.warnings.some((w) => w.includes('index 1'))).toBe(true);
    });
  });

  describe('metadata handling', () => {
    it('should use defaults when metadata is missing', () => {
      const raw = makeRawExtractionResponse({ metadata: undefined });
      const result = validateExtractionResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.metadata.model).toBe('gemini-2.0-flash');
      expect(result.result!.metadata.promptVersion).toBe('unknown');
      expect(result.result!.metadata.fallbackUsed).toBe(false);
    });

    it('should use defaults for invalid metadata fields', () => {
      const raw = makeRawExtractionResponse({
        metadata: { model: 'invalid-model', inputTokens: -5 },
      });
      const result = validateExtractionResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.metadata.model).toBe('gemini-2.0-flash');
      expect(result.result!.metadata.inputTokens).toBe(0);
    });
  });

  describe('extraction_confidence handling', () => {
    it('should default to 0 when extraction_confidence is missing', () => {
      const raw = makeRawExtractionResponse({ extraction_confidence: undefined });
      const result = validateExtractionResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.extraction_confidence).toBe(0);
      expect(result.warnings.some((w) => w.includes('extraction_confidence'))).toBe(true);
    });

    it('should default to 0 when extraction_confidence is out of range', () => {
      const raw = makeRawExtractionResponse({ extraction_confidence: 200 });
      const result = validateExtractionResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.extraction_confidence).toBe(0);
    });
  });
});

// Validates: Requirements 10.4, 10.5, 10.6

/**
 * Helper to build a valid raw insight response for testing.
 */
function makeRawInsightResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    insights: [
      {
        type: 'tax_exposure',
        severity: 'warning',
        title: 'Potential VAT Liability',
        body: 'Your monthly revenue exceeds the VAT threshold.',
        action_items: ['Register for VAT', 'Consult tax advisor'],
        related_transactions: ['txn_001'],
      },
    ],
    analysis_period: { start: '2024-01-01', end: '2024-03-31' },
    confidence: 85,
    metadata: {
      model: 'gemini-2.0-flash',
      inputTokens: 200,
      outputTokens: 150,
      latencyMs: 2500,
      promptVersion: 'v1.0',
      transactionsAnalyzed: 42,
    },
    ...overrides,
  };
}

describe('validateInsightResult', () => {
  describe('valid responses', () => {
    it('should accept a fully valid insight response', () => {
      const raw = makeRawInsightResponse();
      const result = validateInsightResult(raw);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.excludedInsights).toBe(0);
      expect(result.result).not.toBeNull();
      expect(result.result!.insights).toHaveLength(1);
      expect(result.result!.insights[0]!.type).toBe('tax_exposure');
      expect(result.result!.insights[0]!.severity).toBe('warning');
      expect(result.result!.analysis_period).toEqual({ start: '2024-01-01', end: '2024-03-31' });
      expect(result.result!.confidence).toBe(85);
    });

    it('should accept response with multiple valid insights', () => {
      const raw = makeRawInsightResponse({
        insights: [
          {
            type: 'tax_exposure',
            severity: 'warning',
            title: 'VAT Liability',
            body: 'Revenue exceeds threshold.',
          },
          {
            type: 'cashflow_risk',
            severity: 'alert',
            title: 'Cash Flow Gap',
            body: 'Projected shortfall next month.',
            action_items: ['Reduce expenses'],
          },
          {
            type: 'revenue_opportunity',
            severity: 'info',
            title: 'New Market',
            body: 'Consider expanding to Lagos.',
          },
        ],
      });
      const result = validateInsightResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.insights).toHaveLength(3);
      expect(result.excludedInsights).toBe(0);
    });

    it('should accept response with empty insights array', () => {
      const raw = makeRawInsightResponse({ insights: [] });
      const result = validateInsightResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.insights).toHaveLength(0);
      expect(result.excludedInsights).toBe(0);
    });

    it('should accept all valid insight types', () => {
      const types = [
        'tax_exposure',
        'personal_spend',
        'cashflow_risk',
        'cost_optimization',
        'revenue_opportunity',
      ] as const;

      for (const type of types) {
        const raw = makeRawInsightResponse({
          insights: [{ type, severity: 'info', title: 'Test', body: 'Test body' }],
        });
        const result = validateInsightResult(raw);
        expect(result.valid).toBe(true);
        expect(result.result!.insights[0]!.type).toBe(type);
      }
    });

    it('should accept all valid severity levels', () => {
      const severities = ['info', 'warning', 'alert'] as const;

      for (const severity of severities) {
        const raw = makeRawInsightResponse({
          insights: [{ type: 'tax_exposure', severity, title: 'Test', body: 'Test body' }],
        });
        const result = validateInsightResult(raw);
        expect(result.valid).toBe(true);
        expect(result.result!.insights[0]!.severity).toBe(severity);
      }
    });
  });

  describe('invalid top-level structure', () => {
    it('should reject null input', () => {
      const result = validateInsightResult(null);

      expect(result.valid).toBe(false);
      expect(result.result).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.code).toBe('INVALID_RESPONSE');
    });

    it('should reject undefined input', () => {
      const result = validateInsightResult(undefined);

      expect(result.valid).toBe(false);
      expect(result.result).toBeNull();
    });

    it('should reject non-object input', () => {
      const result = validateInsightResult('not an object');

      expect(result.valid).toBe(false);
      expect(result.result).toBeNull();
      expect(result.errors[0]!.code).toBe('INVALID_RESPONSE');
    });

    it('should reject response without insights array', () => {
      const result = validateInsightResult({
        analysis_period: { start: '2024-01-01', end: '2024-03-31' },
        confidence: 85,
      });

      expect(result.valid).toBe(false);
      expect(result.result).toBeNull();
      expect(result.errors.some((e) => e.field === 'insights')).toBe(true);
    });

    it('should reject response without analysis_period', () => {
      const raw = makeRawInsightResponse({ analysis_period: undefined });
      const result = validateInsightResult(raw);

      expect(result.valid).toBe(false);
      expect(result.result).toBeNull();
      expect(result.errors.some((e) => e.field === 'analysis_period')).toBe(true);
    });

    it('should reject response with empty analysis_period.start', () => {
      const raw = makeRawInsightResponse({
        analysis_period: { start: '', end: '2024-03-31' },
      });
      const result = validateInsightResult(raw);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'analysis_period.start')).toBe(true);
    });

    it('should reject response with empty analysis_period.end', () => {
      const raw = makeRawInsightResponse({
        analysis_period: { start: '2024-01-01', end: '' },
      });
      const result = validateInsightResult(raw);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'analysis_period.end')).toBe(true);
    });
  });

  describe('insight validation and exclusion', () => {
    it('should exclude insight with invalid type', () => {
      const raw = makeRawInsightResponse({
        insights: [
          {
            type: 'unknown_type',
            severity: 'info',
            title: 'Test',
            body: 'Test body',
          },
        ],
      });
      const result = validateInsightResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.insights).toHaveLength(0);
      expect(result.excludedInsights).toBe(1);
      expect(result.warnings.some((w) => w.includes('index 0'))).toBe(true);
    });

    it('should exclude insight with invalid severity', () => {
      const raw = makeRawInsightResponse({
        insights: [
          {
            type: 'tax_exposure',
            severity: 'critical',
            title: 'Test',
            body: 'Test body',
          },
        ],
      });
      const result = validateInsightResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.insights).toHaveLength(0);
      expect(result.excludedInsights).toBe(1);
    });

    it('should exclude insight with empty title', () => {
      const raw = makeRawInsightResponse({
        insights: [
          {
            type: 'tax_exposure',
            severity: 'info',
            title: '',
            body: 'Test body',
          },
        ],
      });
      const result = validateInsightResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.insights).toHaveLength(0);
      expect(result.excludedInsights).toBe(1);
    });

    it('should exclude insight with empty body', () => {
      const raw = makeRawInsightResponse({
        insights: [
          {
            type: 'tax_exposure',
            severity: 'info',
            title: 'Test',
            body: '',
          },
        ],
      });
      const result = validateInsightResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.insights).toHaveLength(0);
      expect(result.excludedInsights).toBe(1);
    });

    it('should keep valid insights and exclude invalid ones', () => {
      const raw = makeRawInsightResponse({
        insights: [
          {
            type: 'tax_exposure',
            severity: 'warning',
            title: 'Valid insight',
            body: 'This is valid.',
          },
          {
            type: 'bad_type',
            severity: 'info',
            title: 'Invalid insight',
            body: 'Bad type.',
          },
          {
            type: 'cashflow_risk',
            severity: 'alert',
            title: 'Another valid one',
            body: 'Also valid.',
          },
        ],
      });
      const result = validateInsightResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.insights).toHaveLength(2);
      expect(result.excludedInsights).toBe(1);
      expect(result.warnings.some((w) => w.includes('index 1'))).toBe(true);
    });

    it('should exclude insight missing required fields entirely', () => {
      const raw = makeRawInsightResponse({
        insights: [{ type: 'tax_exposure' }],
      });
      const result = validateInsightResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.insights).toHaveLength(0);
      expect(result.excludedInsights).toBe(1);
    });
  });

  describe('metadata handling', () => {
    it('should use defaults when metadata is missing', () => {
      const raw = makeRawInsightResponse({ metadata: undefined });
      const result = validateInsightResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.metadata.model).toBe('gemini-2.0-flash');
      expect(result.result!.metadata.promptVersion).toBe('unknown');
      expect(result.result!.metadata.transactionsAnalyzed).toBe(0);
    });

    it('should use defaults for invalid metadata fields', () => {
      const raw = makeRawInsightResponse({
        metadata: { model: 'invalid-model', transactionsAnalyzed: -5 },
      });
      const result = validateInsightResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.metadata.model).toBe('gemini-2.0-flash');
      expect(result.result!.metadata.transactionsAnalyzed).toBe(0);
    });

    it('should accept valid metadata fields', () => {
      const raw = makeRawInsightResponse({
        metadata: {
          model: 'gemini-2.0-pro',
          inputTokens: 500,
          outputTokens: 300,
          latencyMs: 3000,
          promptVersion: 'v2.1',
          transactionsAnalyzed: 100,
        },
      });
      const result = validateInsightResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.metadata.model).toBe('gemini-2.0-pro');
      expect(result.result!.metadata.inputTokens).toBe(500);
      expect(result.result!.metadata.outputTokens).toBe(300);
      expect(result.result!.metadata.latencyMs).toBe(3000);
      expect(result.result!.metadata.promptVersion).toBe('v2.1');
      expect(result.result!.metadata.transactionsAnalyzed).toBe(100);
    });
  });

  describe('confidence handling', () => {
    it('should default to 0 when confidence is missing', () => {
      const raw = makeRawInsightResponse({ confidence: undefined });
      const result = validateInsightResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.confidence).toBe(0);
      expect(result.warnings.some((w) => w.includes('confidence'))).toBe(true);
    });

    it('should default to 0 when confidence is out of range', () => {
      const raw = makeRawInsightResponse({ confidence: 200 });
      const result = validateInsightResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.confidence).toBe(0);
    });

    it('should default to 0 when confidence is not an integer', () => {
      const raw = makeRawInsightResponse({ confidence: 85.5 });
      const result = validateInsightResult(raw);

      expect(result.valid).toBe(true);
      expect(result.result!.confidence).toBe(0);
    });
  });
});
