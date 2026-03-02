// Insights Engine - Test utilities
// Barrel file re-exporting test fixtures and helpers

export {
  makeActionItem,
  makeAnalysisContext,
  makeBusinessProfile,
  makeDateRange,
  makeInsight,
  makeRawInsight,
  makeScoredInsight,
  makeTransaction,
} from './fixtures.js';

// Re-export types from the canonical types module
export type {
  ActionItem,
  ActionItemTemplate,
  AnalysisContext,
  BusinessEvent,
  BusinessProfile,
  BusinessSize,
  DataRequirement,
  DateRange,
  Insight,
  InsightCategory,
  InsightData,
  InsightPriority,
  InsightStatus,
  InsightTemplate,
  InsightType,
  NigerianSector,
  RawInsight,
  ScoreFactor,
  ScoredInsight,
  ScoringContext,
  TemplateVariable,
  Transaction,
  UserEngagement,
} from '../types/index.js';
