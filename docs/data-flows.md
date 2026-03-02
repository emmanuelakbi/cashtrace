# CashTrace — Data Flow Documentation

## Overview

All CashTrace user data is stored in the af-south-1 (Cape Town) AWS region to comply with Nigerian Data Protection Regulation (NDPR) data residency requirements.

## Data Storage Locations

| Data Type              | Service              | Region      | Encrypted | Classification |
|------------------------|----------------------|-------------|-----------|----------------|
| User accounts          | RDS PostgreSQL       | af-south-1  | Yes (AES-256) | PII        |
| Business profiles      | RDS PostgreSQL       | af-south-1  | Yes (AES-256) | Business   |
| Transactions           | RDS PostgreSQL       | af-south-1  | Yes (AES-256) | Financial  |
| Session tokens         | ElastiCache Redis    | af-south-1  | Yes (TLS + at-rest) | Auth |
| Rate limit counters    | ElastiCache Redis    | af-south-1  | Yes (TLS + at-rest) | System |
| Uploaded documents     | S3                   | af-south-1  | Yes (SSE-KMS) | Business   |
| Application secrets    | Secrets Manager      | af-south-1  | Yes (KMS) | System     |
| Audit logs             | CloudWatch Logs      | af-south-1  | Yes       | Compliance |
| Database backups       | RDS Snapshots        | af-south-1  | Yes (AES-256) | All types |
| DR backup replicas     | S3 (cross-region)    | eu-west-1   | Yes (SSE-KMS) | System backup |
| DR database backups    | RDS backup replication | eu-west-1 | Yes (AES-256) | All types |

## Data Flow Diagram

```
User (Nigeria) → CloudFront (global edge, no data cached)
                    ↓
              ALB (af-south-1)
                    ↓
              ECS Fargate (af-south-1)
              ├── → RDS PostgreSQL (af-south-1) [user data, transactions]
              ├── → ElastiCache Redis (af-south-1) [sessions, cache]
              ├── → S3 (af-south-1) [documents]
              ├── → Secrets Manager (af-south-1) [credentials]
              └── → CloudWatch (af-south-1) [logs, metrics]

DR Replication (automated):
  S3 (af-south-1) ──replication──→ S3 (eu-west-1)
  RDS backups (af-south-1) ──replication──→ RDS backups (eu-west-1)
```

## Data Residency Guardrails

1. **Terraform variable validation** — `aws_region` must be `af-south-1`, `allowed_data_regions` must contain only `af-*` regions.
2. **Runtime null_resource check** — Terraform plan fails if the active region is not in the allowed list.
3. **TypeScript validation** — `checkResidencyGuardrail()` validates all data flow records against compliant regions.
4. **CDN configuration** — CloudFront does not cache user data; API responses have `Cache-Control: no-store` for authenticated endpoints.

## Cross-Region Data (DR Only)

The only data that leaves af-south-1 is for disaster recovery purposes:
- S3 bucket replication to eu-west-1 (encrypted, automated)
- RDS automated backup replication to eu-west-1 (encrypted, automated)

This data is encrypted at rest and in transit, and is only accessed during a declared disaster recovery event.

## Compliance Audit Support

To audit data residency compliance:

```bash
# Verify all resources are in af-south-1
terraform plan -var-file=terraform.tfvars

# Check TypeScript guardrails
npx vitest run --testPathPattern='dataResidency'
```
