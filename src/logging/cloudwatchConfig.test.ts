import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadCloudWatchConfig,
  loadElasticsearchConfig,
  loadLogAggregationConfig,
  createLogAggregationClient,
} from './cloudwatchConfig.js';

describe('CloudWatch/Elasticsearch Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadCloudWatchConfig', () => {
    it('returns defaults when no env vars set', () => {
      const config = loadCloudWatchConfig();
      expect(config.enabled).toBe(false);
      expect(config.region).toBe('eu-west-1');
      expect(config.logGroupName).toBe('/cashtrace/app');
      expect(config.logStreamPrefix).toBe('cashtrace-');
      expect(config.retentionDays).toBe(30);
      expect(config.batchSize).toBe(100);
      expect(config.flushIntervalMs).toBe(5000);
    });

    it('reads values from environment variables', () => {
      process.env['CLOUDWATCH_ENABLED'] = 'true';
      process.env['AWS_REGION'] = 'us-east-1';
      process.env['CLOUDWATCH_LOG_GROUP'] = '/custom/group';
      process.env['CLOUDWATCH_RETENTION_DAYS'] = '90';

      const config = loadCloudWatchConfig();
      expect(config.enabled).toBe(true);
      expect(config.region).toBe('us-east-1');
      expect(config.logGroupName).toBe('/custom/group');
      expect(config.retentionDays).toBe(90);
    });
  });

  describe('loadElasticsearchConfig', () => {
    it('returns defaults when no env vars set', () => {
      const config = loadElasticsearchConfig();
      expect(config.enabled).toBe(false);
      expect(config.nodes).toEqual(['http://localhost:9200']);
      expect(config.indexPrefix).toBe('cashtrace-logs-');
      expect(config.tlsEnabled).toBe(false);
    });

    it('parses comma-separated nodes', () => {
      process.env['ELASTICSEARCH_NODES'] = 'http://es1:9200, http://es2:9200';
      const config = loadElasticsearchConfig();
      expect(config.nodes).toEqual(['http://es1:9200', 'http://es2:9200']);
    });

    it('reads credentials from env', () => {
      process.env['ELASTICSEARCH_USERNAME'] = 'admin';
      process.env['ELASTICSEARCH_PASSWORD'] = 'secret';
      const config = loadElasticsearchConfig();
      expect(config.username).toBe('admin');
      expect(config.password).toBe('secret');
    });
  });

  describe('loadLogAggregationConfig', () => {
    it('defaults to console backend', () => {
      const config = loadLogAggregationConfig();
      expect(config.backend).toBe('console');
      expect(config.hotRetentionDays).toBe(30);
      expect(config.coldRetentionDays).toBe(365);
    });

    it('selects cloudwatch backend from env', () => {
      process.env['LOG_BACKEND'] = 'cloudwatch';
      const config = loadLogAggregationConfig();
      expect(config.backend).toBe('cloudwatch');
    });
  });

  describe('createLogAggregationClient', () => {
    it('creates console client by default', async () => {
      const config = loadLogAggregationConfig();
      const client = createLogAggregationClient(config);
      expect(await client.healthCheck()).toBe(true);
      await client.send([{ timestamp: new Date().toISOString(), message: 'test' }]);
      await client.close();
    });

    it('creates cloudwatch client when configured', async () => {
      process.env['LOG_BACKEND'] = 'cloudwatch';
      process.env['CLOUDWATCH_ENABLED'] = 'true';
      const config = loadLogAggregationConfig();
      const client = createLogAggregationClient(config);
      expect(await client.healthCheck()).toBe(true);
      await client.close();
    });

    it('creates elasticsearch client when configured', async () => {
      process.env['LOG_BACKEND'] = 'elasticsearch';
      process.env['ELASTICSEARCH_ENABLED'] = 'true';
      const config = loadLogAggregationConfig();
      const client = createLogAggregationClient(config);
      expect(await client.healthCheck()).toBe(true);
      await client.close();
    });
  });
});
