/**
 * Dashboard repositories barrel export.
 * Re-exports all repository implementations.
 *
 * @module modules/analytics-dashboard/repositories
 */

export {
  getCategoryAggregations,
  getCounterpartyAggregations,
  getSummaryAggregations,
  getTrendAggregations,
  shouldIncludeTransaction,
} from './aggregationRepository.js';
