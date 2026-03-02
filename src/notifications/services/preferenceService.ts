/**
 * Preference Service
 *
 * Manages user notification preferences including category toggles,
 * channel preferences per category, quiet hours, and frequency settings.
 * Security notifications are always mandatory and cannot be disabled.
 *
 * @module notifications/services/preferenceService
 */

import type { Pool } from 'pg';

import type {
  NotificationCategory,
  NotificationChannel,
  NotificationFrequency,
  NotificationPreferences,
  QuietHours,
} from '../types/index.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const ALL_CATEGORIES: NotificationCategory[] = [
  'security',
  'transactions',
  'insights',
  'compliance',
  'system',
  'marketing',
];

const ALL_CHANNELS: NotificationChannel[] = ['email', 'in_app', 'push'];

const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: true,
  startTime: '22:00',
  endTime: '07:00',
};

const DEFAULT_FREQUENCY: NotificationFrequency = 'immediate';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Database row shape for notification_preferences table. */
interface PreferenceRow {
  id: string;
  user_id: string;
  enabled_categories: NotificationCategory[];
  channel_preferences: Record<NotificationCategory, NotificationChannel[]>;
  frequency: NotificationFrequency;
  quiet_hours: QuietHours;
  unsubscribed_categories: NotificationCategory[];
  created_at: Date;
  updated_at: Date;
}

export interface PreferenceService {
  /** Retrieve notification preferences for a user, returning defaults if none exist. */
  getPreferences(userId: string): Promise<NotificationPreferences>;
  /** Update notification preferences for a user (upsert). */
  updatePreferences(userId: string, preferences: Partial<NotificationPreferences>): Promise<void>;
  /** Determine whether a notification should be delivered on a given channel for a category. */
  shouldDeliver(
    userId: string,
    category: NotificationCategory,
    channel: NotificationChannel,
  ): Promise<boolean>;
  /** Retrieve quiet hours settings for a user. */
  getQuietHours(userId: string): Promise<QuietHours>;
  /** Check whether the current time falls within the user's quiet hours (WAT timezone). */
  isInQuietHours(userId: string, currentTime?: Date): Promise<boolean>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build default channel preferences: all channels enabled for every category. */
function buildDefaultChannelPreferences(): Record<NotificationCategory, NotificationChannel[]> {
  const prefs = {} as Record<NotificationCategory, NotificationChannel[]>;
  for (const cat of ALL_CATEGORIES) {
    prefs[cat] = [...ALL_CHANNELS];
  }
  return prefs;
}

/** Build default preferences for a user who has no stored record. */
function buildDefaultPreferences(userId: string): NotificationPreferences {
  return {
    userId,
    enabledCategories: [...ALL_CATEGORIES],
    channelPreferences: buildDefaultChannelPreferences(),
    frequency: DEFAULT_FREQUENCY,
    quietHours: { ...DEFAULT_QUIET_HOURS },
    unsubscribedCategories: [],
  };
}

/** Map a database row to the TypeScript domain model. */
function rowToPreferences(row: PreferenceRow): NotificationPreferences {
  return {
    userId: row.user_id,
    enabledCategories: row.enabled_categories,
    channelPreferences: row.channel_preferences,
    frequency: row.frequency,
    quietHours: row.quiet_hours,
    unsubscribedCategories: row.unsubscribed_categories,
  };
}

/**
 * Enforce security invariant: security category is always enabled,
 * never unsubscribed, and always has all channels.
 */
function enforceSecurityInvariant(prefs: NotificationPreferences): NotificationPreferences {
  const enabled = prefs.enabledCategories.includes('security')
    ? prefs.enabledCategories
    : [...prefs.enabledCategories, 'security'];

  const unsubscribed = prefs.unsubscribedCategories.filter((c) => c !== 'security');

  const channelPreferences = { ...prefs.channelPreferences };
  channelPreferences.security = [...ALL_CHANNELS];

  return {
    ...prefs,
    enabledCategories: enabled,
    channelPreferences,
    unsubscribedCategories: unsubscribed,
  };
}

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * Create a PostgreSQL-backed preference service.
 *
 * Reads and writes the `notification_preferences` table. When no record
 * exists for a user, sensible defaults are returned (all categories enabled,
 * quiet hours 22:00–07:00 WAT, immediate frequency).
 *
 * Security notifications are always mandatory — the service enforces this
 * invariant on every read and write.
 */
export function createPreferenceService(pool: Pool): PreferenceService {
  async function getPreferences(userId: string): Promise<NotificationPreferences> {
    const result = await pool.query<PreferenceRow>(
      `SELECT id, user_id, enabled_categories, channel_preferences,
              frequency, quiet_hours, unsubscribed_categories,
              created_at, updated_at
       FROM notification_preferences
       WHERE user_id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      return buildDefaultPreferences(userId);
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return enforceSecurityInvariant(rowToPreferences(result.rows[0]!));
  }

  async function updatePreferences(
    userId: string,
    preferences: Partial<NotificationPreferences>,
  ): Promise<void> {
    // Merge with existing (or default) preferences
    const current = await getPreferences(userId);
    const merged = enforceSecurityInvariant({
      ...current,
      ...preferences,
      userId, // userId is immutable
    });

    await pool.query(
      `INSERT INTO notification_preferences
         (user_id, enabled_categories, channel_preferences, frequency,
          quiet_hours, unsubscribed_categories, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         enabled_categories = EXCLUDED.enabled_categories,
         channel_preferences = EXCLUDED.channel_preferences,
         frequency = EXCLUDED.frequency,
         quiet_hours = EXCLUDED.quiet_hours,
         unsubscribed_categories = EXCLUDED.unsubscribed_categories,
         updated_at = NOW()`,
      [
        userId,
        JSON.stringify(merged.enabledCategories),
        JSON.stringify(merged.channelPreferences),
        merged.frequency,
        JSON.stringify(merged.quietHours),
        JSON.stringify(merged.unsubscribedCategories),
      ],
    );
  }

  async function shouldDeliver(
    userId: string,
    category: NotificationCategory,
    channel: NotificationChannel,
  ): Promise<boolean> {
    // Security notifications are always delivered on all channels
    if (category === 'security') {
      return true;
    }

    const prefs = await getPreferences(userId);

    // Category must be enabled and not unsubscribed
    if (!prefs.enabledCategories.includes(category)) {
      return false;
    }
    if (prefs.unsubscribedCategories.includes(category)) {
      return false;
    }

    // Channel must be in the user's preferences for this category
    const channels = prefs.channelPreferences[category];
    if (!channels) {
      return false;
    }

    return channels.includes(channel);
  }

  async function getQuietHours(userId: string): Promise<QuietHours> {
    const prefs = await getPreferences(userId);
    return prefs.quietHours;
  }

  async function isInQuietHours(userId: string, currentTime?: Date): Promise<boolean> {
    const quietHours = await getQuietHours(userId);

    if (!quietHours.enabled) {
      return false;
    }

    // Convert current time to WAT (UTC+1)
    const now = currentTime ?? new Date();
    const watOffsetMs = 60 * 60 * 1000; // +1 hour
    const watTime = new Date(now.getTime() + now.getTimezoneOffset() * 60 * 1000 + watOffsetMs);
    const watMinutes = watTime.getHours() * 60 + watTime.getMinutes();

    const [startH, startM] = quietHours.startTime.split(':').map(Number) as [number, number];
    const [endH, endM] = quietHours.endTime.split(':').map(Number) as [number, number];
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    // Overnight case: e.g. 22:00 → 07:00
    if (startMinutes > endMinutes) {
      return watMinutes >= startMinutes || watMinutes < endMinutes;
    }

    // Same-day case: e.g. 01:00 → 05:00
    return watMinutes >= startMinutes && watMinutes < endMinutes;
  }

  return {
    getPreferences,
    updatePreferences,
    shouldDeliver,
    getQuietHours,
    isInQuietHours,
  };
}
