// Insights Engine - Type definitions
// Barrel file for all insight type exports

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
} from './insight.js';

export { formatNaira, isValidKoboAmount, koboToNaira, nairaToKobo } from './insight.js';
