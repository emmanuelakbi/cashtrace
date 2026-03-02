// Gemini Integration - Insight generation prompt template
// Nigerian business financial insights with structured JSON output

import type { SystemPrompt } from '../prompt-manager.js';

export const INSIGHT_GENERATION_PROMPT: SystemPrompt = {
  type: 'insight_generation',
  version: '1.0.0',
  systemInstruction: `You are a Nigerian business financial advisor analyzing transaction data for SMEs.

TASK: Generate actionable insights for a Nigerian small or medium enterprise based on their transaction history.

NIGERIAN TAX CONTEXT:
- VAT (Value Added Tax): 7.5% on taxable goods and services; mandatory registration when turnover exceeds ₦25 million per annum
- WHT (Withholding Tax): Deducted at source on qualifying payments; rates vary by transaction type (5% for professional services, 10% for rent, etc.)
- CIT (Company Income Tax): 30% for large companies (turnover > ₦100M), 20% for medium (₦25M–₦100M), 0% for small (< ₦25M)
- PAYE: Employers must remit employee income tax monthly
- Filing deadlines: Annual returns due within 6 months of financial year-end

NIGERIAN BUSINESS CONTEXT:
- Currency is Nigerian Naira (₦); amounts stored as numeric values
- Common challenges: cash flow gaps, forex volatility, inflation, generator/fuel costs
- Banking: GTBank, Access, Zenith, First Bank, UBA are major banks
- Payment channels: bank transfers, POS, mobile money, cash
- Regulatory bodies: FIRS (tax), CAC (registration), NDPR (data protection)

INSIGHT TYPES:
- tax_exposure: Potential tax liabilities, missed deductions, compliance risks, VAT/WHT/CIT obligations
- personal_spend: Personal expenses mixed with business funds, owner drawings, non-business transactions
- cashflow_risk: Cash flow gaps, seasonal patterns, late payments, concentration risk, runway concerns
- cost_optimization: Opportunities to reduce costs, negotiate better rates, eliminate waste, consolidate vendors
- revenue_opportunity: Potential revenue improvements, underpriced services, untapped markets, upsell opportunities

SEVERITY LEVELS:
- info: Informational observation, no immediate action required; useful for awareness and planning
- warning: Should be addressed within the current or next business cycle; potential financial impact if ignored
- alert: Requires immediate attention; significant financial, tax, or compliance risk

OUTPUT FORMAT:
Return a JSON object with this exact structure:
{
  "insights": [
    {
      "type": "tax_exposure",
      "severity": "warning",
      "title": "Short descriptive title",
      "body": "Detailed explanation with specific numbers and context",
      "action_items": ["Specific actionable step 1", "Specific actionable step 2"],
      "related_transactions": ["transaction_id_1", "transaction_id_2"]
    }
  ],
  "analysis_period": {
    "start": "YYYY-MM-DD",
    "end": "YYYY-MM-DD"
  },
  "confidence": 85
}

RULES:
1. Provide 3-5 most relevant insights, prioritized by business impact
2. Be specific with Nigerian context — reference actual tax rates, thresholds, and regulations
3. Include actionable recommendations that a Nigerian SME owner can follow
4. Reference specific transaction IDs in related_transactions when relevant
5. Prioritize alerts over warnings, warnings over info
6. Use concrete numbers from the transaction data (e.g., "Your ₦3.2M in Q1 revenue...")
7. Consider seasonal patterns common in Nigerian business (e.g., December spending, January slowdown)
8. Flag potential FIRS audit triggers when applicable

CONFIDENCE SCORING:
- 90-100: Clear patterns with strong data support, high transaction volume
- 70-89: Reasonable patterns, moderate data, some assumptions made
- 50-69: Limited data, significant assumptions, directional insights only
- 30-49: Very limited data, speculative insights
- 0-29: Insufficient data for meaningful analysis`,

  exampleOutputs: [
    JSON.stringify(
      {
        insights: [
          {
            type: 'tax_exposure',
            severity: 'warning',
            title: 'Potential VAT Registration Required',
            body: 'Your total revenue of ₦28.5M over the past 12 months exceeds the ₦25M VAT registration threshold. You may be required to register for VAT with FIRS and begin charging 7.5% VAT on taxable supplies. Failure to register could result in penalties and back-dated assessments.',
            action_items: [
              'Consult a tax advisor about VAT registration with FIRS',
              'Begin tracking VAT on all taxable sales and purchases',
              'Set aside 7.5% of taxable revenue for VAT remittance',
            ],
            related_transactions: ['txn_001', 'txn_045', 'txn_112'],
          },
          {
            type: 'personal_spend',
            severity: 'warning',
            title: 'Personal Expenses Detected in Business Account',
            body: 'We identified 12 transactions totalling ₦485,000 that appear to be personal expenses (school fees, personal subscriptions, family transfers). Mixing personal and business expenses complicates tax filing and may trigger FIRS scrutiny.',
            action_items: [
              'Open a separate personal account for non-business expenses',
              'Reclassify identified transactions as owner drawings',
              'Establish a monthly owner draw amount to avoid ad-hoc withdrawals',
            ],
            related_transactions: ['txn_023', 'txn_067', 'txn_089'],
          },
          {
            type: 'cashflow_risk',
            severity: 'alert',
            title: 'Cash Flow Gap Projected for Next Month',
            body: 'Based on your current receivables and upcoming obligations, you may face a cash shortfall of approximately ₦1.8M next month. Your average collection period has increased from 15 to 28 days over the past quarter.',
            action_items: [
              'Follow up on outstanding invoices totalling ₦3.2M',
              'Negotiate extended payment terms with top 3 suppliers',
              'Consider invoice factoring for immediate cash needs',
            ],
            related_transactions: ['txn_150', 'txn_155', 'txn_160'],
          },
        ],
        analysis_period: {
          start: '2024-01-01',
          end: '2024-03-31',
        },
        confidence: 82,
      },
      null,
      2,
    ),
    JSON.stringify(
      {
        insights: [
          {
            type: 'cost_optimization',
            severity: 'info',
            title: 'Generator Fuel Costs Above Industry Average',
            body: 'Your monthly generator fuel spend of ₦320,000 is approximately 40% higher than similar businesses in your sector. This may indicate inefficient generator usage or opportunities to switch to solar backup.',
            action_items: [
              'Audit generator runtime and fuel consumption patterns',
              'Get quotes for solar inverter backup systems',
              'Consider shared generator arrangements with neighbouring businesses',
            ],
            related_transactions: ['txn_034', 'txn_078', 'txn_121'],
          },
          {
            type: 'revenue_opportunity',
            severity: 'info',
            title: 'Weekend Sales Consistently Higher',
            body: 'Your weekend transaction volume is 65% higher than weekdays, with average ticket size 22% larger. Consider extending weekend hours or running targeted weekend promotions to capitalize on this pattern.',
            action_items: [
              'Extend operating hours on Saturdays',
              'Launch weekend-specific promotions or bundles',
              'Ensure adequate staffing and inventory for weekends',
            ],
            related_transactions: ['txn_200', 'txn_205', 'txn_210'],
          },
        ],
        analysis_period: {
          start: '2024-01-01',
          end: '2024-01-31',
        },
        confidence: 75,
      },
      null,
      2,
    ),
  ],
  jsonSchema: {
    type: 'object',
    required: ['insights', 'analysis_period', 'confidence'],
    properties: {
      insights: {
        type: 'array',
        items: {
          type: 'object',
          required: ['type', 'severity', 'title', 'body'],
          properties: {
            type: {
              type: 'string',
              enum: [
                'tax_exposure',
                'personal_spend',
                'cashflow_risk',
                'cost_optimization',
                'revenue_opportunity',
              ],
              description: 'Category of the insight',
            },
            severity: {
              type: 'string',
              enum: ['info', 'warning', 'alert'],
              description: 'Urgency level of the insight',
            },
            title: {
              type: 'string',
              description: 'Short descriptive title for the insight',
            },
            body: {
              type: 'string',
              description: 'Detailed explanation with specific numbers and context',
            },
            action_items: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific actionable recommendations',
            },
            related_transactions: {
              type: 'array',
              items: { type: 'string' },
              description: 'IDs of transactions related to this insight',
            },
          },
        },
      },
      analysis_period: {
        type: 'object',
        required: ['start', 'end'],
        properties: {
          start: { type: 'string', description: 'Period start date (YYYY-MM-DD)' },
          end: { type: 'string', description: 'Period end date (YYYY-MM-DD)' },
        },
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 100,
        description: 'Overall confidence in the generated insights',
      },
    },
  },
};
