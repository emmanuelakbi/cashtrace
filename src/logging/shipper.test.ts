import { describe, it, expect, beforeEach } from 'vitest';
import type { LogEntry } from './logger.js';
import {
  createLogShipper,
  createCloudWatchShipper,
  createElasticsearchShipper,
  createInMemoryShipperTransport,
  type ShipperTransport,
  type ShipmentBatch,
  type TransportResult,
} from './shipper.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEntry(msg = 'test', level: LogEntry['level'] = 'info'): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    message: msg,
    service: 'cashtrace',
    correlationId: 'corr-1',
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LogShipper', () => {
  let transport: ReturnType<typeof createInMemoryShipperTransport>;

  beforeEach(() => {
    transport = createInMemoryShipperTransport();
  });

  describe('buffered shipping', () => {
    it('buffers entries until flush is called', async () => {
      const shipper = createLogShipper({
        transport,
        destination: 'test',
        bufferSize: 100,
        flushIntervalMs: 0,
      });

      shipper.ship(makeEntry('a'));
      shipper.ship(makeEntry('b'));
      expect(transport.batches).toHaveLength(0);
      expect(shipper.bufferLength()).toBe(2);

      await shipper.flush();
      expect(transport.batches).toHaveLength(1);
      expect(transport.batches[0].entries).toHaveLength(2);
      expect(shipper.bufferLength()).toBe(0);

      await shipper.stop();
    });

    it('sends entries in a single batch with correct destination', async () => {
      const shipper = createLogShipper({
        transport,
        destination: 'cloudwatch',
        bufferSize: 100,
        flushIntervalMs: 0,
      });

      shipper.ship(makeEntry('x'));
      await shipper.flush();

      expect(transport.batches[0].destination).toBe('cloudwatch');
      expect(transport.batches[0].timestamp).toBeDefined();

      await shipper.stop();
    });

    it('flush is a no-op when buffer is empty', async () => {
      const shipper = createLogShipper({
        transport,
        destination: 'test',
        flushIntervalMs: 0,
      });

      await shipper.flush();
      expect(transport.batches).toHaveLength(0);

      await shipper.stop();
    });
  });

  describe('auto-flush on buffer full', () => {
    it('flushes automatically when buffer reaches bufferSize', async () => {
      const shipper = createLogShipper({
        transport,
        destination: 'test',
        bufferSize: 3,
        flushIntervalMs: 0,
      });

      shipper.ship(makeEntry('1'));
      shipper.ship(makeEntry('2'));
      expect(transport.batches).toHaveLength(0);

      shipper.ship(makeEntry('3'));
      // Auto-flush is async, give it a tick
      await new Promise((r) => setTimeout(r, 10));
      expect(transport.batches).toHaveLength(1);
      expect(transport.batches[0].entries).toHaveLength(3);

      await shipper.stop();
    });
  });

  describe('interval-based flush', () => {
    it('flushes on interval', async () => {
      // Use a manual approach: create shipper with interval=0 (disabled),
      // verify that periodic flushing concept works via manual flush timing.
      const shipper = createLogShipper({
        transport,
        destination: 'test',
        bufferSize: 100,
        flushIntervalMs: 0,
      });

      shipper.ship(makeEntry('timed'));
      expect(transport.batches).toHaveLength(0);

      // Simulate what the interval would do
      await shipper.flush();
      expect(transport.batches).toHaveLength(1);
      expect(transport.batches[0].entries[0].message).toBe('timed');

      await shipper.stop();
    });

    it('periodic flush fires with short interval', async () => {
      const shipper = createLogShipper({
        transport,
        destination: 'test',
        bufferSize: 100,
        flushIntervalMs: 50,
      });

      shipper.ship(makeEntry('periodic'));
      expect(transport.batches).toHaveLength(0);

      // Wait for the interval to fire
      await new Promise((r) => setTimeout(r, 120));
      expect(transport.batches.length).toBeGreaterThanOrEqual(1);

      await shipper.stop();
    });
  });

  describe('transport failure and retry', () => {
    it('retries on failure and succeeds', async () => {
      let callCount = 0;
      const retryTransport: ShipperTransport = {
        async send(batch: ShipmentBatch): Promise<TransportResult> {
          callCount++;
          if (callCount < 3) {
            return { success: false, error: `fail-${callCount}` };
          }
          return { success: true };
        },
      };

      const shipper = createLogShipper({
        transport: retryTransport,
        destination: 'test',
        bufferSize: 100,
        flushIntervalMs: 0,
        maxRetries: 3,
        retryBaseDelayMs: 1,
      });

      shipper.ship(makeEntry('retry-me'));
      await shipper.flush();

      expect(callCount).toBe(3);
      expect(shipper.deadLetterQueue()).toHaveLength(0);

      await shipper.stop();
    });

    it('sends to dead letter queue after all retries exhausted', async () => {
      const failTransport: ShipperTransport = {
        async send(): Promise<TransportResult> {
          return { success: false, error: 'permanent failure' };
        },
      };

      const shipper = createLogShipper({
        transport: failTransport,
        destination: 'test',
        bufferSize: 100,
        flushIntervalMs: 0,
        maxRetries: 2,
        retryBaseDelayMs: 1,
      });

      shipper.ship(makeEntry('doomed'));
      await shipper.flush();

      const dlq = shipper.deadLetterQueue();
      expect(dlq).toHaveLength(1);
      expect(dlq[0].error).toBe('permanent failure');
      expect(dlq[0].attempts).toBe(2);
      expect(dlq[0].batch.entries).toHaveLength(1);
      expect(dlq[0].failedAt).toBeDefined();

      await shipper.stop();
    });
  });

  describe('dead letter queue', () => {
    it('accumulates multiple failed batches', async () => {
      const failTransport: ShipperTransport = {
        async send(): Promise<TransportResult> {
          return { success: false, error: 'down' };
        },
      };

      const shipper = createLogShipper({
        transport: failTransport,
        destination: 'test',
        bufferSize: 1,
        flushIntervalMs: 0,
        maxRetries: 1,
        retryBaseDelayMs: 1,
      });

      shipper.ship(makeEntry('a'));
      await shipper.flush();
      shipper.ship(makeEntry('b'));
      await shipper.flush();

      expect(shipper.deadLetterQueue()).toHaveLength(2);

      await shipper.stop();
    });

    it('returns a copy of the DLQ (not a reference)', async () => {
      const failTransport: ShipperTransport = {
        async send(): Promise<TransportResult> {
          return { success: false, error: 'err' };
        },
      };

      const shipper = createLogShipper({
        transport: failTransport,
        destination: 'test',
        flushIntervalMs: 0,
        maxRetries: 1,
        retryBaseDelayMs: 1,
      });

      shipper.ship(makeEntry('x'));
      await shipper.flush();

      const dlq1 = shipper.deadLetterQueue();
      const dlq2 = shipper.deadLetterQueue();
      expect(dlq1).not.toBe(dlq2);
      expect(dlq1).toEqual(dlq2);

      await shipper.stop();
    });
  });

  describe('stop behavior', () => {
    it('flushes remaining buffer on stop', async () => {
      const shipper = createLogShipper({
        transport,
        destination: 'test',
        bufferSize: 100,
        flushIntervalMs: 0,
      });

      shipper.ship(makeEntry('final'));
      await shipper.stop();

      expect(transport.batches).toHaveLength(1);
      expect(transport.batches[0].entries[0].message).toBe('final');
    });

    it('ignores entries shipped after stop', async () => {
      const shipper = createLogShipper({
        transport,
        destination: 'test',
        flushIntervalMs: 0,
      });

      await shipper.stop();
      shipper.ship(makeEntry('ignored'));
      await shipper.flush();

      expect(transport.batches).toHaveLength(0);
    });
  });

  describe('createCloudWatchShipper', () => {
    it('creates a shipper with CloudWatch config', async () => {
      const shipper = createCloudWatchShipper(
        {
          enabled: true,
          region: 'eu-west-1',
          logGroupName: '/cashtrace/app',
          logStreamPrefix: 'cashtrace-',
          retentionDays: 30,
          batchSize: 5,
          flushIntervalMs: 0,
        },
        transport,
      );

      for (let i = 0; i < 5; i++) {
        shipper.ship(makeEntry(`cw-${i}`));
      }
      // Buffer full at 5 → auto-flush
      await new Promise((r) => setTimeout(r, 10));
      expect(transport.batches).toHaveLength(1);
      expect(transport.batches[0].destination).toBe('cloudwatch');
      expect(transport.batches[0].entries).toHaveLength(5);

      await shipper.stop();
    });
  });

  describe('createElasticsearchShipper', () => {
    it('creates a shipper with Elasticsearch config', async () => {
      const shipper = createElasticsearchShipper(
        {
          enabled: true,
          nodes: ['http://localhost:9200'],
          indexPrefix: 'cashtrace-logs-',
          tlsEnabled: false,
          retentionDays: 30,
          batchSize: 2,
          flushIntervalMs: 0,
        },
        transport,
      );

      shipper.ship(makeEntry('es-1'));
      shipper.ship(makeEntry('es-2'));
      await new Promise((r) => setTimeout(r, 10));

      expect(transport.batches).toHaveLength(1);
      expect(transport.batches[0].destination).toBe('elasticsearch');

      await shipper.stop();
    });
  });

  describe('in-memory transport', () => {
    it('records batches and supports failNext', async () => {
      const t = createInMemoryShipperTransport();
      const batch: ShipmentBatch = {
        entries: [makeEntry('ok')],
        destination: 'test',
        timestamp: new Date().toISOString(),
      };

      const r1 = await t.send(batch);
      expect(r1.success).toBe(true);
      expect(t.batches).toHaveLength(1);

      t.failNext = true;
      const r2 = await t.send(batch);
      expect(r2.success).toBe(false);
      expect(t.failCount).toBe(1);
      expect(t.batches).toHaveLength(1); // not added on failure
    });
  });

  describe('edge cases', () => {
    it('handles shipping a single entry', async () => {
      const shipper = createLogShipper({
        transport,
        destination: 'test',
        bufferSize: 100,
        flushIntervalMs: 0,
      });

      shipper.ship(makeEntry('solo'));
      await shipper.flush();

      expect(transport.batches).toHaveLength(1);
      expect(transport.batches[0].entries).toHaveLength(1);

      await shipper.stop();
    });

    it('handles multiple flushes in sequence', async () => {
      const shipper = createLogShipper({
        transport,
        destination: 'test',
        bufferSize: 100,
        flushIntervalMs: 0,
      });

      shipper.ship(makeEntry('a'));
      await shipper.flush();
      shipper.ship(makeEntry('b'));
      await shipper.flush();

      expect(transport.batches).toHaveLength(2);

      await shipper.stop();
    });

    it('preserves log entry data through shipping', async () => {
      const shipper = createLogShipper({
        transport,
        destination: 'test',
        flushIntervalMs: 0,
      });

      const entry = makeEntry('preserve-me', 'error');
      entry.userId = 'u-123';
      entry.metadata = { key: 'value' };

      shipper.ship(entry);
      await shipper.flush();

      const shipped = transport.batches[0].entries[0];
      expect(shipped.message).toBe('preserve-me');
      expect(shipped.level).toBe('error');
      expect(shipped.userId).toBe('u-123');
      expect(shipped.metadata).toEqual({ key: 'value' });

      await shipper.stop();
    });
  });
});
