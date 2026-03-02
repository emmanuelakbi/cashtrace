#!/usr/bin/env bash
# ─── CashTrace — Deployment Script ───────────────────────────────────────────
#
# Usage: ./scripts/deploy.sh <environment> <version>
#
# Deploys the specified version of CashTrace to the target environment.
# For production deployments, interactive confirmation is required.
#
# Arguments:
#   environment  - Target environment: development | staging | production
#   version      - Docker image tag / version to deploy (e.g. v1.2.3, sha-abc1234)
#
# Environment variables:
#   AWS_REGION          - AWS region (default: af-south-1)
#   ECS_CLUSTER_PREFIX  - Cluster name prefix (default: cashtrace)
#   ECS_SERVICE_PREFIX  - Service name prefix (default: cashtrace-api)
#   ECR_REPO            - ECR repository URI (default: derived)
#   HEALTH_CHECK_URL    - Override health check endpoint
#   SMOKE_TEST_URL      - Override smoke test base URL

set -euo pipefail

# ─── Constants ────────────────────────────────────────────────────────────────

readonly REGION="${AWS_REGION:-af-south-1}"
readonly CLUSTER_PREFIX="${ECS_CLUSTER_PREFIX:-cashtrace}"
readonly SERVICE_PREFIX="${ECS_SERVICE_PREFIX:-cashtrace-api}"
readonly STABILIZATION_TIMEOUT=300
readonly SCRIPT_DIR="$(dirname "$0")"

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

# ─── Input validation ────────────────────────────────────────────────────────

ENVIRONMENT="${1:-}"
VERSION="${2:-}"

if [[ -z "$ENVIRONMENT" || -z "$VERSION" ]]; then
  echo "Usage: $0 <environment> <version>"
  echo ""
  echo "  environment  development | staging | production"
  echo "  version      Docker image tag (e.g. v1.2.3, sha-abc1234)"
  exit 1
fi

if [[ ! "$ENVIRONMENT" =~ ^(development|staging|production)$ ]]; then
  log_error "Invalid environment '${ENVIRONMENT}'. Must be one of: development, staging, production"
  exit 1
fi

if [[ -z "$VERSION" ]]; then
  log_error "Version/tag is required"
  exit 1
fi

# ─── Derived names ────────────────────────────────────────────────────────────

CLUSTER="${CLUSTER_PREFIX}-${ENVIRONMENT}"
SERVICE="${SERVICE_PREFIX}-${ENVIRONMENT}"
ECR_REPO="${ECR_REPO:-123456789012.dkr.ecr.${REGION}.amazonaws.com/cashtrace}"
IMAGE="${ECR_REPO}:${VERSION}"
HEALTH_CHECK_URL="${HEALTH_CHECK_URL:-https://${ENVIRONMENT}.cashtrace.ng/api/health}"
SMOKE_TEST_URL="${SMOKE_TEST_URL:-https://${ENVIRONMENT}.cashtrace.ng}"

# ─── Production confirmation ──────────────────────────────────────────────────

confirm_production() {
  log_warn "You are about to deploy to PRODUCTION"
  log_warn "  Version : ${VERSION}"
  log_warn "  Image   : ${IMAGE}"
  log_warn "  Cluster : ${CLUSTER}"
  echo ""
  read -r -p "Type 'yes' to confirm production deployment: " confirmation
  if [[ "$confirmation" != "yes" ]]; then
    log_error "Production deployment aborted by user"
    exit 1
  fi
  log_info "Production deployment confirmed"
}

if [[ "$ENVIRONMENT" == "production" ]]; then
  confirm_production
fi

# ─── Step 1: Pull image ──────────────────────────────────────────────────────

pull_image() {
  log_info "Step 1/5: Pulling Docker image..."
  log_info "  Image: ${IMAGE}"

  aws ecr get-login-password --region "$REGION" \
    | docker login --username AWS --password-stdin "$ECR_REPO" 2>/dev/null

  docker pull "$IMAGE"

  log_ok "Image pulled successfully"
}

# ─── Step 2: Health check (pre-deploy) ────────────────────────────────────────

pre_deploy_health_check() {
  log_info "Step 2/5: Running pre-deploy health check..."

  local http_status
  http_status=$(curl -s -o /dev/null -w '%{http_code}' \
    --max-time 10 \
    "$HEALTH_CHECK_URL" 2>/dev/null || echo "000")

  if [[ "$http_status" =~ ^2[0-9]{2}$ ]]; then
    log_ok "Current deployment is healthy (HTTP ${http_status})"
  else
    log_warn "Current deployment returned HTTP ${http_status} — proceeding anyway"
  fi
}

# ─── Step 3: Deploy via ECS update ────────────────────────────────────────────

deploy_ecs() {
  log_info "Step 3/5: Deploying via ECS service update..."
  log_info "  Cluster : ${CLUSTER}"
  log_info "  Service : ${SERVICE}"
  log_info "  Image   : ${IMAGE}"

  # Register new task definition with updated image
  local current_task_def
  current_task_def=$(aws ecs describe-services \
    --cluster "$CLUSTER" \
    --services "$SERVICE" \
    --region "$REGION" \
    --query 'services[0].taskDefinition' \
    --output text)

  local task_def_json
  task_def_json=$(aws ecs describe-task-definition \
    --task-definition "$current_task_def" \
    --region "$REGION" \
    --query 'taskDefinition')

  # Update the container image in the task definition
  local new_task_def_json
  new_task_def_json=$(echo "$task_def_json" \
    | jq --arg IMAGE "$IMAGE" '.containerDefinitions[0].image = $IMAGE')

  # Register the new task definition
  local new_task_def_arn
  new_task_def_arn=$(echo "$new_task_def_json" \
    | jq '{
        family,
        containerDefinitions,
        taskRoleArn,
        executionRoleArn,
        networkMode,
        requiresCompatibilities,
        cpu,
        memory
      }' \
    | aws ecs register-task-definition \
        --region "$REGION" \
        --cli-input-json file:///dev/stdin \
        --query 'taskDefinition.taskDefinitionArn' \
        --output text)

  # Update the service
  aws ecs update-service \
    --cluster "$CLUSTER" \
    --service "$SERVICE" \
    --task-definition "$new_task_def_arn" \
    --region "$REGION" \
    --force-new-deployment \
    --no-cli-pager > /dev/null

  log_ok "ECS service update initiated (task def: ${new_task_def_arn})"
}

# ─── Step 4: Wait for stabilization ──────────────────────────────────────────

wait_for_stabilization() {
  log_info "Step 4/5: Waiting for service stabilization (timeout: ${STABILIZATION_TIMEOUT}s)..."

  if aws ecs wait services-stable \
    --cluster "$CLUSTER" \
    --services "$SERVICE" \
    --region "$REGION" 2>/dev/null; then
    log_ok "Service is stable"
  else
    log_error "Service did not stabilize within timeout"
    exit 1
  fi
}

# ─── Step 5: Smoke test ──────────────────────────────────────────────────────

run_smoke_test() {
  log_info "Step 5/5: Running post-deploy smoke test..."

  local endpoints=("/api/health" "/api/auth/status")
  local all_passed=true

  for endpoint in "${endpoints[@]}"; do
    local url="${SMOKE_TEST_URL}${endpoint}"
    local http_status
    http_status=$(curl -s -o /dev/null -w '%{http_code}' \
      --max-time 10 \
      "$url" 2>/dev/null || echo "000")

    if [[ "$http_status" =~ ^2[0-9]{2}$ ]]; then
      log_ok "  ${endpoint} — HTTP ${http_status}"
    else
      log_error "  ${endpoint} — HTTP ${http_status}"
      all_passed=false
    fi
  done

  if [[ "$all_passed" != "true" ]]; then
    log_error "Smoke test failed — consider rolling back"
    exit 1
  fi

  log_ok "All smoke tests passed"
}

# ─── Execute ──────────────────────────────────────────────────────────────────

log_info "Starting CashTrace deployment"
log_info "  Environment : ${ENVIRONMENT}"
log_info "  Version     : ${VERSION}"
log_info "  Region      : ${REGION}"
log_info "  Cluster     : ${CLUSTER}"
log_info "  Service     : ${SERVICE}"
echo ""

pull_image
pre_deploy_health_check
deploy_ecs
wait_for_stabilization
run_smoke_test

echo ""
log_ok "Deployment complete!"
log_ok "  Environment : ${ENVIRONMENT}"
log_ok "  Version     : ${VERSION}"
log_ok "  Image       : ${IMAGE}"
