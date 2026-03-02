-- Migration 011: Create notification system tables
-- Requirements: Data Models from design - Notifications, Templates, Preferences, DeviceTokens

-- Notification category enum
DO $$ BEGIN
  CREATE TYPE notification_category AS ENUM (
    'security',
    'transactions',
    'insights',
    'compliance',
    'system',
    'marketing'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Notification channel enum
DO $$ BEGIN
  CREATE TYPE notification_channel AS ENUM (
    'email',
    'in_app',
    'push'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Notification priority enum
DO $$ BEGIN
  CREATE TYPE notification_priority AS ENUM (
    'critical',
    'high',
    'normal',
    'low'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Notification status enum
DO $$ BEGIN
  CREATE TYPE notification_status AS ENUM (
    'pending',
    'queued',
    'sent',
    'delivered',
    'read',
    'failed',
    'expired'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Device platform enum
DO $$ BEGIN
  CREATE TYPE device_platform AS ENUM (
    'ios',
    'android',
    'web'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Notification frequency enum
DO $$ BEGIN
  CREATE TYPE notification_frequency AS ENUM (
    'immediate',
    'daily_digest',
    'weekly_digest'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── Notifications table ─────────────────────────────────────────────────────

-- In-app notification type enum
DO $$ BEGIN
  CREATE TYPE in_app_notification_type AS ENUM (
    'info',
    'success',
    'warning',
    'error',
    'action_required'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  business_id UUID NOT NULL REFERENCES businesses(id),
  category notification_category NOT NULL,
  template_id UUID,
  template_version VARCHAR(20) NOT NULL DEFAULT '1.0',
  channels JSONB NOT NULL DEFAULT '[]',
  channel notification_channel,
  priority notification_priority NOT NULL DEFAULT 'normal',
  status notification_status NOT NULL DEFAULT 'pending',
  delivery_attempts JSONB NOT NULL DEFAULT '[]',

  -- In-app notification fields
  type in_app_notification_type,
  title TEXT,
  body TEXT,
  actions JSONB,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);

-- Indexes for notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_business_id ON notifications(business_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_category ON notifications(category);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_status ON notifications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_notifications_user_category ON notifications(user_id, category);
CREATE INDEX IF NOT EXISTS idx_notifications_channel ON notifications(channel)
  WHERE channel IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_channel_unread
  ON notifications(user_id, channel) WHERE channel = 'in_app' AND is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_scheduled_at
  ON notifications(scheduled_at) WHERE scheduled_at IS NOT NULL AND status = 'pending';
CREATE INDEX IF NOT EXISTS idx_notifications_expires_at
  ON notifications(expires_at) WHERE status NOT IN ('failed', 'expired');


-- ─── Notification templates table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version VARCHAR(20) NOT NULL DEFAULT '1.0',
  category notification_category NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT NOT NULL,
  push_title TEXT NOT NULL DEFAULT '',
  push_body TEXT NOT NULL DEFAULT '',
  variables JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for notification_templates
CREATE INDEX IF NOT EXISTS idx_notification_templates_category ON notification_templates(category);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_templates_unique_version
  ON notification_templates(id, version);

-- ─── Notification preferences table ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id),
  enabled_categories JSONB NOT NULL DEFAULT '["security","transactions","insights","compliance","system","marketing"]',
  channel_preferences JSONB NOT NULL DEFAULT '{}',
  frequency notification_frequency NOT NULL DEFAULT 'immediate',
  quiet_hours JSONB NOT NULL DEFAULT '{"enabled":true,"startTime":"22:00","endTime":"07:00"}',
  unsubscribed_categories JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for notification_preferences
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_id ON notification_preferences(user_id);

-- ─── Device tokens table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  token TEXT NOT NULL UNIQUE,
  platform device_platform NOT NULL,
  device_name VARCHAR(255) NOT NULL DEFAULT '',
  is_valid BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for device_tokens
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_token ON device_tokens(token);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_valid ON device_tokens(user_id, is_valid)
  WHERE is_valid = TRUE;
