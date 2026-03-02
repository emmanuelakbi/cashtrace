-- Migration 009: Create transaction engine tables
-- Requirements: 6.2 - Transaction normalization, categorization, full-text search, duplicate detection

-- Source type enum
DO $$ BEGIN
  CREATE TYPE source_type AS ENUM (
    'RECEIPT',
    'BANK_STATEMENT',
    'POS_EXPORT',
    'MANUAL'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Transaction type enum
DO $$ BEGIN
  CREATE TYPE transaction_type AS ENUM (
    'INFLOW',
    'OUTFLOW'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Category source enum
DO $$ BEGIN
  CREATE TYPE category_source AS ENUM (
    'AUTO',
    'MANUAL'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Transaction category enum
DO $$ BEGIN
  CREATE TYPE transaction_category AS ENUM (
    'INVENTORY_STOCK',
    'RENT_UTILITIES',
    'SALARIES_WAGES',
    'TRANSPORTATION_LOGISTICS',
    'MARKETING_ADVERTISING',
    'PROFESSIONAL_SERVICES',
    'EQUIPMENT_MAINTENANCE',
    'BANK_CHARGES_FEES',
    'TAXES_LEVIES',
    'MISCELLANEOUS_EXPENSES',
    'PRODUCT_SALES',
    'SERVICE_REVENUE',
    'OTHER_INCOME'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Duplicate status enum
DO $$ BEGIN
  CREATE TYPE duplicate_status AS ENUM (
    'PENDING',
    'REVIEWED',
    'RESOLVED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Audit action enum
DO $$ BEGIN
  CREATE TYPE audit_action AS ENUM (
    'CREATE',
    'UPDATE',
    'DELETE',
    'RESTORE',
    'CATEGORIZE',
    'DUPLICATE_RESOLVE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  source_document_id UUID,
  source_type source_type NOT NULL,
  transaction_type transaction_type NOT NULL,
  transaction_date DATE NOT NULL,
  description TEXT NOT NULL,
  amount_kobo BIGINT NOT NULL,
  counterparty VARCHAR(255),
  reference VARCHAR(255),

  -- Categorization
  category transaction_category NOT NULL,
  category_source category_source NOT NULL DEFAULT 'AUTO',
  category_confidence SMALLINT,
  original_category transaction_category,

  -- Flags
  is_personal BOOLEAN NOT NULL DEFAULT FALSE,
  is_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_of_id UUID,

  -- Metadata
  notes TEXT,
  raw_metadata JSONB DEFAULT '{}',

  -- Full-text search
  search_vector TSVECTOR,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,

  CONSTRAINT amount_positive CHECK (amount_kobo > 0),
  CONSTRAINT confidence_range CHECK (category_confidence IS NULL OR (category_confidence >= 0 AND category_confidence <= 100))
);

-- Indexes for transactions
CREATE INDEX IF NOT EXISTS idx_transactions_business_id ON transactions(business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_source_document ON transactions(source_document_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(transaction_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_source_type ON transactions(source_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_is_personal ON transactions(is_personal) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_is_duplicate ON transactions(is_duplicate) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_amount ON transactions(amount_kobo) WHERE deleted_at IS NULL;

-- Trigger function to update search vector on insert/update
CREATE OR REPLACE FUNCTION update_transaction_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.counterparty, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update search vector before insert or update
CREATE TRIGGER transactions_search_vector_update
  BEFORE INSERT OR UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_transaction_search_vector();

-- GIN index on search_vector for full-text search performance
CREATE INDEX IF NOT EXISTS idx_transactions_search ON transactions USING GIN(search_vector) WHERE deleted_at IS NULL;

-- Transaction audits table
CREATE TABLE IF NOT EXISTS transaction_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  user_id UUID NOT NULL,
  action audit_action NOT NULL,
  changes JSONB NOT NULL DEFAULT '[]',
  ip_address INET NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transaction_audits_transaction ON transaction_audits(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_audits_user ON transaction_audits(user_id);
CREATE INDEX IF NOT EXISTS idx_transaction_audits_created ON transaction_audits(created_at DESC);

-- Duplicate pairs table
CREATE TABLE IF NOT EXISTS duplicate_pairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  transaction1_id UUID NOT NULL REFERENCES transactions(id),
  transaction2_id UUID NOT NULL REFERENCES transactions(id),
  similarity_score SMALLINT NOT NULL,
  amount_match BOOLEAN NOT NULL,
  date_proximity SMALLINT NOT NULL,
  description_similarity SMALLINT NOT NULL,
  status duplicate_status NOT NULL DEFAULT 'PENDING',
  resolved_by UUID,
  resolved_at TIMESTAMP WITH TIME ZONE,
  kept_transaction_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT similarity_range CHECK (similarity_score >= 0 AND similarity_score <= 100),
  CONSTRAINT description_similarity_range CHECK (description_similarity >= 0 AND description_similarity <= 100),
  CONSTRAINT different_transactions CHECK (transaction1_id != transaction2_id)
);

CREATE INDEX IF NOT EXISTS idx_duplicate_pairs_business ON duplicate_pairs(business_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_pairs_status ON duplicate_pairs(status) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_duplicate_pairs_transactions ON duplicate_pairs(transaction1_id, transaction2_id);
