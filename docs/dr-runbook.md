# CashTrace — Disaster Recovery Runbook

## Overview

- **Primary Region:** af-south-1 (Cape Town)
- **Secondary Region:** eu-west-1 (Ireland)
- **RPO:** 1 hour
- **RTO:** 4 hours
- **Testing Cadence:** Quarterly

## Recovery Procedures

### 1. Assess the Incident

1. Confirm the outage scope via CloudWatch alarms and PagerDuty alerts.
2. Determine whether the issue is regional (full DR failover) or service-specific (targeted recovery).
3. Notify the on-call team via Slack `#cashtrace-incidents`.

### 2. Database Recovery

#### Point-in-Time Recovery (Single Instance Failure)

```bash
# Restore RDS to a specific point in time
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier cashtrace-production \
  --target-db-instance-identifier cashtrace-production-restored \
  --restore-time "2026-01-15T10:00:00Z" \
  --region af-south-1
```

#### Cross-Region Failover (Regional Outage)

```bash
# Promote the cross-region read replica or restore from replicated backup
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier cashtrace-dr \
  --db-snapshot-identifier <replicated-snapshot-id> \
  --region eu-west-1
```

### 3. Application Failover

1. Update Route 53 DNS to point to the secondary region's ALB.
2. Deploy the latest Docker image to the secondary ECS cluster.
3. Verify health checks pass at the secondary endpoint.

```bash
# Update DNS failover
aws route53 change-resource-record-sets \
  --hosted-zone-id <zone-id> \
  --change-batch file://dns-failover.json
```

### 4. Cache Recovery

ElastiCache does not support cross-region replication. On failover:

1. Deploy a new Redis cluster in eu-west-1.
2. The application will repopulate the cache on startup (cold cache).
3. Monitor cache hit rates during warm-up.

### 5. Secrets Recovery

Secrets are backed up to the DR S3 bucket (encrypted). On failover:

1. Restore secrets from the DR bucket to AWS Secrets Manager in eu-west-1.
2. Update ECS task definitions to reference the new secret ARNs.

### 6. Verification

1. Run smoke tests against the DR environment.
2. Verify data integrity by comparing record counts and checksums.
3. Confirm all API endpoints return 200.

```bash
./scripts/deploy.sh production <version>
# Smoke tests run automatically as step 5
```

## Failback Procedure

Once the primary region is restored:

1. Replicate any data changes from secondary back to primary.
2. Update DNS to point back to af-south-1.
3. Verify primary region health.
4. Decommission temporary DR resources.

## Quarterly Testing Schedule

| Quarter | Test Type              | Scope                          |
|---------|------------------------|--------------------------------|
| Q1      | Full DR failover       | All services to eu-west-1      |
| Q2      | Database restore       | RDS PITR + backup verification |
| Q3      | Full DR failover       | All services to eu-west-1      |
| Q4      | Tabletop exercise      | Review runbook, update contacts |

## Contacts

| Role              | Contact              |
|-------------------|----------------------|
| On-call engineer  | PagerDuty escalation |
| Infrastructure    | `#cashtrace-infra`   |
| Incident commander| Rotating weekly      |
