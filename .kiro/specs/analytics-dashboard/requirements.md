# Requirements Document

## Introduction

The Analytics Dashboard Module (analytics-dashboard) is Module 5 of 14 for CashTrace - an SME cashflow & compliance copilot for Nigerian small businesses. This module provides comprehensive dashboard analytics that aggregate transaction data into meaningful KPIs and visualizations. It enables business owners to understand their financial health at a glance, track cashflow trends, identify top expense categories and revenue sources, and compare performance across different time periods. The module depends on core-auth for user authentication, business-management for business context, and transaction-engine for transaction data.

## Glossary

- **Dashboard_System**: The analytics dashboard module responsible for aggregating transaction data and computing KPIs
- **KPI**: Key Performance Indicator - a measurable value demonstrating business financial health
- **Business**: A Nigerian SME entity that owns transactions (from business-management module)
- **User**: An authenticated CashTrace user who views dashboard analytics (from core-auth module)
- **Transaction**: A normalized financial record from the transaction-engine module
- **Period**: A time range for analytics (today, this week, this month, this quarter, this year, or custom)
- **Inflow**: Revenue/credit transactions representing money coming into the business
- **Outflow**: Expense/debit transactions representing money leaving the business
- **Net_Cashflow**: The difference between total inflows and total outflows (profit/loss)
- **Counterparty**: The other party in a transaction (customer for inflows, vendor for outflows)
- **WAT**: West Africa Time (UTC+1), the timezone for all date calculations
- **Kobo**: The smallest unit of Nigerian Naira (1 NGN = 100 kobo)
- **Cache**: Redis-based storage for pre-computed aggregations to improve performance
- **Trend_Data**: Time series data showing cashflow changes over daily, weekly, or monthly intervals

## Requirements

### Requirement 1: Dashboard Summary KPIs

**User Story:** As a business owner, I want to see my total revenue and expenses at a glance, so that I can quickly understand my business financial health.

#### Acceptance Criteria

1. WHEN a user requests the dashboard summary, THE Dashboard_System SHALL return total revenue (sum of all inflows) for the selected period
2. WHEN a user requests the dashboard summary, THE Dashboard_System SHALL return total expenses (sum of all outflows) for the selected period
3. WHEN a user requests the dashboard summary, THE Dashboard_System SHALL return net cashflow (total revenue minus total expenses) for the selected period
4. WHEN a user requests the dashboard summary, THE Dashboard_System SHALL return the total transaction count for the selected period
5. WHEN a user requests the dashboard summary, THE Dashboard_System SHALL return the average transaction value for the selected period
6. WHEN calculating totals, THE Dashboard_System SHALL exclude transactions marked as personal (isPersonal = true)
7. WHEN calculating totals, THE Dashboard_System SHALL exclude soft-deleted transactions
8. THE Dashboard_System SHALL return all amounts in kobo (integer) and formatted Naira string (₦X,XXX.XX)

### Requirement 2: Period Selection

**User Story:** As a business owner, I want to view analytics for different time periods, so that I can analyze my business performance over various timeframes.

#### Acceptance Criteria

1. THE Dashboard_System SHALL support the following predefined periods: today, this_week, this_month, this_quarter, this_year
2. THE Dashboard_System SHALL support custom date range selection with startDate and endDate parameters
3. WHEN a period is selected, THE Dashboard_System SHALL calculate date boundaries using WAT (West Africa Time, UTC+1)
4. WHEN "today" is selected, THE Dashboard_System SHALL include transactions from midnight WAT to current time
5. WHEN "this_week" is selected, THE Dashboard_System SHALL include transactions from Monday 00:00 WAT to current time
6. WHEN "this_month" is selected, THE Dashboard_System SHALL include transactions from the 1st of the current month 00:00 WAT to current time
7. WHEN "this_quarter" is selected, THE Dashboard_System SHALL include transactions from the first day of the current quarter 00:00 WAT to current time
8. WHEN "this_year" is selected, THE Dashboard_System SHALL include transactions from January 1st 00:00 WAT to current time
9. IF no period is specified, THE Dashboard_System SHALL default to "this_month"

### Requirement 3: Period Comparison

**User Story:** As a business owner, I want to compare current period to previous period, so that I can understand if my business is improving.

#### Acceptance Criteria

1. WHEN a user requests the dashboard summary, THE Dashboard_System SHALL include comparison data for the equivalent previous period
2. WHEN comparing periods, THE Dashboard_System SHALL calculate the percentage change for revenue, expenses, and net cashflow
3. WHEN comparing "today", THE Dashboard_System SHALL compare against yesterday
4. WHEN comparing "this_week", THE Dashboard_System SHALL compare against the previous week (same number of days)
5. WHEN comparing "this_month", THE Dashboard_System SHALL compare against the previous month (same number of days elapsed)
6. WHEN comparing "this_quarter", THE Dashboard_System SHALL compare against the previous quarter (same number of days elapsed)
7. WHEN comparing "this_year", THE Dashboard_System SHALL compare against the previous year (same number of days elapsed)
8. WHEN comparing custom ranges, THE Dashboard_System SHALL compare against an equal-length period immediately preceding the selected range

### Requirement 4: Top Expense Categories

**User Story:** As a business owner, I want to see my top expense categories, so that I can understand where my money is going.

#### Acceptance Criteria

1. WHEN a user requests category breakdown, THE Dashboard_System SHALL return the top 5 expense categories by total amount
2. WHEN returning category breakdown, THE Dashboard_System SHALL include the category name, total amount, and percentage of total expenses
3. WHEN returning category breakdown, THE Dashboard_System SHALL include transaction count per category
4. WHEN calculating category totals, THE Dashboard_System SHALL exclude personal transactions
5. THE Dashboard_System SHALL return category data suitable for pie chart visualization
6. IF there are fewer than 5 expense categories, THE Dashboard_System SHALL return all available categories

### Requirement 5: Top Revenue Sources

**User Story:** As a business owner, I want to see my top customers/revenue sources, so that I can identify my most valuable customers.

#### Acceptance Criteria

1. WHEN a user requests top counterparties, THE Dashboard_System SHALL return the top 5 revenue sources (counterparties) by total inflow amount
2. WHEN returning top counterparties, THE Dashboard_System SHALL include the counterparty name, total amount, and percentage of total revenue
3. WHEN returning top counterparties, THE Dashboard_System SHALL include transaction count per counterparty
4. WHEN calculating counterparty totals, THE Dashboard_System SHALL exclude personal transactions
5. WHEN a transaction has no counterparty, THE Dashboard_System SHALL group it under "Unknown"
6. THE Dashboard_System SHALL also return top 5 expense destinations (vendors) by total outflow amount

### Requirement 6: Cashflow Trends

**User Story:** As a business owner, I want to see cashflow trends over time, so that I can identify patterns in my business.

#### Acceptance Criteria

1. WHEN a user requests trend data, THE Dashboard_System SHALL return time series data for the selected period
2. WHEN the period is 7 days or less, THE Dashboard_System SHALL return daily data points
3. WHEN the period is between 8 and 90 days, THE Dashboard_System SHALL return weekly data points
4. WHEN the period is greater than 90 days, THE Dashboard_System SHALL return monthly data points
5. WHEN returning trend data, THE Dashboard_System SHALL include date, total inflows, total outflows, and net cashflow for each data point
6. THE Dashboard_System SHALL return trend data suitable for line chart visualization
7. THE Dashboard_System SHALL return revenue vs expenses data suitable for bar chart comparison

### Requirement 7: Currency Formatting

**User Story:** As a business owner, I want all amounts displayed in Naira with proper formatting, so that I can easily read financial figures.

#### Acceptance Criteria

1. THE Dashboard_System SHALL format all Naira amounts with the ₦ symbol prefix
2. THE Dashboard_System SHALL format amounts with thousands separators (e.g., ₦1,234,567.89)
3. THE Dashboard_System SHALL display amounts with exactly 2 decimal places
4. THE Dashboard_System SHALL return both raw kobo values (integer) and formatted Naira strings in all responses
5. WHEN an amount is negative (net loss), THE Dashboard_System SHALL prefix with minus sign (e.g., -₦1,234.56)

### Requirement 8: Performance Requirements

**User Story:** As a business owner, I want the dashboard to load quickly, so that I can access my financial data without waiting.

#### Acceptance Criteria

1. THE Dashboard_System SHALL load the complete dashboard summary within 3 seconds for typical small business data (up to 10,000 transactions)
2. THE Dashboard_System SHALL use Redis caching for computed aggregations
3. WHEN a new transaction is added, THE Dashboard_System SHALL invalidate relevant cached aggregations
4. WHEN a transaction is updated or deleted, THE Dashboard_System SHALL invalidate relevant cached aggregations
5. THE Dashboard_System SHALL use efficient SQL aggregations to minimize database load
6. THE Dashboard_System SHALL cache aggregations with a TTL of 5 minutes for frequently accessed data

### Requirement 9: Real-time Updates

**User Story:** As a business owner, I want to see updated analytics when new transactions are added, so that my dashboard reflects current data.

#### Acceptance Criteria

1. WHEN a transaction is created in the transaction-engine, THE Dashboard_System SHALL invalidate cached aggregations for the affected business and period
2. WHEN a transaction is updated in the transaction-engine, THE Dashboard_System SHALL invalidate cached aggregations for the affected business and period
3. WHEN a transaction is deleted in the transaction-engine, THE Dashboard_System SHALL invalidate cached aggregations for the affected business and period
4. THE Dashboard_System SHALL provide a mechanism for the transaction-engine to notify of changes (event-based or direct call)

### Requirement 10: API Endpoints

**User Story:** As a developer integrating with the dashboard module, I want well-defined API endpoints, so that I can build client applications.

#### Acceptance Criteria

1. THE Dashboard_System SHALL expose GET /api/dashboard/summary for main KPIs with period comparison
2. THE Dashboard_System SHALL expose GET /api/dashboard/trends for time series cashflow data
3. THE Dashboard_System SHALL expose GET /api/dashboard/categories for expense category breakdown
4. THE Dashboard_System SHALL expose GET /api/dashboard/top-counterparties for top customers and vendors
5. THE Dashboard_System SHALL require authentication for all endpoints
6. THE Dashboard_System SHALL scope all data to the authenticated user's business
7. IF the user does not have a business, THE Dashboard_System SHALL return a 404 Not Found error
8. THE Dashboard_System SHALL include request correlation IDs in all responses

### Requirement 11: Data Access Control

**User Story:** As a business owner, I want my analytics data to be private, so that only I can see my business performance.

#### Acceptance Criteria

1. THE Dashboard_System SHALL only return analytics for the authenticated user's business
2. IF a user attempts to access another business's analytics, THE Dashboard_System SHALL return a 403 Forbidden error
3. THE Dashboard_System SHALL verify business ownership before returning any data
4. THE Dashboard_System SHALL use the business ID from the business-management module for data scoping

### Requirement 12: API Response Standards

**User Story:** As a developer integrating with the dashboard module, I want consistent API responses, so that error handling is predictable.

#### Acceptance Criteria

1. THE Dashboard_System SHALL return JSON responses with consistent structure for success and error cases
2. WHEN an error occurs, THE Dashboard_System SHALL include error code, message, and field-specific details
3. THE Dashboard_System SHALL use appropriate HTTP status codes (200, 400, 403, 404, 500)
4. THE Dashboard_System SHALL include request correlation IDs in all responses for debugging
5. WHEN returning period information, THE Dashboard_System SHALL include the actual date range used in the response
