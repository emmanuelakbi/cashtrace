/**
 * CloudWatch / Elasticsearch Configuration
 *
 * Provides configuration and connection abstraction for log aggregation backends.
 * Supports CloudWatch Logs and Elasticsearch as destinations.
 * All settings are configurable via environment variables.
 */

export interface CloudWatchConfig {
  enabled: boolean;
  region: string;
  logGroupName: string;
  logStreamPrefix: string;
  retentionDays: number;
  batchSize: number;
  flushIntervalMs: number;
}

export interface ElasticsearchConfig {
  enabled: boolean;
  nodes: string[];
  indexPrefix: string;
  username?: string;
  password?: string;
  tlsEnabled: boolean;
  retentionDays: number;
  batchSize: number;
  flushIntervalMs: number;
}

export type LogBackend = 'cloudwatch' | 'elasticsearch' | 'console';

export interface LogAggregationConfig {
  backend: LogBackend;
  cloudwatch: CloudWatchConfig;
  elasticsearch: ElasticsearchConfig;
  hotRetentionDays: number;
  coldRetentionDays: number;
}

export function loadCloudWatchConfig(): CloudWatchConfig {
  return {
    enabled: process.env['CLOUDWATCH_ENABLED'] === 'true',
    region: process.env['AWS_REGION'] ?? 'eu-west-1',
    logGroupName: process.env['CLOUDWATCH_LOG_GROUP'] ?? '/cashtrace/app',
    logStreamPrefix: process.env['CLOUDWATCH_LOG_STREAM_PREFIX'] ?? 'cashtrace-',
    retentionDays: parseInt(process.env['CLOUDWATCH_RETENTION_DAYS'] ?? '30', 10),
    batchSize: parseInt(process.env['CLOUDWATCH_BATCH_SIZE'] ?? '100', 10),
    flushIntervalMs: parseInt(process.env['CLOUDWATCH_FLUSH_INTERVAL_MS'] ?? '5000', 10),
  };
}

export function loadElasticsearchConfig(): ElasticsearchConfig {
  const nodesEnv = process.env['ELASTICSEARCH_NODES'] ?? 'http://localhost:9200';
  return {
    enabled: process.env['ELASTICSEARCH_ENABLED'] === 'true',
    nodes: nodesEnv.split(',').map((n) => n.trim()),
    indexPrefix: process.env['ELASTICSEARCH_INDEX_PREFIX'] ?? 'cashtrace-logs-',
    username: process.env['ELASTICSEARCH_USERNAME'],
    password: process.env['ELASTICSEARCH_PASSWORD'],
    tlsEnabled: process.env['ELASTICSEARCH_TLS_ENABLED'] === 'true',
    retentionDays: parseInt(process.env['ELASTICSEARCH_RETENTION_DAYS'] ?? '30', 10),
    batchSize: parseInt(process.env['ELASTICSEARCH_BATCH_SIZE'] ?? '100', 10),
    flushIntervalMs: parseInt(process.env['ELASTICSEARCH_FLUSH_INTERVAL_MS'] ?? '5000', 10),
  };
}

export function loadLogAggregationConfig(): LogAggregationConfig {
  const backend = (process.env['LOG_BACKEND'] ?? 'console') as LogBackend;
  return {
    backend,
    cloudwatch: loadCloudWatchConfig(),
    elasticsearch: loadElasticsearchConfig(),
    hotRetentionDays: parseInt(process.env['LOG_HOT_RETENTION_DAYS'] ?? '30', 10),
    coldRetentionDays: parseInt(process.env['LOG_COLD_RETENTION_DAYS'] ?? '365', 10),
  };
}

/**
 * Connection abstraction for log aggregation backends.
 * In production, this would wrap actual AWS SDK / Elasticsearch client calls.
 */
export interface LogAggregationClient {
  send(entries: LogBatchEntry[]): Promise<void>;
  healthCheck(): Promise<boolean>;
  close(): Promise<void>;
}

export interface LogBatchEntry {
  timestamp: string;
  message: string;
}

export function createLogAggregationClient(config: LogAggregationConfig): LogAggregationClient {
  switch (config.backend) {
    case 'cloudwatch':
      return createCloudWatchClient(config.cloudwatch);
    case 'elasticsearch':
      return createElasticsearchClient(config.elasticsearch);
    case 'console':
    default:
      return createConsoleClient();
  }
}

function createCloudWatchClient(_config: CloudWatchConfig): LogAggregationClient {
  let connected = false;
  return {
    async send(entries: LogBatchEntry[]): Promise<void> {
      if (!connected) {
        connected = true;
      }
      // Stub: In production, use @aws-sdk/client-cloudwatch-logs
      void entries;
    },
    async healthCheck(): Promise<boolean> {
      return _config.enabled;
    },
    async close(): Promise<void> {
      connected = false;
    },
  };
}

function createElasticsearchClient(_config: ElasticsearchConfig): LogAggregationClient {
  let connected = false;
  return {
    async send(entries: LogBatchEntry[]): Promise<void> {
      if (!connected) {
        connected = true;
      }
      // Stub: In production, use @elastic/elasticsearch
      void entries;
    },
    async healthCheck(): Promise<boolean> {
      return _config.enabled;
    },
    async close(): Promise<void> {
      connected = false;
    },
  };
}

function createConsoleClient(): LogAggregationClient {
  return {
    async send(_entries: LogBatchEntry[]): Promise<void> {
      // No-op for console backend; logs go to stdout directly
    },
    async healthCheck(): Promise<boolean> {
      return true;
    },
    async close(): Promise<void> {
      // No-op
    },
  };
}
