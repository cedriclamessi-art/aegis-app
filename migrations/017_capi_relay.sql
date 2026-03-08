-- ============================================================
-- AEGIS — Migration 017 : CAPI Relay Infrastructure
-- Server-side conversion tracking for Meta / TikTok / Google
-- Résout : iOS 14.5+ tracking loss (~40% conversions manquantes)
-- ============================================================

BEGIN;

-- ─── Schema analytics ────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS analytics;

-- ─── Table principale : événements CAPI ──────────────────
CREATE TABLE analytics.capi_events (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,

  -- Identité de l'événement
  event_name      TEXT          NOT NULL,  -- 'Purchase' | 'InitiateCheckout' | 'AddToCart' | 'ViewContent' | 'Lead'
  event_id        TEXT          NOT NULL,  -- hash déterministe (tenant+source_id+event_name) — clé de déduplication
  event_time      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  source_id       TEXT,                    -- order_id / checkout_token / cart_token Shopify

  -- Données utilisateur (hashées SHA256 — GDPR compliant)
  user_email_hash TEXT,         -- SHA256(email.toLowerCase().trim())
  user_phone_hash TEXT,         -- SHA256(phone.e164format)
  user_ip         TEXT,         -- IP brute (non hashée, CAPI l'accepte)
  user_agent      TEXT,
  fbc             TEXT,         -- Facebook click ID (fbclid cookie)
  fbp             TEXT,         -- Facebook browser ID (_fbp cookie)
  ttclid          TEXT,         -- TikTok click ID
  gclid           TEXT,         -- Google click ID

  -- Données de conversion
  value           NUMERIC(12,2),
  currency        VARCHAR(3)    DEFAULT 'EUR',
  content_ids     TEXT[],       -- SKUs des produits
  content_type    TEXT          DEFAULT 'product',
  contents        JSONB,        -- [{id, quantity, item_price}]
  num_items       INTEGER,
  order_id        TEXT,

  -- Statut d'envoi par plateforme
  platforms_target TEXT[]       NOT NULL DEFAULT '{}',  -- plateformes à notifier
  platforms_sent   TEXT[]       NOT NULL DEFAULT '{}',  -- plateformes effectivement contactées
  platforms_ok     TEXT[]       NOT NULL DEFAULT '{}',  -- plateformes confirmées (200 OK)
  platforms_failed TEXT[]       NOT NULL DEFAULT '{}',  -- plateformes en erreur

  -- Réponses raw des APIs
  response_meta    JSONB,
  response_tiktok  JSONB,
  response_google  JSONB,
  response_pinterest JSONB,

  -- Statut global
  status          TEXT          NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','sending','sent','partial','failed','deduplicated')),
  retry_count     INTEGER       NOT NULL DEFAULT 0,
  last_error      TEXT,
  sent_at         TIMESTAMPTZ,

  -- Metadata
  shopify_webhook_id TEXT,      -- X-Shopify-Webhook-Id header (idempotence)
  raw_payload     JSONB,        -- payload Shopify original (debug)
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Contrainte d'unicité : event_id par tenant ──────────
-- Garantit la déduplication : même event jamais traité deux fois
CREATE UNIQUE INDEX idx_capi_events_event_id
  ON analytics.capi_events (tenant_id, event_id);

-- ─── Index shopify_webhook_id (idempotence webhooks) ─────
CREATE UNIQUE INDEX idx_capi_events_webhook_id
  ON analytics.capi_events (shopify_webhook_id)
  WHERE shopify_webhook_id IS NOT NULL;

-- ─── Index opérationnels ──────────────────────────────────
CREATE INDEX idx_capi_events_tenant_status
  ON analytics.capi_events (tenant_id, status, created_at DESC);

CREATE INDEX idx_capi_events_pending_retry
  ON analytics.capi_events (status, retry_count, created_at)
  WHERE status IN ('pending', 'failed') AND retry_count < 3;

CREATE INDEX idx_capi_events_tenant_time
  ON analytics.capi_events (tenant_id, event_time DESC);

-- ─── Trigger updated_at ──────────────────────────────────
CREATE TRIGGER capi_events_updated_at
  BEFORE UPDATE ON analytics.capi_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── Config CAPI par tenant ───────────────────────────────
-- Stocke les credentials CAPI (via vault) et les flags d'activation
CREATE TABLE analytics.capi_config (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,

  -- Meta CAPI
  meta_enabled    BOOLEAN       NOT NULL DEFAULT false,
  meta_pixel_id   TEXT,
  meta_access_token_vault_id UUID,  -- référence vers connectors.token_vault

  -- TikTok Events API
  tiktok_enabled  BOOLEAN       NOT NULL DEFAULT false,
  tiktok_pixel_id TEXT,
  tiktok_access_token_vault_id UUID,

  -- Google Enhanced Conversions
  google_enabled  BOOLEAN       NOT NULL DEFAULT false,
  google_tag_id   TEXT,          -- GTM-XXXXXX ou G-XXXXXX
  google_api_secret TEXT,        -- pour l'API Measurement Protocol

  -- Pinterest CAPI
  pinterest_enabled BOOLEAN     NOT NULL DEFAULT false,
  pinterest_ad_account_id TEXT,
  pinterest_access_token_vault_id UUID,

  -- Shopify webhook config
  shopify_webhook_secret TEXT,   -- pour valider HMAC (stocké chiffré)
  events_to_track TEXT[]        NOT NULL DEFAULT ARRAY['Purchase','InitiateCheckout','AddToCart'],

  -- Dedup window (évite double-comptage pixel client + CAPI)
  dedup_window_seconds INTEGER  NOT NULL DEFAULT 600, -- 10 min

  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id)
);

CREATE TRIGGER capi_config_updated_at
  BEFORE UPDATE ON analytics.capi_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── Vue agrégée : taux de capture CAPI ──────────────────
CREATE VIEW analytics.capi_capture_rate AS
SELECT
  tenant_id,
  DATE_TRUNC('day', event_time) AS day,
  event_name,
  COUNT(*)                                          AS total_events,
  COUNT(*) FILTER (WHERE 'meta'     = ANY(platforms_ok)) AS meta_captured,
  COUNT(*) FILTER (WHERE 'tiktok'   = ANY(platforms_ok)) AS tiktok_captured,
  COUNT(*) FILTER (WHERE 'google'   = ANY(platforms_ok)) AS google_captured,
  ROUND(
    COUNT(*) FILTER (WHERE 'meta' = ANY(platforms_ok))::NUMERIC
    / NULLIF(COUNT(*), 0) * 100, 1
  )                                                 AS meta_capture_pct,
  SUM(value) FILTER (WHERE 'meta' = ANY(platforms_ok)) AS meta_value_captured
FROM analytics.capi_events
WHERE status IN ('sent', 'partial')
GROUP BY 1, 2, 3;

-- ─── RLS ─────────────────────────────────────────────────
ALTER TABLE analytics.capi_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.capi_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON analytics.capi_events
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON analytics.capi_config
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── Grant service role ───────────────────────────────────
GRANT USAGE ON SCHEMA analytics TO aegis_service;
GRANT SELECT, INSERT, UPDATE ON analytics.capi_events TO aegis_service;
GRANT SELECT, INSERT, UPDATE ON analytics.capi_config TO aegis_service;
GRANT SELECT ON analytics.capi_capture_rate TO aegis_service;

-- ─── Enregistrement de l'agent CAPI dans le registre ─────
INSERT INTO agents_registry (agent_id, name, category, min_tier, capabilities, description)
VALUES (
  'AGENT_CAPI',
  'CAPI Relay',
  'analytics',
  'basic',
  '["capi.relay","capi.meta","capi.tiktok","capi.google","capi.dedup"]'::jsonb,
  'Server-side conversion tracking relay. Intercepte les webhooks Shopify et relaie les événements vers Meta CAPI, TikTok Events API, et Google Enhanced Conversions avec déduplication event_id.'
)
ON CONFLICT (agent_id) DO UPDATE SET
  name = EXCLUDED.name,
  capabilities = EXCLUDED.capabilities;

-- ─── Schedule : retry des events failed ──────────────────
INSERT INTO agents_schedule (
  agent_id, capability, min_tier, trigger_type,
  cron_expr, timeout_seconds, concurrency_mode, guardrails, meta
)
VALUES (
  'AGENT_CAPI',
  'capi.relay',
  'basic',
  'cron',
  '*/5 * * * *',   -- toutes les 5 minutes
  60,
  'per_tenant',
  '{}',
  '{"task": "retry_failed_events", "max_retry": 3}'::jsonb
)
ON CONFLICT DO NOTHING;

COMMIT;
