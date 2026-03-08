#!/usr/bin/env bash
# AEGIS — Onboard a new shop in one command
# Usage: ONBOARD_SHOP_NAME="Blissal" ONBOARD_EMAIL="john@blissal.fr" ./scripts/onboard-shop.sh

set -euo pipefail
API_URL="${API_URL:-http://localhost:3000}"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
log() { echo -e "${BLUE}[AEGIS]${NC} $*"; }
ok()  { echo -e "${GREEN}[  OK ]${NC} $*"; }

SHOP_NAME="${ONBOARD_SHOP_NAME:?Set ONBOARD_SHOP_NAME}"
EMAIL="${ONBOARD_EMAIL:?Set ONBOARD_EMAIL}"
PASS="${ONBOARD_PASSWORD:-$(openssl rand -base64 16)}"

log "Onboarding shop: $SHOP_NAME"

# 1. Create account + shop
RESULT=$(curl -sf -X POST "$API_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"full_name\":\"${ONBOARD_OWNER:-Admin}\",\"shop_name\":\"$SHOP_NAME\"}")

USER_ID=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['user_id'])" 2>/dev/null || echo "")
ok "Account created (user: $USER_ID)"

# 2. Login + get token
TOKEN_RESULT=$(curl -sf -X POST "$API_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
TOKEN=$(echo "$TOKEN_RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])" 2>/dev/null || echo "")
SHOP_ID=$(echo "$TOKEN_RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['shops'][0]['id'])" 2>/dev/null || echo "")
ok "Authenticated (shop: $SHOP_ID)"

# 3. Print onboarding URL
echo ""
echo "══════════════════════════════════════════"
ok " Shop '$SHOP_NAME' ready"
echo "   Email:    $EMAIL"
echo "   Password: $PASS"
echo "   Shop ID:  $SHOP_ID"
echo "   Dashboard: $API_URL?token=$TOKEN"
echo ""
echo "   Next steps:"
echo "   1. Connect Shopify → Settings → Integrations"
echo "   2. Connect Meta Ads → Settings → Platforms"
echo "   3. Set product margins → Products → Economics"
echo "══════════════════════════════════════════"
