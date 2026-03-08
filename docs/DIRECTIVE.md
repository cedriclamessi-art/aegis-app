# AEGIS — DIRECTIVE DEV (Version Finale)
> Copier-coller ready · Rien à interpréter · Tout à implémenter

---

## 0. OBJECTIF

AEGIS est une machine autonome e-commerce + marketing : un lien produit entre, une machine de conversion sort.

**Loi absolue** : signal → décision → exécution → mesure → apprentissage.

**Objectif business** : millions d'euros de CA tracké sur la plateforme.

---

## 1. ARCHITECTURE — 3 NIVEAUX EN FEATURE FLAGS

```sql
-- Dans saas.tenants :
agent_mode      VARCHAR(30) DEFAULT 'basic'
-- basic | hedge_fund | full_organism

autopilot_mode  VARCHAR(30) DEFAULT 'human_validate'
-- human_validate | semi_auto | full_auto

guardrails_locked BOOLEAN DEFAULT TRUE
-- JAMAIS FALSE sauf super_admin + audit log obligatoire
```

### Niveau 1 — `basic` (ship en 14 jours)
Pipeline linéaire : lien produit → fiche → store → ads → tracking.

### Niveau 2 — `hedge_fund` (activer à 1M€/an)
Desk de trading marketing : protection capital + arbitrage winners/losers.

### Niveau 3 — `full_organism` (activer à 3M€/an)
Organisme cognitif : signaux marché + apprentissage + auto-réparation.

---

## 2. AGENTS — LISTE COMPLÈTE PAR NIVEAU

### NIVEAU 1 — `basic` (9 agents)

| Agent | Mission | Déclencheur |
|-------|---------|-------------|
| `AGENT_INGEST` | Analyse URL produit, extrait données, crée Product Draft | Trigger: product.url_submitted |
| `AGENT_OFFER` | Pricing, bundles, garanties, upsells, plan abonnement | Trigger: product.ingested |
| `AGENT_COPY` | Copywriting page + ads + emails (brand voice) | Trigger: offer.built |
| `AGENT_CREATIVE` | Briefs créas image/vidéo + déclinaisons formats | Trigger: copy.generated |
| `AGENT_STORE_BUILDER` | Crée page produit Shopify + sections + FAQ | Trigger: creative.briefed |
| `AGENT_MEDIA_BUYER` | Set-up campagnes + audience + budget initial | Trigger: store.deployed |
| `AGENT_ANALYTICS` | Tracking events + attribution basique + rapports | Cron: toutes les heures |
| `AGENT_OPS_GUARD` | Budget cap + stop-loss simple + alerting | Cron: toutes les 10min |
| **`AGENT_STRATEGY_ORGANIC`** | **UGC automatisés + calendrier + croissance audience** | **Trigger + Crons** |

### NIVEAU 2 — `hedge_fund` (+5 agents)

| Agent | Mission | Déclencheur |
|-------|---------|-------------|
| `AGENT_RISK_ENGINE` | Stop-loss multi-niveaux, circuit breakers, drawdown | Cron: toutes les 15min |
| `AGENT_BUDGET_ALLOCATOR` | Allocation budget portefeuille (hedge fund logic) | Cron: toutes les 2h |
| `AGENT_PORTFOLIO_OPT` | Arbitrage winners/losers (scale vs kill) | Trigger: performance.updated |
| `AGENT_FRAUD_GUARD` | Anomalies: spend spike, CTR fake, bot, pixel drift | Cron: toutes les 5min |
| `AGENT_RECOVERY` | Auto-repair: retries, re-sync, rollback | Trigger: error.detected |

### NIVEAU 3 — `full_organism` (+9 agents)

| Agent | Mission | Déclencheur |
|-------|---------|-------------|
| `AGENT_ORCHESTRATOR` | Chef d'orchestre: arbitre conflits, assigne tâches | Cron: toutes les 5min |
| `AGENT_POLICY_GOVERNOR` | Doctrine + règles (autorisé/interdit) | Middleware: chaque action |
| `AGENT_MARKET_INTEL` | Scraping: Google Trends, TikTok, Amazon, Meta Ads Library | Crons: 3-6h |
| `AGENT_LEARNING` | Extraction patterns winners/losers, scoring | Cron: 3h du matin |
| `AGENT_EXPERIMENTS` | A/B tests orchestrés (pages, hooks, audiences, offres) | Cron: toutes les 6h |
| `AGENT_HEALTH_SRE` | Santé système, auto-healing, SLO, DLQ replay | Cron: toutes les 2min |
| `AGENT_LEGAL_SCRAPING` | Conformité: robots.txt, TOS, consentement | Trigger: avant scraping |
| `AGENT_INNOVATION` | Propose nouvelles boucles, angles, offres, tests | Cron: lundi + jeudi 9h |
| `AGENT_PSYCHO_MARKETING` | Modèles mentaux + anchoring éthique sur pages/offres | Trigger: offer.built |

**Total : 23 agents · 3 niveaux · feature flags par tenant**

---

## 3. AGENT_STRATEGY_ORGANIC — SPÉCIFICATION COMPLÈTE

### Mission primaire
Construire une audience organique durable **avant et pendant** les ads payantes.
L'organique **prouve**. Les ads **scalent** ce que l'organique a validé.

### 9 tâches à implémenter

| Task | Schedule | Quoi |
|------|----------|------|
| `strategy.organic_plan` | Lundi 6h | LLM: brand voice + 3 personas + pilliers + roadmap 90j |
| `ugc.batch_production` | Mardi + Vendredi 8h | LLM: 10-15 scripts (hook×5, corps timecodes, CTA, hashtags, notes visuelles) |
| `content.calendar_build` | 1er du mois 7h | Place scripts dans calendrier 30j avec best time slots |
| `content.repurpose` | Chaque jour 10h | TikTok viral → Reel + Short + Pin automatiquement |
| `organic.performance_review` | Dimanche 20h | Winners → hook_library + signal MEDIA_BUYER pour dark posts |
| `ugc.generate_scripts` | TRIGGER viral détecté | Script trend_hijack urgent (priorité 9) |
| `audience.persona_build` | TRIGGER product.ingested | 3 personas LLM dès qu'un produit entre |
| `brand.voice_define` | On demand | Brand voice + tone + vocabulary + forbidden |
| `organic.growth_loop` | TRIGGER market_intel | Surfe sur les trends MARKET_INTEL en temps réel |

### 12 types de scripts UGC générés
`hook_reel` · `transformation` · `ingredient_focus` · `objection_killer` · `social_proof` · `routine_hack` · `trend_hijack` · `educational` · `storytime` · `day_in_life` · `comparison` · `comment_reply`

### Fréquences par plateforme

| Plateforme | Posts/semaine | Best time slots |
|-----------|--------------|----------------|
| TikTok | 7/semaine (1/jour) | 7h, 12h, 17h, 20h, 22h |
| Instagram Reels | 5/semaine | 8h, 12h30, 17h30, 21h |
| YouTube Shorts | 3/semaine | 9h, 15h, 20h |
| Pinterest | 10 pins/semaine | 8h, 14h, 20h |

### Boucle organique → payant (critique)
```
Contenu organique > 10 000 vues
  → COMMAND → AGENT_MEDIA_BUYER
    payload: { calendar_id, platform, views, engagement_rate }
    instruction: "Créer dark post — 20-50€/j — contenu validé marché"
    résultat attendu: ROAS > moyenne (marché a déjà dit oui organiquement)
```

### Communication

| Direction | Vers/Depuis | Type | Contenu |
|-----------|-------------|------|---------|
| → | AGENT_COPY | DATA_PUSH | Brand voice + personas |
| → | AGENT_CREATIVE | COMMAND | Briefs visuels UGC |
| → | AGENT_MEDIA_BUYER | COMMAND | Viraux à booster en dark post |
| → | AGENT_LEARNING | DATA_PUSH | Patterns hooks gagnants |
| → | AGENT_ORCHESTRATOR | EVENT | Rapport planification |
| ← | AGENT_MARKET_INTEL | ALERT | Viral/trend → trend_hijack immédiat |
| ← | AGENT_ORCHESTRATOR | COMMAND | product.ingested → personas + stratégie |
| ← | AGENT_ANALYTICS | DATA_PUSH | Perfs dispo → review |

---

## 4. COMMUNICATION INTER-AGENTS

### Protocol bus (`agents.messages`)
```typescript
type MessageType =
  | 'COMMAND'    // donner un ordre (1→1)
  | 'QUERY'      // demander une réponse (1→1, ACK 30s)
  | 'RESPONSE'   // répondre à un QUERY
  | 'EVENT'      // notifier (1→N)
  | 'ALERT'      // signal urgent
  | 'DATA_PUSH'  // envoyer un payload de données
  | 'BROADCAST'  // informer tous
```

### Arbitrage conflits (niveau 3 uniquement)
```
2 agents en désaccord :
  1. Chaque agent soumet : { proposal, risk_score, confidence, blast_radius, proof[] }
  2. Vote pondéré :
     - RISK_ENGINE   : poids ×2
     - POLICY_GOVERNOR : veto absolu
     - Autres agents  : poids ×1
  3. ORCHESTRATOR décision finale → agents.decisions
  4. Loggé ops.audit_log (immuable, append-only)
```

### Les 5 moteurs
```
1. Moteur Produit    INGEST → OFFER → STORE_BUILDER → PSYCHO_MARKETING
2. Moteur Créatif    CREATIVE → STRATEGY_ORGANIC → UGC → fatigue créative
3. Moteur Media      MEDIA_BUYER → BUDGET_ALLOCATOR → PORTFOLIO_OPT
4. Moteur Risk       OPS_GUARD → RISK_ENGINE → FRAUD_GUARD → kill-switch
5. Moteur Cognitif   MARKET_INTEL → LEARNING → EXPERIMENTS → INNOVATION
```

---

## 5. SCHEMAS SQL — LISTE COMPLÈTE

### Core (tous niveaux)
```
saas.tenants · saas.users · saas.plans · saas.subscriptions
saas.entitlements · saas.billing_ledger · saas.revenue_share · saas.admin_whitelist
events.outbox · events.inbox
jobs.queue · jobs.dlq · jobs.attempts
agents.registry · agents.messages · agents.decisions · agents.metrics
agents.schedule · agents.traces
ops.alerts · ops.runtime_config · ops.kill_switch_log · ops.audit_log
connector_registry · token_vault · oauth_states · connector_call_log
```

### Growth — Produit + Ads (niveau 1+)
```
store.products · store.offers · store.pages · store.assets
store.pipeline_runs · store.pipeline_approvals
ads.entities · ads.actions · ads.performance_hourly
```

### Intel — Organic (niveau 1+) + Market (niveau 3)
```
intel.organic_strategies · intel.ugc_scripts · intel.content_calendar
intel.hook_library · intel.creator_briefs · intel.repurposing_map
intel.audience_analytics · intel.signals · intel.patterns
intel.experiments · intel.feed
market_intel_data · trending_keywords · viral_creatives
competitor_intel · amazon_product_signals · google_trends_signals
```

### Risk (niveau 2+)
```
risk.limits · risk.stop_loss_events · risk.drawdown
risk.state_expectations · risk.incidents
```

---

## 6. GUARDRAILS — IMPOSSIBLES À DÉSACTIVER

```sql
-- ops.runtime_config, is_locked = TRUE, locked_by = 'SYSTEM'
guardrails.roas_min_seed         = 1.5
guardrails.roas_min_growth       = 2.0
guardrails.roas_min_scale        = 2.5
guardrails.max_loss_day_seed     = 500    -- €
guardrails.max_loss_day_growth   = 2000   -- €
guardrails.max_loss_day_scale    = 10000  -- €
guardrails.drawdown_max_pct      = 20     -- %
guardrails.volatility_throttle   = 0.35   -- variance ROAS > 35% → ralentit
guardrails.scaling_cooldown_h    = 4      -- heures entre 2 scalings
guardrails.error_rate_max_pct    = 15     -- % avant throttle workers
policy.full_auto_min_days_green  = 7      -- jours green requis avant Full Auto
```

**Modifier un guardrail locked** :
- `role = 'super_admin'` obligatoire
- Entrée `ops.audit_log` automatique (immuable)
- Approbation humaine requise

---

## 7. SÉCURITÉ — NON-NÉGOCIABLE

```
✅ Jamais de password en dur (repo, SQL, prompt, log, env)
✅ Admin = invitation email → reset link (24h) → token hashed SHA256 → set password
✅ MFA optionnel (TOTP) — secret chiffré dans vault
✅ JWT access 15min + refresh rotation 7j
✅ Token vault : pgcrypto pgp_sym_encrypt (jamais de token en clair en DB)
✅ RLS activé sur TOUTES les tables tenant-scoped
✅ ops.audit_log append-only (partition par année)
✅ ops.kill_switch_log append-only
✅ CORS strict — pas de wildcard *
✅ Rate limiting : global 100req/min, auth 10req/min
✅ Webhook signatures vérifiées (Stripe-Signature, Shopify HMAC)
✅ Circuit breakers par provider API (CLOSED → HALF_OPEN → OPEN)
```

---

## 8. BILLING

### Plans (Stripe)
```
trial   →    0€/mois → 15 jours → basic, human_validate
starter →  149€/mois → 1 store, 1 ad account, 1 produit, semi_auto
growth  →  499€/mois → 3 stores, multi-campaign, creative loop, semi_auto
scale   → 1990€/mois → illimité, full_organism, full_auto, SLA
```

### Admin à vie (jonathanlamessi@yahoo.fr)
```
saas.admin_whitelist (email)
  → saas.entitlements (entitlement: 'admin_lifetime', expires_at: NULL)
  → saas.tenants (admin_lifetime: TRUE, plan: scale, plan_status: active)
  → Accès: invitation email → reset link 24h → password → MFA optionnel
  → Jamais de password en dur nulle part
```

### Revenue Share
```
2% sur CA tracké au-delà de 200 000€/mois
Calculé automatiquement : saas.revenue_share
Déclenché via Stripe + ledger interne
Paramétrable par contrat (colonne share_rate)
```

---

## 9. FEATURE FLAG — IMPLÉMENTATION

```typescript
// middleware/feature-flags.ts
// workers/src/engines/claim.engine.ts

type AgentLevel = 'basic' | 'hedge_fund' | 'full_organism'
const LEVEL_ORDER = ['basic', 'hedge_fund', 'full_organism']

const AGENT_LEVELS: Record<string, AgentLevel> = {
  // basic (niveau 1)
  AGENT_INGEST:             'basic',
  AGENT_OFFER:              'basic',
  AGENT_COPY:               'basic',
  AGENT_CREATIVE:           'basic',
  AGENT_STORE_BUILDER:      'basic',
  AGENT_MEDIA_BUYER:        'basic',
  AGENT_ANALYTICS:          'basic',
  AGENT_OPS_GUARD:          'basic',
  AGENT_STRATEGY_ORGANIC:   'basic',   // ← organique dès niveau 1
  // hedge_fund (niveau 2)
  AGENT_RISK_ENGINE:        'hedge_fund',
  AGENT_BUDGET_ALLOCATOR:   'hedge_fund',
  AGENT_PORTFOLIO_OPT:      'hedge_fund',
  AGENT_FRAUD_GUARD:        'hedge_fund',
  AGENT_RECOVERY:           'hedge_fund',
  // full_organism (niveau 3)
  AGENT_ORCHESTRATOR:       'full_organism',
  AGENT_POLICY_GOVERNOR:    'full_organism',
  AGENT_MARKET_INTEL:       'full_organism',
  AGENT_LEARNING:           'full_organism',
  AGENT_EXPERIMENTS:        'full_organism',
  AGENT_HEALTH_SRE:         'full_organism',
  AGENT_LEGAL_SCRAPING:     'full_organism',
  AGENT_INNOVATION:         'full_organism',
  AGENT_PSYCHO_MARKETING:   'full_organism',
}

function canExecute(tenantAgentMode: AgentLevel, agentId: string): boolean {
  const required = AGENT_LEVELS[agentId] ?? 'full_organism'
  return LEVEL_ORDER.indexOf(tenantAgentMode) >= LEVEL_ORDER.indexOf(required)
}

// Dans jobs.claim_next() : filtre automatiquement les jobs non autorisés
// via JOIN sur saas.tenants.agent_mode + agents.registry.required_level
```

---

## 10. MAKE COMMANDS

```bash
make up              # Démarrer tous les services (prod)
make up-dev          # Démarrer avec hot-reload (dev)
make build           # Rebuild images Docker
make migrate         # Exécuter migrations 001→008
make migrate-fresh   # Drop + recreate + migrate (⚠️ efface tout)
make seed            # Admin + plans + reset link (jamais de password en dur)
make test            # 8 tests obligatoires avant go-live
make admin-reset     # Nouveau reset link admin (expire 24h)
make logs            # Tail all logs
make logs-api        # API seulement
make logs-worker     # Workers seulement
make test-rls        # Test isolation tenants
make test-stop-loss  # Test stop-loss triggers
make test-queue      # Test claim concurrency
make test-dlq        # Test DLQ + replay
```

---

## 11. ORDRE D'IMPLÉMENTATION (42 jours)

```
Sprint 1 — J1-J7 : Foundation
  ✓ Docker Compose + PostgreSQL + migrations 001-007-008
  ✓ Auth : invitation + reset link (SHA256) + JWT + refresh
  ✓ RLS sur toutes les tables + ops.audit_log
  ✓ jobs.claim_next() + workers (SKIP LOCKED)
  ✓ make seed → admin reset link → connexion confirmée

Sprint 2 — J8-J14 : Pipeline basique (9 agents niveau 1)
  ✓ AGENT_INGEST → AGENT_OFFER → AGENT_COPY → AGENT_STORE_BUILDER
  ✓ Connector Shopify + Stripe
  ✓ AGENT_OPS_GUARD (stop-loss basique)
  ✓ AGENT_STRATEGY_ORGANIC (personas + plan + batch UGC)
  ✓ Mode human_validate end-to-end

Sprint 3 — J15-J21 : Ads + Organic complet
  ✓ AGENT_MEDIA_BUYER (Meta Ads)
  ✓ AGENT_ANALYTICS (attribution basique)
  ✓ AGENT_STRATEGY_ORGANIC (calendrier + repurposing + review)
  ✓ Boucle organique → dark posts MEDIA_BUYER
  ✓ Premier pipeline produit complet

Sprint 4 — J22-J28 : Hedge Fund (niveau 2)
  ✓ AGENT_RISK_ENGINE (stop-loss multi-niveaux + drawdown)
  ✓ AGENT_BUDGET_ALLOCATOR + AGENT_PORTFOLIO_OPT
  ✓ AGENT_FRAUD_GUARD
  ✓ Mode semi_auto + full_auto (après 7 jours green)

Sprint 5 — J29-J42 : Cognitive (niveau 3)
  ✓ AGENT_MARKET_INTEL (Google Trends + TikTok + Amazon + Meta)
  ✓ AGENT_ORCHESTRATOR + AGENT_POLICY_GOVERNOR
  ✓ AGENT_LEARNING + AGENT_EXPERIMENTS
  ✓ AGENT_HEALTH_SRE
  ✓ Growth loop complet : marché → organic → paid
```

---

## 12. PROVIDERS EXTERNES

```bash
# Obligatoires
LLM_API_KEY=              # Anthropic Claude (toutes les générations LLM)
STRIPE_SECRET_KEY=        # Billing
META_APP_ID=              # Meta Ads
META_APP_SECRET=          # Meta OAuth
SHOPIFY_API_KEY=          # Store deployment

# Market Intel (niveau 3)
SERPAPI_KEY=              # Google Trends (~50$/mois)
RAINFOREST_API_KEY=       # Amazon data (~50$/mois)
TIKTOK_CREATIVE_API_KEY=  # TikTok Business (gratuit si app enregistrée)
RAPIDAPI_KEY=             # TikTok hashtags
META_ACCESS_TOKEN=        # Meta Ad Library (gratuit)
SCRAPINGBEE_KEY=          # Scraping concurrents (~49$/mois)

# Génération créative (optionnel phase 1)
REPLICATE_API_KEY=        # Images/vidéos
RUNWAYML_API_KEY=         # Génération vidéo
```

---

## RÉSUMÉ POUR LE DEV

```
AEGIS = 23 agents · 3 niveaux · feature flags · guardrails inviolables

Niveau 1 (basic)        9 agents · pipeline linéaire · cash conversion J+14
Niveau 2 (hedge_fund)  +5 agents · protection capital · scale 1M→10M
Niveau 3 (full_organism)+9 agents · apprentissage continu · machine vivante

AGENT_STRATEGY_ORGANIC (niveau 1 — disponible immédiatement)
  → 12 types de scripts UGC générés par LLM
  → Calendrier éditorial 30j automatisé (best time slots)
  → Growth loop temps réel (trend hijack < 2min)
  → Organique prouve → MEDIA_BUYER scale en dark posts
  → Tables : organic_strategies, ugc_scripts, content_calendar,
             hook_library, creator_briefs, repurposing_map, audience_analytics

Loi : signal → décision → exécution → mesure → apprentissage
Cible : millions d'euros de CA tracké sur la plateforme
```
