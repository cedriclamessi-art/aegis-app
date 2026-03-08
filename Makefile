# ============================================================
# AEGIS v3.2 — Makefile complet
# ============================================================
# make up              Démarrer tout
# make down            Arrêter
# make migrate         Toutes les migrations (ordre correct)
# make seed            Seed + bootstrap admin
# make test            Suite de tests complète (20 tests)
# make health          Santé de tous les services
# make audit           Audit sécurité
# make bootstrap-admin Créer/récupérer compte admin
# make backup          Backup DB compressé
# make deploy-check    Checklist pré-déploiement
# make reset           Reset complet (⚠️ destructif)
# make help            Toutes les commandes
# ============================================================

ifneq (,$(wildcard .env))
  include .env
  export
endif

COMPOSE           = docker compose
DB_URL           ?= postgresql://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@localhost:$(POSTGRES_PORT)/$(POSTGRES_DB)
PSQL              = psql "$(DB_URL)" --set ON_ERROR_STOP=1
TS_NODE           = npx tsx
BACKUP_DIR        = ./backups
BACKEND_PORT     ?= 3000
WORKER_HEALTH_PORT ?= 3001
FRONTEND_PORT    ?= 3002

RED   = \033[0;31m
GREEN = \033[0;32m
GOLD  = \033[0;33m
CYAN  = \033[0;36m
RESET = \033[0m

.PHONY: up down build migrate migrate-check seed bootstrap-admin \
        test test-quick test-billing test-guardrails test-agents \
        health health-post-deploy audit lint typecheck build-prod \
        logs logs-backend logs-worker shell-db shell-backend \
        backup backup-list restore clean reset deploy-check help

# ── Infrastructure ───────────────────────────────────────────────────────────

up:
	@echo "$(CYAN)▶ Démarrage AEGIS...$(RESET)"
	$(COMPOSE) up -d
	@echo "$(GREEN)✅ AEGIS running$(RESET)"
	@echo "   API    → http://localhost:$(BACKEND_PORT)"
	@echo "   Admin  → http://localhost:$(FRONTEND_PORT)"

down:
	@echo "$(GOLD)⏸ Arrêt...$(RESET)"
	$(COMPOSE) down
	@echo "$(GREEN)✅ Arrêté$(RESET)"

build:
	$(COMPOSE) build --no-cache

logs:
	$(COMPOSE) logs -f --tail=100

logs-backend:
	$(COMPOSE) logs -f backend --tail=200

logs-worker:
	$(COMPOSE) logs -f worker --tail=200

shell-db:
	$(PSQL)

shell-backend:
	$(COMPOSE) exec backend sh

# ── Database ─────────────────────────────────────────────────────────────────

migrate:
	@echo "$(CYAN)▶ Migrations (idempotentes, ordre strict)...$(RESET)"
	@$(PSQL) -f migrations/000_consolidated.sql      && echo "  ✓ 000 consolidated"
	@$(PSQL) -f migrations/009_phase_unlock.sql      && echo "  ✓ 009 phase_unlock"
	@$(PSQL) -f migrations/010_learning_patterns.sql && echo "  ✓ 010 learning_patterns"
	@$(PSQL) -f migrations/014_empire_core.sql       && echo "  ✓ 014 empire_core"
	@$(PSQL) -f migrations/016_ugc_media.sql         && echo "  ✓ 016 ugc_media"
	@$(PSQL) -f migrations/017_capi_relay.sql        && echo "  ✓ 017 capi_relay"
	@$(PSQL) -f migrations/018_money_model.sql       && echo "  ✓ 018 money_model"
	@$(PSQL) -f migrations/019_stop_loss.sql         && echo "  ✓ 019 stop_loss"
	@$(PSQL) -f migrations/020_guardrails_by_level.sql && echo "  ✓ 020 guardrails"
	@$(PSQL) -f migrations/021_systemic_risks.sql    && echo "  ✓ 021 systemic_risks"
	@$(PSQL) -f migrations/022_billing.sql           && echo "  ✓ 022 billing"
	@echo "$(GREEN)✅ 11 migrations — 110+ tables$(RESET)"

migrate-check:
	@$(PSQL) -c "SELECT MAX(version) AS current FROM schema_migrations WHERE status='applied';" 2>/dev/null || echo "schema_migrations non initialisée"

seed:
	@echo "$(CYAN)▶ Seed...$(RESET)"
	@cd backend && $(TS_NODE) scripts/seed.ts
	@echo "$(GREEN)✅ Seed OK$(RESET)"

bootstrap-admin:
	@echo "$(CYAN)▶ Bootstrap admin (jonathanlamessi@yahoo.fr)...$(RESET)"
	@$(PSQL) -t -c "SELECT message FROM auth.bootstrap_admin();" 2>/dev/null
	@echo "$(GOLD)  → Utiliser le reset_token reçu pour définir le mot de passe :$(RESET)"
	@echo "     POST /api/auth/reset-password { token, newPassword }"

# ── Qualité ──────────────────────────────────────────────────────────────────

lint:
	@echo "$(CYAN)▶ ESLint...$(RESET)"
	@cd backend && npx eslint src --ext .ts --max-warnings 0 && echo "$(GREEN)  ✅ backend OK$(RESET)"
	@cd workers && npx eslint src --ext .ts --max-warnings 0 && echo "$(GREEN)  ✅ workers OK$(RESET)"

typecheck:
	@echo "$(CYAN)▶ TypeScript strict...$(RESET)"
	@cd backend && npx tsc --noEmit && echo "$(GREEN)  ✅ backend OK$(RESET)"
	@cd workers && npx tsc --noEmit && echo "$(GREEN)  ✅ workers OK$(RESET)"

build-prod:
	@cd backend && npx tsc
	@cd workers && npx tsc
	@echo "$(GREEN)✅ Build prod OK$(RESET)"

# ── Tests ────────────────────────────────────────────────────────────────────

test:
	@echo "$(CYAN)▶ Suite tests complète AEGIS (20 tests)...$(RESET)"
	@echo ""
	@DATABASE_URL="$(DB_URL)" $(TS_NODE) scripts/test-suite.ts

test-quick:
	@DATABASE_URL="$(DB_URL)" $(TS_NODE) scripts/test-suite.ts --filter=db

test-billing:
	@DATABASE_URL="$(DB_URL)" $(TS_NODE) scripts/test-suite.ts --filter=billing

test-guardrails:
	@DATABASE_URL="$(DB_URL)" $(TS_NODE) scripts/test-suite.ts --filter=guardrails

test-agents:
	@DATABASE_URL="$(DB_URL)" $(TS_NODE) scripts/test-suite.ts --filter=agents

# ── Health ───────────────────────────────────────────────────────────────────

health:
	@echo "$(CYAN)▶ Santé des services...$(RESET)"
	@$(PSQL) -c "SELECT 1" > /dev/null 2>&1 \
		&& echo "$(GREEN)  ✅ PostgreSQL$(RESET)" \
		|| echo "$(RED)  ❌ PostgreSQL FAIL$(RESET)"
	@curl -sf http://localhost:$(BACKEND_PORT)/health > /dev/null 2>&1 \
		&& echo "$(GREEN)  ✅ Backend API$(RESET)" \
		|| echo "$(RED)  ❌ Backend API$(RESET)"
	@echo ""
	@echo "$(CYAN)  Jobs queue :$(RESET)"
	@$(PSQL) -c "SELECT status, COUNT(*) FROM jobs.queue GROUP BY status ORDER BY status;" 2>/dev/null || true
	@echo "$(CYAN)  Alertes actives :$(RESET)"
	@$(PSQL) -c "SELECT severity, COUNT(*) FROM ops.alerts WHERE resolved_at IS NULL GROUP BY severity;" 2>/dev/null || true
	@echo "$(CYAN)  Agents throttlés :$(RESET)"
	@$(PSQL) -c "SELECT agent_id, failrate_pct FROM agents.throttle_state WHERE throttled = TRUE;" 2>/dev/null || true

health-post-deploy:
	@DATABASE_URL="$(DB_URL)" $(TS_NODE) scripts/test-suite.ts --filter=health
	@echo "$(GREEN)✅ Post-deploy OK$(RESET)"

# ── Audit ────────────────────────────────────────────────────────────────────

audit:
	@echo "$(CYAN)▶ Audit sécurité AEGIS v3.2...$(RESET)"
	@echo ""
	@MISSING=0; \
	for f in $$(find backend/src workers/src -name "*.ts" 2>/dev/null); do \
		dir=$$(dirname $$f); \
		for imp in $$(grep -o "from '[^']*'" $$f | grep "\.\." | sed "s/from '//;s/'//"); do \
			full=$$(realpath "$$dir/$$imp" 2>/dev/null); \
			[ ! -f "$${full}.ts" ] && [ ! -f "$${full}.js" ] && MISSING=$$((MISSING+1)); \
		done; \
	done; \
	[ "$$MISSING" -eq 0 ] && echo "$(GREEN)  ✅ Imports — 0 cassé$(RESET)" || echo "$(RED)  ❌ $$MISSING imports cassés$(RESET)"
	@SECRETS=$$(grep -rE "sk-(ant|live|test)-[a-zA-Z0-9]{20}" backend/src/ 2>/dev/null | wc -l | tr -d ' '); \
	[ "$$SECRETS" = "0" ] && echo "$(GREEN)  ✅ 0 secret hardcodé$(RESET)" || echo "$(RED)  ❌ $$SECRETS secrets$(RESET)"
	@LOGS=$$(grep -r "console\." backend/src/ 2>/dev/null | wc -l | tr -d ' '); \
	[ "$$LOGS" = "0" ] && echo "$(GREEN)  ✅ 0 console.*$(RESET)" || echo "$(RED)  ❌ $$LOGS console.* restants$(RESET)"
	@echo ""
	@DATABASE_URL="$(DB_URL)" $(TS_NODE) scripts/test-suite.ts 2>&1 | grep -E "✅|❌|RÉSULTAT"

# ── Backup ───────────────────────────────────────────────────────────────────

backup:
	@mkdir -p $(BACKUP_DIR)
	@TIMESTAMP=$$(date +%Y%m%d_%H%M%S); \
	FILE="$(BACKUP_DIR)/aegis_$${TIMESTAMP}.sql.gz"; \
	pg_dump "$(DB_URL)" | gzip > $$FILE; \
	SIZE=$$(du -sh $$FILE | cut -f1); \
	echo "$(GREEN)✅ Backup : $$FILE ($$SIZE)$(RESET)"

backup-list:
	@ls -lh $(BACKUP_DIR)/*.sql.gz 2>/dev/null || echo "Aucun backup dans $(BACKUP_DIR)"

restore:
	@echo "$(RED)⚠️  RESTAURATION — écrase la DB actuelle$(RESET)"
	@read -p "Fichier .sql.gz : " FILE; \
	read -p "Confirmer (yes) : " C; \
	[ "$$C" = "yes" ] && gunzip -c $$FILE | $(PSQL) || echo "Annulé"

# ── Reset / Clean ─────────────────────────────────────────────────────────────

clean:
	$(COMPOSE) down -v --remove-orphans
	@echo "$(GREEN)✅ Clean$(RESET)"

reset:
	@echo "$(RED)⚠️  RESET COMPLET — toutes les données supprimées$(RESET)"
	@read -p "Confirmer (yes) : " C; [ "$$C" = "yes" ] || (echo "Annulé" && exit 1)
	$(COMPOSE) down -v
	$(COMPOSE) up -d postgres
	@echo "Attente PostgreSQL (5s)..."
	@sleep 5
	@$(MAKE) migrate
	@$(MAKE) seed
	@$(MAKE) bootstrap-admin
	@echo "$(GREEN)✅ Reset complet$(RESET)"

# ── Deploy check ─────────────────────────────────────────────────────────────

deploy-check:
	@echo "$(CYAN)═══════════════════════════════════════════════$(RESET)"
	@echo "$(CYAN)   AEGIS — Checklist pré-déploiement$(RESET)"
	@echo "$(CYAN)═══════════════════════════════════════════════$(RESET)"
	@[ -f .env ]       && echo "$(GREEN)  ✅ .env présent$(RESET)"       || echo "$(RED)  ❌ .env manquant$(RESET)"
	@grep -q "CHANGE_ME\|YOUR_KEY\|xxx" .env 2>/dev/null \
		&& echo "$(RED)  ❌ Placeholders dans .env$(RESET)" \
		|| echo "$(GREEN)  ✅ .env sans placeholder$(RESET)"
	@docker info > /dev/null 2>&1 \
		&& echo "$(GREEN)  ✅ Docker OK$(RESET)" \
		|| echo "$(RED)  ❌ Docker non démarré$(RESET)"
	@[ -d $(BACKUP_DIR) ] \
		&& echo "$(GREEN)  ✅ Répertoire backups$(RESET)" \
		|| echo "$(GOLD)  ⚠️  mkdir backups$(RESET)"
	@echo ""
	@echo "  $(CYAN)Étapes go-live :$(RESET)"
	@echo "   1. make deploy-check"
	@echo "   2. make up"
	@echo "   3. make migrate"
	@echo "   4. make seed"
	@echo "   5. make bootstrap-admin"
	@echo "   6. make test"
	@echo "   7. make health"
	@echo "$(CYAN)═══════════════════════════════════════════════$(RESET)"

# ── Aide ─────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "$(CYAN)AEGIS v3.2 — Makefile$(RESET)"
	@echo ""
	@echo "$(GOLD)Infra$(RESET)       up · down · build · logs · shell-db"
	@echo "$(GOLD)Database$(RESET)    migrate · seed · bootstrap-admin · backup · reset"
	@echo "$(GOLD)Qualité$(RESET)     test · audit · health · lint · typecheck"
	@echo "$(GOLD)Prod$(RESET)        deploy-check · health-post-deploy · restore"
	@echo ""

# v3.8 targets
deploy:
	./aegis-deploy.sh

onboard-shop:
	@read -p "Shop name: " name; ./aegis-deploy.sh --shop $$name

health:
	@curl -s http://localhost:3001/health | python3 -m json.tool

daypart-now:
	@curl -sf -X POST http://localhost:3001/api/internal/agents/dispatch \
	  -H "Content-Type: application/json" \
	  -d '{"agent":"AGENT_DAYPARTING","task":"apply_schedule"}'

pixel-check:
	@curl -sf -X POST http://localhost:3001/api/internal/agents/dispatch \
	  -H "Content-Type: application/json" \
	  -d '{"agent":"AGENT_PIXEL_HEALTH","task":"check"}'

competitive-analyze:
	@curl -sf -X POST http://localhost:3001/api/internal/agents/dispatch \
	  -H "Content-Type: application/json" \
	  -d '{"agent":"AGENT_COMPETITIVE_INTEL","task":"analyze_patterns"}'

## v3.8 targets
deploy:
	./scripts/aegis-deploy.sh

deploy-staging:
	AEGIS_ENV=staging ./scripts/aegis-deploy.sh

onboard:
	./scripts/onboard-shop.sh

health:
	curl -s http://localhost:3000/health | python3 -m json.tool

daypart-analyze:
	curl -s -X POST http://localhost:3000/api/internal/dispatch \
	  -d '{"agent":"AGENT_DAYPARTING","task":"analyze_patterns"}' | python3 -m json.tool

pixel-check:
	curl -s -X POST http://localhost:3000/api/internal/dispatch \
	  -d '{"agent":"AGENT_PIXEL_HEALTH","task":"check"}' | python3 -m json.tool

## v3.9 targets
chaos-test:
	./scripts/chaos-test.sh

llm-costs:
	curl -s -H "Authorization: Bearer $$AEGIS_TOKEN" \
	  http://localhost:3000/api/shops/$$SHOP_ID/llm-costs | python3 -m json.tool

shadow-report:
	curl -s -X POST http://localhost:3000/api/internal/dispatch \
	  -d '{"agent":"AGENT_SHADOW_MODE","task":"generate_report"}' | python3 -m json.tool

calibrate-guardrails:
	curl -s -X POST http://localhost:3000/api/internal/dispatch \
	  -d '{"agent":"AGENT_GUARDRAIL_CALIBRATOR","task":"calibrate"}' | python3 -m json.tool

## v4.0 — Conseil Constitutionnel
council-status:
	curl -s -H "Authorization: Bearer $$AEGIS_TOKEN" \
	  http://localhost:3000/api/shops/$$SHOP_ID/constitution/status | python3 -m json.tool

council-reviews:
	curl -s -H "Authorization: Bearer $$AEGIS_TOKEN" \
	  "http://localhost:3000/api/shops/$$SHOP_ID/constitution/reviews?limit=20" | python3 -m json.tool

council-articles:
	curl -s http://localhost:3000/api/shops/$$SHOP_ID/constitution/articles | python3 -m json.tool

whitelist-add:
	@echo "Usage: make whitelist-add DEST_TYPE=klaviyo DEST_ID=list_abc PURPOSE='Champions list'"
	curl -s -X POST -H "Authorization: Bearer $$AEGIS_TOKEN" \
	  -H "Content-Type: application/json" \
	  -d "{\"destination_type\":\"$$DEST_TYPE\",\"destination_id\":\"$$DEST_ID\",\"purpose\":\"$$PURPOSE\"}" \
	  http://localhost:3000/api/shops/$$SHOP_ID/constitution/whitelist | python3 -m json.tool

lift-suspension:
	@echo "Usage: make lift-suspension AGENT=AGENT_SCALE"
	curl -s -X POST -H "Authorization: Bearer $$AEGIS_TOKEN" \
	  http://localhost:3000/api/shops/$$SHOP_ID/constitution/suspensions/$$AGENT/lift | python3 -m json.tool

## v4.1 targets
probes:
	curl -s -X POST http://localhost:3000/api/internal/dispatch \
	  -d '{"agent":"AGENT_HEALTH_PROBES","task":"run_all"}' | python3 -m json.tool

seasonal-check:
	curl -s -X POST http://localhost:3000/api/internal/dispatch \
	  -d '{"agent":"AGENT_SEASONAL_CALENDAR","task":"check_phases"}' | python3 -m json.tool

seasonal-upcoming:
	curl -s -H "Authorization: Bearer $$AEGIS_TOKEN" \
	  http://localhost:3000/api/shops/$$SHOP_ID/seasonal/upcoming | python3 -m json.tool

monthly-report:
	curl -s -X POST http://localhost:3000/api/internal/dispatch \
	  -d '{"agent":"AGENT_MONTHLY_REPORT","task":"generate"}' | python3 -m json.tool

narrate:
	curl -s -X POST http://localhost:3000/api/internal/dispatch \
	  -d '{"agent":"AGENT_DECISION_NARRATOR","task":"narrate_batch"}' | python3 -m json.tool

activity-feed:
	curl -s -H "Authorization: Bearer $$AEGIS_TOKEN" \
	  http://localhost:3000/api/shops/$$SHOP_ID/decisions/feed | python3 -m json.tool

currency-rates:
	curl -s http://localhost:3000/api/currency/rates | python3 -m json.tool

## v4.2 targets
seed-global-calendar:
	curl -s -X POST http://localhost:3000/api/internal/dispatch \
	  -d '{"agent":"AGENT_SEASONAL_CALENDAR","task":"seed_global"}' | python3 -m json.tool

replenishment:
	curl -s -X POST http://localhost:3000/api/internal/dispatch \
	  -d '{"agent":"AGENT_REPLENISHMENT","task":"sync_inventory"}' | python3 -m json.tool

stock-alerts:
	curl -s -H "Authorization: Bearer $$AEGIS_TOKEN" \
	  http://localhost:3000/api/shops/$$SHOP_ID/replenishment/alerts | python3 -m json.tool

budget-optimize:
	curl -s -X POST http://localhost:3000/api/internal/dispatch \
	  -d '{"agent":"AGENT_BUDGET_OPTIMIZER","task":"analyze"}' | python3 -m json.tool

brief-ab-results:
	curl -s -H "Authorization: Bearer $$AEGIS_TOKEN" \
	  http://localhost:3000/api/shops/$$SHOP_ID/brief-ab/results | python3 -m json.tool

vapid-keys:
	@echo "Générer les clés VAPID pour les push notifications:"
	npx web-push generate-vapid-keys

pwa-serve:
	@echo "PWA disponible sur http://localhost:3000 (servi par le backend Express)"
	@echo "Pour tester en local: cd frontend/pwa && python3 -m http.server 8080"
