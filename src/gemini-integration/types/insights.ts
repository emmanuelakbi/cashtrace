// Gemini Integration - Insight types

import type { GeminiModel } from './config.js';

export type InsightType =
  | 'tax_exposure'
  | 'personal_spend'
  | 'cashflow_risk'
  | 'cost_optimization'
  | 'revenue_opportunity';

export type InsightSeverity = 'info' | 'warning' | 'alert';

export interface GeneratedInsight {
  type: InsightType;
  severity: InsightSeverity;
  title: string;
  body: string;
  action_items?: string[];
  related_transactions?: string[];
}

export interface InsightResult {
  insights: GeneratedInsight[];
  analysis_period: { start: string; end: string };
  confidence: number;
  metadata: InsightMetadata;
}

export interface InsightMetadata {
  model: GeminiModel;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  promptVersion: string;
  transactionsAnalyzed: number;
}

export interface BusinessContext {
  businessId: string;
  businessName: string;
  businessType: string;
  transactions: TransactionSummary[];
  period: { start: string; end: string };
  previousPeriodComparison?: TransactionSummary[];
  customPromptContext?: string;
}

export interface TransactionSummary {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: 'credit' | 'debit';
  category?: string;
  isPersonal?: boolean;
}
