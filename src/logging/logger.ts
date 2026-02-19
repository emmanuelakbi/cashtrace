/**
 * Structured Logger
 *
 * Provides JSON-structured logging with log level support, context enrichment,
 * and child logger creation for CashTrace observability.
 *
 * Requirements: 1.1 (JSON format), 1.2 (standard fields), 1.3 (log levels), 1.4 (request context)
 *
 * @module logging/logger
 */

import { randomUUID } from 'node:crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogMetadata {
  [key: string]: unknown;
}

export interface LogContext {
  correlationId?: string;
  userId?: string;
  businessId?: string;
  service?: string;
  operation?: string;
}

export interface ErrorInfo {
  name: string;
  message: string;
  stack?: string;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  correlationId: string;
  userId?: string;
  businessId?: string;
  metadata?: LogMetadata;
  error?: ErrorInfo;
}

export interface Logger {
  debug(message: string, metadata?: LogMetadata): void;
  info(message: string, metadata?: LogMetadata): void;
  warn(message: string, metadata?: LogMetadata): void;
  error(message: string, error?: Error, metadata?: LogMetadata): void;
  fatal(message: string, error?: Error, metadata?: LogMetadata): void;
  child(context: LogContext): Logger;
}

// ─── Log Level Ordering ──────────────────────────────────────────────────────

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

/**
 * Output sink for log entries. Defaults to stdout JSON.
 * Can be replaced for testing or custom transports.
 */
export type LogOutput = (entry: LogEntry) => void;

const defaultLogOutput: LogOutput = (entry: LogEntry) => {
  const line = JSON.stringify(entry);
  process.stdout.write(line + '\n');
};

// ─── Logger Options ──────────────────────────────────────────────────────────

export interface LoggerOptions {
  /** Service name included in every log entry. Defaults to 'cashtrace'. */
  service?: string;
  /** Minimum log level to emit. Defaults to 'info'. */
  level?: LogLevel;
  /** Base context merged into every log entry. */
  context?: LogContext;
  /** Custom output sink. Defaults to JSON on stdout. */
  output?: LogOutput;
  /**
   * Sampling rate for debug-level logs (0.0–1.0).
   * 0.0 = drop all debug logs, 1.0 = emit all debug logs.
   * Defaults to 0.1 (10% of debug logs emitted).
   * Only affects debug level; warn, error, and fatal are always emitted.
   * Requirements: 1.5
   */
  debugSampleRate?: number;
  /**
   * Random number generator for sampling decisions.
   * Returns a value in [0, 1). Defaults to Math.random.
   * Exposed for deterministic testing.
   */
  randomFn?: () => number;
}

// ─── Implementation ──────────────────────────────────────────────────────────

export function createLogger(options: LoggerOptions = {}): Logger {
  const service = options.service ?? 'cashtrace';
  const minLevel = options.level ?? 'info';
  const baseContext: LogContext = {
    ...options.context,
  };
  // Auto-generate correlation ID if none provided (Req 1.2, 1.4)
  if (!baseContext.correlationId) {
    baseContext.correlationId = randomUUID();
  }
  // Ensure service name is always present in context
  if (!baseContext.service) {
    baseContext.service = service;
  }
  const output = options.output ?? defaultLogOutput;

  // Sampling: clamp debugSampleRate to [0, 1], default 0.1 (Req 1.5)
  const rawRate = options.debugSampleRate ?? 0.1;
  const debugSampleRate = Math.max(0, Math.min(1, rawRate));
  const randomFn = options.randomFn ?? Math.random;

  function shouldLog(level: LogLevel): boolean {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[minLevel]) return false;

    // Apply sampling only to debug-level logs (Req 1.5)
    if (level === 'debug' && debugSampleRate < 1) {
      if (debugSampleRate <= 0) return false;
      return randomFn() < debugSampleRate;
    }

    return true;
  }

  function buildEntry(
    level: LogLevel,
    message: string,
    error?: Error,
    metadata?: LogMetadata,
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: baseContext.service ?? service,
      correlationId: baseContext.correlationId ?? '',
    };

    if (baseContext.userId) entry.userId = baseContext.userId;
    if (baseContext.businessId) entry.businessId = baseContext.businessId;
    if (metadata && Object.keys(metadata).length > 0) entry.metadata = metadata;

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    return entry;
  }

  function log(level: LogLevel, message: string, error?: Error, metadata?: LogMetadata): void {
    if (!shouldLog(level)) return;
    const entry = buildEntry(level, message, error, metadata);
    output(entry);
  }

  return {
    debug(message: string, metadata?: LogMetadata): void {
      log('debug', message, undefined, metadata);
    },
    info(message: string, metadata?: LogMetadata): void {
      log('info', message, undefined, metadata);
    },
    warn(message: string, metadata?: LogMetadata): void {
      log('warn', message, undefined, metadata);
    },
    error(message: string, error?: Error, metadata?: LogMetadata): void {
      log('error', message, error, metadata);
    },
    fatal(message: string, error?: Error, metadata?: LogMetadata): void {
      log('fatal', message, error, metadata);
    },
    child(context: LogContext): Logger {
      const mergedContext: LogContext = {
        ...baseContext,
        ...context,
      };
      return createLogger({
        service,
        level: minLevel,
        context: mergedContext,
        output,
        debugSampleRate,
        randomFn,
      });
    },
  };
}
