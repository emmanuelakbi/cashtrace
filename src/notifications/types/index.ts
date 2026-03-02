/**
 * Notification System - Type Definitions
 *
 * Core types, enums, and interfaces for the notification module.
 *
 * @module notifications/types
 */

// ─── Enums ───

export type NotificationCategory =
  | 'security'
  | 'transactions'
  | 'insights'
  | 'compliance'
  | 'system'
  | 'marketing';

export type NotificationChannel = 'email' | 'in_app' | 'push';

export type NotificationPriority = 'critical' | 'high' | 'normal' | 'low';

export type NotificationStatus =
  | 'pending'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'expired';

export type DeliveryStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'failed';

export type NotificationFrequency = 'immediate' | 'daily_digest' | 'weekly_digest';

export type InAppNotificationType = 'info' | 'success' | 'warning' | 'error' | 'action_required';

export type DevicePlatform = 'ios' | 'android' | 'web';

// ─── Core Interfaces ───

export interface NotificationRequest {
  userId: string;
  businessId: string;
  category: NotificationCategory;
  templateId: string;
  variables: Record<string, unknown>;
  channels?: NotificationChannel[];
  priority?: NotificationPriority;
}

export interface NotificationResult {
  notificationId: string;
  status: NotificationStatus;
  channels: NotificationChannel[];
  createdAt: Date;
}

export interface Notification {
  id: string;
  userId: string;
  businessId: string;
  category: NotificationCategory;
  templateId: string;
  templateVersion: string;
  channels: NotificationChannel[];
  priority: NotificationPriority;
  status: NotificationStatus;
  deliveryAttempts: DeliveryAttempt[];
  createdAt: Date;
  scheduledAt: Date | null;
  sentAt: Date | null;
  readAt: Date | null;
  expiresAt: Date;
}

export interface DeliveryAttempt {
  channel: NotificationChannel;
  attemptNumber: number;
  status: DeliveryStatus;
  timestamp: Date;
  errorMessage: string | null;
}

// ─── Template Types ───

export interface NotificationTemplate {
  id: string;
  version: string;
  category: NotificationCategory;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  pushTitle: string;
  pushBody: string;
  variables: TemplateVariable[];
}

export interface TemplateVariable {
  name: string;
  required: boolean;
  type: 'string' | 'number' | 'date' | 'currency';
  defaultValue?: unknown;
}

export interface RenderedTemplate {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  pushTitle: string;
  pushBody: string;
}

export interface ValidationResult {
  valid: boolean;
  missingVariables: string[];
  invalidVariables: string[];
}

// ─── Preference Types ───

export interface NotificationPreferences {
  userId: string;
  enabledCategories: NotificationCategory[];
  channelPreferences: Record<NotificationCategory, NotificationChannel[]>;
  frequency: NotificationFrequency;
  quietHours: QuietHours;
  unsubscribedCategories: NotificationCategory[];
}

export interface QuietHours {
  enabled: boolean;
  startTime: string; // HH:mm in WAT
  endTime: string; // HH:mm in WAT
}

// ─── Channel Types ───

export interface EmailMessage {
  to: string;
  from: string;
  replyTo: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  headers: Record<string, string>;
  metadata: Record<string, string>;
}

export interface DeliveryResult {
  messageId: string;
  status: DeliveryStatus;
  timestamp: Date;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export interface DeviceToken {
  id: string;
  userId: string;
  token: string;
  platform: DevicePlatform;
  deviceName: string;
  isValid: boolean;
  createdAt: Date;
  lastUsedAt: Date;
}

// ─── Error Codes ───

export const NOTIFICATION_ERROR_CODES = {
  NOTIF_INVALID_TEMPLATE: 'NOTIF_INVALID_TEMPLATE',
  NOTIF_MISSING_VARIABLES: 'NOTIF_MISSING_VARIABLES',
  NOTIF_USER_NOT_FOUND: 'NOTIF_USER_NOT_FOUND',
  NOTIF_RATE_LIMITED: 'NOTIF_RATE_LIMITED',
  NOTIF_CHANNEL_UNAVAILABLE: 'NOTIF_CHANNEL_UNAVAILABLE',
  NOTIF_PROVIDER_ERROR: 'NOTIF_PROVIDER_ERROR',
} as const;

export type NotificationErrorCode =
  (typeof NOTIFICATION_ERROR_CODES)[keyof typeof NOTIFICATION_ERROR_CODES];

// ─── In-App Types ───

export interface NotificationAction {
  label: string;
  type: 'navigate' | 'api_call';
  target: string; // URL or route path
}

export interface InAppNotification {
  id: string;
  userId: string;
  businessId: string;
  category: NotificationCategory;
  type: InAppNotificationType;
  title: string;
  body: string;
  actions?: NotificationAction[];
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface InAppGetOptions {
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

// ─── Email Event Types ───

export type BounceType = 'hard' | 'soft';

export interface BounceEvent {
  messageId: string;
  email: string;
  bounceType: BounceType;
  timestamp: Date;
}

export interface UnsubscribeEvent {
  messageId: string;
  email: string;
  category: NotificationCategory;
  timestamp: Date;
}

// ─── Unsubscribe Audit Types ───

export type UnsubscribeAction = 'unsubscribe' | 'resubscribe';

export type UnsubscribeMethod = 'one_click_link' | 'direct' | 'api';

export interface UnsubscribeAuditEntry {
  id: string;
  userId: string;
  category: NotificationCategory;
  action: UnsubscribeAction;
  method: UnsubscribeMethod;
  timestamp: Date;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}
