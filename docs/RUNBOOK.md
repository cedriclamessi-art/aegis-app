# AEGIS — Runbook Deploy + Go-Live Checklist
> VPS · Docker Compose · Nginx · Robuste · Phase 0→100M

---

## 1. DEPLOY RUNBOOK (VPS → Production)

### Prérequis serveur
```bash
# VPS Phase 1 (0→1M): 4 vCPU / 8 GB RAM / 50 GB SSD
# OS: Ubuntu 22.04 LTS · Ports: 80, 443, 22

sudo apt update && sudo apt install -y docker.io docker-compose-v2 git openssl make
sudo usermod -aG docker $USER
newgrp docker
```

### Étape 1 — Clone + Secrets
```bash
git clone https://github.com/your-org/aegis.git /opt/aegis
cd /opt/aegis
cp .env.example .env

# Générer tous les secrets d'un coup
cat >> .env << EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 64)
JWT_REFRESH_SECRET=$(openssl rand -hex 64)
VAULT_KEY=$(openssl rand -hex 32)
INTERNAL_KEY=$(openssl rand -hex 32)
EOF

# Remplir manuellement dans .env:
# - LLM_API_KEY (Anthropic)
# - STRIPE_SECRET_KEY
# - META_APP_ID / META_APP_SECRET
# - etc.
```

### Étape 2 — SSL
```bash
# Option A: Let's Encrypt (recommandé prod)
sudo apt install certbot
sudo certbot certonly --standalone -d yourdomain.com
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem ./infra/nginx/ssl/
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem ./infra/nginx/ssl/

# Option B: Self-signed (dev uniquement)
mkdir -p ./infra/nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout ./infra/nginx/ssl/privkey.pem \
  -out ./infra/nginx/ssl/fullchain.pem \
  -subj "/CN=localhost"
```

### Étape 3 — Build + Start
```bash
make build
make up
docker compose ps   # Vérifier que tout est "healthy"
```

### Étape 4 — Migrate + Seed
```bash
# Les migrations s'exécutent automatiquement au premier start postgres
# Si besoin de forcer:
make migrate

# Créer admin + plans + seed
make seed
# ⚠️ Copier le reset link affiché dans les logs!
# Il expire dans 24h
```

### Étape 5 — Smoke Tests
```bash
# Health
curl https://yourdomain.com/health/live
# → {"status":"ok"}

curl https://yourdomain.com/health/ready
# → {"db":"ok","workers":"ok","queue_depth":0}

# Récupérer token admin
TOKEN=$(curl -s -X POST https://yourdomain.com/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jonathanlamessi@yahoo.fr","password":"YOUR_NEW_PASSWORD"}' \
  | jq -r '.access_token')

echo "Token: $TOKEN"

# Vérifier admin lifetime
curl https://yourdomain.com/v1/auth/me \
  -H "Authorization: Bearer $TOKEN"
# → {"admin_lifetime": true, "plan": "scale"}

# Metrics
curl https://yourdomain.com/metrics
```

### Étape 6 — Test Suite
```bash
make test
# Tous les 8 tests doivent passer avant de continuer
```

### Étape 7 — Connecter les providers
```bash
# Via UI admin → /connectors
# Ou via API:

# Shopify OAuth
curl -X POST https://yourdomain.com/v1/connectors/shopify/oauth/init \
  -H "Authorization: Bearer $TOKEN"
# → {"redirect_url": "..."} → ouvrir dans browser

# Stripe API Key
curl -X POST https://yourdomain.com/v1/connectors/stripe/connect \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"api_key": "sk_live_..."}'

# Meta OAuth
curl -X POST https://yourdomain.com/v1/connectors/meta/oauth/init \
  -H "Authorization: Bearer $TOKEN"
```

### Étape 8 — Premier produit test
```bash
# Ingestor un lien produit (mode Human Control)
PIPELINE=$(curl -s -X POST https://yourdomain.com/v1/products/ingest \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-shopify.myshopify.com/products/test", "mode": "human"}' \
  | jq -r '.pipeline_run_id')

echo "Pipeline: $PIPELINE"

# Suivre le statut
watch -n 5 "curl -s https://yourdomain.com/v1/products/$PIPELINE/status \
  -H 'Authorization: Bearer $TOKEN' | jq '.status,.current_step'"
```

### Étape 9 — Go-Live progressif
```bash
# Mode Human → validé manuellement pendant 7 jours
# Puis passer en Semi:
curl -X PATCH https://yourdomain.com/v1/risk/mode \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"mode": "semi"}'

# Full Auto: SEULEMENT après 7 jours green + metrics stables
curl -X PATCH https://yourdomain.com/v1/risk/mode \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"mode": "auto", "confirm": "I_UNDERSTAND_THE_RISKS"}'
```

---

## 2. BACKUP & ROLLBACK

### Backup PostgreSQL
```bash
# Backup manuel
docker compose exec postgres pg_dump -U aegis aegis | gzip > backup_$(date +%Y%m%d_%H%M).sql.gz

# Cron automatique (ajouter dans crontab)
0 2 * * * docker compose -f /opt/aegis/docker-compose.yml exec postgres \
  pg_dump -U aegis aegis | gzip > /backups/aegis_$(date +\%Y\%m\%d).sql.gz

# Vérifier backup
ls -lh /backups/
```

### Rollback migration
```bash
# Chaque migration doit avoir son rollback dans /migrations/XXX_rollback.sql
make migrate-rollback STEP=005
```

---

## 3. CHECKLIST SÉCURITÉ (14 points obligatoires)

### Secrets
- [ ] JWT_SECRET ≥ 64 chars hex
- [ ] VAULT_KEY = 64 chars hex (backup offline obligatoire)
- [ ] POSTGRES_PASSWORD ≥ 32 chars random
- [ ] .env non commité (.gitignore vérifié: `git ls-files --error-unmatch .env` doit échouer)
- [ ] INTERNAL_KEY configuré (endpoints /internal/* protégés)

### Database
- [ ] RLS activé + testé (`make test-rls` = vert)
- [ ] Audit log immuable (pas d'UPDATE/DELETE possible)
- [ ] Backup automatique configuré + testé (restore d'un backup)
- [ ] Port PostgreSQL non exposé publiquement (`docker compose ps` → postgres sans port public)

### API & Réseau
- [ ] HTTPS forcé (HTTP → 301 redirect)
- [ ] Rate limiting actif (global + auth)
- [ ] CORS strict (CORS_ORIGINS = domaine exact, pas `*`)
- [ ] Webhook signatures vérifiées (Stripe-Signature, Shopify HMAC)

### Tokens & Connecteurs
- [ ] Token vault chiffré vérifié (`SELECT encrypted_value FROM token_vault LIMIT 1` → bytea, pas texte lisible)
- [ ] Circuit breakers actifs sur chaque provider

---

## 4. TABLEAU PHASES 0→100M

### Phase 1 (0 → 1M€/an) — "Stabilité"
| Composant | Config |
|-----------|--------|
| Infra | 1 VPS · Docker Compose · 2 workers |
| DB | PostgreSQL 15 simple · backups daily |
| Agents actifs | 10 core + risk_engine + health_watchdog |
| Mode | Human Control → Semi après 7 jours green |
| Guardrails | ROAS min 1.5 · Max loss 500€/j · Budget cap 50€/adset |
| Connecteurs | Shopify + Stripe + Meta |
| Tests obligatoires | 8 tests = 100% verts |

### Phase 2 (1M → 10M€/an) — "Optimisation"
| Composant | Config |
|-----------|--------|
| Infra | 2 VPS · 4-8 workers · Read replica DB |
| Agents actifs | 20+ agents · learning loop actif |
| Mode | Semi Control → Full Auto validé |
| Guardrails | ROAS min 2.0 · Max loss 2000€/j · Budget cap 500€/adset |
| Connecteurs | + TikTok + Google Ads |
| Nouvelles features | Multi-store · Attribution server-side · Creative testing loop |

### Phase 3 (10M → 100M€/an) — "Scale"
| Composant | Config |
|-----------|--------|
| Infra | Kubernetes · Workers autoscale · DB sharding |
| Agents actifs | 25 agents complets · plugins verticaux actifs |
| Mode | Full Auto avec kill-switch supervisé |
| Guardrails | ROAS min 2.5 · Max loss 10k€/j · Budget cap 5k€/adset |
| Nouvelles features | Multi-region · SOC2-style audit · SLA contractuels |

---

## 5. COMMANDES UTILES

```bash
# Status général
make logs                     # tail tous les logs
docker compose ps             # état des containers

# Admin
make admin-reset              # générer nouveau reset link
make seed                     # re-seed si besoin

# Tests ciblés
make test-queue               # test saturation queue
make test-rls                 # test isolation tenant
make test-stop-loss           # test stop-loss
make test-dlq                 # test DLQ + replay

# Urgence
docker compose restart worker # restart workers
docker compose restart api    # restart API

# Kill-switch d'urgence (via API)
curl -X POST https://yourdomain.com/v1/risk/kill-switch \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"confirm": true}'

# Lever le kill-switch
curl -X DELETE https://yourdomain.com/v1/risk/kill-switch \
  -H "Authorization: Bearer $TOKEN"
```
