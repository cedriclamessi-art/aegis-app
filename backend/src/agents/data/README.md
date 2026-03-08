# AEGIS \u2014 Syst\u00e8me E-commerce Autonome
> **Version CONDOR** \u2014 Organisme complet event-driven
> Stack : PostgreSQL \u00b7 TypeScript \u00b7 Node 20 \u00b7 Redis \u00b7 BullMQ \u00b7 Docker

## Pipeline complet
```
INGEST \u2192 WINNER_DETECTOR \u2192 MARKET_ANALYSE \u2192 OFFER_OPTIMIZER
       \u2193
  CREATIVE_FACTORY \u2192 FUNNEL_ENGINE \u2192 STORE_BUILDER
       \u2193
  META_TESTING (CBO 300\u2013500\u20ac) \u2192 classification 48h \u2192 TOF/BOF/CONDOR
       \u2193
  SCALE_ENGINE \u2192 CRUISE \u2192 ECOSYSTEM_LOOP (5000\u20ac/j)
```
**Formule CONDOR :** `(Angle \u00d7 (Avatar \u00d7 Awareness)) \u00d7 Concept \u00d7 Coherence Index`

## Phases
| Phase | Seuil | Agents actifs |
|-------|-------|---------------|
| **0 \u2014 Bootstrap** | D\u00e8s J+1 | INGEST \u00b7 MARKET_ANALYSE \u00b7 COPY |
| **1 \u2014 Unlock** | 1000\u20ac/jour | +27 agents \u2014 organisme complet |
| **2 \u2014 Ecosystem** | 5000\u20ac/j \u00d7 3j | +ECOSYSTEM_LOOP (Google \u00b7 Email \u00b7 SMS \u00b7 Amazon) |

## D\u00e9marrage
```bash
cp .env.example .env       # Remplir les cl\u00e9s
make start                 # docker compose up
make migrate               # seed + migrations
make test                  # 14 tests automatiques
```

## S\u00e9curit\u00e9 (10/10)
- FORCE RLS \u00b7 WITH CHECK \u00b7 bcrypt 12 \u00b7 kill-switch 4 niveaux
- Backoff exponentiel \u00b7 Idempotence DB-level \u00b7 R\u00f4le aegis_app
- Z\u00e9ro scraping HTTP direct \u00b7 Compliance Meta 2026