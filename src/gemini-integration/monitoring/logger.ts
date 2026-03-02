// Gemini Integration - Logger with PII redaction
// Validates: Requirements 12.1, 12.2, 12.5, 12.6

import { redact, redactObject } from '../utils/index.js';

/**
 * Log levels in ascending severity order.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * A single structured log entry.
 */
export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  correlationId: string;
  context?: Record<string, unknown>;
}

/**
 * Options for configuring the GeminiLogger.
 */
export interface LoggerOptions {
  level?: LogLevel;
  redactPii?: boolean;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Structured logger with automatic PII redaction and correlation ID tracking.
 *
 * Stores log entries in an internal buffer for inspection/testing.
 * Only entries at or above the configured log level are recorded.
 */
export class GeminiLogger {
  private readonly level: LogLevel;
  private readonly redactPii: boolean;
  private entries: LogEntry[] = [];

  constructor(options?: LoggerOptions) {
    this.level = options?.level ?? 'info';
    this.redactPii = options?.redactPii ?? true;
  }

  debug(message: string, correlationId: string, context?: Record<string, unknown>): void {
    this.log('debug', message, correlationId, context);
  }

  info(message: string, correlationId: string, context?: Record<string, unknown>): void {
    this.log('info', message, correlationId, context);
  }

  warn(message: string, correlationId: string, context?: Record<string, unknown>): void {
    this.log('warn', message, correlationId, context);
  }

  error(message: string, correlationId: string, context?: Record<string, unknown>): void {
    this.log('error', message, correlationId, context);
  }

  /**
   * Return all stored log entries.
   */
  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * Clear all stored log entries.
   */
  clear(): void {
    this.entries = [];
  }

  private log(
    level: LogLevel,
    message: string,
    correlationId: string,
    context?: Record<string, unknown>,
  ): void {
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[this.level]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message: this.redactPii ? redact(message) : message,
      correlationId,
      context: context
        ? this.redactPii
          ? (redactObject(context) as Record<string, unknown>)
          : { ...context }
        : undefined,
    };

    this.entries.push(entry);
  }
}
