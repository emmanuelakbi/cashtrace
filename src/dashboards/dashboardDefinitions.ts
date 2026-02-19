/**
 * Grafana Dashboard Definitions
 *
 * Generates JSON-serializable Grafana dashboard definitions for CashTrace.
 * Covers API performance, database health, and business metrics.
 *
 * Requirements:
 *   7.1 - Provide dashboard definitions for Grafana
 *   7.2 - Include dashboards for API performance, database health, business metrics
 *   7.3 - Support dashboard variables for filtering by environment and service
 */

// --- Grafana JSON model interfaces ---

export interface GrafanaDashboard {
  uid: string;
  title: string;
  description: string;
  tags: string[];
  timezone: string;
  editable: boolean;
  refresh: string;
  time: { from: string; to: string };
  templating: { list: TemplateVariable[] };
  panels: Panel[];
}

export interface TemplateVariable {
  name: string;
  label: string;
  type: string;
  query: string;
  datasource: string;
  refresh: number;
  includeAll: boolean;
  multi: boolean;
  current: { text: string; value: string };
}

export interface Panel {
  id: number;
  title: string;
  type: string;
  gridPos: { h: number; w: number; x: number; y: number };
  targets: PanelTarget[];
  fieldConfig?: Record<string, unknown>;
}

export interface PanelTarget {
  expr: string;
  legendFormat: string;
  refId: string;
}

// --- Shared helpers ---

function envAndServiceVars(): TemplateVariable[] {
  return [
    {
      name: 'environment',
      label: 'Environment',
      type: 'query',
      query: 'label_values(up, environment)',
      datasource: 'Prometheus',
      refresh: 2,
      includeAll: true,
      multi: true,
      current: { text: 'All', value: '$__all' },
    },
    {
      name: 'service',
      label: 'Service',
      type: 'query',
      query: 'label_values(up, service)',
      datasource: 'Prometheus',
      refresh: 2,
      includeAll: true,
      multi: true,
      current: { text: 'All', value: '$__all' },
    },
  ];
}

function baseDashboard(
  uid: string,
  title: string,
  description: string,
  tags: string[],
): Omit<GrafanaDashboard, 'panels'> {
  return {
    uid,
    title,
    description,
    tags: ['cashtrace', ...tags],
    timezone: 'browser',
    editable: true,
    refresh: '30s',
    time: { from: 'now-1h', to: 'now' },
    templating: { list: envAndServiceVars() },
  };
}

// --- API Performance Dashboard ---

export function createApiPerformanceDashboard(): GrafanaDashboard {
  return {
    ...baseDashboard(
      'cashtrace-api-performance',
      'CashTrace - API Performance',
      'HTTP request rate, latency percentiles, error rates, and status code distribution',
      ['api', 'performance'],
    ),
    panels: [
      {
        id: 1,
        title: 'Request Rate',
        type: 'timeseries',
        gridPos: { h: 8, w: 12, x: 0, y: 0 },
        targets: [
          {
            expr: 'sum(rate(http_requests_total{environment=~"$environment",service=~"$service"}[5m])) by (method)',
            legendFormat: '{{method}}',
            refId: 'A',
          },
        ],
      },
      {
        id: 2,
        title: 'Latency Percentiles',
        type: 'timeseries',
        gridPos: { h: 8, w: 12, x: 12, y: 0 },
        targets: [
          {
            expr: 'histogram_quantile(0.50, sum(rate(http_request_duration_ms_bucket{environment=~"$environment",service=~"$service"}[5m])) by (le))',
            legendFormat: 'p50',
            refId: 'A',
          },
          {
            expr: 'histogram_quantile(0.95, sum(rate(http_request_duration_ms_bucket{environment=~"$environment",service=~"$service"}[5m])) by (le))',
            legendFormat: 'p95',
            refId: 'B',
          },
          {
            expr: 'histogram_quantile(0.99, sum(rate(http_request_duration_ms_bucket{environment=~"$environment",service=~"$service"}[5m])) by (le))',
            legendFormat: 'p99',
            refId: 'C',
          },
        ],
      },
      {
        id: 3,
        title: 'Error Rate',
        type: 'timeseries',
        gridPos: { h: 8, w: 12, x: 0, y: 8 },
        targets: [
          {
            expr: 'sum(rate(http_requests_total{environment=~"$environment",service=~"$service",status_code=~"5.."}[5m])) / sum(rate(http_requests_total{environment=~"$environment",service=~"$service"}[5m]))',
            legendFormat: 'Error Rate',
            refId: 'A',
          },
        ],
      },
      {
        id: 4,
        title: 'Status Code Distribution',
        type: 'piechart',
        gridPos: { h: 8, w: 12, x: 12, y: 8 },
        targets: [
          {
            expr: 'sum(increase(http_status_total{environment=~"$environment",service=~"$service"}[1h])) by (status_class)',
            legendFormat: '{{status_class}}',
            refId: 'A',
          },
        ],
      },
    ],
  };
}

// --- Database Health Dashboard ---

export function createDatabaseHealthDashboard(): GrafanaDashboard {
  return {
    ...baseDashboard(
      'cashtrace-db-health',
      'CashTrace - Database Health',
      'Database query count, latency, connection pool, and error rates',
      ['database', 'health'],
    ),
    panels: [
      {
        id: 1,
        title: 'Query Rate',
        type: 'timeseries',
        gridPos: { h: 8, w: 12, x: 0, y: 0 },
        targets: [
          {
            expr: 'sum(rate(db_queries_total{environment=~"$environment",service=~"$service"}[5m])) by (operation)',
            legendFormat: '{{operation}}',
            refId: 'A',
          },
        ],
      },
      {
        id: 2,
        title: 'Query Latency',
        type: 'timeseries',
        gridPos: { h: 8, w: 12, x: 12, y: 0 },
        targets: [
          {
            expr: 'histogram_quantile(0.50, sum(rate(db_query_duration_ms_bucket{environment=~"$environment",service=~"$service"}[5m])) by (le))',
            legendFormat: 'p50',
            refId: 'A',
          },
          {
            expr: 'histogram_quantile(0.95, sum(rate(db_query_duration_ms_bucket{environment=~"$environment",service=~"$service"}[5m])) by (le))',
            legendFormat: 'p95',
            refId: 'B',
          },
          {
            expr: 'histogram_quantile(0.99, sum(rate(db_query_duration_ms_bucket{environment=~"$environment",service=~"$service"}[5m])) by (le))',
            legendFormat: 'p99',
            refId: 'C',
          },
        ],
      },
      {
        id: 3,
        title: 'Connection Pool Usage',
        type: 'gauge',
        gridPos: { h: 8, w: 12, x: 0, y: 8 },
        targets: [
          {
            expr: 'db_connection_pool_active{environment=~"$environment",service=~"$service"}',
            legendFormat: 'Active Connections',
            refId: 'A',
          },
        ],
      },
      {
        id: 4,
        title: 'Query Error Rate',
        type: 'timeseries',
        gridPos: { h: 8, w: 12, x: 12, y: 8 },
        targets: [
          {
            expr: 'sum(rate(db_query_errors_total{environment=~"$environment",service=~"$service"}[5m])) by (operation)',
            legendFormat: '{{operation}}',
            refId: 'A',
          },
        ],
      },
    ],
  };
}

// --- Business Metrics Dashboard ---

export function createBusinessMetricsDashboard(): GrafanaDashboard {
  return {
    ...baseDashboard(
      'cashtrace-business-metrics',
      'CashTrace - Business Metrics',
      'Transactions processed, documents parsed, and revenue metrics',
      ['business', 'metrics'],
    ),
    panels: [
      {
        id: 1,
        title: 'Transactions Processed',
        type: 'timeseries',
        gridPos: { h: 8, w: 12, x: 0, y: 0 },
        targets: [
          {
            expr: 'sum(rate(business_transactions_total{environment=~"$environment",service=~"$service"}[5m])) by (type)',
            legendFormat: '{{type}}',
            refId: 'A',
          },
        ],
      },
      {
        id: 2,
        title: 'Transaction Success Rate',
        type: 'stat',
        gridPos: { h: 8, w: 12, x: 12, y: 0 },
        targets: [
          {
            expr: 'sum(rate(business_transactions_total{environment=~"$environment",service=~"$service",status="success"}[5m])) / sum(rate(business_transactions_total{environment=~"$environment",service=~"$service"}[5m]))',
            legendFormat: 'Success Rate',
            refId: 'A',
          },
        ],
      },
      {
        id: 3,
        title: 'Documents Parsed',
        type: 'timeseries',
        gridPos: { h: 8, w: 12, x: 0, y: 8 },
        targets: [
          {
            expr: 'sum(rate(business_documents_parsed_total{environment=~"$environment",service=~"$service"}[5m])) by (type)',
            legendFormat: '{{type}}',
            refId: 'A',
          },
        ],
      },
      {
        id: 4,
        title: 'Revenue Metrics',
        type: 'stat',
        gridPos: { h: 8, w: 12, x: 12, y: 8 },
        targets: [
          {
            expr: 'sum(increase(business_transactions_total{environment=~"$environment",service=~"$service",status="success"}[24h]))',
            legendFormat: 'Successful Transactions (24h)',
            refId: 'A',
          },
        ],
      },
    ],
  };
}

// --- Aggregate export ---

export function getAllDashboards(): GrafanaDashboard[] {
  return [
    createApiPerformanceDashboard(),
    createDatabaseHealthDashboard(),
    createBusinessMetricsDashboard(),
  ];
}
