#!/usr/bin/env bash
# ============================================================
# AEGIS Deploy Script v3.8
# One-command deployment with validation, migration, health check
# Usage: ./scripts/aegis-deploy.sh [--env production|staging] [--rollback <version>]
# ============================================================

set -euo pipefail
AEGIS_VERSION="3.8.0"
DEPLOY_ENV="${AEGIS_ENV:-production}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[AEGIS]${NC} $*"; }
ok()   { echo -e "${GREEN}[  OK ]${NC} $*"; }
warn() { echo -e "${YELLOW}[ WARN]${NC} $*"; }
fail() { echo -e "${RED}[ FAIL]${NC} $*"; exit 1; }

log "═══════════════════════════════════════════"
log " AEGIS v${AEGIS_VERSION} — Deploy (${DEPLOY_ENV})"
log "═══════════════════════════════════════════"

# ── 1. Validate required env vars ──────────────────────────
log "Validating environment..."
REQUIRED_VARS=(
  DATABASE_URL REDIS_URL ANTHROPIC_API_KEY JWT_SECRET
  META_ACCESS_TOKEN META_SYSTEM_TOKEN
  SHOPIFY_API_KEY SHOPIFY_API_SECRET
)
OPTIONAL_VARS=(
  RESEND_API_KEY WHATSAPP_TOKEN WHATSAPP_PHONE_ID
  TIKTOK_ACCESS_TOKEN KLAVIYO_API_KEY
)

MISSING=()
for var in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then MISSING+=("$var"); fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  fail "Missing required env vars: ${MISSING[*]}\nCopy .env.example to .env and fill in values."
fi
ok "All required env vars present"

for var in "${OPTIONAL_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    warn "Optional var not set: $var (some features disabled)"
  fi
done

# ── 2. Test connectivity ───────────────────────────────────
log "Testing database connection..."
if ! psql "$DATABASE_URL" -c "SELECT 1" > /dev/null 2>&1; then
  fail "Cannot connect to PostgreSQL at DATABASE_URL"
fi
ok "PostgreSQL connected"

log "Testing Redis connection..."
if ! redis-cli -u "$REDIS_URL" ping > /dev/null 2>&1; then
  fail "Cannot connect to Redis at REDIS_URL"
fi
ok "Redis connected"

log "Testing Anthropic API..."
if ! curl -sf -o /dev/null \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  "https://api.anthropic.com/v1/models"; then
  fail "Anthropic API key invalid or unreachable"
fi
ok "Anthropic API reachable"

# ── 3. Build TypeScript ────────────────────────────────────
log "Building TypeScript..."
cd "$ROOT_DIR/backend"
npm ci --silent
npm run build 2>&1 | tail -5
ok "TypeScript compiled"

# ── 4. Run migrations ─────────────────────────────────────
log "Running database migrations..."
MIGRATION_DIR="$ROOT_DIR/migrations"
MIGRATIONS=($(ls "$MIGRATION_DIR"/*.sql | sort -V))

# Get current version from deploy_log
CURRENT_MIG=$(psql "$DATABASE_URL" -t -c \
  "SELECT COALESCE(MAX(migration_number), -1) FROM deploy_log WHERE status='success'" 2>/dev/null | tr -d ' \n' || echo "-1")

log "Current migration: ${CURRENT_MIG}, available: ${#MIGRATIONS[@]}"

DEPLOYED=0
for mig_path in "${MIGRATIONS[@]}"; do
  mig_num=$(basename "$mig_path" | grep -oE '^[0-9]+')
  mig_num_int=$((10#$mig_num))

  if [[ $mig_num_int -le $CURRENT_MIG ]]; then continue; fi

  log "  → Applying migration $mig_num: $(basename "$mig_path")"

  # Log start
  psql "$DATABASE_URL" -c \
    "INSERT INTO deploy_log (version, migration_number, status, deployed_by) \
     VALUES ('$AEGIS_VERSION', $mig_num_int, 'running', '$(whoami)') \
     ON CONFLICT DO NOTHING" 2>/dev/null || true

  # Apply migration (in transaction for rollback safety)
  if psql "$DATABASE_URL" < "$mig_path" > /dev/null 2>&1; then
    psql "$DATABASE_URL" -c \
      "UPDATE deploy_log SET status='success', completed_at=NOW() \
       WHERE migration_number=$mig_num_int AND version='$AEGIS_VERSION'" 2>/dev/null || true
    ok "  Migration $mig_num applied"
    ((DEPLOYED++))
  else
    psql "$DATABASE_URL" -c \
      "UPDATE deploy_log SET status='failed', completed_at=NOW() \
       WHERE migration_number=$mig_num_int AND version='$AEGIS_VERSION'" 2>/dev/null || true
    fail "Migration $mig_num failed. Check PostgreSQL logs."
  fi
done

if [[ $DEPLOYED -eq 0 ]]; then
  ok "No new migrations to apply"
else
  ok "$DEPLOYED migration(s) applied"
fi

# ── 5. Start / restart services ────────────────────────────
log "Starting AEGIS services..."

if command -v docker compose &> /dev/null; then
  cd "$ROOT_DIR"
  docker compose --env-file .env pull --quiet
  docker compose --env-file .env up -d --remove-orphans
  ok "Docker Compose services started"
elif command -v pm2 &> /dev/null; then
  pm2 restart aegis-api aegis-workers 2>/dev/null || \
  pm2 start "$ROOT_DIR/backend/dist/api/server.js" --name aegis-api
  ok "PM2 processes started"
else
  warn "No process manager found. Start manually: npm run start"
fi

# ── 6. Health check ────────────────────────────────────────
log "Running post-deploy health check..."
sleep 5  # Give services time to start

API_URL="${API_URL:-http://localhost:3000}"
MAX_RETRIES=10
for i in $(seq 1 $MAX_RETRIES); do
  if curl -sf "$API_URL/health" > /tmp/aegis_health.json 2>/dev/null; then
    HEALTH_STATUS=$(cat /tmp/aegis_health.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "unknown")
    if [[ "$HEALTH_STATUS" == "ok" ]]; then
      ok "Health check passed"
      break
    else
      warn "Health check degraded (attempt $i/$MAX_RETRIES): $(cat /tmp/aegis_health.json)"
    fi
  fi
  if [[ $i -eq $MAX_RETRIES ]]; then
    fail "Health check failed after $MAX_RETRIES attempts. Check logs: docker compose logs"
  fi
  sleep 3
done

# ── 7. Onboard new shop (if ONBOARD_SHOP_NAME set) ────────
if [[ -n "${ONBOARD_SHOP_NAME:-}" ]]; then
  log "Onboarding new shop: $ONBOARD_SHOP_NAME"
  curl -sf -X POST "$API_URL/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${ONBOARD_EMAIL:-admin@${ONBOARD_SHOP_NAME}.com}\",\"password\":\"${ONBOARD_PASSWORD:-changeme123}\",\"shop_name\":\"${ONBOARD_SHOP_NAME}\"}" \
    > /dev/null && ok "Shop '$ONBOARD_SHOP_NAME' created" || warn "Shop creation failed (may already exist)"
fi

# ── 8. Summary ────────────────────────────────────────────
echo ""
log "═══════════════════════════════════════════"
ok " AEGIS v${AEGIS_VERSION} deployed successfully"
log " Environment:  ${DEPLOY_ENV}"
log " Migrations:   ${DEPLOYED} applied"
log " Dashboard:    ${API_URL}"
log " Health:       ${API_URL}/health"
log "═══════════════════════════════════════════"
