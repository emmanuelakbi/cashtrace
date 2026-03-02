/**
 * Test fixture factory functions for the Insights Engine module.
 *
 * Provides `make*` factories for all insight-related types, following the
 * project convention of `Partial<T>` overrides with sensible defaults.
 *
 * @module insights/test/fixtures
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  ActionItem,
  AnalysisContext,
  BusinessProfile,
  DateRange,
  Insight,
  RawInsight,
  ScoredInsight,
  Transaction,
} from '../types/index.js';

// ─── Factory Functions ──────────────────────────────────────────────────────

/** Create a BusinessProfile with sensible Nigerian defaults. */
export function makeBusinessProfile(overrides: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    id: uuidv4(),
    name: 'Adebayo Stores Ltd',
    sector: 'retail',
    size: 'small',
    annualRevenueKobo: 15_000_000_00, // ₦15M in Kobo
    registeredWithCac: true,
    registeredWithFirs: true,
    vatRegistered: false,
    state: 'Lagos',
    createdAt: new Date('2023-01-15T09:00:00+01:00'),
    ...overrides,
  };
}

/** Create a Transaction with sensible defaults (Kobo amounts). */
export function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: uuidv4(),
    businessId: uuidv4(),
    type: 'credit',
    amountKobo: 250_000_00, // ₦250,000 in Kobo
    category: 'sales',
    description: 'Payment received for invoice #1042',
    reference: `TXN-${Date.now()}`,
    counterparty: 'Customer A',
    date: new Date('2024-06-15T14:30:00+01:00'),
    createdAt: new Date('2024-06-15T14:30:00+01:00'),
    ...overrides,
  };
}

/** Create an ActionItem with sensible defaults. */
export function makeActionItem(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    id: uuidv4(),
    description: 'Review your tax obligations on the FIRS portal',
    actionType: 'external_link',
    actionData: { url: 'https://firs.gov.ng' },
    completed: false,
    ...overrides,
  };
}

/** Create an Insight with sensible defaults. */
export function makeInsight(overrides: Partial<Insight> = {}): Insight {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

  return {
    id: uuidv4(),
    businessId: uuidv4(),
    category: 'tax',
    type: 'vat_liability',
    priority: 'high',
    status: 'active',
    title: 'VAT liability approaching threshold',
    body: 'Your quarterly revenue suggests potential VAT obligations. Review your tax position.',
    actionItems: [makeActionItem()],
    data: {
      amounts: [500_000_00],
      thresholds: { quarterly_vat: 500_000_00 },
    },
    score: 75,
    financialImpactKobo: 500_000_00, // ₦500,000 in Kobo
    createdAt: now,
    acknowledgedAt: null,
    acknowledgedBy: null,
    dismissedAt: null,
    dismissedBy: null,
    dismissReason: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNotes: null,
    expiresAt,
    ...overrides,
  };
}

/** Create a RawInsight with sensible defaults. */
export function makeRawInsight(overrides: Partial<RawInsight> = {}): RawInsight {
  return {
    category: 'cashflow',
    type: 'negative_projection',
    title: 'Cashflow risk detected for next 30 days',
    body: 'Based on current spending patterns, your cashflow may turn negative within 30 days.',
    data: {
      projectedShortfallKobo: 1_200_000_00,
      daysUntilNegative: 28,
    },
    actionItems: [makeActionItem({ description: 'Review upcoming expenses' })],
    financialImpact: 1_200_000_00, // ₦1.2M in Kobo
    urgency: 80,
    confidence: 70,
    ...overrides,
  };
}

/** Create a ScoredInsight with sensible defaults. */
export function makeScoredInsight(overrides: Partial<ScoredInsight> = {}): ScoredInsight {
  const raw = makeRawInsight(overrides);
  return {
    ...raw,
    score: 72,
    priority: 'high',
    factors: [
      { name: 'financialImpact', weight: 0.4, value: 80, contribution: 32 },
      { name: 'urgency', weight: 0.3, value: 80, contribution: 24 },
      { name: 'confidence', weight: 0.2, value: 70, contribution: 14 },
      { name: 'relevance', weight: 0.1, value: 20, contribution: 2 },
    ],
    ...overrides,
  };
}

/** Create an AnalysisContext with sensible defaults. */
export function makeAnalysisContext(overrides: Partial<AnalysisContext> = {}): AnalysisContext {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const businessId = overrides.businessId ?? uuidv4();

  return {
    businessId,
    businessProfile: makeBusinessProfile({ id: businessId }),
    transactions: [
      makeTransaction({ businessId, type: 'credit', amountKobo: 500_000_00 }),
      makeTransaction({ businessId, type: 'debit', amountKobo: 150_000_00 }),
      makeTransaction({ businessId, type: 'credit', amountKobo: 300_000_00 }),
    ],
    dateRange: { start: thirtyDaysAgo, end: now },
    previousInsights: [],
    ...overrides,
  };
}

/** Create a DateRange with sensible defaults. */
export function makeDateRange(overrides: Partial<DateRange> = {}): DateRange {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    start: thirtyDaysAgo,
    end: now,
    ...overrides,
  };
}
