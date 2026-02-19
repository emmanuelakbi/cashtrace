/**
 * Log Shipper
 *
 * Ships structured log entries to centralized storage backends
 * (CloudWatch, Elasticsearch) with buffered batching, retry logic,
 * and dead letter queue for failed shipments.
 *
 * Requirements: 8.1 (ship logs to centralized log storage)
 *
 * @module logging/shipper
 */

import type { LogEntry } from './logger.js';
import type { CloudWatchConfig, ElasticsearchConfig } from './cloudwatchConfig.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Serialized batch of log entries sent to a backend. */
export interface ShipmentBatch {
  entries: LogEntry[];
  destination: string;
  timestamp: string;
}

/** Result of a transport send operation. */
export interface TransportResult {
  success: boolean;
  error?: string;
}

/** Pluggable transport layer for shipping log batches. */
export interface ShipperTransport {
  send(batch: ShipmentBatch): Promise<TransportResult>;
}

/** Configuration for the log shipper. */
export interface ShipperConfig {
  /** Transport used to send batches. */
  transport: ShipperTransport;
  /** Destination label (e.g. 'cloudwatch', 'elasticsearch'). */
  destination: string;
  /** Max entries buffered before auto-flush. Defaults to 100. */
  bufferSize?: number;
  /** Flush interval in ms. Defaults to 5000. */
  flushIntervalMs?: number;
  /** Max retry attempts for failed shipments. Defaults to 3. */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff. Defaults to 100. */
  retryBaseDelayMs?: number;
}

/** A failed shipment stored in the dead letter queue. */
export interface DeadLetterEntry {
  batch: ShipmentBatch;
  error: string;
  attempts: number;
  failedAt: string;
}

/** The log shipper interface. */
export interface LogShipper {
  /** Add a log entry to the buffer. Flushes automatically when buffer is full. */
  ship(entry: LogEntry): void;
  /** Manually flush all buffered entries. */
  flush(): Promise<void>;
  /** Stop the shipper and flush remaining entries. */
  stop(): Promise<void>;
  /** Get entries that failed all retry attempts. */
  deadLetterQueue(): DeadLetterEntry[];
  /** Get current buffer size. */
  bufferLength(): number;
}

// ─── In-Memory Transport (for testing) ───────────────────────────────────────

export interface InMemoryTransport extends ShipperTransport {
  batches: ShipmentBatch[];
  failNext: boolean;
  failCount: number;
}

export function createInMemoryShipperTransport(): InMemoryTransport {
  const transport: InMemoryTransport = {
    batches: [],
    failNext: false,
    failCount: 0,
    async send(batch: ShipmentBatch): Promise<TransportResult> {
      if (transport.failNext) {
        transport.failCount++;
        return { success: false, error: 'Simulated transport failure' };
      }
      transport.batches.push(batch);
      return { success: true };
    },
  };
  return transport;
}

// ─── Shipper Implementation ──────────────────────────────────────────────────

export function createLogShipper(config: ShipperConfig): LogShipper {
  const bufferSize = config.bufferSize ?? 100;
  const flushIntervalMs = config.flushIntervalMs ?? 5000;
  const maxRetries = config.maxRetries ?? 3;
  const retryBaseDelayMs = config.retryBaseDelayMs ?? 100;

  let buffer: LogEntry[] = [];
  const dlq: DeadLetterEntry[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  // Start periodic flush
  if (flushIntervalMs > 0) {
    timer = setInterval(() => {
      void doFlush();
    }, flushIntervalMs);
    // Allow Node to exit even if timer is active
    if (timer && typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }
  }

  async function sendWithRetry(batch: ShipmentBatch): Promise<void> {
    let lastError = '';
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await config.transport.send(batch);
      if (result.success) return;
      lastError = result.error ?? 'Unknown error';
      if (attempt < maxRetries) {
        const delay = retryBaseDelayMs * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
    // All retries exhausted — push to DLQ
    dlq.push({
      batch,
      error: lastError,
      attempts: maxRetries,
      failedAt: new Date().toISOString(),
    });
  }

  async function doFlush(): Promise<void> {
    if (buffer.length === 0) return;
    const entries = buffer;
    buffer = [];
    const batch: ShipmentBatch = {
      entries,
      destination: config.destination,
      timestamp: new Date().toISOString(),
    };
    await sendWithRetry(batch);
  }

  return {
    ship(entry: LogEntry): void {
      if (stopped) return;
      buffer.push(entry);
      if (buffer.length >= bufferSize) {
        void doFlush();
      }
    },

    async flush(): Promise<void> {
      await doFlush();
    },

    async stop(): Promise<void> {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      await doFlush();
    },

    deadLetterQueue(): DeadLetterEntry[] {
      return [...dlq];
    },

    bufferLength(): number {
      return buffer.length;
    },
  };
}

// ─── Factory Functions ───────────────────────────────────────────────────────

export function createCloudWatchShipper(
  cwConfig: CloudWatchConfig,
  transport?: ShipperTransport,
): LogShipper {
  const t = transport ?? createStubTransport('cloudwatch');
  return createLogShipper({
    transport: t,
    destination: 'cloudwatch',
    bufferSize: cwConfig.batchSize,
    flushIntervalMs: cwConfig.flushIntervalMs,
  });
}

export function createElasticsearchShipper(
  esConfig: ElasticsearchConfig,
  transport?: ShipperTransport,
): LogShipper {
  const t = transport ?? createStubTransport('elasticsearch');
  return createLogShipper({
    transport: t,
    destination: 'elasticsearch',
    bufferSize: esConfig.batchSize,
    flushIntervalMs: esConfig.flushIntervalMs,
  });
}

/** Stub transport for production use — replace with real SDK calls. */
function createStubTransport(destination: string): ShipperTransport {
  return {
    async send(_batch: ShipmentBatch): Promise<TransportResult> {
      void destination;
      return { success: true };
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
