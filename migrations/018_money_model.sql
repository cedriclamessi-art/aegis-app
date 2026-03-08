-- ============================================================
-- MIGRATION 018 — AGENT_MONEY_MODEL (Hormozi Framework)
-- ============================================================
-- Philosophie : implémenter les 13 offres de $100M Money Models
-- comme un système de séquences d'offres autonomes.
--
-- Ce qu'on AJOUTE :
--   1. offers.money_models      → séquences d'offres complètes
--   2. offers.model_steps       → chaque étape (attraction/upsell/downsell/continuity)
--   3. offers.step_performance  → taux de conversion par étape
--   4. offers.creative_briefs   → briefs générés pour chaque étape
--   5. Vue offers.funnel_health → santé du funnel par étape
--   6. Fonction offers.compute_30day_math() → validation objectif Hormozi
--   7. Cron AGENT_MONEY_MODEL   → rebuild séquence si step < seuil
-- ============================================================

CREATE SCHEMA IF NOT EXISTS offers;

-- ╔════════════════════════════════════════════════════════════╗
-- ║  1. offers.money_models                                    ║
-- ║  Séquence d'offres complète pour un produit               ║
-- ╚════════════════════════════════════════════════════════════╝
CREATE TABLE offers.money_models (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    product_id          UUID REFERENCES store.products(id) ON DELETE SET NULL,

    -- Métadonnées
    name                VARCHAR(300) NOT NULL,
    stage               VARCHAR(20)  NOT NULL DEFAULT 'draft',
    -- draft | testing | active | optimizing | archived

    -- Math Hormozi (objectif : couvrir CAC + COGS en < 30 jours)
    target_cac          NUMERIC(10,2),   -- coût d'acquisition cible
    target_cogs         NUMERIC(10,2),   -- coût de livraison
    target_profit_30d   NUMERIC(10,2),   -- profit net visé J+30
    actual_profit_30d   NUMERIC(10,2),   -- actualisé via CAPI

    -- Statuts et scores
    funnel_health_score NUMERIC(5,2) DEFAULT 0,  -- 0-100
    last_optimized_at   TIMESTAMPTZ,
    optimizations_count INTEGER NOT NULL DEFAULT 0,

    -- Config LLM
    llm_context         JSONB NOT NULL DEFAULT '{}',
    -- {niche, brand_voice, product_description, audience_pain_points}

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_money_models_tenant   ON offers.money_models(tenant_id);
CREATE INDEX idx_money_models_product  ON offers.money_models(product_id);
CREATE INDEX idx_money_models_stage    ON offers.money_models(stage);

-- ╔════════════════════════════════════════════════════════════╗
-- ║  2. offers.model_steps                                     ║
-- ║  Chaque étape de la séquence d'offres                     ║
-- ╚════════════════════════════════════════════════════════════╝
CREATE TABLE offers.model_steps (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id        UUID NOT NULL REFERENCES offers.money_models(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,

    -- Position dans le funnel
    step_order      INTEGER NOT NULL,  -- 1=attraction, 2=upsell, 3=downsell, 4=continuity
    step_type       VARCHAR(30) NOT NULL,
    -- attraction | upsell | downsell | continuity

    -- Type d'offre Hormozi (13 offres)
    offer_type      VARCHAR(60) NOT NULL,
    -- WIN_MONEY_BACK | GIVEAWAY | DECOY | BUY_X_GET_Y | PAY_LESS_NOW
    -- CLASSIC_UPSELL | MENU_UPSELL | ANCHOR_UPSELL | ROLLOVER_UPSELL
    -- PAYMENT_PLAN | TRIAL_PENALTY | FEATURE_DOWNSELL
    -- CONTINUITY_BONUS | CONTINUITY_DISCOUNT | WAIVED_FEE

    -- Contenu de l'offre
    title           VARCHAR(300) NOT NULL,
    hook            TEXT,               -- phrase d'accroche principale
    price_main      NUMERIC(10,2),      -- prix présenté
    price_anchor    NUMERIC(10,2),      -- prix anchor (pour Anchor Upsell)
    price_fallback  NUMERIC(10,2),      -- prix downsell si refus
    currency        VARCHAR(3) NOT NULL DEFAULT 'EUR',

    -- Logique Hormozi
    trigger_condition   TEXT,
    -- ex: "customer said yes to step 1" / "customer said no to step 2"
    psychology_lever    VARCHAR(60),
    -- ANCHORING | RECIPROCITY | SCARCITY | SOCIAL_PROOF | LOSS_AVERSION | COMMITMENT

    -- Contenu généré par LLM
    sales_script        TEXT,           -- script de présentation
    objection_handlers  JSONB DEFAULT '[]',
    -- [{objection: "...", response: "..."}]
    ab_variants         JSONB DEFAULT '[]',
    -- [{label: "Option A", description: "..."}] pour Menu Upsell

    -- Liens avec autres étapes
    if_yes_go_to        INTEGER,        -- step_order suivant si OUI
    if_no_go_to         INTEGER,        -- step_order suivant si NON

    -- Statut
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    version             INTEGER NOT NULL DEFAULT 1,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(model_id, step_order)
);

CREATE INDEX idx_model_steps_model   ON offers.model_steps(model_id);
CREATE INDEX idx_model_steps_type    ON offers.model_steps(offer_type);
CREATE INDEX idx_model_steps_tenant  ON offers.model_steps(tenant_id);

-- ╔════════════════════════════════════════════════════════════╗
-- ║  3. offers.step_performance                                ║
-- ║  Taux de conversion mesurés par étape par jour            ║
-- ╚════════════════════════════════════════════════════════════╝
CREATE TABLE offers.step_performance (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    step_id         UUID NOT NULL REFERENCES offers.model_steps(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    recorded_date   DATE NOT NULL DEFAULT CURRENT_DATE,

    -- Volume
    presented_count INTEGER NOT NULL DEFAULT 0,   -- nb de fois l'offre a été présentée
    accepted_count  INTEGER NOT NULL DEFAULT 0,   -- nb de OUI
    declined_count  INTEGER NOT NULL DEFAULT 0,   -- nb de NON (→ déclenche downsell)

    -- Cash généré
    revenue_eur     NUMERIC(12,2) NOT NULL DEFAULT 0,
    avg_order_value NUMERIC(10,2),

    -- Benchmarks Hormozi
    conversion_rate NUMERIC(6,4),    -- accepted / presented
    -- Cibles : attraction >40%, upsell >30%, downsell >25%, continuity >20%
    take_rate       NUMERIC(6,4),    -- = conversion_rate alias sémantique

    -- Source des données
    data_source     VARCHAR(30) NOT NULL DEFAULT 'capi',
    -- capi | shopify | manual

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(step_id, recorded_date)
);

CREATE INDEX idx_step_perf_step   ON offers.step_performance(step_id);
CREATE INDEX idx_step_perf_date   ON offers.step_performance(recorded_date);
CREATE INDEX idx_step_perf_tenant ON offers.step_performance(tenant_id);

-- ╔════════════════════════════════════════════════════════════╗
-- ║  4. offers.creative_briefs                                 ║
-- ║  Briefs créatifs générés pour chaque étape                ║
-- ╚════════════════════════════════════════════════════════════╝
CREATE TABLE offers.creative_briefs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    step_id         UUID NOT NULL REFERENCES offers.model_steps(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,

    -- Brief complet pour AGENT_CREATIVE_FACTORY
    brief_type      VARCHAR(30) NOT NULL,
    -- meta_ad | tiktok_video | email | landing_copy | upsell_page | sms

    -- Contenu du brief
    objective       TEXT NOT NULL,       -- ce que le brief doit accomplir
    psychology      TEXT NOT NULL,       -- levier psychologique à utiliser
    hook_options    JSONB NOT NULL DEFAULT '[]',  -- 3-5 options de hook
    angle           TEXT,                -- angle narratif
    cta             VARCHAR(200),        -- call-to-action
    tone            VARCHAR(50),         -- urgency | authority | empathy | social_proof
    format_specs    JSONB NOT NULL DEFAULT '{}',
    -- {duration_sec, aspect_ratio, headline_max_chars, ...}

    -- Script/copy généré
    generated_copy  TEXT,
    generated_at    TIMESTAMPTZ,

    -- Perf après lancement
    linked_ad_id    VARCHAR(200),        -- Meta/TikTok ad ID
    ctr_observed    NUMERIC(6,4),
    roas_observed   NUMERIC(8,4),

    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- pending | generated | sent_to_factory | live | archived

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_creative_briefs_step   ON offers.creative_briefs(step_id);
CREATE INDEX idx_creative_briefs_tenant ON offers.creative_briefs(tenant_id);
CREATE INDEX idx_creative_briefs_status ON offers.creative_briefs(status);

-- ╔════════════════════════════════════════════════════════════╗
-- ║  5. Vue offers.funnel_health                               ║
-- ║  Santé de chaque étape du funnel (7 derniers jours)       ║
-- ╚════════════════════════════════════════════════════════════╝
CREATE OR REPLACE VIEW offers.funnel_health AS
SELECT
    mm.id           AS model_id,
    mm.tenant_id,
    mm.name         AS model_name,
    ms.id           AS step_id,
    ms.step_order,
    ms.step_type,
    ms.offer_type,
    ms.title        AS step_title,

    -- Perf 7 jours
    COALESCE(SUM(sp.presented_count), 0)    AS presented_7d,
    COALESCE(SUM(sp.accepted_count), 0)     AS accepted_7d,
    COALESCE(SUM(sp.revenue_eur), 0)        AS revenue_7d,

    -- Taux de conversion actuel
    CASE
        WHEN COALESCE(SUM(sp.presented_count), 0) = 0 THEN NULL
        ELSE ROUND(SUM(sp.accepted_count)::numeric / SUM(sp.presented_count), 4)
    END AS conversion_rate,

    -- Benchmark cible Hormozi
    CASE ms.step_type
        WHEN 'attraction'  THEN 0.40
        WHEN 'upsell'      THEN 0.30
        WHEN 'downsell'    THEN 0.25
        WHEN 'continuity'  THEN 0.20
    END AS target_rate,

    -- Statut santé
    CASE
        WHEN COALESCE(SUM(sp.presented_count), 0) < 10 THEN 'insufficient_data'
        WHEN ROUND(SUM(sp.accepted_count)::numeric / NULLIF(SUM(sp.presented_count), 0), 4)
             >= CASE ms.step_type
                    WHEN 'attraction'  THEN 0.40
                    WHEN 'upsell'      THEN 0.30
                    WHEN 'downsell'    THEN 0.25
                    WHEN 'continuity'  THEN 0.20
                END
        THEN 'healthy'
        ELSE 'needs_optimization'
    END AS health_status,

    mm.funnel_health_score,
    mm.last_optimized_at

FROM offers.money_models mm
JOIN offers.model_steps   ms ON ms.model_id = mm.id
LEFT JOIN offers.step_performance sp
    ON sp.step_id = ms.id
    AND sp.recorded_date >= CURRENT_DATE - INTERVAL '7 days'
WHERE ms.is_active = TRUE
GROUP BY mm.id, mm.tenant_id, mm.name, mm.funnel_health_score,
         mm.last_optimized_at, ms.id, ms.step_order, ms.step_type,
         ms.offer_type, ms.title;

-- ╔════════════════════════════════════════════════════════════╗
-- ║  6. Fonction offers.compute_30day_math()                   ║
-- ║  Validation objectif Hormozi : CAC couvert en < 30 jours  ║
-- ╚════════════════════════════════════════════════════════════╝
CREATE OR REPLACE FUNCTION offers.compute_30day_math(p_model_id UUID)
RETURNS TABLE (
    model_id            UUID,
    avg_cac             NUMERIC,
    avg_cogs            NUMERIC,
    attraction_revenue  NUMERIC,
    upsell_revenue      NUMERIC,
    downsell_revenue    NUMERIC,
    continuity_revenue  NUMERIC,
    total_30d_revenue   NUMERIC,
    total_30d_cost      NUMERIC,
    net_profit_30d      NUMERIC,
    cac_covered         BOOLEAN,
    hormozi_ratio       NUMERIC,   -- revenue / (cac + cogs) — doit être > 1.5
    verdict             TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH model_data AS (
        SELECT
            mm.id,
            COALESCE(mm.target_cac, 20)   AS cac,
            COALESCE(mm.target_cogs, 8)   AS cogs
        FROM offers.money_models mm
        WHERE mm.id = p_model_id
    ),
    step_revenue AS (
        SELECT
            ms.step_type,
            COALESCE(AVG(sp.avg_order_value), 0)  AS avg_aov,
            COALESCE(AVG(sp.conversion_rate), 0)  AS avg_cr
        FROM offers.model_steps ms
        LEFT JOIN offers.step_performance sp ON sp.step_id = ms.id
            AND sp.recorded_date >= CURRENT_DATE - INTERVAL '30 days'
        WHERE ms.model_id = p_model_id AND ms.is_active = TRUE
        GROUP BY ms.step_type
    )
    SELECT
        p_model_id,
        md.cac,
        md.cogs,
        COALESCE((SELECT avg_aov * avg_cr FROM step_revenue WHERE step_type = 'attraction'), 0),
        COALESCE((SELECT avg_aov * avg_cr FROM step_revenue WHERE step_type = 'upsell'), 0),
        COALESCE((SELECT avg_aov * avg_cr FROM step_revenue WHERE step_type = 'downsell'), 0),
        COALESCE((SELECT avg_aov * avg_cr FROM step_revenue WHERE step_type = 'continuity'), 0),
        -- total
        COALESCE((SELECT SUM(avg_aov * avg_cr) FROM step_revenue), 0) AS total_rev,
        md.cac + md.cogs,
        COALESCE((SELECT SUM(avg_aov * avg_cr) FROM step_revenue), 0) - (md.cac + md.cogs),
        -- couvert?
        COALESCE((SELECT SUM(avg_aov * avg_cr) FROM step_revenue), 0) > (md.cac + md.cogs),
        -- ratio
        CASE WHEN (md.cac + md.cogs) = 0 THEN 0
             ELSE ROUND(COALESCE((SELECT SUM(avg_aov * avg_cr) FROM step_revenue), 0) / (md.cac + md.cogs), 2)
        END,
        -- verdict
        CASE
            WHEN COALESCE((SELECT SUM(avg_aov * avg_cr) FROM step_revenue), 0) / NULLIF(md.cac + md.cogs, 0) >= 2.5
            THEN '🟢 EXCELLENT — Ratio Hormozi atteint (>2.5x). Scale max.'
            WHEN COALESCE((SELECT SUM(avg_aov * avg_cr) FROM step_revenue), 0) / NULLIF(md.cac + md.cogs, 0) >= 1.5
            THEN '🟡 CORRECT — CAC couvert. Optimiser upsell/continuity.'
            WHEN COALESCE((SELECT SUM(avg_aov * avg_cr) FROM step_revenue), 0) / NULLIF(md.cac + md.cogs, 0) >= 1.0
            THEN '🟠 LIMITE — CAC couvert mais marge insuffisante pour scaler.'
            ELSE '🔴 DANGER — CAC non couvert en 30 jours. Revoir attraction.'
        END
    FROM model_data md;
END;
$$ LANGUAGE plpgsql;

-- ╔════════════════════════════════════════════════════════════╗
-- ║  7. RLS                                                    ║
-- ╚════════════════════════════════════════════════════════════╝
ALTER TABLE offers.money_models       ENABLE ROW LEVEL SECURITY;
ALTER TABLE offers.model_steps        ENABLE ROW LEVEL SECURITY;
ALTER TABLE offers.step_performance   ENABLE ROW LEVEL SECURITY;
ALTER TABLE offers.creative_briefs    ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON offers.money_models
    USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation ON offers.model_steps
    USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation ON offers.step_performance
    USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation ON offers.creative_briefs
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- ╔════════════════════════════════════════════════════════════╗
-- ║  8. Enregistrement agent + cron                            ║
-- ╚════════════════════════════════════════════════════════════╝
INSERT INTO agents.registry (agent_id, display_name, tier, schedule_cron, is_active, description)
VALUES (
    'AGENT_MONEY_MODEL',
    'Money Model Builder',
    'hedge_fund',
    '0 6 * * *',    -- chaque matin à 6h
    TRUE,
    'Construit et optimise les séquences d''offres Hormozi (Attraction→Upsell→Downsell→Continuity). Génère les briefs créatifs. Monitore les taux de conversion par étape.'
) ON CONFLICT (agent_id) DO UPDATE
    SET description = EXCLUDED.description,
        schedule_cron = EXCLUDED.schedule_cron;

-- Trigger updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON offers.money_models
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON offers.model_steps
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON offers.creative_briefs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ╔════════════════════════════════════════════════════════════╗
-- ║  9. Données initiales : templates des 13 offres            ║
-- ╚════════════════════════════════════════════════════════════╝
CREATE TABLE IF NOT EXISTS offers.offer_templates (
    offer_type          VARCHAR(60) PRIMARY KEY,
    step_type           VARCHAR(30) NOT NULL,
    display_name        VARCHAR(100) NOT NULL,
    description         TEXT NOT NULL,
    psychology_lever    VARCHAR(60) NOT NULL,
    hormozi_quote       TEXT,
    target_cr           NUMERIC(4,2) NOT NULL,  -- taux de conversion cible
    price_logic         TEXT NOT NULL,           -- règle de pricing
    trigger_logic       TEXT NOT NULL,           -- quand utiliser cette offre
    script_template     TEXT NOT NULL            -- template de script
);

INSERT INTO offers.offer_templates VALUES

-- ── ATTRACTION ──────────────────────────────────────────────
('WIN_MONEY_BACK', 'attraction', 'Win Your Money Back',
 'Le client paie maintenant avec la possibilité de récupérer son argent s''il atteint le résultat.',
 'COMMITMENT',
 'You get loads of cash up front. You get more customers to say yes since you offer the steepest possible discount — 100%.',
 0.45, 'Prix normal. Remboursement si résultat atteint.',
 'Toujours en premier. Idéal pour produits où le résultat est mesurable.',
 'Tu vas investir {{price}}€ aujourd''hui. Si tu fais {{action}} pendant {{duration}}, on te rembourse intégralement. Tu paries sur toi-même — et honnêtement, à ce tarif, tu ne peux pas perdre.'),

('GIVEAWAY', 'attraction', 'Giveaway / Concours',
 'Concours pour gagner le produit gratuitement. Les perdants reçoivent une offre discount.',
 'SCARCITY',
 'Who doesn''t want somethin'' for nothin''? Giveaways are so good they need to be regulated.',
 0.35, '0€ pour entrer. -30% à -50% pour les non-gagnants.',
 'Lancement produit, cold audience, croissance organique TikTok/Meta.',
 'On offre {{prize}} à un gagnant. Tu n''as pas gagné aujourd''hui — mais t''es qualifié pour notre offre exclusive {{discount}}% valable 48h.'),

('DECOY', 'attraction', 'Decoy Offer',
 'Offre de base peu attrayante présentée en contraste avec l''offre premium.',
 'ANCHORING',
 '"Are you here for free stuff or lasting results?" — most people say results.',
 0.50, 'Decoy stripped = 40-60% moins cher. Premium = prix normal.',
 'Quand la promesse est forte mais le prospect hésite sur le prix.',
 'Tu peux partir avec l''option de base — ou je peux te montrer ce qui donne vraiment des résultats. Laquelle tu préfères?'),

('BUY_X_GET_Y', 'attraction', 'Buy X Get Y Free',
 'Acheter X unités pour en recevoir Y gratuitement.',
 'RECIPROCITY',
 'Free drives more interest than a discount. More people know the value of free than the value of a percentage off.',
 0.40, 'Prix unitaire × X. Y unités gratuites. Marge calculée sur le bundle.',
 'Produits consommables ou achetés en plusieurs exemplaires.',
 'Achète {{qty_paid}} {{product}}, reçois {{qty_free}} {{product}} offert{{s}}. C''est notre meilleure offre — et ça ne reviendra pas.'),

('PAY_LESS_NOW', 'attraction', 'Pay Less Now or Pay More Later',
 'Choix entre payer plein tarif plus tard ou prix réduit maintenant.',
 'LOSS_AVERSION',
 'Anyone can sell this. Almost anyone will agree to pay later if they are satisfied. Once they agree to pay later, you can get them to pay now with hefty discounts.',
 0.55, 'Option A: 0€ maintenant, prix plein dans 14j. Option B: -20-30% maintenant.',
 'Première interaction. Prospect froid. Très fort en paid ads.',
 'Option 1 : tu essaies gratuitement — si t''es satisfait tu paies {{price}}€ dans 14 jours. Option 2 : tu paies {{price_discounted}}€ maintenant et tu gardes ce tarif à vie.'),

-- ── UPSELL ──────────────────────────────────────────────────
('CLASSIC_UPSELL', 'upsell', 'Classic Upsell',
 'Offrir un produit complémentaire immédiatement après l''achat principal.',
 'COMMITMENT',
 'You can''t have X without Y. The second worst thing that happens is they say no.',
 0.35, 'Complément = 30-60% du prix principal. Présenté comme nécessité.',
 'Immédiatement après OUI à l''offre principale.',
 'Tu ne vas pas obtenir les meilleurs résultats sans {{complement}}. C''est comme avoir une voiture sans carburant. Tu veux qu''on l''ajoute maintenant?'),

('MENU_UPSELL', 'upsell', 'Menu Upsell',
 'Unsell ce dont ils n''ont pas besoin, prescribe ce dont ils ont besoin, A/B sur les préférences.',
 'AUTHORITY',
 '"You don''t need all eight courses yet. You just need to solve X." Unselling lower-margin stuff incentivizes higher-margin upsells.',
 0.45, 'Prescris le bundle optimisé. Retire les extras inutiles. Prix adapté.',
 'Quand tu as plusieurs produits et que le client ne sait pas quoi prendre.',
 'T''as pas besoin de ça pour l''instant — ça, c''est pour les avancés. Ce qu''il te faut vraiment c''est [X + Y]. Est-ce que tu préfères [A] ou [B]?'),

('ANCHOR_UPSELL', 'upsell', 'Anchor Upsell',
 'Présenter le produit le plus cher en premier pour que le prix principal paraisse raisonnable.',
 'ANCHORING',
 '"The only thing worse than making a $1,000 offer to a person with a $100 budget is making a $100 offer to someone with a $1,000 budget."',
 0.60, 'Anchor = 3-5x le prix principal. Main offer = prix normal.',
 'Quand tu ne sais pas le budget du client. Toujours montrer le premium d''abord.',
 'Notre offre complète c''est {{anchor_price}}€ — ça inclut [tout]. Si tu cherches quelque chose de plus ciblé, j''ai aussi {{product}} à {{main_price}}€.'),

('ROLLOVER_UPSELL', 'upsell', 'Rollover Upsell',
 'Créditer l''achat initial vers une offre plus longue/plus chère.',
 'RECIPROCITY',
 '"Wanna just roll it forward?" This changed my life and thousands of gym owners'' lives.',
 0.50, 'Crédit = 100% du 1er achat. Nouvel engagement = min 4x le crédit.',
 'Juste après le 1er achat. Offre one-time-only — maintenant ou jamais.',
 'Tes {{credit}}€ que tu viens de dépenser — je peux les créditer intégralement vers {{next_offer}} à {{new_price}}€/mois. Tu commences maintenant, tu ne paies rien de plus ce mois-ci.'),

-- ── DOWNSELL ────────────────────────────────────────────────
('PAYMENT_PLAN', 'downsell', 'Payment Plan Downsell',
 'Même prix, étalé dans le temps. Jamais de réduction — juste du temps.',
 'LOSS_AVERSION',
 'Payment plans get more buyers like discounts, but boost profits because they agree to pay the full price over time.',
 0.30, 'Prix inchangé. Fractionner : 50% maintenant / 50% à la prochaine paye.',
 'Premier refus basé sur le prix.',
 'Je comprends. On peut faire 50% aujourd''hui et 50% dans 14 jours — même prix total. Qu''est-ce que tu mets aujourd''hui?'),

('TRIAL_PENALTY', 'downsell', 'Trial With Penalty',
 'Essai gratuit avec pénalité si les conditions ne sont pas remplies.',
 'COMMITMENT',
 '"If you do X, Y, Z, I''ll let you start for free." Just call it a Free Trial.',
 0.40, '0€ pour démarrer. Pénalité = 30-50% du prix si conditions non remplies.',
 'Refus de l''offre principale par manque de confiance dans le résultat.',
 'OK — essaie gratuitement. Je te demande juste de faire [3 choses simples]. Si t''as une bonne raison de ne pas continuer après ça, tu dois rien. Quelle carte tu veux utiliser?'),

('FEATURE_DOWNSELL', 'downsell', 'Feature Downsell',
 'Retirer une feature, baisser le prix. Jamais réduire le prix du même produit.',
 'RECIPROCITY',
 '"Take something away, lower the price, and ask: how about now?" People see the value in what you removed after they see the price difference.',
 0.35, 'Prix réduit de 30-50%. Feature retirée = garantie, quantité, ou service inclus.',
 'Refus persistant après Payment Plan. Toujours proposer AVANT d''abandonner.',
 'Si le prix est le frein — je peux retirer la garantie et descendre à {{lower_price}}€. Tu gardes le produit, juste sans le filet. Ça marche pour toi?'),

-- ── CONTINUITY ───────────────────────────────────────────────
('CONTINUITY_BONUS', 'continuity', 'Continuity Bonus Offer',
 'Bonus exclusif offert uniquement si le client s''abonne maintenant.',
 'SCARCITY',
 '"Focus on the bonus, not the membership. Join my membership isn''t compelling. Get this free valuable thing — is."',
 0.25, 'Abonnement mensuel à X€/mois. Bonus = produit ou contenu valeur réelle justifiée.',
 'Dernier step du funnel. Après upsell accepté ou downsell accepté.',
 'Si tu t''abonnes aujourd''hui, je t''inclus {{bonus}} (valeur {{bonus_value}}€) — c''est uniquement pour les clients qui décident maintenant.'),

('CONTINUITY_DISCOUNT', 'continuity', 'Continuity Discount',
 'Discount appliqué sur l''engagement long terme.',
 'COMMITMENT',
 'Bill weekly (every 4 weeks = 13 cycles/year, not 12). That''s 8.3% more revenue for zero extra work.',
 0.20, 'Engagement 6-12 mois = 2-3 mois offerts. Spread le discount sur la durée.',
 'Client qui hésite entre mensuel et annuel.',
 'Si tu t''engages sur 12 mois, on te fait 3 mois offerts — soit {{total_discount}}€ d''économie. Et on dépose les mois offerts en fin de période.'),

('WAIVED_FEE', 'continuity', 'Waived Fee Offer',
 'Frais d''activation waivés si engagement long terme.',
 'LOSS_AVERSION',
 '"Fees get them to start. Fees get them to stick." If the cost to quit exceeds the cost to stay, they stay.',
 0.30, 'Frais activation = 3-5x mensualité. Waived si engagement 12 mois.',
 'Client qui veut rester flexible (mois-à-mois).',
 'En mois-à-mois, on a des frais d''activation de {{fee}}€. Si tu t''engages 12 mois, je les supprime. Si tu quittes avant, ces frais s''appliquent. Qu''est-ce que tu préfères?')

ON CONFLICT (offer_type) DO NOTHING;

-- Commentaire final
COMMENT ON SCHEMA offers IS 'AEGIS Money Model Engine — Séquences d''offres Hormozi automatisées';
COMMENT ON TABLE offers.money_models IS 'Séquences d''offres complètes (Attraction→Upsell→Downsell→Continuity)';
COMMENT ON TABLE offers.model_steps IS 'Chaque étape d''une séquence. 13 types d''offres Hormozi.';
COMMENT ON TABLE offers.step_performance IS 'KPIs de conversion par étape par jour';
COMMENT ON TABLE offers.creative_briefs IS 'Briefs générés pour AGENT_CREATIVE_FACTORY';
COMMENT ON TABLE offers.offer_templates IS 'Templates des 13 offres avec scripts et logique de déclenchement';
