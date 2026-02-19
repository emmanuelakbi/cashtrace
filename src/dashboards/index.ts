/**
 * Dashboards Module
 *
 * Provides Grafana dashboard JSON definitions for CashTrace observability.
 * Dashboards cover API performance, database health, business metrics, and SLO tracking.
 */

export {
  type GrafanaDashboard,
  type TemplateVariable,
  type Panel,
  type PanelTarget,
  createApiPerformanceDashboard,
  createDatabaseHealthDashboard,
  createBusinessMetricsDashboard,
  getAllDashboards,
} from './dashboardDefinitions.js';

export {
  type SloType,
  type SloConfig,
  type SloStatus,
  type SloTracker,
  createSloTracker,
  createAvailabilitySloConfig,
  createLatencySloConfig,
} from './sloTracking.js';

export {
  type AnnotationType,
  type IncidentSeverity,
  type IncidentStatus,
  type DeploymentMetadata,
  type IncidentMetadata,
  type Annotation,
  type GrafanaAnnotationPayload,
  type AnnotationDisplayEntry,
  type AnnotationManager,
  createAnnotationManager,
} from './annotations.js';
