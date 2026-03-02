-- Migration 010: Create insights engine tables
-- Requirements: Data Models from design - Insights, InsightTemplates, InsightPreferences

-- Insight category enum
DO $$ BEGIN
  CREATE TYPE insight_category AS ENUM (
    'tax',
    'compliance',
    'cashflow',
    'spending',
    'revenue',
    'operational'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Insight priority enum
DO $$ BEGIN
  CREATE TYPE insight_priority AS ENUM (
    'critical',
    'high',
    'medium',
    'low',
    'info'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Insight status enum
DO $$ BEGIN
  CREATE TYPE insight_status AS ENUM (
    'active',
    'acknowledged',
    'dismissed',
    'resolved',
    'expired'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Insights table
CREATE TABLE IF NOT EXISTS insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id),
  category insight_category NOT NULL,
  type VARCHAR(100) NOT NULL,
  priority insight_priority NOT NULL DEFAULT 'medium',
  status insight_status NOT NULL DEFAULT 'active',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_items JSONB NOT NULL DEFAULT '[]',
  data JSONB NOT NULL DEFAULT '{}',
  score SMALLINT NOT NULL DEFAULT 0,
  financial_impact_kobo BIGINT NOT NULL DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Acknowledgement
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES users(id),

  -- Dismissal
  dismissed_at TIMESTAMPTZ,
  dismissed_by UUID REFERENCES users(id),
  dismiss_reason TEXT,

  -- Resolution
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  resolution_notes TEXT,

  -- Expiration
  expires_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT score_range CHECK (score >= 0 AND score <= 100)
);

-- Indexes for insights
CREATE INDEX IF NOT EXISTS idx_insights_business_id ON insights(business_id);
CREATE INDEX IF NOT EXISTS idx_insights_status ON insights(status);
CREATE INDEX IF NOT EXISTS idx_insights_category ON insights(category);
CREATE INDEX IF NOT EXISTS idx_insights_priority ON insights(priority);
CREATE INDEX IF NOT EXISTS idx_insights_expires_at ON insights(expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_insights_business_status ON insights(business_id, status);
CREATE INDEX IF NOT EXISTS idx_insights_business_category ON insights(business_id, category);
CREATE INDEX IF NOT EXISTS idx_insights_created_at ON insights(created_at DESC);

-- Insight templates table
CREATE TABLE IF NOT EXISTS insight_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version VARCHAR(20) NOT NULL DEFAULT '1.0',
  category insight_category NOT NULL,
  type VARCHAR(100) NOT NULL,
  title_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  action_item_templates JSONB NOT NULL DEFAULT '[]',
  variables JSONB NOT NULL DEFAULT '[]',
  locale VARCHAR(5) NOT NULL DEFAULT 'en',

  CONSTRAINT valid_locale CHECK (locale IN ('en', 'pcm'))
);

-- Indexes for insight_templates
CREATE INDEX IF NOT EXISTS idx_insight_templates_category ON insight_templates(category);
CREATE INDEX IF NOT EXISTS idx_insight_templates_type ON insight_templates(type);
CREATE INDEX IF NOT EXISTS idx_insight_templates_locale ON insight_templates(locale);
CREATE UNIQUE INDEX IF NOT EXISTS idx_insight_templates_unique_version
  ON insight_templates(category, type, version, locale);

-- Insight preferences table
CREATE TABLE IF NOT EXISTS insight_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL UNIQUE REFERENCES businesses(id),
  excluded_categories JSONB NOT NULL DEFAULT '[]',
  frequency_overrides JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for insight_preferences
CREATE INDEX IF NOT EXISTS idx_insight_preferences_business_id ON insight_preferences(business_id);
