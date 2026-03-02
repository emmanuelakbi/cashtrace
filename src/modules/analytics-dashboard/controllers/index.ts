/**
 * Dashboard controllers barrel export.
 * Re-exports all controller implementations.
 *
 * @module modules/analytics-dashboard/controllers
 */

export {
  createDashboardRouter,
  dashboardErrorHandler,
  DashboardError,
} from './dashboardController.js';

export type { BusinessInfo, DashboardRouterDeps } from './dashboardController.js';
