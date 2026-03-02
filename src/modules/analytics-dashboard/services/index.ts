/**
 * Barrel file for analytics-dashboard services.
 *
 * @module modules/analytics-dashboard/services
 */

export {
  cacheCategories,
  cacheCounterparties,
  cacheSummary,
  cacheTrends,
  generateCacheKey,
  getAffectedPeriodKeys,
  getCachedCategories,
  getCachedCounterparties,
  getCachedSummary,
  getCachedTrends,
  invalidateAffectedPeriods,
  invalidateBusinessCache,
} from './cacheService.js';

export {
  calculateComparison,
  calculateSummary,
  getSummaryWithComparison,
} from './summaryService.js';

export {
  determineGranularity,
  formatDataPointLabel,
  formatTrendDataPoints,
  getTrendData,
} from './trendService.js';

export {
  calculatePercentages,
  formatCategoryDisplay,
  getTopExpenseCategories,
} from './categoryService.js';

export {
  calculateCounterpartyPercentages,
  getTopCustomers,
  getTopVendors,
  mapRawToBreakdowns,
} from './counterpartyService.js';

export {
  onTransactionCreated,
  onTransactionDeleted,
  onTransactionUpdated,
} from './cacheInvalidationHandler.js';
