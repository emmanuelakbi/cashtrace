#!/usr/bin/env bash
# ─── CashTrace — Smoke Test Script ───────────────────────────────────────────
#
# Usage: ./scripts/smoke-test.sh <base_url>
#
# Runs post-deployment smoke tests against the specified environment URL.
# Verifies critical endpoints are responding with expected status codes.
#
# Arguments:
#   base_url  - Base URL of the environment (e.g. https://staging.cashtrace.ng)
#
# Environment variables:
#   MAX_RETRIES     - Number of retry attempts per endpoint (default: 3)
#   RETRY_DELAY     - Seconds between retries (default: 5)
#   TIMEOUT         - Curl timeout in seconds (default: 10)
#   MAX_LATENCY_MS  - Maximum acceptable latency in ms (default: 2000)

set -euo pipefail

# ─── Constants ────────────────────────────────────────────────────────────────

readonly MAX_RETRIES="${MAX_RETRIES:-3}"
readonly RETRY_DELAY="${RETRY_DELAY:-5}"
readonly TIMEOUT="${TIMEOUT:-10}"
readonly MAX_LATENCY_MS="${MAX_LATENCY_MS:-2000}"

# ─── Color helpers ────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[PASS]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_fail()  { echo -e "${RED}[FAIL]${NC}  $*"; }

# ─── Input validation ────────────────────────────────────────────────────────

BASE_URL="${1:-}"

if [[ -z "$BASE_URL" ]]; then
  echo "Usage: $0 <base_url>"
  echo ""
  echo "  base_url  Environment URL (e.g. https://staging.cashtrace.ng)"
  exit 1
fi

# Remove trailing slash
BASE_URL="${BASE_URL%/}"

# ─── Endpoints to test ───────────────────────────────────────────────────────

declare -a ENDPOINTS=(
  "/api/health"
  "/api/auth/status"
)

declare -a EXPECTED_STATUS=(
  "200"
  "200"
)

# ─── Test runner ──────────────────────────────────────────────────────────────

TOTAL=0
PASSED=0
FAILED=0

test_endpoint() {
  local endpoint="$1"
  local expected="$2"
  local url="${BASE_URL}${endpoint}"

  TOTAL=$((TOTAL + 1))

  for attempt in $(seq 1 "$MAX_RETRIES"); do
    local start_ms
    start_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')

    local http_status
    http_status=$(curl -s -o /dev/null -w '%{http_code}' \
      --max-time "$TIMEOUT" \
      "$url" 2>/dev/null || echo "000")

    local end_ms
    end_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')
    local latency=$((end_ms - start_ms))

    if [[ "$http_status" == "$expected" ]]; then
      if (( latency > MAX_LATENCY_MS )); then
        log_warn "${endpoint} — HTTP ${http_status} (${latency}ms > ${MAX_LATENCY_MS}ms limit)"
      else
        log_ok "${endpoint} — HTTP ${http_status} (${latency}ms)"
      fi
      PASSED=$((PASSED + 1))
      return 0
    fi

    if (( attempt < MAX_RETRIES )); then
      log_warn "${endpoint} — HTTP ${http_status}, retrying in ${RETRY_DELAY}s (${attempt}/${MAX_RETRIES})"
      sleep "$RETRY_DELAY"
    fi
  done

  log_fail "${endpoint} — expected HTTP ${expected}, got ${http_status} after ${MAX_RETRIES} attempts"
  FAILED=$((FAILED + 1))
  return 1
}

# ─── Execute ──────────────────────────────────────────────────────────────────

log_info "Running smoke tests against ${BASE_URL}"
log_info "Config: retries=${MAX_RETRIES}, delay=${RETRY_DELAY}s, timeout=${TIMEOUT}s"
echo ""

all_passed=true

for i in "${!ENDPOINTS[@]}"; do
  if ! test_endpoint "${ENDPOINTS[$i]}" "${EXPECTED_STATUS[$i]}"; then
    all_passed=false
  fi
done

echo ""
log_info "Results: ${PASSED}/${TOTAL} passed, ${FAILED} failed"

if [[ "$all_passed" != "true" ]]; then
  log_fail "Smoke tests FAILED"
  exit 1
fi

log_ok "All smoke tests passed"
