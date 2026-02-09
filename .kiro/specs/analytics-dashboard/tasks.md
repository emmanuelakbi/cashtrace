# Implementation Plan: Analytics Dashboard Module

## Overview

This implementation plan breaks down the analytics-dashboard module into discrete coding tasks. The module provides dashboard analytics for Nigerian SMEs, aggregating transaction data into KPIs and visualizations. Implementation uses TypeScript with PostgreSQL for data storage and Redis for caching.

## Tasks

- [ ] 1. Set up module structure and core interfaces
  - [ ] 1.1 Create analytics-dashboard module directory structure
    - Create `src/modules/analytics-dashboard/` with subdirectories: controllers, services, repositories, types, utils
    - Set up module index exports
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [ ] 1.2 Define TypeScript interfaces and types
    - Create request/response types (SummaryRequest, TrendRequest, CategoryRequest, CounterpartyRequest)
    - Create data types (SummaryData, TrendData, CategoryBreakdown, CounterpartyBreakdown)
    - Create AmountDisplay, PeriodInfo, ComparisonKPIs types
    - Define PeriodType enum and TrendGranularity enum
    - _Requirements: 12.1, 12.5_

- [ ] 2. Implement FormatterService for Naira formatting
  - [ ] 2.1 Implement Naira formatting functions
    - Implement `formatAsNaira(kobo: number): string` with ₦ symbol, thousands separators, 2 decimal places
    - Implement `formatAsNairaWithSign(kobo: number): string` for negative amounts
    - Implement `koboToNaira(kobo: number): number` conversion
    - Implement `formatPercentage(value: number): string` and `formatPercentageChange(value: number): string`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ] 2.2 Write property test for Naira formatting round-trip
    - **Property 13: Naira Formatting Round-Trip**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 1.8**

- [ ] 3. Implement PeriodService for date calculations
  - [ ] 3.1 Implement WAT timezone utilities
    - Implement `getCurrentTimeWAT(): Date`
    - Implement `toWAT(date: Date): Date` for UTC to WAT conversion
    - Implement `getStartOfDayWAT(date: Date): Date`
    - _Requirements: 2.3_

  - [ ] 3.2 Implement period boundary calculations
    - Implement `getStartOfWeekWAT(date: Date): Date` (Monday start)
    - Implement `getStartOfMonthWAT(date: Date): Date`
    - Implement `getStartOfQuarterWAT(date: Date): Date`
    - Implement `getStartOfYearWAT(date: Date): Date`
    - _Requirements: 2.4, 2.5, 2.6, 2.7, 2.8_

  - [ ] 3.3 Implement calculatePeriodBounds function
    - Handle all period types: today, this_week, this_month, this_quarter, this_year, custom
    - Default to this_month when no period specified
    - Validate custom date ranges
    - _Requirements: 2.1, 2.2, 2.9_

  - [ ] 3.4 Implement calculatePreviousPeriod function
    - Calculate previous period with same number of elapsed days
    - Handle all period types for comparison
    - _Requirements: 3.1, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [ ] 3.5 Write property test for period boundary WAT calculation
    - **Property 5: Period Boundary WAT Calculation**
    - **Validates: Requirements 2.3, 2.4, 2.5, 2.6, 2.7, 2.8**

  - [ ] 3.6 Write property test for period comparison equal length
    - **Property 6: Period Comparison Equal Length**
    - **Validates: Requirements 3.4, 3.5, 3.6, 3.7, 3.8**

- [ ] 4. Checkpoint - Core utilities complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement AggregationRepository for database queries
  - [ ] 5.1 Implement summary aggregation query
    - Create `getSummaryAggregations(businessId, startDate, endDate)` method
    - Use efficient SQL with SUM, COUNT for inflows/outflows
    - Exclude personal and soft-deleted transactions in WHERE clause
    - _Requirements: 1.1, 1.2, 1.4, 1.6, 1.7_

  - [ ] 5.2 Implement trend aggregation queries
    - Create `getTrendAggregations(businessId, startDate, endDate, granularity)` method
    - Implement DATE_TRUNC with 'Africa/Lagos' timezone for daily, weekly, monthly buckets
    - Return time series data ordered chronologically
    - _Requirements: 6.1, 6.5_

  - [ ] 5.3 Implement category aggregation query
    - Create `getCategoryAggregations(businessId, startDate, endDate, transactionType, limit)` method
    - Group by category, order by total amount descending, limit results
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ] 5.4 Implement counterparty aggregation query
    - Create `getCounterpartyAggregations(businessId, startDate, endDate, transactionType, limit)` method
    - Use COALESCE to group null counterparties as 'Unknown'
    - Order by total amount descending, limit results
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.6_

  - [ ] 5.5 Write property test for transaction filtering exclusion
    - **Property 4: Transaction Filtering Exclusion**
    - **Validates: Requirements 1.6, 1.7, 4.4, 5.4**

- [ ] 6. Implement CacheService for Redis caching
  - [ ] 6.1 Implement cache key generation
    - Create `generateCacheKey(type, businessId, period, subtype?)` method
    - Define key patterns for summary, trends, categories, counterparties
    - _Requirements: 8.2_

  - [ ] 6.2 Implement cache get/set operations
    - Implement `getCachedSummary`, `cacheSummary` methods
    - Implement `getCachedTrends`, `cacheTrends` methods
    - Implement `getCachedCategories`, `cacheCategories` methods
    - Implement `getCachedCounterparties`, `cacheCounterparties` methods
    - Set TTL to 300 seconds (5 minutes)
    - _Requirements: 8.2, 8.6_

  - [ ] 6.3 Implement cache invalidation
    - Implement `invalidateBusinessCache(businessId)` to clear all caches for a business
    - Implement `invalidateAffectedPeriods(businessId, transactionDate)` for targeted invalidation
    - Calculate which periods are affected by a transaction date
    - _Requirements: 8.3, 8.4, 9.1, 9.2, 9.3_

  - [ ] 6.4 Write property test for cache invalidation on transaction changes
    - **Property 14: Cache Invalidation on Transaction Changes**
    - **Validates: Requirements 8.3, 8.4, 9.1, 9.2, 9.3**

- [ ] 7. Checkpoint - Data layer complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Implement SummaryService for KPI calculations
  - [ ] 8.1 Implement calculateSummary function
    - Calculate total revenue, total expenses from aggregation results
    - Calculate net cashflow as revenue - expenses (in kobo)
    - Calculate transaction count and average transaction value
    - Handle zero transaction count edge case for average
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ] 8.2 Implement calculateComparison function
    - Calculate percentage change for revenue, expenses, net cashflow
    - Handle zero previous value edge case (indicate as new/infinite)
    - Handle both zero edge case (0% change)
    - _Requirements: 3.2_

  - [ ] 8.3 Implement getSummaryWithComparison function
    - Integrate with CacheService for cache-first retrieval
    - Call PeriodService for period bounds and previous period
    - Call AggregationRepository for both current and previous periods
    - Format response with AmountDisplay objects
    - _Requirements: 1.8, 3.1_

  - [ ] 8.4 Write property test for aggregation correctness
    - **Property 1: Aggregation Correctness**
    - **Validates: Requirements 1.1, 1.2, 1.4**

  - [ ] 8.5 Write property test for net cashflow invariant
    - **Property 2: Net Cashflow Invariant**
    - **Validates: Requirements 1.3**

  - [ ] 8.6 Write property test for average transaction calculation
    - **Property 3: Average Transaction Calculation**
    - **Validates: Requirements 1.5**

  - [ ] 8.7 Write property test for percentage change calculation
    - **Property 7: Percentage Change Calculation**
    - **Validates: Requirements 3.2**

- [ ] 9. Implement TrendService for time series data
  - [ ] 9.1 Implement determineGranularity function
    - Return DAILY for periods ≤ 7 days
    - Return WEEKLY for periods 8-90 days
    - Return MONTHLY for periods > 90 days
    - _Requirements: 6.2, 6.3, 6.4_

  - [ ] 9.2 Implement getTrendData function
    - Integrate with CacheService for cache-first retrieval
    - Call AggregationRepository with appropriate granularity
    - Format data points with labels (day names, week numbers, month names)
    - Ensure chronological ordering
    - _Requirements: 6.1, 6.5, 6.6, 6.7_

  - [ ] 9.3 Write property test for trend granularity selection
    - **Property 11: Trend Granularity Selection**
    - **Validates: Requirements 6.2, 6.3, 6.4**

  - [ ] 9.4 Write property test for trend data chronological order
    - **Property 12: Trend Data Chronological Order**
    - **Validates: Requirements 6.1, 6.6**

- [ ] 10. Implement CategoryService for expense breakdown
  - [ ] 10.1 Implement getTopExpenseCategories function
    - Integrate with CacheService for cache-first retrieval
    - Call AggregationRepository for category aggregations
    - Calculate percentages against total expenses
    - Limit to requested number (default 5, max 10)
    - _Requirements: 4.1, 4.2, 4.3, 4.6_

  - [ ] 10.2 Implement calculatePercentages function
    - Calculate percentage of total for each category
    - Ensure percentages sum to 100% (within tolerance)
    - _Requirements: 4.5_

  - [ ] 10.3 Write property test for top N sorting and limiting
    - **Property 8: Top N Sorting and Limiting**
    - **Validates: Requirements 4.1, 4.6, 5.1, 5.6**

  - [ ] 10.4 Write property test for category percentage sum
    - **Property 9: Category Percentage Sum**
    - **Validates: Requirements 4.2, 4.5**

- [ ] 11. Implement CounterpartyService for top customers/vendors
  - [ ] 11.1 Implement getTopCustomers function
    - Integrate with CacheService for cache-first retrieval
    - Call AggregationRepository for INFLOW counterparty aggregations
    - Calculate percentages against total revenue
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ] 11.2 Implement getTopVendors function
    - Integrate with CacheService for cache-first retrieval
    - Call AggregationRepository for OUTFLOW counterparty aggregations
    - Calculate percentages against total expenses
    - _Requirements: 5.6_

  - [ ] 11.3 Write property test for null counterparty grouping
    - **Property 10: Null Counterparty Grouping**
    - **Validates: Requirements 5.5**

- [ ] 12. Checkpoint - Services complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Implement DashboardController and API endpoints
  - [ ] 13.1 Implement GET /api/dashboard/summary endpoint
    - Parse and validate period parameters
    - Verify user authentication and business ownership
    - Call SummaryService.getSummaryWithComparison
    - Return formatted SummaryResponse with requestId
    - _Requirements: 10.1, 10.5, 10.6, 10.8_

  - [ ] 13.2 Implement GET /api/dashboard/trends endpoint
    - Parse and validate period parameters
    - Verify user authentication and business ownership
    - Call TrendService.getTrendData
    - Return formatted TrendResponse with requestId
    - _Requirements: 10.2, 10.5, 10.6, 10.8_

  - [ ] 13.3 Implement GET /api/dashboard/categories endpoint
    - Parse and validate period and limit parameters
    - Verify user authentication and business ownership
    - Call CategoryService.getTopExpenseCategories
    - Return formatted CategoryResponse with requestId
    - _Requirements: 10.3, 10.5, 10.6, 10.8_

  - [ ] 13.4 Implement GET /api/dashboard/top-counterparties endpoint
    - Parse and validate period and limit parameters
    - Verify user authentication and business ownership
    - Call CounterpartyService for both customers and vendors
    - Return formatted CounterpartyResponse with requestId
    - _Requirements: 10.4, 10.5, 10.6, 10.8_

  - [ ] 13.5 Implement error handling middleware
    - Handle DASHBOARD_BUSINESS_NOT_FOUND (404)
    - Handle DASHBOARD_FORBIDDEN (403)
    - Handle validation errors (400)
    - Handle internal errors (500)
    - Include requestId in all error responses
    - _Requirements: 10.7, 12.1, 12.2, 12.3, 12.4_

  - [ ] 13.6 Write property test for data isolation enforcement
    - **Property 15: Data Isolation Enforcement**
    - **Validates: Requirements 10.5, 10.6, 11.1, 11.2, 11.3**

  - [ ] 13.7 Write property test for API response format consistency
    - **Property 16: API Response Format Consistency**
    - **Validates: Requirements 10.8, 12.1, 12.2, 12.3, 12.4, 12.5**

- [ ] 14. Implement cache invalidation integration with transaction-engine
  - [ ] 14.1 Create cache invalidation event handler
    - Export `onTransactionCreated(businessId, transactionDate)` function
    - Export `onTransactionUpdated(businessId, transactionDate)` function
    - Export `onTransactionDeleted(businessId, transactionDate)` function
    - Call CacheService.invalidateAffectedPeriods for each event
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [ ] 14.2 Document integration points for transaction-engine
    - Add comments/documentation for how transaction-engine should call invalidation
    - _Requirements: 9.4_

- [ ] 15. Final checkpoint - Module complete
  - Ensure all tests pass, ask the user if questions arise.
  - Verify all API endpoints return correct responses
  - Verify cache invalidation works correctly
  - Verify data isolation is enforced

## Notes

- All tasks including property tests are required for comprehensive coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- All amounts are stored and calculated in kobo (integers) to avoid floating-point errors
- All date calculations use WAT (West Africa Time, UTC+1)
