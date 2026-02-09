# CashTrace Modular Specs

SME Cashflow & Compliance Copilot for Nigerian Small Businesses

## Module Overview

| #   | Module                                        | Purpose                                               | Requirements | Properties | Status |
| --- | --------------------------------------------- | ----------------------------------------------------- | ------------ | ---------- | ------ |
| 1   | [core-auth](./core-auth/)                     | Authentication, JWT, magic links, NDPR compliance     | 9            | 21         | ⬜     |
| 2   | [business-management](./business-management/) | Business profiles, Nigerian sectors, soft delete      | 9            | 12         | ⬜     |
| 3   | [document-processing](./document-processing/) | File uploads, S3 storage, async processing queue      | 12           | 20         | ⬜     |
| 4   | [transaction-engine](./transaction-engine/)   | Normalization, categorization, duplicate detection    | 12           | 25         | ⬜     |
| 5   | [analytics-dashboard](./analytics-dashboard/) | KPIs, trends, caching, WAT timezone                   | 12           | 16         | ⬜     |
| 6   | [gemini-integration](./gemini-integration/)   | AI extraction, insights, circuit breaker, retry logic | 14           | 27         | ⬜     |
| 7   | [insights-engine](./insights-engine/)         | AI-powered business insights, compliance tips         | 14           | 10         | ⬜     |
| 8   | [frontend-shell](./frontend-shell/)           | Next.js app shell, routing, state management, PWA     | 16           | 10         | ⬜     |
| 9   | [notification-system](./notification-system/) | Email, in-app, push notifications                     | 12           | 10         | ⬜     |
| 10  | [api-gateway](./api-gateway/)                 | Rate limiting, request validation, auth verification  | 12           | 10         | ⬜     |
| 11  | [observability](./observability/)             | Logging, metrics, tracing, PII scrubbing              | 12           | 8          | ⬜     |
| 12  | [security-compliance](./security-compliance/) | Encryption, audit trails, NDPR, key management        | 12           | 10         | ⬜     |
| 13  | [deployment-infra](./deployment-infra/)       | CI/CD, Terraform IaC, Nigerian data residency         | 13           | 10         | ⬜     |

## Recommended Execution Order

### Phase 1: Foundation (No Dependencies)

```
1. core-auth          → Authentication is foundational for everything
2. observability      → Logging/metrics needed by all modules
3. security-compliance → Encryption and audit used across the system
```

### Phase 2: Infrastructure

```
4. api-gateway        → Central entry point, depends on auth + observability
5. deployment-infra   → CI/CD and infrastructure for deploying services
```

### Phase 3: Core Business Logic

```
6. business-management  → Business profiles needed by transactions
7. document-processing  → File handling for receipts/statements
8. transaction-engine   → Depends on business-management + document-processing
9. gemini-integration   → AI extraction, used by document-processing + insights
```

### Phase 4: Intelligence Layer

```
10. analytics-dashboard → Depends on transaction-engine
11. insights-engine     → Depends on transaction-engine, business-management, gemini
```

### Phase 5: User-Facing

```
12. notification-system → Delivers insights and alerts to users
13. frontend-shell      → Consumes all backend modules
```

## Dependency Graph

```
                                    ┌─────────────────┐
                                    │   core-auth     │
                                    └────────┬────────┘
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    │                        │                        │
                    ▼                        ▼                        ▼
           ┌───────────────┐        ┌───────────────┐        ┌───────────────┐
           │ observability │        │   api-gateway │        │   security-   │
           └───────────────┘        └───────┬───────┘        │  compliance   │
                                            │                └───────────────┘
                                            ▼
                                   ┌───────────────┐
                                   │   business-   │
                                   │  management   │
                                   └───────┬───────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    │                      │                      │
                    ▼                      ▼                      ▼
           ┌───────────────┐      ┌───────────────┐      ┌───────────────┐
           │   document-   │      │  transaction- │      │    gemini-    │
           │  processing   │─────▶│    engine     │◀─────│  integration  │
           └───────────────┘      └───────┬───────┘      └───────┬───────┘
                                          │                      │
                    ┌─────────────────────┼──────────────────────┘
                    │                     │
                    ▼                     ▼
           ┌───────────────┐      ┌───────────────┐
           │   analytics-  │      │   insights-   │
           │   dashboard   │      │    engine     │
           └───────────────┘      └───────┬───────┘
                                          │
                                          ▼
                                 ┌───────────────┐
                                 │ notification- │
                                 │    system     │
                                 └───────┬───────┘
                                         │
                                         ▼
                                ┌───────────────┐
                                │ frontend-shell│
                                └───────────────┘
```

## Nigerian-Specific Features

All modules include:

- **NDPR Compliance** - Nigeria Data Protection Regulation
- **WAT Timezone** - West Africa Time (UTC+1) for all operations
- **Naira (₦) Formatting** - Proper currency display with Kobo precision
- **Kobo Storage** - Integer storage for financial precision (no floating point)
- **Nigerian Bank Formats** - GTBank, Access, Zenith, First Bank, UBA support
- **Local Date Formats** - DD/MM/YYYY handling

## Spec Structure

Each module contains:

```
.kiro/specs/{module-name}/
├── requirements.md   # User stories and acceptance criteria
├── design.md         # Architecture, interfaces, correctness properties
└── tasks.md          # Implementation plan with checkpoints
```

## Testing Strategy

- **Property-Based Testing** - fast-check with 100+ iterations per property
- **Unit Tests** - Vitest for component testing
- **Integration Tests** - Full flow testing with test databases
- **E2E Tests** - Playwright for frontend testing

## Getting Started

1. Open a module's `tasks.md` file
2. Ask Kiro to execute the tasks
3. Review at each checkpoint before proceeding
4. Mark tasks complete as you progress

Start with: `core-auth` → it has zero dependencies and everything else needs authentication.
