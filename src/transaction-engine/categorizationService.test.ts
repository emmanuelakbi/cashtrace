import { describe, expect, it } from 'vitest';

import {
  categorize,
  getCategoriesForTransactionType,
  getCategoriesForType,
  getSuggestions,
  matchKeywords,
  scoreCategory,
  validateCategory,
} from './categorizationService.js';
import type { NormalizedTransaction } from './types.js';
import { EXPENSE_CATEGORIES, REVENUE_CATEGORIES } from './types.js';

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

function makeTransaction(overrides: Partial<NormalizedTransaction> = {}): NormalizedTransaction {
  return {
    transactionDate: new Date('2024-06-15'),
    description: 'some transaction',
    amountKobo: 500_000,
    transactionType: 'OUTFLOW',
    counterparty: null,
    reference: null,
    rawMetadata: {},
    ...overrides,
  };
}

// ============================================================================
// scoreCategory
// ============================================================================

describe('scoreCategory', () => {
  it('returns 0 when keywords list is empty', () => {
    expect(scoreCategory('some text', [])).toBe(0);
  });

  it('returns 0 when no keywords match', () => {
    expect(scoreCategory('hello world', ['fuel', 'petrol'])).toBe(0);
  });

  it('returns 100 when all keywords match', () => {
    expect(scoreCategory('fuel and petrol costs', ['fuel', 'petrol'])).toBe(100);
  });

  it('returns a partial score when some keywords match', () => {
    const score = scoreCategory('bought fuel today', ['fuel', 'petrol', 'diesel']);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });

  it('is case-insensitive', () => {
    expect(scoreCategory('FUEL purchase', ['fuel'])).toBe(100);
    expect(scoreCategory('fuel purchase', ['FUEL'])).toBe(100);
  });

  it('matches multi-word keywords like "sms alert"', () => {
    const score = scoreCategory('sms alert charge from bank', ['sms alert', 'bank']);
    expect(score).toBe(100);
  });
});

// ============================================================================
// getCategoriesForTransactionType
// ============================================================================

describe('getCategoriesForTransactionType', () => {
  it('returns EXPENSE_CATEGORIES for OUTFLOW', () => {
    const result = getCategoriesForTransactionType('OUTFLOW');
    expect(result).toBe(EXPENSE_CATEGORIES);
  });

  it('returns REVENUE_CATEGORIES for INFLOW', () => {
    const result = getCategoriesForTransactionType('INFLOW');
    expect(result).toBe(REVENUE_CATEGORIES);
  });
});

// ============================================================================
// matchKeywords
// ============================================================================

describe('matchKeywords', () => {
  it('categorises a fuel purchase as TRANSPORTATION_LOGISTICS', () => {
    const result = matchKeywords('Fuel purchase at filling station', null, 'OUTFLOW');
    expect(result.category).toBe('TRANSPORTATION_LOGISTICS');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('categorises rent payment as RENT_UTILITIES', () => {
    const result = matchKeywords('Monthly rent payment', null, 'OUTFLOW');
    expect(result.category).toBe('RENT_UTILITIES');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('categorises a sale as PRODUCT_SALES for INFLOW', () => {
    const result = matchKeywords('Sale of goods to customer', null, 'INFLOW');
    expect(result.category).toBe('PRODUCT_SALES');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('falls back to MISCELLANEOUS_EXPENSES for unrecognised OUTFLOW', () => {
    const result = matchKeywords('xyzzy foobar baz', null, 'OUTFLOW');
    expect(result.category).toBe('MISCELLANEOUS_EXPENSES');
    expect(result.confidence).toBe(0);
  });

  it('falls back to OTHER_INCOME for unrecognised INFLOW', () => {
    const result = matchKeywords('xyzzy foobar baz', null, 'INFLOW');
    expect(result.category).toBe('OTHER_INCOME');
    expect(result.confidence).toBe(0);
  });

  it('includes counterparty in the search text', () => {
    // "bank" keyword should match via counterparty
    const result = matchKeywords('monthly charge', 'GTBank', 'OUTFLOW');
    expect(result.category).toBe('BANK_CHARGES_FEES');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('returns up to 3 alternatives', () => {
    // "service" appears in both EQUIPMENT_MAINTENANCE and PROFESSIONAL_SERVICES
    const result = matchKeywords('professional service fee', null, 'OUTFLOW');
    expect(result.alternatives.length).toBeLessThanOrEqual(3);
    for (const alt of result.alternatives) {
      expect(alt.category).not.toBe(result.category);
      expect(alt.confidence).toBeGreaterThan(0);
    }
  });

  it('alternatives are sorted by confidence descending', () => {
    const result = matchKeywords('bank transfer fee commission charge', null, 'OUTFLOW');
    for (let i = 1; i < result.alternatives.length; i++) {
      const prev = result.alternatives[i - 1];
      const curr = result.alternatives[i];
      expect(prev).toBeDefined();
      expect(curr).toBeDefined();
      expect(prev!.confidence).toBeGreaterThanOrEqual(curr!.confidence);
    }
  });

  it('does not include zero-confidence alternatives when best has a match', () => {
    const result = matchKeywords('salary payment to staff', null, 'OUTFLOW');
    expect(result.category).toBe('SALARIES_WAGES');
    for (const alt of result.alternatives) {
      expect(alt.confidence).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// categorize
// ============================================================================

describe('categorize', () => {
  it('returns AUTO source for all results', () => {
    const result = categorize(makeTransaction({ description: 'Fuel purchase' }));
    expect(result.source).toBe('AUTO');
  });

  it('categorises a fuel purchase as TRANSPORTATION_LOGISTICS with confidence', () => {
    const result = categorize(
      makeTransaction({ description: 'fuel petrol diesel transport delivery shipping logistics' }),
    );
    expect(result.category).toBe('TRANSPORTATION_LOGISTICS');
    expect(result.confidence).toBeGreaterThanOrEqual(30);
  });

  it('assigns MISCELLANEOUS_EXPENSES with confidence 0 for unrecognised OUTFLOW', () => {
    const result = categorize(makeTransaction({ description: 'xyzzy foobar baz' }));
    expect(result.category).toBe('MISCELLANEOUS_EXPENSES');
    expect(result.confidence).toBe(0);
  });

  it('assigns OTHER_INCOME with confidence 0 for unrecognised INFLOW', () => {
    const result = categorize(
      makeTransaction({ description: 'xyzzy foobar baz', transactionType: 'INFLOW' }),
    );
    expect(result.category).toBe('OTHER_INCOME');
    expect(result.confidence).toBe(0);
  });

  it('falls back to default when confidence is below threshold', () => {
    // A very weak match that scores below 30
    const result = categorize(
      makeTransaction({ description: 'random text with a tiny mention of tax somewhere else' }),
    );
    // If confidence < 30, should get default
    if (result.confidence === 0) {
      expect(result.category).toBe('MISCELLANEOUS_EXPENSES');
    } else {
      expect(result.confidence).toBeGreaterThanOrEqual(30);
    }
  });

  it('includes alternativeCategories array', () => {
    const result = categorize(makeTransaction({ description: 'Fuel purchase' }));
    expect(Array.isArray(result.alternativeCategories)).toBe(true);
  });

  it('uses counterparty for categorization', () => {
    const result = categorize(
      makeTransaction({
        description: 'bank charge fee commission transfer atm',
        counterparty: 'GTBank',
      }),
    );
    expect(result.category).toBe('BANK_CHARGES_FEES');
  });
});

// ============================================================================
// getSuggestions
// ============================================================================

describe('getSuggestions', () => {
  it('returns at least one suggestion', () => {
    const suggestions = getSuggestions(makeTransaction({ description: 'Fuel purchase' }));
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
  });

  it('returns suggestions sorted by confidence descending', () => {
    const suggestions = getSuggestions(
      makeTransaction({ description: 'bank transfer fee commission charge' }),
    );
    for (let i = 1; i < suggestions.length; i++) {
      expect(suggestions[i - 1]!.confidence).toBeGreaterThanOrEqual(suggestions[i]!.confidence);
    }
  });

  it('includes the best match as the first element when it has highest confidence', () => {
    const suggestions = getSuggestions(
      makeTransaction({ description: 'Fuel purchase at filling station' }),
    );
    expect(suggestions[0]!.category).toBe('TRANSPORTATION_LOGISTICS');
  });

  it('each suggestion has category, confidence, and reason', () => {
    const suggestions = getSuggestions(makeTransaction({ description: 'salary payment to staff' }));
    for (const s of suggestions) {
      expect(s.category).toBeDefined();
      expect(typeof s.confidence).toBe('number');
      expect(typeof s.reason).toBe('string');
    }
  });

  it('works for INFLOW transactions', () => {
    const suggestions = getSuggestions(
      makeTransaction({ description: 'Sale of goods to customer', transactionType: 'INFLOW' }),
    );
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions[0]!.category).toBe('PRODUCT_SALES');
  });
});

// ============================================================================
// validateCategory
// ============================================================================

describe('validateCategory', () => {
  it('accepts valid expense categories for OUTFLOW', () => {
    expect(validateCategory('INVENTORY_STOCK', 'OUTFLOW')).toBe(true);
    expect(validateCategory('RENT_UTILITIES', 'OUTFLOW')).toBe(true);
    expect(validateCategory('MISCELLANEOUS_EXPENSES', 'OUTFLOW')).toBe(true);
  });

  it('accepts valid revenue categories for INFLOW', () => {
    expect(validateCategory('PRODUCT_SALES', 'INFLOW')).toBe(true);
    expect(validateCategory('SERVICE_REVENUE', 'INFLOW')).toBe(true);
    expect(validateCategory('OTHER_INCOME', 'INFLOW')).toBe(true);
  });

  it('rejects expense categories for INFLOW', () => {
    expect(validateCategory('INVENTORY_STOCK', 'INFLOW')).toBe(false);
    expect(validateCategory('SALARIES_WAGES', 'INFLOW')).toBe(false);
  });

  it('rejects revenue categories for OUTFLOW', () => {
    expect(validateCategory('PRODUCT_SALES', 'OUTFLOW')).toBe(false);
    expect(validateCategory('OTHER_INCOME', 'OUTFLOW')).toBe(false);
  });

  it('rejects invalid category strings', () => {
    expect(validateCategory('INVALID_CATEGORY', 'OUTFLOW')).toBe(false);
    expect(validateCategory('', 'INFLOW')).toBe(false);
    expect(validateCategory('random', 'OUTFLOW')).toBe(false);
  });
});

// ============================================================================
// getCategoriesForType
// ============================================================================

describe('getCategoriesForType', () => {
  it('returns all 10 expense categories for OUTFLOW', () => {
    const categories = getCategoriesForType('OUTFLOW');
    expect(categories).toHaveLength(10);
    expect(categories).toContain('INVENTORY_STOCK');
    expect(categories).toContain('MISCELLANEOUS_EXPENSES');
  });

  it('returns all 3 revenue categories for INFLOW', () => {
    const categories = getCategoriesForType('INFLOW');
    expect(categories).toHaveLength(3);
    expect(categories).toContain('PRODUCT_SALES');
    expect(categories).toContain('SERVICE_REVENUE');
    expect(categories).toContain('OTHER_INCOME');
  });

  it('does not include revenue categories in OUTFLOW', () => {
    const categories = getCategoriesForType('OUTFLOW');
    expect(categories).not.toContain('PRODUCT_SALES');
    expect(categories).not.toContain('OTHER_INCOME');
  });

  it('does not include expense categories in INFLOW', () => {
    const categories = getCategoriesForType('INFLOW');
    expect(categories).not.toContain('INVENTORY_STOCK');
    expect(categories).not.toContain('RENT_UTILITIES');
  });
});
