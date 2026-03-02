-- Migration 008: Create document processing tables
-- Requirements: 10.1 - Document metadata storage for uploads, processing jobs, and status tracking

-- Document types enum
DO $$ BEGIN
  CREATE TYPE document_type AS ENUM (
    'RECEIPT_IMAGE',
    'BANK_STATEMENT',
    'POS_EXPORT'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Document status enum
DO $$ BEGIN
  CREATE TYPE document_status AS ENUM (
    'UPLOADED',
    'PROCESSING',
    'PARSED',
    'PARTIAL',
    'ERROR'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Job status enum
DO $$ BEGIN
  CREATE TYPE job_status AS ENUM (
    'PENDING',
    'ACTIVE',
    'COMPLETED',
    'FAILED',
    'RETRYING'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Documents table
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  user_id UUID NOT NULL,
  filename VARCHAR(255) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  document_type document_type NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size INTEGER NOT NULL,
  s3_key VARCHAR(500) NOT NULL,
  s3_bucket VARCHAR(100) NOT NULL,
  status document_status NOT NULL DEFAULT 'UPLOADED',
  processing_started_at TIMESTAMP WITH TIME ZONE,
  processing_completed_at TIMESTAMP WITH TIME ZONE,
  processing_duration_ms INTEGER,
  transactions_extracted INTEGER,
  processing_warnings TEXT[] DEFAULT '{}',
  processing_errors TEXT[] DEFAULT '{}',
  idempotency_key VARCHAR(64),
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT file_size_limit CHECK (file_size <= 10485760)
);

CREATE INDEX IF NOT EXISTS idx_documents_business_id ON documents(business_id);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_at ON documents(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_idempotency_key ON documents(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Processing jobs table
CREATE TABLE IF NOT EXISTS processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status job_status NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  next_retry_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_document_id ON processing_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_next_retry_at ON processing_jobs(next_retry_at) WHERE status = 'RETRYING';
