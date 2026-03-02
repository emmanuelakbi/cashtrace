/**
 * Insight Generator for the Insights Engine.
 *
 * Orchestrates all analyzers, applies personalization based on business
 * profile (sector, size), scores insights, filters dismissed ones, and
 * enforces the 10-insight limit.
 *
 * **Validates: Requirements 9.1, 9.5**
 *
 * @module insights/services/insightGenerator
 */

import type {
  AnalysisContext,
  BusinessEvent,
  DataRequirement,
  Insight,
  InsightCategory,
  InsightPriority,
  NigerianSector,
  RawInsight,
  ScoredInsight,
  ScoringContext,
  UserEngagement,
} from '../types/index.js';

import { DismissalCooldownTracker } from './dismissalCooldown.js';
import { InsightLimitEnforcer } from './insightLimiter.js';
import { PriorityScorer } from './priorityScorer.js';

// ─── Analyzer Interface ────────────────────────────────────────────────────

/** Common interface shared by all analyzers. */
export interface InsightAnalyzer {
  analyze(context: AnalysisContext): Promise<RawInsight[]>;
  getCategory(): InsightCategory;
  getRequiredData(): DataRequirement[];
}

// ─── Constants ─────────────────────────────────────────────────────────────

/**
 * Priority rank — lower number means higher priority.
 * Used for sorting scored insights before limit enforcement.
 */
const PRIORITY_RANK: Record<InsightPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/**
 * Sectors where tax analysis is less relevant.
 * These sectors typically have simpler tax obligations or are exempt
 * from certain tax requirements.
 *
 * **Validates: Requirement 9.1**
 */
const TAX_EXEMPT_SECTORS: ReadonlySet<NigerianSector> = new Set<NigerianSector>([
  'education',
  'healthcare',
]);

/**
 * Maps business event types to the analyzer categories that should run.
 *
 * - `transaction_created` → transaction-related analyzers
 * - `document_processed` → compliance checks
 * - `threshold_crossed`  → all analyzers (significant business event)
 *
 * **Validates: Requirement 10.4**
 */
const EVENT_CATEGORY_MAP: ReadonlyMap<
  BusinessEvent['type'],
  ReadonlySet<InsightCategory>
> = new Map([
  ['transaction_created', new Set<InsightCategory>(['cashflow', 'spending', 'tax', 'revenue'])],
  ['document_processed', new Set<InsightCategory>(['compliance'])],
  [
    'threshold_crossed',
    new Set<InsightCategory>([
      'cashflow',
      'spending',
      'tax',
      'revenue',
      'compliance',
      'operational',
    ]),
  ],
]);

/**
 * Default user engagement values for businesses without engagement history.
 */
const DEFAULT_USER_ENGAGEMENT: UserEngagement = {
  viewRate: 0.5,
  acknowledgeRate: 0.3,
  dismissRate: 0.1,
  resolveRate: 0.2,
  avgResponseTimeMs: 86_400_000, // 1 day
};

// ─── InsightGenerator ──────────────────────────────────────────────────────

export class InsightGenerator {
  private readonly analyzers: InsightAnalyzer[];
  private readonly scorer: PriorityScorer;
  private readonly limiter: InsightLimitEnforcer;
  private readonly cooldownTracker: DismissalCooldownTracker;

  constructor(deps: {
    analyzers: InsightAnalyzer[];
    scorer: PriorityScorer;
    limiter: InsightLimitEnforcer;
    cooldownTracker: DismissalCooldownTracker;
  }) {
    this.analyzers = deps.analyzers;
    this.scorer = deps.scorer;
    this.limiter = deps.limiter;
    this.cooldownTracker = deps.cooldownTracker;
  }

  /**
   * Generate insights for a business by running all applicable analyzers.
   *
   * Pipeline:
   * 1. Filter analyzers by sector relevance (Req 9.1)
   * 2. Run applicable analyzers in parallel
   * 3. Score each raw insight using PriorityScorer (Req 9.5 — size context)
   * 4. Filter out dismissed insights via DismissalCooldownTracker
   * 5. Sort by priority then score
   * 6. Enforce the 10-insight limit via InsightLimitEnforcer
   *
   * **Validates: Requirements 9.1, 9.5**
   */
  async generateForBusiness(context: AnalysisContext): Promise<ScoredInsight[]> {
    // Step 1 — filter analyzers by sector relevance
    const applicableAnalyzers = this.getApplicableAnalyzers(context.businessProfile.sector);

    // Step 2 — run all applicable analyzers in parallel
    const analyzerResults = await Promise.all(
      applicableAnalyzers.map((analyzer) => analyzer.analyze(context)),
    );
    const rawInsights = analyzerResults.flat();

    // Step 3 — score each raw insight
    const scoringContext = this.buildScoringContext(context);
    const scoredInsights = rawInsights.map((raw) => this.scorer.score(raw, scoringContext));

    // Step 4 — filter out dismissed insights
    const filtered = scoredInsights.filter(
      (insight) => !this.cooldownTracker.isSuppressed(context.businessId, insight.type),
    );

    // Step 5 — sort by priority (highest first) then by score (highest first)
    const sorted = [...filtered].sort((a, b) => {
      const priorityDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.score - a.score;
    });

    // Step 6 — enforce the 10-insight limit
    // Convert ScoredInsights to Insight-like objects for the limiter
    const asInsights = sorted.map((s) => this.scoredToInsight(s, context.businessId));
    const { active } = this.limiter.enforce(asInsights);

    // Map back to ScoredInsight by matching on title+type (preserving order)
    const activeSet = new Set(active.map((i) => `${i.type}:${i.title}`));
    return sorted.filter((s) => activeSet.has(`${s.type}:${s.title}`));
  }

  /**
   * Generate insights for a specific category only.
   *
   * Runs only the analyzer matching the requested category.
   * Still applies scoring, dismissal filtering, and sorting.
   *
   * **Validates: Requirements 9.1, 9.5**
   */
  async generateByCategory(
    context: AnalysisContext,
    category: InsightCategory,
  ): Promise<ScoredInsight[]> {
    const analyzer = this.analyzers.find((a) => a.getCategory() === category);
    if (!analyzer) {
      return [];
    }

    // Check sector relevance for the requested category
    if (!this.isCategoryRelevantForSector(category, context.businessProfile.sector)) {
      return [];
    }

    const rawInsights = await analyzer.analyze(context);

    const scoringContext = this.buildScoringContext(context);
    const scoredInsights = rawInsights.map((raw) => this.scorer.score(raw, scoringContext));

    const filtered = scoredInsights.filter(
      (insight) => !this.cooldownTracker.isSuppressed(context.businessId, insight.type),
    );

    return [...filtered].sort((a, b) => {
      const priorityDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.score - a.score;
    });
  }

  /**
   * Evaluate a real-time business event and return relevant insights.
   *
   * Only runs analyzers relevant to the event type (e.g. transaction events
   * trigger cashflow/spending/tax/revenue analyzers, document events trigger
   * compliance). Applies the same scoring, dismissal filtering, and sorting
   * pipeline as {@link generateForBusiness}.
   *
   * **Validates: Requirement 10.4**
   */
  async evaluateRealTime(context: AnalysisContext, event: BusinessEvent): Promise<ScoredInsight[]> {
    const relevantCategories = EVENT_CATEGORY_MAP.get(event.type);
    if (!relevantCategories) {
      return [];
    }

    // Filter analyzers by event relevance AND sector relevance
    const applicableAnalyzers = this.analyzers.filter(
      (analyzer) =>
        relevantCategories.has(analyzer.getCategory()) &&
        this.isCategoryRelevantForSector(analyzer.getCategory(), context.businessProfile.sector),
    );

    if (applicableAnalyzers.length === 0) {
      return [];
    }

    // Run applicable analyzers in parallel
    const analyzerResults = await Promise.all(
      applicableAnalyzers.map((analyzer) => analyzer.analyze(context)),
    );
    const rawInsights = analyzerResults.flat();

    // Score, filter dismissed, sort
    const scoringContext = this.buildScoringContext(context);
    const scoredInsights = rawInsights.map((raw) => this.scorer.score(raw, scoringContext));

    const filtered = scoredInsights.filter(
      (insight) => !this.cooldownTracker.isSuppressed(context.businessId, insight.type),
    );

    return [...filtered].sort((a, b) => {
      const priorityDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.score - a.score;
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /**
   * Filter analyzers to only those relevant for the given sector.
   *
   * **Validates: Requirement 9.1**
   */
  private getApplicableAnalyzers(sector: NigerianSector): InsightAnalyzer[] {
    return this.analyzers.filter((analyzer) =>
      this.isCategoryRelevantForSector(analyzer.getCategory(), sector),
    );
  }

  /**
   * Determine whether an insight category is relevant for a given sector.
   *
   * - Tax insights are skipped for education and healthcare sectors
   *   (these sectors have different tax treatment in Nigeria).
   * - All other categories are relevant for all sectors.
   *
   * **Validates: Requirement 9.1**
   */
  private isCategoryRelevantForSector(category: InsightCategory, sector: NigerianSector): boolean {
    if (category === 'tax' && TAX_EXEMPT_SECTORS.has(sector)) {
      return false;
    }
    return true;
  }

  /**
   * Build a ScoringContext from the AnalysisContext.
   *
   * Uses the business size from the profile (Req 9.5) and defaults
   * for user engagement when no history is available.
   *
   * **Validates: Requirement 9.5**
   */
  private buildScoringContext(context: AnalysisContext): ScoringContext {
    return {
      businessSize: context.businessProfile.size,
      userEngagement: DEFAULT_USER_ENGAGEMENT,
      existingInsights: context.previousInsights,
    };
  }

  /**
   * Convert a ScoredInsight to an Insight object for the limiter.
   * Creates a minimal Insight with the fields the limiter needs.
   */
  private scoredToInsight(scored: ScoredInsight, businessId: string): Insight {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    return {
      id: `gen-${scored.type}-${Date.now()}`,
      businessId,
      category: scored.category,
      type: scored.type,
      priority: scored.priority,
      status: 'active',
      title: scored.title,
      body: scored.body,
      actionItems: scored.actionItems,
      data: scored.data as Insight['data'],
      score: scored.score,
      financialImpactKobo: scored.financialImpact,
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
    };
  }

  /**
   * Refresh all insights for a business by regenerating them.
   * Convenience method matching the design doc InsightGenerator interface.
   */
  async refreshInsights(context: AnalysisContext): Promise<void> {
    await this.generateForBusiness(context);
  }
}
