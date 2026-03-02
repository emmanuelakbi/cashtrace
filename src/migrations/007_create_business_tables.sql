-- Migration 007: Create business management tables
-- Requirements: Data Models from design - Business entities, audit logs, NDPR compliance

-- Business sectors enum
CREATE TYPE business_sector AS ENUM (
  'RETAIL_TRADING',
  'PROFESSIONAL_SERVICES',
  'MANUFACTURING',
  'AGRICULTURE_AGRIBUSINESS',
  'TECHNOLOGY_DIGITAL',
  'HOSPITALITY_FOOD',
  'TRANSPORTATION_LOGISTICS',
  'HEALTHCARE_PHARMA',
  'EDUCATION_TRAINING',
  'CONSTRUCTION_REAL_ESTATE',
  'OTHER'
);

-- Currency enum
CREATE TYPE currency AS ENUM ('NGN', 'USD', 'GBP');

-- Business event types enum
CREATE TYPE business_event_type AS ENUM (
  'BUSINESS_CREATED',
  'BUSINESS_UPDATED',
  'BUSINESS_SOFT_DELETED',
  'BUSINESS_RESTORED',
  'BUSINESS_HARD_DELETED',
  'BUSINESS_EXPORTED'
);

-- Businesses table
CREATE TABLE IF NOT EXISTS businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  sector business_sector NOT NULL DEFAULT 'OTHER',
  currency currency NOT NULL DEFAULT 'NGN',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  hard_delete_at TIMESTAMP WITH TIME ZONE,

  CONSTRAINT name_length CHECK (char_length(name) >= 2)
);

CREATE INDEX IF NOT EXISTS idx_businesses_user_id ON businesses(user_id);
CREATE INDEX IF NOT EXISTS idx_businesses_deleted_at ON businesses(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_businesses_hard_delete_at ON businesses(hard_delete_at) WHERE hard_delete_at IS NOT NULL;

-- Business audit logs table
CREATE TABLE IF NOT EXISTS business_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type business_event_type NOT NULL,
  user_id UUID NOT NULL,
  business_id UUID NOT NULL,
  ip_address VARCHAR(45) NOT NULL,
  user_agent TEXT,
  request_id VARCHAR(36) NOT NULL,
  previous_values JSONB,
  new_values JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_audit_logs_business_id ON business_audit_logs(business_id);
CREATE INDEX IF NOT EXISTS idx_business_audit_logs_user_id ON business_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_business_audit_logs_created_at ON business_audit_logs(created_at);
