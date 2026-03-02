import { describe, expect, it } from 'vitest';

import {
  determineTransactionType,
  extractCounterparty,
  formatAsNaira,
  koboToNaira,
  nairaToKobo,
  normalize,
  normalizeBatch,
} from './normalizationService.js';
import type { RawExtractedTransaction } from './types.js';

describe('nairaToKobo', () => {
  it('converts whole Naira amounts to kobo', () => {
    expect(nairaToKobo(1)).toBe(100);
    expect(nairaToKobo(0)).toBe(0);
    expect(nairaToKobo(1000)).toBe(100_000);
  });

  it('converts decimal Naira amounts to kobo', () => {
    expect(nairaToKobo(12.34)).toBe(1234);
    expect(nairaToKobo(0.01)).toBe(1);
    expect(nairaToKobo(0.99)).toBe(99);
  });

  it('rounds to nearest integer to handle floating-point precision', () => {
    // 19.99 * 100 can produce 1998.9999... in floating point
    expect(nairaToKobo(19.99)).toBe(1999);
    expect(nairaToKobo(0.1 + 0.2)).toBe(30);
  });

  it('handles large amounts', () => {
    expect(nairaToKobo(1_000_000)).toBe(100_000_000);
  });
});

describe('koboToNaira', () => {
  it('converts kobo to Naira', () => {
    expect(koboToNaira(100)).toBe(1);
    expect(koboToNaira(0)).toBe(0);
    expect(koboToNaira(1234)).toBe(12.34);
    expect(koboToNaira(1)).toBe(0.01);
    expect(koboToNaira(100_000_000)).toBe(1_000_000);
  });
});

describe('formatAsNaira', () => {
  it('formats kobo as Naira with symbol and two decimals', () => {
    expect(formatAsNaira(123456)).toBe('₦1,234.56');
  });

  it('formats zero', () => {
    expect(formatAsNaira(0)).toBe('₦0.00');
  });

  it('formats small amounts', () => {
    expect(formatAsNaira(1)).toBe('₦0.01');
    expect(formatAsNaira(99)).toBe('₦0.99');
    expect(formatAsNaira(100)).toBe('₦1.00');
  });

  it('formats large amounts with comma separators', () => {
    expect(formatAsNaira(100_000_000)).toBe('₦1,000,000.00');
  });
});

// ---------------------------------------------------------------------------
// determineTransactionType
// ---------------------------------------------------------------------------

describe('determineTransactionType', () => {
  it('maps credit to INFLOW', () => {
    const raw: RawExtractedTransaction = {
      date: '2024-01-15',
      description: 'Payment received',
      amount: 5000,
      type: 'credit',
    };
    expect(determineTransactionType(raw)).toBe('INFLOW');
  });

  it('maps debit to OUTFLOW', () => {
    const raw: RawExtractedTransaction = {
      date: '2024-01-15',
      description: 'Rent payment',
      amount: 50000,
      type: 'debit',
    };
    expect(determineTransactionType(raw)).toBe('OUTFLOW');
  });

  it('defaults to OUTFLOW when type is undefined', () => {
    const raw: RawExtractedTransaction = {
      date: '2024-01-15',
      description: 'Some transaction',
      amount: 1000,
    };
    expect(determineTransactionType(raw)).toBe('OUTFLOW');
  });
});

// ---------------------------------------------------------------------------
// extractCounterparty
// ---------------------------------------------------------------------------

describe('extractCounterparty', () => {
  it('extracts counterparty from bank statement TRF FROM pattern', () => {
    expect(extractCounterparty('TRF FROM John Doe/REF123', 'BANK_STATEMENT')).toBe('John Doe');
  });

  it('extracts counterparty from bank statement TRF TO pattern', () => {
    expect(extractCounterparty('TRF TO Jane Smith/REF456', 'BANK_STATEMENT')).toBe('Jane Smith');
  });

  it('extracts counterparty from NIP/FRM pattern', () => {
    expect(extractCounterparty('NIP/FRM Ade Obi/ACC789', 'BANK_STATEMENT')).toBe('Ade Obi');
  });

  it('extracts counterparty from POS pattern in bank statement', () => {
    expect(extractCounterparty('POS Purchase at ShopRite/TID001', 'BANK_STATEMENT')).toBe(
      'ShopRite',
    );
  });

  it('extracts merchant from POS_EXPORT', () => {
    expect(extractCounterparty('Merchant: Chicken Republic', 'POS_EXPORT')).toBe(
      'Chicken Republic',
    );
  });

  it('returns null for RECEIPT source type', () => {
    expect(extractCounterparty('TRF FROM Someone', 'RECEIPT')).toBeNull();
  });

  it('returns null for MANUAL source type', () => {
    expect(extractCounterparty('TRF FROM Someone', 'MANUAL')).toBeNull();
  });

  it('returns null when no pattern matches', () => {
    expect(extractCounterparty('Random description', 'BANK_STATEMENT')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalize
// ---------------------------------------------------------------------------

describe('normalize', () => {
  it('normalizes a raw transaction into the unified format', () => {
    const raw: RawExtractedTransaction = {
      date: '2024-03-15',
      description: 'TRF FROM Emeka Obi/REF001',
      amount: 15000.5,
      type: 'credit',
      reference: 'REF001',
      metadata: { bank: 'GTBank' },
    };

    const result = normalize(raw, 'BANK_STATEMENT');

    expect(result.transactionDate).toEqual(new Date('2024-03-15'));
    expect(result.amountKobo).toBe(1500050);
    expect(result.transactionType).toBe('INFLOW');
    expect(result.counterparty).toBe('Emeka Obi');
    expect(result.reference).toBe('REF001');
    expect(result.description).toBe('TRF FROM Emeka Obi/REF001');
    expect(result.rawMetadata).toEqual({ bank: 'GTBank' });
  });

  it('uses explicit counterparty over extracted one', () => {
    const raw: RawExtractedTransaction = {
      date: '2024-01-01',
      description: 'TRF FROM Wrong Name/REF',
      amount: 100,
      counterparty: 'Correct Name',
    };

    const result = normalize(raw, 'BANK_STATEMENT');
    expect(result.counterparty).toBe('Correct Name');
  });

  it('converts negative amounts to positive kobo', () => {
    const raw: RawExtractedTransaction = {
      date: '2024-01-01',
      description: 'Refund',
      amount: -500,
      type: 'credit',
    };

    const result = normalize(raw, 'MANUAL');
    expect(result.amountKobo).toBe(50000);
  });

  it('handles Date object input', () => {
    const date = new Date('2024-06-15T10:00:00Z');
    const raw: RawExtractedTransaction = {
      date,
      description: 'Test',
      amount: 100,
    };

    const result = normalize(raw, 'RECEIPT');
    expect(result.transactionDate).toBe(date);
  });

  it('defaults metadata to empty object when not provided', () => {
    const raw: RawExtractedTransaction = {
      date: '2024-01-01',
      description: 'Test',
      amount: 100,
    };

    const result = normalize(raw, 'MANUAL');
    expect(result.rawMetadata).toEqual({});
  });

  it('returns null reference when not provided', () => {
    const raw: RawExtractedTransaction = {
      date: '2024-01-01',
      description: 'Test',
      amount: 100,
    };

    const result = normalize(raw, 'MANUAL');
    expect(result.reference).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeBatch
// ---------------------------------------------------------------------------

describe('normalizeBatch', () => {
  it('normalizes multiple transactions', () => {
    const raws: RawExtractedTransaction[] = [
      { date: '2024-01-01', description: 'First', amount: 100, type: 'credit' },
      { date: '2024-01-02', description: 'Second', amount: 200, type: 'debit' },
      { date: '2024-01-03', description: 'Third', amount: 300 },
    ];

    const results = normalizeBatch(raws, 'RECEIPT');

    expect(results).toHaveLength(3);
    expect(results[0]?.amountKobo).toBe(10000);
    expect(results[0]?.transactionType).toBe('INFLOW');
    expect(results[1]?.amountKobo).toBe(20000);
    expect(results[1]?.transactionType).toBe('OUTFLOW');
    expect(results[2]?.amountKobo).toBe(30000);
    expect(results[2]?.transactionType).toBe('OUTFLOW');
  });

  it('returns empty array for empty input', () => {
    expect(normalizeBatch([], 'MANUAL')).toEqual([]);
  });
});
