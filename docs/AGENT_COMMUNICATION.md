# AEGIS — Flux de Communication Inter-Agents
> Qui parle à qui · Quand · Pourquoi

---

## 1. TOPOLOGIE DU BUS

```
                    ┌──────────────────────────────────┐
                    │         AGENT_BUS (PostgreSQL)    │
                    │  QUERY · RESPONSE · EVENT ·       │
                    │  COMMAND · BROADCAST · ALERT ·    │
                    │  DATA_PUSH                        │
                    └──────────────────────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
    ┌─────────▼────────┐  ┌────────▼────────┐  ┌────────▼────────┐
    │ AGENT_MARKET_INTEL│  │ AGENT_ORCHESTRATOR│  │ AGENT_RISK_ENGINE│
    │  (collecte data)  │  │  (chef d'orchestre)│  │  (garde-fous)   │
    └──────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## 2. PLANNING PAR AGENT (horaires)

| Agent | Schedule | Trigger | Ce qu'il fait |
|-------|----------|---------|---------------|
| AGENT_MARKET_INTEL | Toutes les 4h (Google Trends) | Pipeline start | Scrape Google, TikTok, Amazon, Meta |
| AGENT_MARKET_INTEL | Toutes les 3h (TikTok) | — | Trends + Creative Center |
| AGENT_MARKET_INTEL | 3x/jour (Amazon) | — | Best sellers + pricing |
| AGENT_MARKET_INTEL | Toutes les 6h (Meta) | — | Ad Library |
| AGENT_MARKET_INTEL | 8h chaque jour (Competitors) | — | Analyse concurrents |
| AGENT_MARKET_INTEL | Lundi 00h (Full Scan) | — | Scan hebdomadaire complet |
| AGENT_ORCHESTRATOR | Toutes les 5min | Message reçu | Check pipelines, réagit aux signaux |
| AGENT_RISK_ENGINE | Toutes les 15min | Stop-loss | Évalue ROAS, loss, pixel |
| AGENT_ATTRIBUTION | Toutes les heures | — | Calcule ROAS réel |
| AGENT_HEALTH_WATCHDOG | Toutes les 2min | — | Santé système |
| AGENT_CONNECTOR_MANAGER | Toutes les 4h | — | Refresh OAuth tokens |
| AGENT_INNOVATION | Lundi + Jeudi 9h | Rapport intel | Veille + propositions |

---

## 3. FLUX PRINCIPAUX

### Flux A — Signal Google Trends → Copie → Ads

```
AGENT_MARKET_INTEL
  │  scrape Google Trends → keyword "serviette exfoliante" +250% semaine
  │
  ├─→ pushIntel(type: 'breakout_keyword', priority: 8)
  │     target: [COPY_CHIEF, MEDIA_BUYER, OFFER_ENGINE, ORCHESTRATOR]
  │
  ├─→ agent_bus: ALERT → AGENT_ORCHESTRATOR
  │
  └─→ AGENT_ORCHESTRATOR.handleIncomingMessage
        │
        ├─→ COMMAND → AGENT_COPY_CHIEF
        │     "Intégrer 'serviette exfoliante' dans les prochaines copies"
        │
        └─→ COMMAND → AGENT_MEDIA_BUYER
              "Créer des adsets sur 'serviette exfoliante'"
```

### Flux B — Créa TikTok virale détectée

```
AGENT_MARKET_INTEL
  │  scrape TikTok Creative Center → viral_score: 87/100
  │
  ├─→ pushIntel(type: 'viral_creative', priority: 7)
  │     target: [CREATIVE_DIRECTOR, UGC_FACTORY, COPY_CHIEF]
  │
  ├─→ ALERT → AGENT_CREATIVE_DIRECTOR
  │     payload: { hookText: "...", format: "video", engagementRate: 0.08 }
  │
  └─→ ALERT → AGENT_ORCHESTRATOR
        │
        └─→ COMMAND → AGENT_CREATIVE_DIRECTOR
              "Créa virale détectée — analyser et adapter"
```

### Flux C — Opportunité Amazon (BSR <1000, <500 reviews)

```
AGENT_MARKET_INTEL
  │  Amazon Best Sellers → produit BSR #234, 180 reviews
  │
  ├─→ pushIntel(type: 'amazon_opportunity', priority: 7)
  │     target: [OFFER_ENGINE, COPY_CHIEF, PRODUCT_INGEST]
  │
  └─→ ALERT → AGENT_OFFER_ENGINE
        "Opportunité marché peu saturé — étudier le positionnement"
```

### Flux D — Rapport intel hebdomadaire → Actions orchestrées

```
AGENT_MARKET_INTEL (full_scan — lundi 00h)
  │
  ├─→ BROADCAST → tous les agents
  │     "Full scan terminé"
  │
  └─→ DATA_PUSH → AGENT_ORCHESTRATOR
        payload: { weeklyHighlights: { topKeywords, topVirals, topOpportunities } }
        │
        ├─→ COMMAND → AGENT_COPY_CHIEF
        │     "Intégrer les nouveaux keywords trending"
        │
        ├─→ COMMAND → AGENT_MEDIA_BUYER
        │     "Créer adsets sur keywords trending"
        │
        ├─→ COMMAND → AGENT_CREATIVE_DIRECTOR
        │     "Analyser les créas virales de la semaine"
        │
        └─→ QUERY → AGENT_FINANCE_GUARD
              "Évaluer les opportunités — budget à allouer ?"
```

### Flux E — Pipeline produit + contexte intel

```
User → POST /v1/products/ingest { url, mode: 'human' }
  │
  └─→ AGENT_ORCHESTRATOR (pipeline.start)
        │
        ├─→ readIntelFeed() → 12 signaux actifs
        │     buildContextualPlan() → trending keywords + top virals
        │
        ├─→ UPDATE pipeline_runs SET metadata = { marketContext }
        │
        ├─→ COMMAND → AGENT_MARKET_INTEL
        │     "Scraper les concurrents de ce produit spécifiquement"
        │
        └─→ ENQUEUE: product.ingest → AGENT_PRODUCT_INGEST
              payload: { productId, marketContext }
              │
              └─→ AGENT_PRODUCT_INGEST
                    Enrichit la fiche avec le contexte trending
                    │
                    └─→ EVENT: product.ingested
                          → AGENT_OFFER_ENGINE, AGENT_COPY_CHIEF
```

### Flux F — Stop-loss → Cascade agents

```
AGENT_RISK_ENGINE (toutes les 15min)
  │  ROAS 1.2 < seuil 2.0
  │
  ├─→ UPDATE campaigns SET status='PAUSED'
  ├─→ INSERT risk_events
  │
  └─→ ALERT → AGENT_ORCHESTRATOR (priority: 10)
        │
        ├─→ COMMAND → AGENT_ATTRIBUTION
        │     "Rapport attribution urgent — stop-loss déclenché"
        │
        └─→ QUERY → AGENT_MEDIA_BUYER
              "Analyser pourquoi le ROAS est tombé"
```

### Flux G — Concurrence: price drop détecté

```
AGENT_MARKET_INTEL (analyze_competitors)
  │  concurrent Amazon: -25% sur le même produit
  │
  ├─→ pushIntel(type: 'competitor_price_drop', priority: 8)
  │
  └─→ ALERT → AGENT_ORCHESTRATOR
        │
        └─→ COMMAND → AGENT_OFFER_ENGINE
              "Revoir le pricing — concurrent en liquidation"
              │
              ├─→ RESPONSE → AGENT_ORCHESTRATOR
              │     "Recommandation: bundle 3+1 pour justifier prix"
              │
              └─→ ALERT → AGENT_FINANCE_GUARD
                    "Analyser impact marges si price war"
```

---

## 4. TYPES DE MESSAGES

| Type | Direction | Usage | ACK requis |
|------|-----------|-------|------------|
| COMMAND | 1→1 | Donner un ordre à un agent | Non |
| QUERY | 1→1 | Demander une réponse | Oui (30s) |
| RESPONSE | 1→1 | Répondre à un QUERY | Non |
| EVENT | 1→N | Notifier un événement | Non |
| ALERT | 1→1 / Broadcast | Signal urgent à traiter | Non |
| DATA_PUSH | 1→1 | Envoyer un payload de données | Non |
| BROADCAST | 1→Tous | Informer tous les agents | Non |

---

## 5. INTEL FEED → AGENTS CONCERNÉS

| Signal Intel | Agents notifiés | Priorité |
|-------------|-----------------|----------|
| breakout_keyword | COPY_CHIEF, MEDIA_BUYER, OFFER_ENGINE, ORCHESTRATOR | 8 |
| viral_creative | CREATIVE_DIRECTOR, UGC_FACTORY, COPY_CHIEF | 7 |
| amazon_opportunity | OFFER_ENGINE, COPY_CHIEF, PRODUCT_INGEST | 7 |
| competitor_price_drop | FINANCE_GUARD, RISK_ENGINE, OFFER_ENGINE | 8 |
| meta_winner_ad | COPY_CHIEF, CREATIVE_DIRECTOR, MEDIA_BUYER | 7 |
| market_saturation | MEDIA_BUYER, CREATIVE_DIRECTOR, RISK_ENGINE | 6 |
| competitor_alert | OFFER_ENGINE, FINANCE_GUARD, MEDIA_BUYER | 9 |
| seasonal_opportunity | MEDIA_BUYER, COPY_CHIEF, ORCHESTRATOR | 7 |

---

## 6. NOUVELLES VARIABLES D'ENV REQUISES

```bash
# Scraping providers (choisir selon budget)
SERPAPI_KEY=              # Google Trends via SerpAPI (~$50/mois)
DATAFORSEO_KEY=           # Alternative: DataForSEO (~$30/mois)
RAINFOREST_API_KEY=       # Amazon data (~$50/mois)
TIKTOK_CREATIVE_API_KEY=  # TikTok Business API (gratuit si app enregistrée)
RAPIDAPI_KEY=             # RapidAPI hub (TikTok hashtags, etc.)
META_ACCESS_TOKEN=        # Meta Ad Library API (gratuit)
SCRAPINGBEE_KEY=          # Scraping concurrents (~$49/mois)
```
