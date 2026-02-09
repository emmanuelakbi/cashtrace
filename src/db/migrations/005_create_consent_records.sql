-- Migration: Create consent records table
CREATE TABLE IF NOT EXISTS consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_type VARCHAR(50) NOT NULL,
  consent_version VARCHAR(20) NOT NULL,
  ip_address VARCHAR(45) NOT NULL,
  user_agent TEXT,
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  revoked_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_consent_records_user_id ON consent_records(user_id);
