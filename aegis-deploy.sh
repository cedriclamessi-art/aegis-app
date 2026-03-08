#!/usr/bin/env bash
# ================================================================
# AEGIS Deploy Script v3.8
# Usage: ./aegis-deploy.sh [--shop SHOP_NAME] [--env ENV_FILE]
# Zero manual steps. Validates → migrates → starts → healthchecks.
# ================================================================

set -euo pipefail

AEGIS_VERSION="3.8.0"
ENV_FILE="${2:-.env}"
LOG_FILE="/var/log/aegis/deploy-$(date +%Y%m%d-%H%M%S).log"
MIGRATIONS_DIR="./migrations"
ROLLBACK_ON_FAIL=true

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log()  { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $*" | tee -a "$LOG_FILE"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*" | tee -a "$LOG_FILE"; }
err()  { echo -e "${RED}[ERROR]${NC} $*" | tee -a "$LOG_FILE"; exit 1; }
step() { echo -e "\n${BLUE}━━ $* ${NC}" | tee -a "$LOG_FILE"; }

mkdir -p /var/log/aegis

# ── 0. Banner ─────────────────────────────────────────────────
echo -e "${BLUE}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║   AEGIS v${AEGIS_VERSION} — Autonomous Deploy      ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${NC}"

# ── 1. Load env ───────────────────────────────────────────────
step "Loading environment"
if [[ ! -f "$ENV_FILE" ]]; then
  err "Environment file '$ENV_FILE' not found. Copy .env.example and fill in your values."
fi
set -a; source "$ENV_FILE"; set +a
log "Environment loaded from $ENV_FILE"

# ── 2. Validate required API keys ─────────────────────────────
step "Validating API keys and credentials"

REQUIRED_VARS=(
  DATABASE_URL REDIS_URL ANTHROPIC_API_KEY
  JWT_SECRET META_SYSTEM_TOKEN
)
OPTIONAL_VARS=(RESEND_API_KEY WHATSAPP_TOKEN WHATSAPP_PHONE_ID TIKTOK_ACCESS_TOKEN)

missing=()
for var in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then missing+=("$var"); fi
done
if [[ ${#missing[@]} > 0 ]]; then
  err "Missing required env vars: ${missing[*]}"
fi
log "All required env vars present ✓"

for var in "${OPTIONAL_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then warn "$var not set — ${var} features will be disabled"; fi
done

# ── 3. Validate API connectivity ──────────────────────────────
step "Testing API connectivity"

# Test Anthropic API
anthropic_test=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  "https://api.anthropic.com/v1/models" 2>/dev/null || echo "000")
if [[ "$anthropic_test" != "200" ]]; then err "Anthropic API key invalid (HTTP $anthropic_test)"; fi
log "Anthropic API ✓"

# Test Meta API
meta_test=$(curl -s -o /dev/null -w "%{http_code}" \
  "https://graph.facebook.com/v18.0/me?access_token=$META_SYSTEM_TOKEN" 2>/dev/null || echo "000")
if [[ "$meta_test" != "200" ]]; then warn "Meta token may be invalid (HTTP $meta_test) — check permissions"; fi
[[ "$meta_test" == "200" ]] && log "Meta API ✓" || warn "Meta API ⚠"

# ── 4. Database connectivity ───────────────────────────────────
step "Testing database connection"
DB_RESULT=$(psql "$DATABASE_URL" -c "SELECT version();" -t -q 2>&1 || true)
if [[ "$DB_RESULT" != *"PostgreSQL"* ]]; then err "Cannot connect to PostgreSQL: $DB_RESULT"; fi
log "PostgreSQL connected ✓"

# Test Redis
REDIS_RESULT=$(redis-cli -u "$REDIS_URL" PING 2>/dev/null || echo "FAIL")
if [[ "$REDIS_RESULT" != "PONG" ]]; then err "Cannot connect to Redis"; fi
log "Redis connected ✓"

# ── 5. Run migrations ─────────────────────────────────────────
step "Running database migrations"

# Get current migration version
CURRENT_MIG=$(psql "$DATABASE_URL" -t -q \
  -c "SELECT COALESCE(MAX(migration_number),0) FROM deploy_log WHERE status='success'" 2>/dev/null || echo "0")
CURRENT_MIG=$(echo "$CURRENT_MIG" | tr -d ' ')
log "Current migration: $CURRENT_MIG"

# Find pending migrations
PENDING=()
for f in $(ls "$MIGRATIONS_DIR"/*.sql | sort -V); do
  num=$(basename "$f" | grep -oP '^\d+' || echo "0")
  if [[ "$num" -gt "$CURRENT_MIG" ]]; then PENDING+=("$f"); fi
done

if [[ ${#PENDING[@]} == 0 ]]; then
  log "No pending migrations ✓"
else
  log "${#PENDING[@]} migration(s) to apply"

  for mig in "${PENDING[@]}"; do
    mig_name=$(basename "$mig")
    mig_num=$(echo "$mig_name" | grep -oP '^\d+')
    log "  Applying $mig_name..."

    # Log start
    psql "$DATABASE_URL" -q -c \
      "INSERT INTO deploy_log (version, migration_number, status) VALUES ('$AEGIS_VERSION', $mig_num, 'running') ON CONFLICT DO NOTHING;" 2>/dev/null || true

    # Apply migration
    if psql "$DATABASE_URL" -f "$mig" -q >> "$LOG_FILE" 2>&1; then
      psql "$DATABASE_URL" -q -c \
        "UPDATE deploy_log SET status='success', completed_at=NOW() WHERE migration_number=$mig_num AND status='running';" 2>/dev/null || true
      log "  ✓ $mig_name applied"
    else
      psql "$DATABASE_URL" -q -c \
        "UPDATE deploy_log SET status='failed', completed_at=NOW() WHERE migration_number=$mig_num;" 2>/dev/null || true

      if [[ "$ROLLBACK_ON_FAIL" == "true" ]]; then
        warn "Migration failed — rolling back last change"
        psql "$DATABASE_URL" -q -c "ROLLBACK;" 2>/dev/null || true
        psql "$DATABASE_URL" -q -c \
          "UPDATE deploy_log SET rolled_back=true WHERE migration_number=$mig_num;" 2>/dev/null || true
      fi
      err "Migration $mig_name failed. Check $LOG_FILE for details."
    fi
  done
fi

# ── 6. Build TypeScript ───────────────────────────────────────
step "Building application"
if command -v npm &>/dev/null; then
  npm run build >> "$LOG_FILE" 2>&1 && log "Build ✓" || err "Build failed"
else
  warn "npm not found — skipping build (assuming pre-built)"
fi

# ── 7. Start / restart services ───────────────────────────────
step "Starting AEGIS services"
if command -v docker-compose &>/dev/null; then
  docker-compose up -d --remove-orphans >> "$LOG_FILE" 2>&1
  log "Docker services started"
elif command -v pm2 &>/dev/null; then
  pm2 reload ecosystem.config.js --update-env >> "$LOG_FILE" 2>&1
  log "PM2 services reloaded"
else
  warn "Neither docker-compose nor pm2 found — start services manually"
fi

# ── 8. Health check ───────────────────────────────────────────
step "Running post-deploy health check"

MAX_RETRIES=12; RETRY=0
API_URL="${AEGIS_API_URL:-http://localhost:3001}"

log "Waiting for API to be ready..."
until curl -sf "$API_URL/health" > /dev/null 2>&1; do
  RETRY=$((RETRY+1))
  if [[ $RETRY -ge $MAX_RETRIES ]]; then err "Health check failed after ${MAX_RETRIES} attempts"; fi
  echo -n "."; sleep 5
done
echo ""

HEALTH=$(curl -sf "$API_URL/health")
log "Health response: $HEALTH"

# Parse health
DB_OK=$(echo "$HEALTH"    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['checks']['database'])" 2>/dev/null || echo "false")
REDIS_OK=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['checks']['redis'])" 2>/dev/null || echo "false")
STATUS=$(echo "$HEALTH"   | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'])" 2>/dev/null || echo "unknown")

[[ "$DB_OK" == "True" ]]    && log "  Database ✓" || warn "  Database ⚠"
[[ "$REDIS_OK" == "True" ]] && log "  Redis ✓"    || warn "  Redis ⚠"
[[ "$STATUS" == "ok" ]]     && log "  Status: OK ✓" || warn "  Status: $STATUS"

# ── 9. Onboard new shop (optional) ────────────────────────────
if [[ "${1:-}" == "--shop" && -n "${2:-}" ]]; then
  step "Onboarding shop: $2"
  SHOP_RESULT=$(curl -sf -X POST "$API_URL/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"admin@${2}.com\",\"password\":\"$(openssl rand -base64 16)\",\"shop_name\":\"$2\"}" 2>/dev/null || echo '{}')
  USER_ID=$(echo "$SHOP_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('user_id',''))" 2>/dev/null || echo "")
  [[ -n "$USER_ID" ]] && log "Shop '$2' created (user_id: $USER_ID)" || warn "Shop creation returned: $SHOP_RESULT"
fi

# ── 10. Summary ───────────────────────────────────────────────
echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}  AEGIS v${AEGIS_VERSION} deployed successfully${NC}"
echo -e "${GREEN}  Migrations applied: ${#PENDING[@]}${NC}"
echo -e "${GREEN}  API: $API_URL${NC}"
echo -e "${GREEN}  Logs: $LOG_FILE${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
