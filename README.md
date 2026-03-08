# AEGIS v3.6 — Autonomous E-Commerce Intelligence System

> Multi-tenant SaaS · 41 agents · 5 platforms · Real profitability · Statistical validation

## Quick Start

```bash
cp .env.example .env          # add API keys
npm install
npm run db:migrate            # runs migrations 000–026
make dev                      # starts all services
open ui/dashboard.html
```

## What's New in v3.6

| Feature | Agent | Impact |
|---------|-------|--------|
| Real contribution margin | AGENT_PROFITABILITY | Stop optimizing ROAS when you're losing money |
| Statistical winner validation | DCTStatTestService | Stop scaling false winners (needs 50+ conv, 90% confidence) |
| Attribution deduplication | AGENT_ATTRIBUTION | Fix 30-60% conversion inflation across platforms |
| Creative vision tagging | AGENT_CREATIVE_VISION | Build compound creative knowledge base via Claude vision |
| Brief delivery | AGENT_DELIVERY | Email + Slack + WhatsApp — alerts that actually reach you |
| 14-day forecasting | AGENT_FORECASTER | Anticipate stock risks and revenue before they happen |

## Agent Architecture (41 agents)

```
Core (6)         ORCHESTRATOR · BRIEF · SCHEDULER · EVALUATOR · ANOMALY · DELIVERY
Paid Ads (5)     DCT_322 · SCALE · STOP_LOSS · BUDGET_PACER · CPA_GUARDIAN
Creative (5)     CREATIVE_FACTORY · CREATIVE_ANALYST · CREATIVE_VISION · VIDEO_FACTORY · COPY_WRITER
Intelligence (4) SPY · AUDIENCE · LOOKALIKE · RETARGETING
Analytics (3)    ANALYTICS · ATTRIBUTION · FORECASTER
Finance (2)      PROFITABILITY · BILLING
Retention (2)    LTV · EMAIL_TRIGGER
Tracking (3)     CAPI_RELAY · PIXEL_MONITOR · ATTRIBUTION_RELAY
Ops (2)          INVENTORY · SUPPLIER
Growth (2)       TIKTOK_ORGANIC · STRATEGIES
System (7)       GUARDRAIL · CIRCUIT_BREAKER · WEBHOOK · WORLD_STATE · SCHEDULER_MULTI · SETTINGS · INTER_PROTOCOL
```

## Intelligence Stack (v3.5+)

```
agent_memory        Shared context store — agents deposit observations
world_state         Consolidated view — all agents read before deciding
agent_decisions     Full observability — every decision logged with context
agent_deliberations Consensus protocol — GUARDRAIL + CPA_GUARDIAN veto
action_outcomes     Feedback loop — outcomes measured t+6h, agents self-calibrate
agent_confidence    Rolling confidence scores — poor track record → reduced activity
config_changelog    Decision versioning — before/after metrics on every config change
anomalies           Structural monitoring — spend spikes, CAPI silence, token expiry
```

## Profitability Stack (v3.6+)

```
product_economics       COGS + return rates + platform fees per SKU
profitability_metrics   Contribution margin with auto-computed columns
shopify_refund_events   Real-time refund tracking
dct_stat_tests          Z-test results — no winner without 90% confidence
attribution_events      First-party order reconciliation
attribution_reconciliation  Platform inflation tracking (how much each platform overclaims)
creative_tags           18-dimension AI vision taxonomy per creative
creative_tag_performance    Materialized: CTR/ROAS by angle/hook/face/style
brief_delivery_*        Email/Slack/WhatsApp delivery log
forecasts               14-day daily projections with stock risk
```

## Key Env Vars (new in v3.6)

```env
RESEND_API_KEY=re_...           # Email delivery
WHATSAPP_TOKEN=EAA...           # WhatsApp Business Cloud API
WHATSAPP_PHONE_ID=1234...       # WhatsApp phone number ID
ANTHROPIC_API_KEY=sk-ant-...    # Claude vision + reasoning (already required)
```

## Stack

- **Backend**: FastAPI (Python 3.12) + TypeScript 5.3
- **Database**: PostgreSQL 16 + pgvector + RLS
- **Queue**: Redis + Celery
- **LLM**: Anthropic Claude claude-sonnet-4-5 (reasoning + vision)
- **Email**: Resend API
- **Messaging**: WhatsApp Business Cloud API
- **Auth**: Supabase Auth + JWT
- **Infra**: Docker Compose / Railway / VPS
