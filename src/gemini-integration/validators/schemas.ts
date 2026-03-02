// Gemini Integration - Zod schemas for output validation
// Validates: Requirements 5.3, 10.1, 10.4

import { z } from 'zod';

/**
 * Schema for ExtractedTransaction output validation.
 *
 * Property 10: Output Validation Field Completeness
 * - date: parseable to a valid Date
 * - description: non-empty string
 * - amount: numeric value > 0
 * - type: either 'credit' or 'debit'
 * - confidence: integer between 0 and 100 inclusive
 */
export const extractedTransactionSchema = z.object({
  date: z
    .string()
    .min(1, 'Date must be a non-empty string')
    .refine(
      (val) => {
        const parsed = new Date(val);
        return !isNaN(parsed.getTime());
      },
      { message: 'Date must be parseable to a valid Date' },
    ),
  description: z.string().min(1, 'Description must be a non-empty string'),
  amount: z.number().positive('Amount must be greater than 0'),
  type: z.enum(['credit', 'debit'], {
    error: "Type must be either 'credit' or 'debit'",
  }),
  counterparty: z.string().optional(),
  reference: z.string().optional(),
  category_hint: z.string().optional(),
  confidence: z
    .number()
    .int('Confidence must be an integer')
    .min(0, 'Confidence must be at least 0')
    .max(100, 'Confidence must be at most 100'),
});

export type ValidatedExtractedTransaction = z.infer<typeof extractedTransactionSchema>;

/**
 * Schema for GeneratedInsight output validation.
 *
 * Property 11: Insight Validation Field Completeness
 * - type: one of tax_exposure, personal_spend, cashflow_risk, cost_optimization, revenue_opportunity
 * - severity: one of info, warning, alert
 * - title: non-empty string
 * - body: non-empty string
 */
export const generatedInsightSchema = z.object({
  type: z.enum(
    ['tax_exposure', 'personal_spend', 'cashflow_risk', 'cost_optimization', 'revenue_opportunity'],
    {
      error:
        'Type must be one of: tax_exposure, personal_spend, cashflow_risk, cost_optimization, revenue_opportunity',
    },
  ),
  severity: z.enum(['info', 'warning', 'alert'], {
    error: 'Severity must be one of: info, warning, alert',
  }),
  title: z.string().min(1, 'Title must be a non-empty string'),
  body: z.string().min(1, 'Body must be a non-empty string'),
  action_items: z.array(z.string()).optional(),
  related_transactions: z.array(z.string()).optional(),
});

export type ValidatedGeneratedInsight = z.infer<typeof generatedInsightSchema>;
