# Implementation Plan: Insights Engine Module

## Overview

This implementation plan breaks down the insights-engine module into incremental coding tasks. Each task builds on previous work, with property-based tests validating correctness at each stage.

## Tasks

- [ ] 1. Project setup and core infrastructure
  - [ ] 1.1 Initialize module structure
    - Create directory structure: `src/`, `src/analyzers/`, `src/services/`, `src/repositories/`, `src/types/`
    - Configure TypeScript with strict mode
    - Set up module dependencies
    - _Requirements: Module independence_

  - [ ] 1.2 Set up database schema
    - Create migrations for insights, insight_templates, insight_preferences tables
    - Set up indexes for efficient querying
    - _Requirements: Data Models from design_

  - [ ] 1.3 Set up testing framework
    - Configure Vitest and fast-check
    - Set up test fixtures for business data
    - _Requirements: Testing Strategy_

- [ ] 2. Implement core types and utilities
  - [ ] 2.1 Define insight types and interfaces
    - Create `src/types/insight.ts` with all type definitions
    - Implement Kobo amount utilities
    - _Requirements: Data Models_

  - [ ] 2.2 Write property test for financial precision
    - **Property 1: Financial Precision**
    - **Validates: Requirements 1.4**

  - [ ] 2.3 Implement WAT timezone utilities
    - Create `src/utils/timezone.ts` for WAT handling
    - Implement date formatting for Nigerian context
    - _Requirements: 14.5_

  - [ ] 2.4 Write property test for WAT timezone
    - **Property 6: WAT Timezone Consistency**
    - **Validates: Requirements 1.5, 14.5**

- [ ] 3. Checkpoint - Core utilities complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement PriorityScorer
  - [ ] 4.1 Implement scoring algorithm
    - Create `src/services/priorityScorer.ts`
    - Implement multi-factor scoring (financial impact, urgency, relevance)
    - _Requirements: 7.1, 7.2_

  - [ ] 4.2 Write property test for priority ordering
    - **Property 2: Priority Ordering**
    - **Validates: Requirements 7.3**

  - [ ] 4.3 Implement insight limit enforcement
    - Add logic to limit active insights to 10 per business
    - Implement auto-expiration of low-priority insights
    - _Requirements: 7.4_

  - [ ] 4.4 Write property test for insight limit
    - **Property 3: Insight Limit**
    - **Validates: Requirements 7.4**

- [ ] 5. Implement LifecycleManager
  - [ ] 5.1 Implement insight state transitions
    - Create `src/services/lifecycleManager.ts`
    - Implement acknowledge, dismiss, resolve, expire operations
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ] 5.2 Write property test for status transitions
    - **Property 5: Status Transitions**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**

  - [ ] 5.3 Implement dismissal cooldown
    - Track dismissed insights and prevent regeneration for 30 days
    - _Requirements: 8.6_

  - [ ] 5.4 Write property test for dismissal cooldown
    - **Property 4: Dismissal Cooldown**
    - **Validates: Requirements 8.6**

- [ ] 6. Checkpoint - Core services complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement Tax Analyzer
  - [ ] 7.1 Implement VAT liability calculation
    - Create `src/analyzers/taxAnalyzer.ts`
    - Calculate VAT from revenue transactions
    - Apply Nigerian VAT thresholds (₦25M annual, ₦500K quarterly)
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ] 7.2 Write property test for tax threshold accuracy
    - **Property 8: Tax Threshold Accuracy**
    - **Validates: Requirements 1.2, 1.3**

  - [ ] 7.3 Implement FIRS deadline tracking
    - Track tax filing deadlines in WAT
    - Generate reminder insights 30 days before deadline
    - _Requirements: 1.5, 1.7_

- [ ] 8. Implement Cashflow Analyzer
  - [ ] 8.1 Implement cashflow projection
    - Create `src/analyzers/cashflowAnalyzer.ts`
    - Project cashflow for 30, 60, 90 days
    - Factor in recurring expenses and revenue patterns
    - _Requirements: 3.1, 3.5, 3.6_

  - [ ] 8.2 Write property test for cashflow projection
    - **Property 9: Cashflow Projection Accuracy**
    - **Validates: Requirements 3.4, 3.5**

  - [ ] 8.3 Implement risk alert generation
    - Generate critical alerts for 30-day negative cashflow
    - Generate high alerts for 60-day negative cashflow
    - _Requirements: 3.2, 3.3_

- [ ] 9. Implement Spending Analyzer
  - [ ] 9.1 Implement personal spending detection
    - Create `src/analyzers/spendingAnalyzer.ts`
    - Identify personal spending patterns
    - Calculate personal spending percentage
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 9.2 Implement cost optimization detection
    - Identify above-average spending categories
    - Detect duplicate subscriptions
    - _Requirements: 4.1, 4.5_

- [ ] 10. Implement Compliance Analyzer
  - [ ] 10.1 Implement regulatory deadline tracking
    - Create `src/analyzers/complianceAnalyzer.ts`
    - Track NDPR, CAC, FIRS deadlines
    - Generate reminders 60 days before due dates
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ] 10.2 Implement sector-specific compliance
    - Add sector-specific compliance rules
    - _Requirements: 6.4_

- [ ] 11. Implement Revenue Analyzer
  - [ ] 11.1 Implement revenue pattern analysis
    - Create `src/analyzers/revenueAnalyzer.ts`
    - Identify high-performing products/services
    - Detect seasonal patterns
    - _Requirements: 5.1, 5.3_

  - [ ] 11.2 Implement customer analysis
    - Identify high-value customers
    - Detect declining purchase frequency
    - _Requirements: 5.2, 5.5_

- [ ] 12. Checkpoint - Analyzers complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Implement InsightGenerator
  - [ ] 13.1 Implement main generation service
    - Create `src/services/insightGenerator.ts`
    - Orchestrate all analyzers
    - Apply personalization based on business profile
    - _Requirements: 9.1, 9.5_

  - [ ] 13.2 Write property test for sector relevance
    - **Property 7: Sector Relevance**
    - **Validates: Requirements 9.1**

  - [ ] 13.3 Implement real-time event evaluation
    - Handle transaction_created, document_processed events
    - Trigger immediate insight evaluation
    - _Requirements: 10.4_

  - [ ] 13.4 Write property test for real-time response
    - **Property 10: Real-Time Trigger Response**
    - **Validates: Requirements 10.4**

- [ ] 14. Implement Template Engine
  - [ ] 14.1 Implement template rendering
    - Create `src/services/templateEngine.ts`
    - Support variable substitution
    - Support English and Pidgin locales
    - _Requirements: 12.1, 12.2, 12.5_

  - [ ] 14.2 Implement template versioning
    - Support A/B testing of templates
    - _Requirements: 12.3_

- [ ] 15. Implement Scheduler
  - [ ] 15.1 Implement scheduled generation
    - Create `src/services/scheduler.ts`
    - Daily generation at 6:00 AM WAT
    - Weekly analysis on Mondays
    - Monthly summary on 1st
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ] 15.2 Implement batch processing
    - Efficient processing for all businesses
    - _Requirements: 10.6_

- [ ] 16. Implement repositories
  - [ ] 16.1 Implement InsightRepository
    - Create `src/repositories/insightRepository.ts`
    - CRUD operations for insights
    - Query by business, status, category
    - _Requirements: Data Models_

  - [ ] 16.2 Implement caching layer
    - Redis caching for frequently accessed data
    - _Requirements: 11.5_

- [ ] 17. Implement API endpoints
  - [ ] 17.1 Create insight API routes
    - GET /insights - list insights for business
    - GET /insights/:id - get single insight
    - POST /insights/:id/acknowledge
    - POST /insights/:id/dismiss
    - POST /insights/:id/resolve
    - POST /insights/refresh - manual refresh
    - _Requirements: All_

- [ ] 18. Implement analytics
  - [ ] 18.1 Implement insight analytics
    - Track generation counts, engagement rates
    - Calculate resolution times
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

- [ ] 19. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.
