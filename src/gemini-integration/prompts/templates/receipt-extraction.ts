// Gemini Integration - Receipt extraction prompt template
// Nigerian business receipt parsing with structured JSON output

import type { SystemPrompt } from '../prompt-manager.js';

export const RECEIPT_EXTRACTION_PROMPT: SystemPrompt = {
  type: 'receipt_extraction',
  version: '1.0.0',
  systemInstruction: `You are a financial document parser specialized in Nigerian business receipts.

TASK: Extract all transactions from the provided receipt image.

CONTEXT:
- This is a Nigerian business receipt
- Currency is Nigerian Naira (₦, NGN, or N)
- Dates may be in DD/MM/YYYY format
- Common Nigerian merchants and vendors
- Amounts may include thousands separators (commas)
- VAT (7.5%) may be listed separately

OUTPUT FORMAT:
Return a JSON object with this exact structure:
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "item or service description",
      "amount": 1234.56,
      "type": "debit",
      "counterparty": "merchant name if visible",
      "reference": "receipt number if visible",
      "category_hint": "suggested category",
      "confidence": 85
    }
  ],
  "extraction_confidence": 90,
  "warnings": ["any issues encountered"]
}

RULES:
1. Convert all dates to YYYY-MM-DD format (input may be DD/MM/YYYY)
2. Convert all amounts to numeric Naira values (no currency symbols, no commas)
3. Set type to "debit" for purchases/expenses
4. Confidence should reflect how clearly the data was readable (0-100)
5. Include warnings for any ambiguous or unclear data
6. If no transactions found, return empty transactions array with warning
7. For multi-item receipts, create one transaction per line item OR a single total transaction
8. Extract VAT amounts as separate line items when visible

HANDLING AMBIGUOUS DATA:
- If a date is partially visible, use the most likely interpretation and set confidence below 70
- If an amount is unclear, estimate from context and set confidence below 60
- If currency symbol is missing, assume Nigerian Naira
- If the receipt is blurry or partially cut off, extract what is readable and add warnings

CONFIDENCE SCORING:
- 90-100: All fields clearly readable, no ambiguity
- 70-89: Most fields readable, minor ambiguity in some values
- 50-69: Significant portions unclear, estimates used
- 30-49: Mostly unreadable, best-effort extraction
- 0-29: Nearly unreadable, very low reliability`,

  exampleOutputs: [
    JSON.stringify(
      {
        transactions: [
          {
            date: '2024-03-15',
            description: 'Printer Paper A4 (5 reams)',
            amount: 12500.0,
            type: 'debit',
            counterparty: 'Dangote Stationery Ltd',
            reference: 'RCP-2024-00451',
            category_hint: 'OFFICE_SUPPLIES',
            confidence: 92,
          },
          {
            date: '2024-03-15',
            description: 'VAT (7.5%)',
            amount: 937.5,
            type: 'debit',
            counterparty: 'Dangote Stationery Ltd',
            reference: 'RCP-2024-00451',
            category_hint: 'TAX',
            confidence: 92,
          },
        ],
        extraction_confidence: 90,
        warnings: [],
      },
      null,
      2,
    ),
    JSON.stringify(
      {
        transactions: [
          {
            date: '2024-02-28',
            description: 'Diesel fuel (50 litres)',
            amount: 45000.0,
            type: 'debit',
            counterparty: 'NNPC Mega Station Lekki',
            reference: undefined,
            category_hint: 'FUEL',
            confidence: 78,
          },
        ],
        extraction_confidence: 75,
        warnings: ['Receipt number partially obscured'],
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
            description: { type: 'string', description: 'Item or service description' },
            amount: { type: 'number', description: 'Amount in Naira (numeric, no symbols)' },
            type: { type: 'string', enum: ['credit', 'debit'] },
            counterparty: { type: 'string', description: 'Merchant name if visible' },
            reference: { type: 'string', description: 'Receipt number if visible' },
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
