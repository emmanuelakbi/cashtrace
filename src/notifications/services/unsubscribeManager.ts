/**
 * Unsubscribe Manager
 *
 * Handles one-click unsubscribe links, category-specific unsubscribe,
 * and unsubscribe state queries. Integrates with PreferenceService to
 * persist unsubscribe state. Security notifications cannot be unsubscribed.
 *
 * Tokens are HMAC-signed to prevent tampering — no database lookup needed
 * to validate an unsubscribe link.
 *
 * @module notifications/services/unsubscribeManager
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { v4 as uuidv4 } from 'uuid';

import type {
  NotificationCategory,
  UnsubscribeAuditEntry,
  UnsubscribeMethod,
} from '../types/index.js';

import type { PreferenceService } from './preferenceService.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const UNSUBSCRIBABLE_CATEGORIES: NotificationCategory[] = [
  'transactions',
  'insights',
  'compliance',
  'system',
  'marketing',
];

const TOKEN_SEPARATOR = '.';
const TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UnsubscribeManagerConfig {
  /** Base URL for unsubscribe links (e.g. https://cashtrace.ng) */
  baseUrl: string;
  /** HMAC secret for signing unsubscribe tokens */
  secret: string;
}

export interface UnsubscribeResult {
  success: boolean;
  userId?: string;
  category?: NotificationCategory;
  error?: string;
}

export interface UnsubscribeManager {
  /** Generate a signed one-click unsubscribe URL for a user + category. */
  generateUnsubscribeLink(userId: string, category: NotificationCategory): string;
  /** Validate a signed token and process the unsubscribe. */
  processUnsubscribe(token: string): Promise<UnsubscribeResult>;
  /** Directly unsubscribe a user from a specific category. */
  unsubscribeFromCategory(userId: string, category: NotificationCategory): Promise<boolean>;
  /** Get the list of categories a user has unsubscribed from. */
  getUnsubscribedCategories(userId: string): Promise<NotificationCategory[]>;
  /** Check whether a user is unsubscribed from a specific category. */
  isUnsubscribed(userId: string, category: NotificationCategory): Promise<boolean>;
  /** Get all audit trail entries for a user (NDPR compliance). */
  getAuditTrail(userId: string): Promise<UnsubscribeAuditEntry[]>;
}

// ─── Token helpers ───────────────────────────────────────────────────────────

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function buildTokenPayload(
  userId: string,
  category: NotificationCategory,
  expiresAt: number,
): string {
  return [userId, category, String(expiresAt)].join(TOKEN_SEPARATOR);
}

function encodeToken(
  userId: string,
  category: NotificationCategory,
  expiresAt: number,
  secret: string,
): string {
  const payload = buildTokenPayload(userId, category, expiresAt);
  const signature = sign(payload, secret);
  return Buffer.from([payload, signature].join(TOKEN_SEPARATOR)).toString('base64url');
}

interface ParsedToken {
  userId: string;
  category: NotificationCategory;
  expiresAt: number;
  signature: string;
}

function decodeToken(token: string): ParsedToken | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const parts = decoded.split(TOKEN_SEPARATOR);
    if (parts.length !== 4) {
      return null;
    }
    const [userId, category, expiresAtStr, signature] = parts as [string, string, string, string];
    const expiresAt = Number(expiresAtStr);
    if (Number.isNaN(expiresAt)) {
      return null;
    }
    return {
      userId,
      category: category as NotificationCategory,
      expiresAt,
      signature,
    };
  } catch {
    return null;
  }
}

function verifySignature(parsed: ParsedToken, secret: string): boolean {
  const payload = buildTokenPayload(parsed.userId, parsed.category, parsed.expiresAt);
  const expected = sign(payload, secret);
  const sigBuf = Buffer.from(parsed.signature, 'utf-8');
  const expectedBuf = Buffer.from(expected, 'utf-8');
  if (sigBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(sigBuf, expectedBuf);
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createUnsubscribeManager(
  preferenceService: PreferenceService,
  config: UnsubscribeManagerConfig,
): UnsubscribeManager {
  /** In-memory audit trail store keyed by userId. */
  const auditStore = new Map<string, UnsubscribeAuditEntry[]>();

  function recordAuditEntry(
    userId: string,
    category: NotificationCategory,
    method: UnsubscribeMethod,
    metadata?: Record<string, unknown>,
  ): void {
    const entry: UnsubscribeAuditEntry = {
      id: uuidv4(),
      userId,
      category,
      action: 'unsubscribe',
      method,
      timestamp: new Date(),
      metadata,
    };
    const entries = auditStore.get(userId) ?? [];
    entries.push(entry);
    auditStore.set(userId, entries);
  }

  function generateUnsubscribeLink(userId: string, category: NotificationCategory): string {
    if (category === 'security') {
      throw new Error('Cannot generate unsubscribe link for security notifications');
    }
    const expiresAt = Date.now() + TOKEN_EXPIRY_MS;
    const token = encodeToken(userId, category, expiresAt, config.secret);
    const base = config.baseUrl.replace(/\/+$/, '');
    return `${base}/api/notifications/unsubscribe?token=${token}`;
  }

  async function processUnsubscribe(token: string): Promise<UnsubscribeResult> {
    const parsed = decodeToken(token);
    if (!parsed) {
      return { success: false, error: 'Invalid token' };
    }

    if (!verifySignature(parsed, config.secret)) {
      return { success: false, error: 'Invalid token signature' };
    }

    if (Date.now() > parsed.expiresAt) {
      return { success: false, error: 'Token expired' };
    }

    if (parsed.category === 'security') {
      return { success: false, error: 'Cannot unsubscribe from security notifications' };
    }

    if (!UNSUBSCRIBABLE_CATEGORIES.includes(parsed.category)) {
      return { success: false, error: 'Invalid category' };
    }

    const ok = await unsubscribeFromCategory(parsed.userId, parsed.category);
    if (!ok) {
      return {
        success: false,
        userId: parsed.userId,
        category: parsed.category,
        error: 'Cannot unsubscribe from security notifications',
      };
    }

    recordAuditEntry(parsed.userId, parsed.category, 'one_click_link');

    return { success: true, userId: parsed.userId, category: parsed.category };
  }

  async function unsubscribeFromCategory(
    userId: string,
    category: NotificationCategory,
  ): Promise<boolean> {
    if (category === 'security') {
      return false;
    }

    const prefs = await preferenceService.getPreferences(userId);
    const alreadyUnsubscribed = prefs.unsubscribedCategories.includes(category);
    if (alreadyUnsubscribed) {
      return true; // idempotent
    }

    const unsubscribedCategories = [...prefs.unsubscribedCategories, category];
    const enabledCategories = prefs.enabledCategories.filter((c) => c !== category);

    await preferenceService.updatePreferences(userId, {
      unsubscribedCategories,
      enabledCategories,
    });

    recordAuditEntry(userId, category, 'direct');

    return true;
  }

  async function getUnsubscribedCategories(userId: string): Promise<NotificationCategory[]> {
    const prefs = await preferenceService.getPreferences(userId);
    return prefs.unsubscribedCategories;
  }

  async function isUnsubscribed(userId: string, category: NotificationCategory): Promise<boolean> {
    if (category === 'security') {
      return false; // security is never unsubscribed
    }
    const prefs = await preferenceService.getPreferences(userId);
    return prefs.unsubscribedCategories.includes(category);
  }

  async function getAuditTrail(userId: string): Promise<UnsubscribeAuditEntry[]> {
    return auditStore.get(userId) ?? [];
  }

  return {
    generateUnsubscribeLink,
    processUnsubscribe,
    unsubscribeFromCategory,
    getUnsubscribedCategories,
    isUnsubscribed,
    getAuditTrail,
  };
}
