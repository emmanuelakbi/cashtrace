# Requirements Document

## Introduction

The Insights Engine Module (insights-engine) is Module 7 of 14 for CashTrace - an SME cashflow & compliance copilot for Nigerian small businesses. This module provides AI-powered business insights, compliance tips, and actionable recommendations based on transaction patterns, business context, and Nigerian regulatory requirements. The module aggregates data from multiple sources and generates personalized, timely insights that help SME owners make informed financial decisions.

## Glossary

- **Insights_Engine**: The core service responsible for generating and managing business insights
- **Insight**: A single actionable recommendation or observation about the business
- **Insight_Category**: Classification of insights (tax, compliance, cashflow, spending, revenue, operational)
- **Insight_Priority**: Urgency level of an insight (critical, high, medium, low, info)
- **Insight_Status**: Lifecycle state of an insight (active, acknowledged, dismissed, resolved, expired)
- **Business_Profile**: The business entity for which insights are generated
- **Transaction_Pattern**: A detected recurring pattern in transaction data
- **Compliance_Rule**: A Nigerian regulatory requirement that triggers compliance insights
- **Insight_Template**: A predefined structure for generating specific types of insights
- **Insight_Trigger**: An event or condition that initiates insight generation
- **Insight_Score**: A calculated relevance score for prioritizing insights
- **WAT**: West Africa Time (UTC+1), the timezone for all Nigerian business operations

## Requirements

### Requirement 1: Tax Exposure Insights

**User Story:** As a business owner, I want to receive alerts about potential tax obligations so that I can prepare for tax payments and avoid penalties.

#### Acceptance Criteria

1. WHEN the Insights_Engine analyzes transactions, THE Insights_Engine SHALL calculate estimated VAT liability based on revenue transactions
2. WHEN VAT liability exceeds ₦500,000 in a quarter, THE Insights_Engine SHALL generate a high-priority tax exposure insight
3. WHEN the Insights_Engine detects revenue approaching VAT registration threshold (₦25M annually), THE Insights_Engine SHALL generate a compliance insight
4. WHEN generating tax insights, THE Insights_Engine SHALL include estimated amounts in Kobo (integer) for precision
5. WHEN generating tax insights, THE Insights_Engine SHALL include relevant FIRS deadlines based on WAT timezone
6. THE Insights_Engine SHALL track withholding tax exposure for businesses with government contracts
7. IF a business has not filed taxes in the current period, THEN THE Insights_Engine SHALL generate a reminder insight 30 days before deadline

### Requirement 2: Personal Spending Detection

**User Story:** As a business owner, I want to be alerted when personal expenses are mixed with business transactions so that I can maintain proper financial separation.

#### Acceptance Criteria

1. WHEN the Insights_Engine analyzes transactions, THE Insights_Engine SHALL identify potential personal spending patterns
2. WHEN a transaction matches personal spending categories (entertainment, personal shopping, family transfers), THE Insights_Engine SHALL flag it for review
3. WHEN personal spending exceeds 10% of monthly business expenses, THE Insights_Engine SHALL generate a medium-priority insight
4. WHEN generating personal spending insights, THE Insights_Engine SHALL list specific transactions for user review
5. THE Insights_Engine SHALL learn from user feedback to improve personal spending detection accuracy
6. THE Insights_Engine SHALL NOT flag legitimate business entertainment expenses as personal spending

### Requirement 3: Cashflow Risk Alerts

**User Story:** As a business owner, I want early warnings about potential cashflow problems so that I can take preventive action.

#### Acceptance Criteria

1. WHEN the Insights_Engine analyzes transaction patterns, THE Insights_Engine SHALL project cashflow for the next 30, 60, and 90 days
2. WHEN projected cashflow becomes negative within 30 days, THE Insights_Engine SHALL generate a critical-priority insight
3. WHEN projected cashflow becomes negative within 60 days, THE Insights_Engine SHALL generate a high-priority insight
4. WHEN generating cashflow insights, THE Insights_Engine SHALL include specific dates and projected shortfall amounts
5. THE Insights_Engine SHALL factor in recurring expenses and expected revenue patterns
6. THE Insights_Engine SHALL consider seasonal variations based on business sector
7. WHEN a large expense is detected, THE Insights_Engine SHALL recalculate cashflow projections immediately

### Requirement 4: Cost Optimization Suggestions

**User Story:** As a business owner, I want suggestions for reducing costs so that I can improve profitability.

#### Acceptance Criteria

1. WHEN the Insights_Engine analyzes expense patterns, THE Insights_Engine SHALL identify categories with above-average spending
2. WHEN a vendor charges significantly more than market rate, THE Insights_Engine SHALL suggest alternatives
3. WHEN recurring expenses increase by more than 20% month-over-month, THE Insights_Engine SHALL generate an insight
4. WHEN generating cost insights, THE Insights_Engine SHALL include potential savings amounts
5. THE Insights_Engine SHALL identify duplicate or redundant subscriptions
6. THE Insights_Engine SHALL benchmark expenses against similar businesses in the same sector

### Requirement 5: Revenue Opportunity Identification

**User Story:** As a business owner, I want to identify opportunities to increase revenue so that I can grow my business.

#### Acceptance Criteria

1. WHEN the Insights_Engine analyzes revenue patterns, THE Insights_Engine SHALL identify high-performing products or services
2. WHEN a customer's purchase frequency decreases, THE Insights_Engine SHALL suggest re-engagement
3. WHEN seasonal revenue patterns are detected, THE Insights_Engine SHALL suggest preparation for peak periods
4. WHEN generating revenue insights, THE Insights_Engine SHALL include specific actionable recommendations
5. THE Insights_Engine SHALL identify customers with high lifetime value for retention focus
6. THE Insights_Engine SHALL detect pricing opportunities based on transaction patterns

### Requirement 6: Compliance Tips

**User Story:** As a business owner, I want compliance reminders and tips so that I stay compliant with Nigerian regulations.

#### Acceptance Criteria

1. THE Insights_Engine SHALL track NDPR compliance requirements and generate reminders
2. THE Insights_Engine SHALL track CAC annual return deadlines and generate reminders 60 days before due date
3. THE Insights_Engine SHALL track FIRS tax filing deadlines and generate reminders
4. WHEN a business operates in a regulated sector, THE Insights_Engine SHALL include sector-specific compliance tips
5. WHEN generating compliance insights, THE Insights_Engine SHALL include links to relevant regulatory resources
6. THE Insights_Engine SHALL track changes in Nigerian business regulations and notify affected businesses

### Requirement 7: Insight Prioritization

**User Story:** As a business owner, I want insights prioritized by importance so that I can focus on what matters most.

#### Acceptance Criteria

1. THE Insights_Engine SHALL calculate an insight score based on financial impact, urgency, and relevance
2. THE Insights_Engine SHALL assign priority levels: critical (immediate action), high (this week), medium (this month), low (when convenient), info (awareness only)
3. WHEN multiple insights exist, THE Insights_Engine SHALL sort by priority and then by score
4. THE Insights_Engine SHALL limit active insights to 10 per business to avoid overwhelm
5. WHEN a new critical insight is generated, THE Insights_Engine SHALL notify the user immediately
6. THE Insights_Engine SHALL demote insights that have been ignored for extended periods

### Requirement 8: Insight Lifecycle Management

**User Story:** As a business owner, I want to manage insights (acknowledge, dismiss, resolve) so that I can track my progress.

#### Acceptance Criteria

1. WHEN a user acknowledges an insight, THE Insights_Engine SHALL update status to 'acknowledged' with timestamp
2. WHEN a user dismisses an insight, THE Insights_Engine SHALL update status to 'dismissed' and record reason
3. WHEN a user marks an insight as resolved, THE Insights_Engine SHALL update status to 'resolved' with resolution notes
4. WHEN an insight's underlying condition is no longer true, THE Insights_Engine SHALL automatically expire it
5. THE Insights_Engine SHALL track insight resolution time for analytics
6. THE Insights_Engine SHALL NOT regenerate dismissed insights for the same condition within 30 days

### Requirement 9: Insight Personalization

**User Story:** As a business owner, I want insights tailored to my business type and preferences so that they are relevant to me.

#### Acceptance Criteria

1. THE Insights_Engine SHALL customize insights based on business sector (retail, services, manufacturing, etc.)
2. THE Insights_Engine SHALL adjust insight frequency based on user engagement patterns
3. THE Insights_Engine SHALL learn from user feedback to improve insight relevance
4. WHEN a user consistently dismisses a type of insight, THE Insights_Engine SHALL reduce frequency of that type
5. THE Insights_Engine SHALL consider business size when generating insights
6. THE Insights_Engine SHALL support user-defined insight preferences (categories to include/exclude)

### Requirement 10: Insight Generation Scheduling

**User Story:** As a system administrator, I want insights generated on a schedule so that users receive timely information.

#### Acceptance Criteria

1. THE Insights_Engine SHALL run daily insight generation for all active businesses at 6:00 AM WAT
2. THE Insights_Engine SHALL run weekly comprehensive analysis every Monday at 6:00 AM WAT
3. THE Insights_Engine SHALL run monthly summary generation on the 1st of each month at 6:00 AM WAT
4. WHEN a significant transaction is processed, THE Insights_Engine SHALL trigger real-time insight evaluation
5. THE Insights_Engine SHALL support manual insight refresh on user request
6. THE Insights_Engine SHALL batch process insights efficiently to minimize system load

### Requirement 11: Insight Data Sources

**User Story:** As a system component, I want to aggregate data from multiple sources so that insights are comprehensive.

#### Acceptance Criteria

1. THE Insights_Engine SHALL consume transaction data from the transaction-engine module
2. THE Insights_Engine SHALL consume business profile data from the business-management module
3. THE Insights_Engine SHALL consume AI-generated insights from the gemini-integration module
4. THE Insights_Engine SHALL maintain its own insight history for trend analysis
5. THE Insights_Engine SHALL cache frequently accessed data for performance
6. THE Insights_Engine SHALL handle missing or incomplete data gracefully

### Requirement 12: Insight Templates

**User Story:** As a system administrator, I want predefined insight templates so that insights are consistent and well-formatted.

#### Acceptance Criteria

1. THE Insights_Engine SHALL use templates for each insight category
2. WHEN generating an insight, THE Insights_Engine SHALL populate template variables with business-specific data
3. THE Insights_Engine SHALL support template versioning for A/B testing
4. THE Insights_Engine SHALL include action items in all actionable insight templates
5. THE Insights_Engine SHALL support localization of insight templates (English, Pidgin)
6. THE Insights_Engine SHALL validate template output before delivery

### Requirement 13: Insight Analytics

**User Story:** As a system administrator, I want analytics on insight effectiveness so that I can improve the system.

#### Acceptance Criteria

1. THE Insights_Engine SHALL track insight generation counts by category and priority
2. THE Insights_Engine SHALL track user engagement rates (view, acknowledge, dismiss, resolve)
3. THE Insights_Engine SHALL track average time to resolution by insight type
4. THE Insights_Engine SHALL calculate insight accuracy based on user feedback
5. THE Insights_Engine SHALL generate weekly analytics reports for system administrators
6. THE Insights_Engine SHALL identify underperforming insight types for improvement

### Requirement 14: Nigerian Context Integration

**User Story:** As a business owner, I want insights that understand Nigerian business context so that recommendations are practical.

#### Acceptance Criteria

1. THE Insights_Engine SHALL use Nigerian tax rates and thresholds in calculations
2. THE Insights_Engine SHALL reference Nigerian regulatory bodies (FIRS, CAC, NDPR) in compliance insights
3. THE Insights_Engine SHALL consider Nigerian business calendar (public holidays, fiscal year)
4. THE Insights_Engine SHALL format currency as Naira (₦) with proper thousands separators
5. THE Insights_Engine SHALL use WAT timezone for all date/time references
6. THE Insights_Engine SHALL understand Nigerian business sectors and their specific challenges
