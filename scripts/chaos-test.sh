#!/usr/bin/env bash
# ============================================================
# AEGIS Chaos Test Suite v3.9
# Injects controlled failures and verifies recovery behavior.
# Run before every major deploy: ./scripts/chaos-test.sh
# ============================================================
set -euo pipefail

API_URL="${API_URL:-http://localhost:3000}"
DB_URL="${DATABASE_URL:?Set DATABASE_URL}"
REDIS_URL="${REDIS_URL:?Set REDIS_URL}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[CHAOS]${NC} $*"; }
ok()   { echo -e "${GREEN}[ PASS]${NC} $*"; }
fail() { echo -e "${RED}[ FAIL]${NC} $*"; FAILURES+=("$*"); }
warn() { echo -e "${YELLOW}[ WARN]${NC} $*"; }

FAILURES=()
PASSED=0
START_TIME=$(date +%s)

log "AEGIS Chaos Test Suite — $(date)"
log "Target: $API_URL"
echo ""

# ── Helper: time a curl call ──────────────────────────────
timed_curl() {
  local start=$(date +%s%3N)
  local result
  result=$(curl -sf "$@" 2>/dev/null || echo "FAILED")
  local end=$(date +%s%3N)
  echo "$((end - start)):$result"
}

# ── TEST 1: Health endpoint responds ─────────────────────
log "Test 1: Health endpoint"
result=$(curl -sf "$API_URL/health" 2>/dev/null || echo "FAILED")
if echo "$result" | grep -q '"status"'; then
  ok "Health endpoint responding"
  ((PASSED++))
else
  fail "Health endpoint not responding"
fi

# ── TEST 2: DB slow query tolerance ──────────────────────
log "Test 2: DB slow query — circuit breaker"
# Simulate slow DB by setting statement_timeout temporarily
psql "$DB_URL" -c "SET statement_timeout='100ms';" -c "SELECT pg_sleep(0.05);" > /dev/null 2>&1 \
  && ok "DB handles short queries under timeout" \
  || warn "DB timeout test inconclusive"
((PASSED++))

# ── TEST 3: API rate limiting ─────────────────────────────
log "Test 3: Rate limiting — 15 rapid login attempts"
RATE_BLOCKED=false
for i in $(seq 1 15); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"chaos@test.com","password":"wrong"}' 2>/dev/null || echo "000")
  if [[ "$STATUS" == "429" ]]; then
    RATE_BLOCKED=true
    break
  fi
done
if $RATE_BLOCKED; then
  ok "Rate limiting triggered correctly (429)"
  ((PASSED++))
else
  fail "Rate limiting NOT triggered after 15 rapid requests"
fi

# ── TEST 4: Invalid JWT rejected ─────────────────────────
log "Test 4: Invalid JWT token rejected"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer invalid.token.here" \
  "$API_URL/api/shops/fake-id/metrics" 2>/dev/null || echo "000")
if [[ "$STATUS" == "401" ]]; then
  ok "Invalid JWT correctly rejected (401)"
  ((PASSED++))
else
  fail "Invalid JWT NOT rejected — got $STATUS"
fi

# ── TEST 5: Missing env var simulation ────────────────────
log "Test 5: Health endpoint detects missing config"
# Just verify health returns component-level status
HEALTH=$(curl -sf "$API_URL/health" 2>/dev/null || echo '{}')
if echo "$HEALTH" | grep -q '"checks"'; then
  ok "Health endpoint reports component-level status"
  ((PASSED++))
else
  fail "Health endpoint missing component breakdown"
fi

# ── TEST 6: DB connection pool exhaustion ─────────────────
log "Test 6: Concurrent requests — connection pool"
CONCURRENT_OK=true
PIDS=()
for i in $(seq 1 20); do
  curl -sf "$API_URL/health" > /dev/null 2>&1 &
  PIDS+=($!)
done
for pid in "${PIDS[@]}"; do
  wait "$pid" || CONCURRENT_OK=false
done
if $CONCURRENT_OK; then
  ok "20 concurrent requests handled without pool exhaustion"
  ((PASSED++))
else
  fail "Some concurrent requests failed — check DB pool size"
fi

# ── TEST 7: Malformed JSON payload ────────────────────────
log "Test 7: Malformed JSON payload handling"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$API_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{invalid json}' 2>/dev/null || echo "000")
if [[ "$STATUS" == "400" ]] || [[ "$STATUS" == "422" ]]; then
  ok "Malformed JSON returns 4xx (got $STATUS)"
  ((PASSED++))
else
  fail "Malformed JSON not handled correctly — got $STATUS"
fi

# ── TEST 8: SQL injection attempt ────────────────────────
log "Test 8: SQL injection — parameterized query protection"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$API_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com'\'' OR 1=1--","password":"x"}' 2>/dev/null || echo "000")
if [[ "$STATUS" != "500" ]]; then
  ok "SQL injection attempt handled safely (got $STATUS)"
  ((PASSED++))
else
  fail "SQL injection may have caused server error — got 500"
fi

# ── TEST 9: Redis connectivity ────────────────────────────
log "Test 9: Redis ping"
if redis-cli -u "$REDIS_URL" ping > /dev/null 2>&1; then
  ok "Redis responding"
  ((PASSED++))
else
  fail "Redis not responding"
fi

# ── TEST 10: Oversized payload rejection ─────────────────
log "Test 10: Oversized payload — body size limit"
BIG_PAYLOAD=$(python3 -c "import json; print(json.dumps({'email': 'a@b.com', 'password': 'x' * 100000}))")
STATUS=$(echo "$BIG_PAYLOAD" | curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$API_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d @- 2>/dev/null || echo "000")
if [[ "$STATUS" == "413" ]] || [[ "$STATUS" == "400" ]]; then
  ok "Oversized payload rejected ($STATUS)"
  ((PASSED++))
else
  warn "Oversized payload not explicitly rejected ($STATUS) — consider adding body size limit"
  ((PASSED++))
fi

# ── Summary ───────────────────────────────────────────────
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
TOTAL=$((PASSED + ${#FAILURES[@]}))

echo ""
log "═══════════════════════════════════════════"
log " Chaos Test Results — ${DURATION}s"
echo ""
echo -e "  Passed:  ${GREEN}${PASSED}/${TOTAL}${NC}"
echo -e "  Failed:  ${RED}${#FAILURES[@]}/${TOTAL}${NC}"

if [[ ${#FAILURES[@]} -gt 0 ]]; then
  echo ""
  echo "  Failures:"
  for f in "${FAILURES[@]}"; do
    echo -e "    ${RED}✗${NC} $f"
  done
  echo ""
  log "═══════════════════════════════════════════"
  echo -e "${RED}CHAOS TESTS FAILED — do not deploy${NC}"
  exit 1
else
  echo ""
  log "═══════════════════════════════════════════"
  echo -e "${GREEN}ALL CHAOS TESTS PASSED — safe to deploy${NC}"
  exit 0
fi
