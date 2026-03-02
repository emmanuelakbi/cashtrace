// ============================================================================
// Transaction Engine Module — Type Definitions
// ============================================================================

// ---------------------------------------------------------------------------
// Enums / Type Aliases
// ---------------------------------------------------------------------------

export type SourceType = 'RECEIPT' | 'BANK_STATEMENT' | 'POS_EXPORT' | 'MANUAL';

export type TransactionType = 'INFLOW' | 'OUTFLOW';

export type CategorySource = 'AUTO' | 'MANUAL';

export type ExpenseCategory =
  | 'INVENTORY_STOCK'
  | 'RENT_UTILITIES'
  | 'SALARIES_WAGES'
  | 'TRANSPORTATION_LOGISTICS'
  | 'MARKETING_ADVERTISING'
  | 'PROFESSIONAL_SERVICES'
  | 'EQUIPMENT_MAINTENANCE'
  | 'BANK_CHARGES_FEES'
  | 'TAXES_LEVIES'
  | 'MISCELLANEOUS_EXPENSES';

export type RevenueCategory = 'PRODUCT_SALES' | 'SERVICE_REVENUE' | 'OTHER_INCOME';

export type TransactionCategory = ExpenseCategory | RevenueCategory;

export type DuplicateStatus = 'PENDING' | 'REVIEWED' | 'RESOLVED';

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'RESTORE'
  | 'CATEGORIZE'
  | 'DUPLICATE_RESOLVE';

// ---------------------------------------------------------------------------
// Data Model Interfaces
// ---------------------------------------------------------------------------

export interface Transaction {
  id: string;
  businessId: string;
  sourceDocumentId: string | null;
  sourceType: SourceType;
  transactionType: TransactionType;
  transactionDate: Date;
  description: string;
  amountKobo: number;
  counterparty: string | null;
  reference: string | null;

  // Categorization
  category: TransactionCategory;
  categorySource: CategorySource;
  categoryConfidence: number | null;
  originalCategory: TransactionCategory | null;

  // Flags
  isPersonal: boolean;
  isDuplicate: boolean;
  duplicateOfId: string | null;

  // Metadata
  notes: string | null;
  rawMetadata: Record<string, unknown>;

  // Search
  searchVector: string | null;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface AuditChanges {
  field: string;
  previousValue: unknown;
  newValue: unknown;
}

export interface TransactionAudit {
  id: string;
  transactionId: string;
  userId: string;
  action: AuditAction;
  changes: AuditChanges[];
  ipAddress: string;
  userAgent: string | null;
  createdAt: Date;
}

export interface DuplicatePair {
  id: string;
  businessId: string;
  transaction1Id: string;
  transaction2Id: string;
  similarityScore: number;
  amountMatch: boolean;
  dateProximity: number;
  descriptionSimilarity: number;
  status: DuplicateStatus;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  keptTransactionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Service Interfaces
// ---------------------------------------------------------------------------

export interface RawExtractedTransaction {
  date: string | Date;
  description: string;
  amount: number; // in Naira (may have decimals)
  type?: 'credit' | 'debit';
  reference?: string;
  counterparty?: string;
  metadata?: Record<string, unknown>;
}

export interface NormalizedTransaction {
  transactionDate: Date;
  description: string;
  amountKobo: number; // integer
  transactionType: TransactionType;
  counterparty: string | null;
  reference: string | null;
  rawMetadata: Record<string, unknown>;
}

export interface CategorizationResult {
  category: TransactionCategory;
  confidence: number; // 0-100
  source: CategorySource;
  alternativeCategories: CategorySuggestion[];
}

export interface CategorySuggestion {
  category: TransactionCategory;
  confidence: number;
  reason: string;
}

export interface TransactionFilters {
  startDate?: Date;
  endDate?: Date;
  minAmount?: number; // in kobo
  maxAmount?: number; // in kobo
  category?: TransactionCategory;
  sourceType?: SourceType;
  transactionType?: TransactionType;
  isPersonal?: boolean;
  page: number;
  pageSize: number;
  sortBy: 'transactionDate' | 'amount' | 'createdAt';
  sortOrder: 'asc' | 'desc';
}

export interface TransactionUpdates {
  description?: string;
  transactionDate?: Date;
  category?: TransactionCategory;
  categorySource?: CategorySource;
  isPersonal?: boolean;
  notes?: string;
}

export interface BulkCreateResult {
  created: number;
  transactions: Transaction[];
  duplicatesDetected: number;
}

export interface SimilarityScore {
  overall: number;
  amountMatch: boolean;
  dateProximity: number;
  descriptionSimilarity: number;
}

export interface SearchResult {
  transactions: RankedTransaction[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface RankedTransaction extends Transaction {
  relevanceScore: number;
  matchedFields: string[];
}

// ---------------------------------------------------------------------------
// API Request Types
// ---------------------------------------------------------------------------

export interface ListTransactionsRequest {
  startDate?: string; // ISO 8601
  endDate?: string; // ISO 8601
  minAmount?: number; // in kobo
  maxAmount?: number; // in kobo
  category?: TransactionCategory;
  sourceType?: SourceType;
  transactionType?: TransactionType;
  isPersonal?: boolean;
  page?: number; // Default 1
  pageSize?: number; // Default 20, max 100
}

export interface GetTransactionRequest {
  transactionId: string;
}

export interface UpdateTransactionRequest {
  transactionId: string;
  description?: string;
  transactionDate?: string; // ISO 8601
  category?: TransactionCategory;
  isPersonal?: boolean;
  notes?: string;
}

export interface BulkCreateRequest {
  sourceDocumentId: string;
  sourceType: SourceType;
  transactions: RawExtractedTransaction[];
}

export interface SearchRequest {
  query: string;
  startDate?: string;
  endDate?: string;
  category?: TransactionCategory;
  transactionType?: TransactionType;
  page?: number;
  pageSize?: number;
}

export interface GetDuplicatesRequest {
  status?: DuplicateStatus;
  page?: number;
  pageSize?: number;
}

export interface ResolveDuplicateRequest {
  duplicatePairId: string;
  action: 'KEEP_FIRST' | 'KEEP_SECOND' | 'NOT_DUPLICATE';
}

export interface DeleteTransactionRequest {
  transactionId: string;
}

// ---------------------------------------------------------------------------
// API Response Types
// ---------------------------------------------------------------------------

export interface TransactionPublic {
  id: string;
  sourceType: SourceType;
  sourceTypeDisplay: string;
  sourceDocumentId: string | null;
  transactionType: TransactionType;
  transactionTypeDisplay: string;
  transactionDate: string; // ISO 8601
  description: string;
  amountKobo: number;
  amountNaira: string; // Formatted: "₦1,234.56"
  counterparty: string | null;
  reference: string | null;
  category: TransactionCategory;
  categoryDisplay: string;
  originalCategory: TransactionCategory | null;
  categorySource: CategorySource;
  categoryConfidence: number | null;
  isPersonal: boolean;
  isDuplicate: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DuplicatePairPublic {
  id: string;
  transaction1: TransactionPublic;
  transaction2: TransactionPublic;
  similarityScore: number;
  amountMatch: boolean;
  dateProximity: number;
  descriptionSimilarity: number;
  status: DuplicateStatus;
  createdAt: string;
}

export interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface TransactionListResponse {
  success: boolean;
  transactions: TransactionPublic[];
  pagination: PaginationInfo;
  requestId: string;
}

export interface TransactionResponse {
  success: boolean;
  transaction: TransactionPublic;
  requestId: string;
}

export interface BulkCreateResponse {
  success: boolean;
  created: number;
  duplicatesDetected: number;
  transactions: TransactionPublic[];
  requestId: string;
}

export interface DuplicateListResponse {
  success: boolean;
  duplicates: DuplicatePairPublic[];
  pagination: PaginationInfo;
  requestId: string;
}

export interface GenericResponse {
  success: boolean;
  message: string;
  requestId: string;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
  };
  requestId: string;
}

// ---------------------------------------------------------------------------
// Category Constants with Keywords
// ---------------------------------------------------------------------------

export interface CategoryInfo {
  code: string;
  name: string;
  keywords: string[];
}

export const EXPENSE_CATEGORIES: Record<ExpenseCategory, CategoryInfo> = {
  INVENTORY_STOCK: {
    code: 'INVENTORY_STOCK',
    name: 'Inventory & Stock',
    keywords: ['stock', 'inventory', 'goods', 'merchandise', 'supplies', 'wholesale'],
  },
  RENT_UTILITIES: {
    code: 'RENT_UTILITIES',
    name: 'Rent & Utilities',
    keywords: ['rent', 'electricity', 'nepa', 'phcn', 'water', 'internet', 'dstv', 'gotv'],
  },
  SALARIES_WAGES: {
    code: 'SALARIES_WAGES',
    name: 'Salaries & Wages',
    keywords: ['salary', 'wage', 'payroll', 'staff', 'employee'],
  },
  TRANSPORTATION_LOGISTICS: {
    code: 'TRANSPORTATION_LOGISTICS',
    name: 'Transportation & Logistics',
    keywords: [
      'transport',
      'fuel',
      'petrol',
      'diesel',
      'delivery',
      'shipping',
      'logistics',
      'uber',
      'bolt',
    ],
  },
  MARKETING_ADVERTISING: {
    code: 'MARKETING_ADVERTISING',
    name: 'Marketing & Advertising',
    keywords: ['marketing', 'advertising', 'ads', 'promotion', 'flyer', 'banner'],
  },
  PROFESSIONAL_SERVICES: {
    code: 'PROFESSIONAL_SERVICES',
    name: 'Professional Services',
    keywords: ['lawyer', 'accountant', 'consultant', 'legal', 'audit', 'professional'],
  },
  EQUIPMENT_MAINTENANCE: {
    code: 'EQUIPMENT_MAINTENANCE',
    name: 'Equipment & Maintenance',
    keywords: ['equipment', 'repair', 'maintenance', 'service', 'parts'],
  },
  BANK_CHARGES_FEES: {
    code: 'BANK_CHARGES_FEES',
    name: 'Bank Charges & Fees',
    keywords: ['bank', 'charge', 'fee', 'commission', 'transfer', 'atm', 'sms alert'],
  },
  TAXES_LEVIES: {
    code: 'TAXES_LEVIES',
    name: 'Taxes & Levies',
    keywords: ['tax', 'levy', 'vat', 'withholding', 'firs', 'lirs'],
  },
  MISCELLANEOUS_EXPENSES: {
    code: 'MISCELLANEOUS_EXPENSES',
    name: 'Miscellaneous Expenses',
    keywords: [],
  },
};

export const REVENUE_CATEGORIES: Record<RevenueCategory, CategoryInfo> = {
  PRODUCT_SALES: {
    code: 'PRODUCT_SALES',
    name: 'Product Sales',
    keywords: ['sale', 'sold', 'purchase', 'order', 'customer'],
  },
  SERVICE_REVENUE: {
    code: 'SERVICE_REVENUE',
    name: 'Service Revenue',
    keywords: ['service', 'consultation', 'fee', 'commission'],
  },
  OTHER_INCOME: {
    code: 'OTHER_INCOME',
    name: 'Other Income',
    keywords: [],
  },
};

// ---------------------------------------------------------------------------
// Custom Error Classes
// ---------------------------------------------------------------------------

/**
 * Base error class for transaction-engine domain errors.
 *
 * Carries a typed `code` property that maps to a specific HTTP status
 * via the error middleware's ERROR_STATUS_MAP.
 */
export class TransactionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'TransactionError';
    this.code = code;
  }
}

export class TransactionNotFoundError extends TransactionError {
  constructor(message = 'Transaction not found') {
    super('TXN_NOT_FOUND', message);
    this.name = 'TransactionNotFoundError';
  }
}

export class TransactionForbiddenError extends TransactionError {
  constructor(message = 'Forbidden: you do not own this transaction') {
    super('TXN_FORBIDDEN', message);
    this.name = 'TransactionForbiddenError';
  }
}

export class TransactionInvalidCategoryError extends TransactionError {
  constructor(category: string, transactionType: string) {
    super(
      'TXN_INVALID_CATEGORY',
      `Invalid category '${category}' for ${transactionType} transaction`,
    );
    this.name = 'TransactionInvalidCategoryError';
  }
}
