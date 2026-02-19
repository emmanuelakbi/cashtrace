import { describe, it, expect } from 'vitest';
import {
  createApiPerformanceDashboard,
  createDatabaseHealthDashboard,
  createBusinessMetricsDashboard,
  getAllDashboards,
  type GrafanaDashboard,
} from './dashboardDefinitions.js';

function expectTemplateVariables(dashboard: GrafanaDashboard) {
  const vars = dashboard.templating.list;
  const names = vars.map((v) => v.name);
  expect(names).toContain('environment');
  expect(names).toContain('service');
  for (const v of vars) {
    expect(v.type).toBe('query');
    expect(v.datasource).toBe('Prometheus');
    expect(v.includeAll).toBe(true);
    expect(v.multi).toBe(true);
  }
}

function expectJsonSerializable(dashboard: GrafanaDashboard) {
  const json = JSON.stringify(dashboard);
  const parsed = JSON.parse(json) as GrafanaDashboard;
  expect(parsed.uid).toBe(dashboard.uid);
  expect(parsed.panels.length).toBe(dashboard.panels.length);
}

describe('API Performance Dashboard', () => {
  const dashboard = createApiPerformanceDashboard();

  it('has correct metadata', () => {
    expect(dashboard.uid).toBe('cashtrace-api-performance');
    expect(dashboard.title).toContain('API Performance');
    expect(dashboard.tags).toContain('cashtrace');
  });

  it('includes environment and service template variables', () => {
    expectTemplateVariables(dashboard);
  });

  it('has 4 panels covering request rate, latency, errors, status codes', () => {
    expect(dashboard.panels).toHaveLength(4);
    const titles = dashboard.panels.map((p) => p.title);
    expect(titles).toContain('Request Rate');
    expect(titles).toContain('Latency Percentiles');
    expect(titles).toContain('Error Rate');
    expect(titles).toContain('Status Code Distribution');
  });

  it('references correct metric names in queries', () => {
    const allExprs = dashboard.panels.flatMap((p) => p.targets.map((t) => t.expr));
    const joined = allExprs.join(' ');
    expect(joined).toContain('http_requests_total');
    expect(joined).toContain('http_request_duration_ms');
    expect(joined).toContain('http_status_total');
  });

  it('is JSON-serializable', () => {
    expectJsonSerializable(dashboard);
  });
});

describe('Database Health Dashboard', () => {
  const dashboard = createDatabaseHealthDashboard();

  it('has correct metadata', () => {
    expect(dashboard.uid).toBe('cashtrace-db-health');
    expect(dashboard.title).toContain('Database Health');
    expect(dashboard.tags).toContain('cashtrace');
  });

  it('includes environment and service template variables', () => {
    expectTemplateVariables(dashboard);
  });

  it('has 4 panels covering query rate, latency, connection pool, errors', () => {
    expect(dashboard.panels).toHaveLength(4);
    const titles = dashboard.panels.map((p) => p.title);
    expect(titles).toContain('Query Rate');
    expect(titles).toContain('Query Latency');
    expect(titles).toContain('Connection Pool Usage');
    expect(titles).toContain('Query Error Rate');
  });

  it('references correct metric names in queries', () => {
    const allExprs = dashboard.panels.flatMap((p) => p.targets.map((t) => t.expr));
    const joined = allExprs.join(' ');
    expect(joined).toContain('db_queries_total');
    expect(joined).toContain('db_query_duration_ms');
    expect(joined).toContain('db_query_errors_total');
  });

  it('is JSON-serializable', () => {
    expectJsonSerializable(dashboard);
  });
});

describe('Business Metrics Dashboard', () => {
  const dashboard = createBusinessMetricsDashboard();

  it('has correct metadata', () => {
    expect(dashboard.uid).toBe('cashtrace-business-metrics');
    expect(dashboard.title).toContain('Business Metrics');
    expect(dashboard.tags).toContain('cashtrace');
  });

  it('includes environment and service template variables', () => {
    expectTemplateVariables(dashboard);
  });

  it('has 4 panels covering transactions, success rate, documents, revenue', () => {
    expect(dashboard.panels).toHaveLength(4);
    const titles = dashboard.panels.map((p) => p.title);
    expect(titles).toContain('Transactions Processed');
    expect(titles).toContain('Transaction Success Rate');
    expect(titles).toContain('Documents Parsed');
    expect(titles).toContain('Revenue Metrics');
  });

  it('references correct metric names in queries', () => {
    const allExprs = dashboard.panels.flatMap((p) => p.targets.map((t) => t.expr));
    const joined = allExprs.join(' ');
    expect(joined).toContain('business_transactions_total');
    expect(joined).toContain('business_documents_parsed_total');
  });

  it('is JSON-serializable', () => {
    expectJsonSerializable(dashboard);
  });
});

describe('getAllDashboards', () => {
  it('returns all three dashboards', () => {
    const dashboards = getAllDashboards();
    expect(dashboards).toHaveLength(3);
    const uids = dashboards.map((d) => d.uid);
    expect(uids).toContain('cashtrace-api-performance');
    expect(uids).toContain('cashtrace-db-health');
    expect(uids).toContain('cashtrace-business-metrics');
  });

  it('returns independent instances', () => {
    const a = getAllDashboards();
    const b = getAllDashboards();
    expect(a[0]).not.toBe(b[0]);
  });
});
