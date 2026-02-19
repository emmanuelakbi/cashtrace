/**
 * Alert Deduplication
 *
 * Prevents alert spam through three mechanisms:
 * 1. Cooldown period — after an alert resolves, suppress re-firing for a configurable duration
 * 2. Rate limiting — cap notifications per channel within a sliding time window
 * 3. Suppression windows — configurable time ranges where alerts are silenced
 *
 * Requirements: 6.3 (alert deduplication to prevent spam)
 *
 * @module alerting/deduplication
 */

import type { AlertChannel, AlertSeverity } from './alertManager.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CooldownConfig {
  /** Cooldown duration in milliseconds after an alert is resolved. Default: 5 minutes. */
  durationMs: number;
}

export interface RateLimitConfig {
  /** Maximum number of notifications allowed per channel in the time window. */
  maxNotifications: number;
  /** Time window in milliseconds. Default: 1 hour. */
  windowMs: number;
}

export interface SuppressionWindow {
  /** Unique name for this suppression window. */
  name: string;
  /** Start hour (0-23) in UTC. */
  startHour: number;
  /** End hour (0-23) in UTC. If less than startHour, wraps past midnight. */
  endHour: number;
  /** Days of week (0=Sunday, 6=Saturday). If empty, applies to all days. */
  daysOfWeek?: number[];
  /** Optional: only suppress specific severities. If omitted, suppresses all. */
  severities?: AlertSeverity[];
  /** Optional: only suppress specific channels. If omitted, suppresses all. */
  channels?: AlertChannel[];
}

export interface DeduplicationConfig {
  /** Cooldown settings per alert definition name. Falls back to default if not specified. */
  cooldowns?: Record<string, CooldownConfig>;
  /** Default cooldown applied when no per-alert config exists. */
  defaultCooldown?: CooldownConfig;
  /** Rate limit settings per channel. */
  rateLimits?: Partial<Record<AlertChannel, RateLimitConfig>>;
  /** Suppression windows. */
  suppressionWindows?: SuppressionWindow[];
}

export type SuppressionReason =
  | { type: 'cooldown'; alertName: string; remainingMs: number }
  | { type: 'rate_limit'; channel: AlertChannel; limit: number; windowMs: number }
  | { type: 'suppression_window'; windowName: string };

export interface DeduplicationResult {
  allowed: boolean;
  suppressed: SuppressionReason[];
}

export interface AlertDeduplicator {
  /** Check whether an alert notification should be allowed. */
  check(alertName: string, severity: AlertSeverity, channels: AlertChannel[]): DeduplicationResult;
  /** Record that a notification was sent on a channel. */
  recordNotification(channel: AlertChannel): void;
  /** Record that an alert was resolved (starts cooldown). */
  recordResolution(alertName: string): void;
  /** Get current config. */
  getConfig(): DeduplicationConfig;
  /** Update config at runtime. */
  updateConfig(config: DeduplicationConfig): void;
  /** Clear all internal state (cooldowns, rate limit counters). */
  reset(): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createAlertDeduplicator(
  config: DeduplicationConfig = {},
  now: () => number = Date.now,
): AlertDeduplicator {
  let currentConfig = { ...config };

  // Tracks when each alert definition was last resolved (alertName -> timestamp)
  const cooldownTimestamps = new Map<string, number>();

  // Tracks notification timestamps per channel for rate limiting
  const notificationLog = new Map<AlertChannel, number[]>();

  function getCooldownConfig(alertName: string): CooldownConfig | undefined {
    return currentConfig.cooldowns?.[alertName] ?? currentConfig.defaultCooldown;
  }

  function checkCooldown(alertName: string): SuppressionReason | null {
    const cooldownCfg = getCooldownConfig(alertName);
    if (!cooldownCfg) return null;

    const resolvedAt = cooldownTimestamps.get(alertName);
    if (resolvedAt === undefined) return null;

    const elapsed = now() - resolvedAt;
    const remaining = cooldownCfg.durationMs - elapsed;

    if (remaining > 0) {
      return { type: 'cooldown', alertName, remainingMs: remaining };
    }

    // Cooldown expired — clean up
    cooldownTimestamps.delete(alertName);
    return null;
  }

  function pruneOldEntries(channel: AlertChannel, windowMs: number): number[] {
    const timestamps = notificationLog.get(channel) ?? [];
    const cutoff = now() - windowMs;
    const pruned = timestamps.filter((t) => t > cutoff);
    notificationLog.set(channel, pruned);
    return pruned;
  }

  function checkRateLimit(channels: AlertChannel[]): SuppressionReason | null {
    for (const channel of channels) {
      const limitCfg = currentConfig.rateLimits?.[channel];
      if (!limitCfg) continue;

      const recent = pruneOldEntries(channel, limitCfg.windowMs);
      if (recent.length >= limitCfg.maxNotifications) {
        return {
          type: 'rate_limit',
          channel,
          limit: limitCfg.maxNotifications,
          windowMs: limitCfg.windowMs,
        };
      }
    }
    return null;
  }

  function checkSuppressionWindows(
    severity: AlertSeverity,
    channels: AlertChannel[],
  ): SuppressionReason | null {
    const windows = currentConfig.suppressionWindows;
    if (!windows || windows.length === 0) return null;

    const currentDate = new Date(now());
    const currentHour = currentDate.getUTCHours();
    const currentDay = currentDate.getUTCDay();

    for (const win of windows) {
      // Check day-of-week filter
      if (win.daysOfWeek && win.daysOfWeek.length > 0 && !win.daysOfWeek.includes(currentDay)) {
        continue;
      }

      // Check severity filter
      if (win.severities && win.severities.length > 0 && !win.severities.includes(severity)) {
        continue;
      }

      // Check channel filter
      if (
        win.channels &&
        win.channels.length > 0 &&
        !channels.some((ch) => win.channels!.includes(ch))
      ) {
        continue;
      }

      // Check time window
      if (isInTimeWindow(currentHour, win.startHour, win.endHour)) {
        return { type: 'suppression_window', windowName: win.name };
      }
    }

    return null;
  }

  return {
    check(
      alertName: string,
      severity: AlertSeverity,
      channels: AlertChannel[],
    ): DeduplicationResult {
      const suppressed: SuppressionReason[] = [];

      const cooldownResult = checkCooldown(alertName);
      if (cooldownResult) suppressed.push(cooldownResult);

      const rateLimitResult = checkRateLimit(channels);
      if (rateLimitResult) suppressed.push(rateLimitResult);

      const windowResult = checkSuppressionWindows(severity, channels);
      if (windowResult) suppressed.push(windowResult);

      return {
        allowed: suppressed.length === 0,
        suppressed,
      };
    },

    recordNotification(channel: AlertChannel): void {
      const timestamps = notificationLog.get(channel) ?? [];
      timestamps.push(now());
      notificationLog.set(channel, timestamps);
    },

    recordResolution(alertName: string): void {
      cooldownTimestamps.set(alertName, now());
    },

    getConfig(): DeduplicationConfig {
      return { ...currentConfig };
    },

    updateConfig(newConfig: DeduplicationConfig): void {
      currentConfig = { ...newConfig };
    },

    reset(): void {
      cooldownTimestamps.clear();
      notificationLog.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if `currentHour` falls within [startHour, endHour).
 * Handles wrap-around past midnight (e.g. startHour=22, endHour=6).
 */
export function isInTimeWindow(currentHour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false; // zero-width window matches nothing
  if (startHour < endHour) {
    return currentHour >= startHour && currentHour < endHour;
  }
  // Wraps past midnight
  return currentHour >= startHour || currentHour < endHour;
}
