// Gemini Integration - Bank statement extraction prompt template
// Nigerian bank statement parsing with structured JSON output

import type { SystemPrompt } from '../prompt-manager.js';

export const BANK_STATEMENT_EXTRACTION_PROMPT: SystemPrompt = {
  type: 'bank_statement_extraction',
  version: '1.0.0',
  systemInstruction: `You are a financial document parser specialized in Nigerian bank statements.

TASK: Extract all transactions from the provided bank statement.

CONTEXT:
- This is a Nigerian bank statement (GTBank, Access Bank, Zenith Bank, First Bank, UBA, or other)
- Currency is Nigerian Naira
- Dates may be in DD/MM/YYYY or DD-MMM-YYYY format
- Credits are money received, Debits are money spent
- Narrations often contain transfer references, beneficiary names, and channel info
- Common transaction channels: ATM, POS, Web, Mobile, USSD, NIP, NEFT

OUTPUT FORMAT:
Return a JSON object with this exact structure:
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "transaction narration",
      "amount": 1234.56,
      "type": "credit" or "debit",
      "counterparty": "other party if identifiable",
      "reference": "transaction reference",
      "category_hint": "suggested category",
      "confidence": 85
    }
  ],
  "extraction_confidence": 90,
  "warnings": ["any issues encountered"],
  "raw_text_preview": "first 200 chars of statement"
}

RULES:
1. Convert all dates to YYYY-MM-DD format
2. Convert all amounts to numeric Naira values
3. Determine type from CR/DR indicators or column position
4. Extract counterparty from narration when possible
5. Include reference numbers when visible
6. Confidence reflects data clarity (0-100)
7. Preserve original narration text in description field
8. Handle opening/closing balance rows by excluding them from transactions

NIGERIAN BANK FORMAT HINTS:
- GTBank: Uses "CR"/"DR" suffixes, date format DD-MMM-YYYY
- Access Bank: Separate credit/debit columns, date format DD/MM/YYYY
- Zenith Bank: Uses "C"/"D" indicators, narration includes channel prefix
- First Bank: Uses credit/debit columns, date format DD-MMM-YY
- UBA: Uses "CR"/"DR" in remarks, date format DD/MM/YYYY

HANDLING AMBIGUOUS DATA:
- If credit/debit indicator is missing, infer from column position or narration keywords
- If date format is ambiguous (e.g., 01/02/2024), prefer DD/MM/YYYY (Nigerian standard)
- If counterparty cannot be determined, leave the field undefined
- If a row appears to be a balance line, exclude it and add a warning

CONFIDENCE SCORING:
- 90-100: All fields clearly readable, standard bank format recognized
- 70-89: Most fields readable, some narrations truncated
- 50-69: Format partially recognized, some transactions may be merged or split incorrectly
- 30-49: Non-standard format, best-effort extraction
- 0-29: Severely degraded quality, very low reliability`,

  exampleOutputs: [
    JSON.stringify(
      {
        transactions: [
          {
            date: '2024-03-01',
            description: 'NIP/TRF FROM ADEBAYO OGUNLESI/Salary March',
            amount: 350000.0,
            type: 'credit',
            counterparty: 'Adebayo Ogunlesi',
            reference: 'NIP/240301/123456',
            category_hint: 'SALARY',
            confidence: 95,
          },
          {
            date: '2024-03-02',
            description: 'POS/WEB PURCHASE - SHOPRITE IKEJA',
            amount: 28750.0,
            type: 'debit',
            counterparty: 'Shoprite Ikeja',
            reference: 'POS/240302/789012',
            category_hint: 'GROCERIES',
            confidence: 90,
          },
        ],
        extraction_confidence: 92,
        warnings: [],
        raw_text_preview: 'GUARANTY TRUST BANK PLC\nStatement of Account...',
      },
      null,
      2,
    ),
    JSON.stringify(
      {
        transactions: [
          {
            date: '2024-01-15',
            description: 'ATM WDL/CASH - FIRST BANK ATM VICTORIA ISLAND',
            amount: 100000.0,
            type: 'debit',
            counterparty: undefined,
            reference: 'ATM/240115/345678',
            category_hint: 'CASH_WITHDRAWAL',
            confidence: 88,
          },
          {
            date: '2024-01-16',
            description: 'MOBILE TRF/AIRTIME PURCHASE',
            amount: 5000.0,
            type: 'debit',
            counterparty: 'MTN Nigeria',
            reference: 'MOB/240116/901234',
            category_hint: 'TELECOMMUNICATIONS',
            confidence: 82,
          },
        ],
        extraction_confidence: 85,
        warnings: ['Some narrations were truncated in the original statement'],
        raw_text_preview: 'ACCESS BANK PLC\nAccount Statement for...',
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
            description: { type: 'string', description: 'Transaction narration' },
            amount: { type: 'number', description: 'Amount in Naira (numeric, no symbols)' },
            type: { type: 'string', enum: ['credit', 'debit'] },
            counterparty: { type: 'string', description: 'Other party if identifiable' },
            reference: { type: 'string', description: 'Transaction reference number' },
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
      raw_text_preview: {
        type: 'string',
        description: 'First 200 characters of the statement text',
      },
    },
  },
};
