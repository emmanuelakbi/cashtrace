/**
 * Core type definitions for the Insights Engine module.
 *
 * All financial amounts are stored in Kobo (integer) for precision.
 * All date/time references use WAT (West Africa Time, UTC+1).
 *
 * @module insights/types/insight
 */

// ─── Enums & Literal Unions ────────────────────────────────────────────────

export type InsightCategory =
  | 'tax'
  | 'compliance'
  | 'cashflow'
  | 'spending'
  | 'revenue'
  | 'operational';

export type InsightPriority = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type InsightStatus = 'active' | 'acknowledged' | 'dismissed' | 'resolved' | 'expired';

export type InsightType =
  | 'vat_liability'
  | 'negative_projection'
  | 'personal_spending'
  | 'cost_optimization'
  | 'revenue_opportunity'
  | 'compliance_deadline'
  | 'tax_filing_reminder'
  | 'cashflow_risk'
  | 'duplicate_subscription'
  | 'seasonal_pattern'
  | 'customer_retention'
  | 'sector_compliance'
  | 'withholding_tax'
  | 'vat_registration'
  | 'expense_spike'
  | 'high_value_customer'
  | 'top_performers';

export type BusinessSize = 'micro' | 'small' | 'medium';

export type NigerianSector =
  | 'retail'
  | 'services'
  | 'manufacturing'
  | 'agriculture'
  | 'technology'
  | 'healthcare'
  | 'education'
  | 'logistics'
  | 'hospitality';

// ─── Action Items ──────────────────────────────────────────────────────────

export interface ActionItem {
  id: string;
  description: string;
  actionType: 'navigate' | 'external_link' | 'api_call';
  actionData: Record<string, unknown>;
  completed: boolean;
}

export interface ActionItemTemplate {
  description: string;
  actionType: 'navigate' | 'external_link' | 'api_call';
  actionData: Record<string, unknown>;
}

// ─── Insight Data ──────────────────────────────────────────────────────────

export interface InsightData {
  transactions?: string[];
  amounts?: number[];
  dates?: string[];
  thresholds?: Record<string, number>;
  comparisons?: Record<string, unknown>;
}

// ─── Core Insight Entity ───────────────────────────────────────────────────

export interface Insight {
  id: string;
  businessId: string;
  category: InsightCategory;
  type: InsightType;
  priority: InsightPriority;
  status: InsightStatus;
  title: string;
  body: string;
  actionItems: ActionItem[];
  data: InsightData;
  score: number;
  financialImpactKobo: number;
  createdAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  dismissedAt: Date | null;
  dismissedBy: string | null;
  dismissReason: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionNotes: string | null;
  expiresAt: Date;
}

// ─── Analyzer Types ────────────────────────────────────────────────────────

export interface RawInsight {
  category: InsightCategory;
  type: InsightType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  actionItems: ActionItem[];
  financialImpact: number; // In Kobo
  urgency: number; // 0-100
  confidence: number; // 0-100
}

export interface ScoreFactor {
  name: string;
  weight: number;
  value: number;
  contribution: number;
}

export interface ScoredInsight extends RawInsight {
  score: number;
  priority: InsightPriority;
  factors: ScoreFactor[];
}

// ─── Business Context ──────────────────────────────────────────────────────

export interface BusinessProfile {
  id: string;
  name: string;
  sector: NigerianSector;
  size: BusinessSize;
  annualRevenueKobo: number;
  registeredWithCac: boolean;
  registeredWithFirs: boolean;
  vatRegistered: boolean;
  state: string;
  createdAt: Date;
}

export interface Transaction {
  id: string;
  businessId: string;
  type: 'credit' | 'debit';
  amountKobo: number;
  category: string;
  description: string;
  reference: string;
  counterparty: string;
  date: Date;
  createdAt: Date;
}

export interface DateRange {
  start: Date;
  end: Date;
}

// ─── Events & Analysis ─────────────────────────────────────────────────────

export interface BusinessEvent {
  type: 'transaction_created' | 'document_processed' | 'threshold_crossed';
  businessId: string;
  data: Record<string, unknown>;
  timestamp: Date;
}

export interface AnalysisContext {
  businessId: string;
  businessProfile: BusinessProfile;
  transactions: Transaction[];
  dateRange: DateRange;
  previousInsights: Insight[];
}

export interface DataRequirement {
  source: string;
  fields: string[];
  required: boolean;
}

// ─── Scoring Context ───────────────────────────────────────────────────────

export interface UserEngagement {
  viewRate: number;
  acknowledgeRate: number;
  dismissRate: number;
  resolveRate: number;
  avgResponseTimeMs: number;
}

export interface ScoringContext {
  businessSize: BusinessSize;
  userEngagement: UserEngagement;
  existingInsights: Insight[];
}

// ─── Templates ─────────────────────────────────────────────────────────────

export interface TemplateVariable {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
}

export interface InsightTemplate {
  id: string;
  version: string;
  category: InsightCategory;
  type: InsightType;
  titleTemplate: string;
  bodyTemplate: string;
  actionItemTemplates: ActionItemTemplate[];
  variables: TemplateVariable[];
  locale: 'en' | 'pcm';
}

// ─── Kobo Utilities ────────────────────────────────────────────────────────

/**
 * Convert Naira to Kobo. Multiplies by 100 and rounds to the nearest integer
 * to avoid floating-point drift.
 */
export function nairaToKobo(naira: number): number {
  return Math.round(naira * 100);
}

/** Convert Kobo to Naira. */
export function koboToNaira(kobo: number): number {
  return kobo / 100;
}

/** Format a Kobo amount as a Naira string, e.g. "₦1,250,000.50". */
export function formatNaira(kobo: number): string {
  const naira = kobo / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Returns `true` when the amount is a non-negative integer (valid Kobo). */
export function isValidKoboAmount(amount: number): boolean {
  return Number.isInteger(amount) && amount >= 0;
}
