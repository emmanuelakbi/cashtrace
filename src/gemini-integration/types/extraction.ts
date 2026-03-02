// Gemini Integration - Extraction types

import type { GeminiModel } from './config.js';

export interface ExtractedTransaction {
  date: string;
  description: string;
  amount: number;
  type: 'credit' | 'debit';
  counterparty?: string;
  reference?: string;
  category_hint?: string;
  confidence: number; // 0-100
}

export interface ExtractionResult {
  transactions: ExtractedTransaction[];
  document_type: 'receipt' | 'bank_statement' | 'pos_export';
  extraction_confidence: number;
  warnings: string[];
  raw_text_preview?: string;
  metadata: ExtractionMetadata;
}

export interface ExtractionMetadata {
  model: GeminiModel;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  promptVersion: string;
  fallbackUsed: boolean;
}
