#!/usr/bin/env bash
# ─── CashTrace — Rollback Script ─────────────────────────────────────────────
#
# Usage: ./scripts/rollback.sh <environment> [version]
#
# Rolls back the ECS service to the previous (or specified) task definition.
# Enforces a 5-minute timeout constraint per Requirement 2.4.
#
# Arguments:
#   environment  - Target environment: development | staging | production
#   version      - (Optional) Specific task definition revision to roll back to.
#                  If omitted, rolls back to the previous revision.
#
# Environment variables:
#   AWS_REGION          - AWS region (default: af-south-1)
#   ECS_CLUSTER_PREFIX  - Cluster name prefix (default: cashtrace)
#   ECS_SERVICE_PREFIX  - Service name prefix (default: cashtrace-api)
#   HEALTH_CHECK_URL    - Health check endpoint (default: derived from environment)
#   ROLLBACK_TIMEOUT    - Timeout in seconds (default: 300 = 5 minutes)

set -euo pipefail

# ─── Constants ────────────────────────────────────────────────────────────────

readonly REGION="${AWS_REGION:-af-south-1}"
readonly CLUSTER_PREFIX="${ECS_CLUSTER_PREFIX:-cashtrace}"
readonly SERVICE_PREFIX="${ECS_SERVICE_PREFIX:-cashtrace-api}"
readonly TIMEOUT="${ROLLBACK_TIMEOUT:-300}"
readonly START_TIME=$(date +%s)

# ─── Color helpers ────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info()  { echo -e "${BLUE}[INFO]${NC}  $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*" >&2; }
log_error() { echo -e "${RED}[ERROR]${NC} $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*" >&2; }

# ─── Timeout check ────────────────────────────────────────────────────────────

check_timeout() {
  local now
  now=$(date +%s)
  local elapsed=$(( now - START_TIME ))
  if (( elapsed >= TIMEOUT )); then
    log_error "Rollback exceeded ${TIMEOUT}s timeout (elapsed: ${elapsed}s)"
    exit 2
  fi
  log_info "Elapsed: ${elapsed}s / ${TIMEOUT}s"
}

# ─── Input validation ─────────────────────────────────────────────────────────

ENVIRONMENT="${1:-}"
TARGET_VERSION="${2:-}"

if [[ -z "$ENVIRONMENT" ]]; then
  echo "Usage: $0 <environment> [version]"
  echo ""
  echo "  environment  development | staging | production"
  echo "  version      (Optional) Task definition revision number"
  exit 1
fi

if [[ ! "$ENVIRONMENT" =~ ^(development|staging|production)$ ]]; then
  log_error "Invalid environment '${ENVIRONMENT}'. Must be one of: development, staging, production"
  exit 1
fi

# ─── Derived names ────────────────────────────────────────────────────────────

CLUSTER="${CLUSTER_PREFIX}-${ENVIRONMENT}"
SERVICE="${SERVICE_PREFIX}-${ENVIRONMENT}"
HEALTH_CHECK_URL="${HEALTH_CHECK_URL:-https://${ENVIRONMENT}.cashtrace.ng/api/health}"

log_info "Starting rollback for CashTrace"
log_info "  Environment : ${ENVIRONMENT}"
log_info "  Cluster     : ${CLUSTER}"
log_info "  Service     : ${SERVICE}"
log_info "  Region      : ${REGION}"
log_info "  Timeout     : ${TIMEOUT}s"
echo ""

# ─── Step 1: Identify current deployment ──────────────────────────────────────

identify_current_deployment() {
  log_info "Step 1/4: Identifying current deployment..."

  CURRENT_TASK_DEF=$(aws ecs describe-services \
    --cluster "$CLUSTER" \
    --services "$SERVICE" \
    --region "$REGION" \
    --query 'services[0].taskDefinition' \
    --output text)

  if [[ -z "$CURRENT_TASK_DEF" || "$CURRENT_TASK_DEF" == "None" ]]; then
    log_error "Could not determine current task definition for ${SERVICE}"
    exit 1
  fi

  log_ok "Current task definition: ${CURRENT_TASK_DEF}"
}

# ─── Step 2: Resolve target version ──────────────────────────────────────────

resolve_target_version() {
  log_info "Step 2/4: Resolving rollback target..."

  TASK_FAMILY=$(echo "$CURRENT_TASK_DEF" | sed 's/:.*$//' | sed 's|.*/||')

  if [[ -n "$TARGET_VERSION" ]]; then
    ROLLBACK_TASK_DEF="arn:aws:ecs:${REGION}:$(aws sts get-caller-identity --query Account --output text):task-definition/${TASK_FAMILY}:${TARGET_VERSION}"
    log_ok "Rolling back to specified version: ${ROLLBACK_TASK_DEF}"
  else
    local current_revision
    current_revision=$(echo "$CURRENT_TASK_DEF" | grep -o '[0-9]*$')
    local previous_revision=$(( current_revision - 1 ))

    if (( previous_revision < 1 )); then
      log_error "No previous revision available (current revision: ${current_revision})"
      exit 1
    fi

    ROLLBACK_TASK_DEF="${TASK_FAMILY}:${previous_revision}"
    log_ok "Rolling back to previous revision: ${ROLLBACK_TASK_DEF}"
  fi

  check_timeout
}

# ─── Step 3: Update ECS service ───────────────────────────────────────────────

update_ecs_service() {
  log_info "Step 3/4: Updating ECS service to rollback task definition..."

  aws ecs update-service \
    --cluster "$CLUSTER" \
    --service "$SERVICE" \
    --task-definition "$ROLLBACK_TASK_DEF" \
    --region "$REGION" \
    --force-new-deployment \
    --no-cli-pager > /dev/null

  log_ok "ECS service update initiated"
  check_timeout

  # Wait for stabilization
  local remaining=$(( TIMEOUT - $(date +%s) + START_TIME ))
  if (( remaining <= 0 )); then
    log_error "No time remaining for stability wait"
    exit 2
  fi

  log_info "Waiting up to ${remaining}s for service stability..."
  if ! aws ecs wait services-stable \
    --cluster "$CLUSTER" \
    --services "$SERVICE" \
    --region "$REGION" 2>/dev/null; then
    check_timeout
    log_warn "Service stability wait returned non-zero; checking health directly..."
  fi

  check_timeout
  log_ok "Service stabilized"
}

# ─── Step 4: Verify health ────────────────────────────────────────────────────

verify_health() {
  log_info "Step 4/4: Verifying health after rollback..."

  local max_attempts=5
  local health_passed=false

  for attempt in $(seq 1 "$max_attempts"); do
    check_timeout

    local http_status
    http_status=$(curl -s -o /dev/null -w '%{http_code}' \
      --max-time 10 \
      "$HEALTH_CHECK_URL" 2>/dev/null || echo "000")

    if [[ "$http_status" =~ ^2[0-9]{2}$ ]]; then
      log_ok "Health check passed (HTTP ${http_status}) on attempt ${attempt}"
      health_passed=true
      break
    fi

    log_warn "Health check attempt ${attempt}/${max_attempts} failed (HTTP ${http_status})"
    sleep 5
  done

  if [[ "$health_passed" != "true" ]]; then
    log_error "Health check failed after ${max_attempts} attempts"
    exit 1
  fi
}

# ─── Execute ──────────────────────────────────────────────────────────────────

identify_current_deployment
resolve_target_version
update_ecs_service
verify_health

ELAPSED=$(( $(date +%s) - START_TIME ))
echo ""
log_ok "Rollback complete in ${ELAPSED}s (limit: ${TIMEOUT}s)"
log_ok "  Environment : ${ENVIRONMENT}"
log_ok "  Task def    : ${ROLLBACK_TASK_DEF}"
