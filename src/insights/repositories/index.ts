// Insights Engine - Repositories
// Barrel file for insight repository exports

export const INSIGHTS_TABLE = 'insights' as const;
export const INSIGHT_TEMPLATES_TABLE = 'insight_templates' as const;
export const INSIGHT_PREFERENCES_TABLE = 'insight_preferences' as const;

export {
  bulkUpdateStatus,
  countActiveInsights,
  createInsightStore,
  deleteInsight,
  getActiveInsights,
  getExpiredInsights,
  getInsightById,
  getInsightsByBusiness,
  getInsightsByCategory,
  getInsightsByStatus,
  saveInsight,
  updateInsight,
} from './insightRepository.js';

export type { InsightStore } from './insightRepository.js';

export {
  cachedBulkUpdateStatus,
  cachedCountActiveInsights,
  cachedDeleteInsight,
  cachedGetActiveInsights,
  cachedGetInsightById,
  cachedGetInsightsByBusiness,
  cachedGetInsightsByCategory,
  cachedGetInsightsByStatus,
  cachedSaveInsight,
  cachedUpdateInsight,
  createCachedInsightStore,
  deserializeInsight,
  deserializeInsights,
  invalidateBusinessCache,
  invalidateInsightCache,
  keyForActiveCount,
  keyForActiveInsights,
  keyForBusinessInsights,
  keyForCategoryInsights,
  keyForInsight,
  keyForStatusInsights,
  serializeInsight,
  serializeInsights,
} from './insightCache.js';

export type { CachedInsightStore, InsightCacheConfig } from './insightCache.js';
