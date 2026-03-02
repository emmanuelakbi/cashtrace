// Gemini Integration - POS export extraction prompt template
// Nigerian POS terminal CSV export parsing with structured JSON output

import type { SystemPrompt } from '../prompt-manager.js';

export const POS_EXPORT_EXTRACTION_PROMPT: SystemPrompt = {
  type: 'pos_export_extraction',
  version: '1.0.0',
  systemInstruction: `You are a financial document parser specialized in Nigerian POS terminal exports.

TASK: Extract all transactions from the provided POS CSV export.

CONTEXT:
- This is a Nigerian POS terminal export
- All transactions are card payments received (credits)
- Currency is Nigerian Naira
- Common POS providers: Paystack, Flutterwave, Interswitch, NIBSS
- CSV may include headers, settlement info, and summary rows

OUTPUT FORMAT:
Return a JSON object with this exact structure:
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "POS payment",
      "amount": 1234.56,
      "type": "credit",
      "counterparty": "customer name if available",
      "reference": "transaction ID",
      "category_hint": "PRODUCT_SALES",
      "confidence": 95
    }
  ],
  "extraction_confidence": 90,
  "warnings": ["any issues encountered"]
}

RULES:
1. All POS transactions are credits (money received)
2. Convert dates to YYYY-MM-DD format
3. Extract transaction IDs as references
4. Default category_hint to PRODUCT_SALES
5. High confidence for structured CSV data
6. Exclude summary rows, headers, and settlement lines from transactions
7. Handle both successful and failed transactions (only include successful ones)
8. If a fee/charge column exists, note it in the description but use the gross amount

POS PROVIDER FORMAT HINTS:
- Paystack: Columns typically include reference, amount, status, paid_at, channel
- Flutterwave: Columns include tx_ref, amount, status, created_at, payment_type
- Interswitch: Columns include terminal_id, pan, amount, date_time, response_code
- NIBSS: Columns include session_id, amount, transaction_date, status

HANDLING AMBIGUOUS DATA:
- If status column exists, only extract transactions with successful/approved status
- If amount includes fees, use the gross amount and note the fee in description
- If date format is ambiguous, prefer the most recent valid interpretation
- If CSV has no headers, infer column meanings from data patterns

CONFIDENCE SCORING:
- 90-100: Standard CSV format with clear headers and consistent data
- 70-89: CSV parseable but some columns ambiguous or missing
- 50-69: Non-standard format, column mapping uncertain
- 30-49: Severely malformed CSV, best-effort extraction
- 0-29: Nearly unparseable, very low reliability`,

  exampleOutputs: [
    JSON.stringify(
      {
        transactions: [
          {
            date: '2024-03-10',
            description: 'POS payment - Card ending 4521',
            amount: 15000.0,
            type: 'credit',
            counterparty: 'Walk-in Customer',
            reference: 'PAY-TXN-20240310-001',
            category_hint: 'PRODUCT_SALES',
            confidence: 97,
          },
          {
            date: '2024-03-10',
            description: 'POS payment - Card ending 8903',
            amount: 7500.0,
            type: 'credit',
            counterparty: 'Walk-in Customer',
            reference: 'PAY-TXN-20240310-002',
            category_hint: 'PRODUCT_SALES',
            confidence: 97,
          },
        ],
        extraction_confidence: 95,
        warnings: [],
      },
      null,
      2,
    ),
    JSON.stringify(
      {
        transactions: [
          {
            date: '2024-02-20',
            description: 'POS payment via Flutterwave',
            amount: 42000.0,
            type: 'credit',
            counterparty: 'Chinedu Okoro',
            reference: 'FLW-TXN-240220-5678',
            category_hint: 'PRODUCT_SALES',
            confidence: 93,
          },
        ],
        extraction_confidence: 90,
        warnings: ['2 failed transactions excluded from results'],
      },
      null,
      2,
    ),
  ],
  jsonSchema: {
    type: 'object',
    required: ['transactions', 'extraction_confidence', 'warnings'],
    properties: {
      transactions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['date', 'description', 'amount', 'type', 'confidence'],
          properties: {
            date: { type: 'string', description: 'ISO 8601 date (YYYY-MM-DD)' },
            description: { type: 'string', description: 'POS payment description' },
            amount: { type: 'number', description: 'Amount in Naira (numeric, no symbols)' },
            type: { type: 'string', enum: ['credit', 'debit'] },
            counterparty: { type: 'string', description: 'Customer name if available' },
            reference: { type: 'string', description: 'Transaction ID from POS provider' },
            category_hint: { type: 'string', description: 'Suggested transaction category' },
            confidence: {
              type: 'number',
              minimum: 0,
              maximum: 100,
              description: 'Extraction confidence score',
            },
          },
        },
      },
      extraction_confidence: {
        type: 'number',
        minimum: 0,
        maximum: 100,
        description: 'Overall extraction confidence',
      },
      warnings: {
        type: 'array',
        items: { type: 'string' },
        description: 'Any issues encountered during extraction',
      },
    },
  },
};
