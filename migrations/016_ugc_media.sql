-- ============================================================
-- MIGRATION 016 — AGENT_UGC_FACTORY — Media & UGC tables
-- ============================================================

CREATE SCHEMA IF NOT EXISTS media;

-- \u2500\u2500 Table principale : jobs de g\u00e9n\u00e9ration UGC \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
CREATE TABLE IF NOT EXISTS media.ugc_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    product_id      UUID NOT NULL REFERENCES store.products(id) ON DELETE CASCADE,

    -- Statut du pipeline
    status          VARCHAR(30) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','scraping','scripting','generating_avatar',
                                      'generating_broll','assembling','done','failed')),
    progress_pct    INTEGER NOT NULL DEFAULT 0,  -- 0\u2192100

    -- Input
    product_url     TEXT,
    product_name    TEXT,
    product_images  JSONB NOT NULL DEFAULT '[]',   -- URLs images produit
    product_desc    TEXT,
    product_benefits JSONB NOT NULL DEFAULT '[]',  -- b\u00e9n\u00e9fices extraits
    target_angle    VARCHAR(100),  -- angle marketing choisi
    awareness_level VARCHAR(30) DEFAULT 'problem_aware',

    -- Script g\u00e9n\u00e9r\u00e9
    script_hook     TEXT,    -- 0\u20133 secondes
    script_body     TEXT,    -- 3\u201325 secondes
    script_cta      TEXT,    -- 25\u201330 secondes
    script_full     TEXT,    -- script complet format\u00e9
    hook_type       VARCHAR(50),  -- pain_point|curiosity|social_proof|transformation

    -- S\u00e9lection avatar
    avatar_id       VARCHAR(100),   -- ID Kling/Replicate avatar
    avatar_gender   VARCHAR(10) DEFAULT 'female',
    avatar_style    VARCHAR(30) DEFAULT 'ugc_authentic',  -- ugc_authentic|studio|selfie
    voice_id        VARCHAR(100),   -- ID voix ElevenLabs/synth\u00e9tique
    voice_language  VARCHAR(10) DEFAULT 'fr',

    -- Assets g\u00e9n\u00e9r\u00e9s
    avatar_video_url     TEXT,   -- vid\u00e9o avatar parlant (talking head)
    broll_video_urls     JSONB NOT NULL DEFAULT '[]',  -- B-roll produit
    captions_url         TEXT,   -- fichier SRT sous-titres
    music_track          VARCHAR(100),  -- track musique fond

    -- Vid\u00e9o finale assembl\u00e9e
    final_video_url      TEXT,
    final_video_duration INTEGER,  -- secondes
    final_video_format   VARCHAR(20) DEFAULT '9:16',  -- 9:16 | 1:1 | 16:9
    thumbnail_url        TEXT,

    -- Performance tracking (apr\u00e8s lancement)
    ad_entity_id         TEXT,    -- Meta/TikTok ad ID
    spend_eur            DECIMAL(10,2) DEFAULT 0,
    impressions          BIGINT DEFAULT 0,
    clicks               INTEGER DEFAULT 0,
    conversions          INTEGER DEFAULT 0,
    roas                 DECIMAL(6,3),
    cpr                  DECIMAL(10,2),
    classification       VARCHAR(20),  -- WINNER | LOSER | TESTING

    -- Meta
    error_message    TEXT,
    retry_count      INTEGER NOT NULL DEFAULT 0,
    generation_cost  DECIMAL(8,4) DEFAULT 0,  -- co\u00fbt API en EUR
    generated_at     TIMESTAMPTZ,
    launched_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE media.ugc_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE media.ugc_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY ugc_jobs_tenant ON media.ugc_jobs
    USING (tenant_id = current_setting('app.tenant_id',TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id',TRUE)::UUID);

CREATE INDEX idx_ugc_jobs_product   ON media.ugc_jobs(tenant_id, product_id, status);
CREATE INDEX idx_ugc_jobs_status    ON media.ugc_jobs(status, created_at DESC);
CREATE INDEX idx_ugc_jobs_winner    ON media.ugc_jobs(classification, roas DESC NULLS LAST) WHERE classification IS NOT NULL;

-- \u2500\u2500 Biblioth\u00e8que d'avatars natifs \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
CREATE TABLE IF NOT EXISTS media.avatar_library (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    avatar_key      VARCHAR(100) NOT NULL UNIQUE,  -- ex: "fr_female_25_ugc_01"
    provider        VARCHAR(30) NOT NULL,           -- kling | runway | replicate | elevenlabs
    provider_id     VARCHAR(200) NOT NULL,          -- ID chez le provider
    gender          VARCHAR(10) NOT NULL,
    age_range       VARCHAR(20),    -- "18-25" | "25-35" | "35-45"
    style           VARCHAR(30) NOT NULL,  -- ugc_authentic | studio | selfie | voiceover
    ethnicity       VARCHAR(30),
    language        VARCHAR(10) NOT NULL DEFAULT 'fr',
    voice_id        VARCHAR(200),   -- voix associ\u00e9e
    sample_url      TEXT,           -- vid\u00e9o de d\u00e9mo
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    performance_avg DECIMAL(5,2),   -- ROAS moyen des UGC g\u00e9n\u00e9r\u00e9s avec cet avatar
    usage_count     INTEGER NOT NULL DEFAULT 0,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- \u2500\u2500 Templates de scripts \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
CREATE TABLE IF NOT EXISTS media.script_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID,  -- NULL = global (pour tous)
    hook_type       VARCHAR(50) NOT NULL,
    awareness_level VARCHAR(30) NOT NULL,
    angle_category  VARCHAR(50),
    language        VARCHAR(10) NOT NULL DEFAULT 'fr',

    -- Structure du script
    hook_template   TEXT NOT NULL,   -- "[Douleur] ? Voici ce qui a TOUT chang\u00e9 pour moi."
    body_template   TEXT NOT NULL,
    cta_template    TEXT NOT NULL,
    duration_secs   INTEGER NOT NULL DEFAULT 30,

    -- Performance observ\u00e9e
    avg_ctr         DECIMAL(6,4),
    avg_conversion  DECIMAL(6,4),
    usage_count     INTEGER NOT NULL DEFAULT 0,
    win_rate        DECIMAL(5,4) NOT NULL DEFAULT 0.5,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    source          VARCHAR(50) DEFAULT 'manual',  -- manual | spy_extracted | ab_winner
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- \u2500\u2500 Biblioth\u00e8que de B-rolls g\u00e9n\u00e9r\u00e9s \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
CREATE TABLE IF NOT EXISTS media.broll_library (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID,
    product_id      UUID REFERENCES store.products(id),
    scene_type      VARCHAR(50) NOT NULL,  -- product_close | lifestyle | transformation | texture | unboxing
    prompt_used     TEXT NOT NULL,
    video_url       TEXT NOT NULL,
    thumbnail_url   TEXT,
    duration_secs   INTEGER,
    provider        VARCHAR(30) NOT NULL,  -- kling | runway | replicate
    quality_score   DECIMAL(4,2),  -- 0-10
    is_approved     BOOLEAN NOT NULL DEFAULT FALSE,
    usage_count     INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- \u2500\u2500 Historique des assemblages FFmpeg \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
CREATE TABLE IF NOT EXISTS media.assembly_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ugc_job_id      UUID NOT NULL REFERENCES media.ugc_jobs(id),
    assembly_cmd    TEXT,        -- commande FFmpeg utilis\u00e9e
    input_files     JSONB,       -- fichiers en entr\u00e9e
    output_file     TEXT,
    duration_ms     INTEGER,     -- temps de traitement
    file_size_mb    DECIMAL(8,2),
    success         BOOLEAN NOT NULL,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- \u2500\u2500 Avatars par d\u00e9faut (biblioth\u00e8que bootstrap) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
INSERT INTO media.avatar_library
    (avatar_key, provider, provider_id, gender, age_range, style, language, notes)
VALUES
-- Kling avatars via Replicate
('fr_female_20_ugc_01', 'replicate', 'lucataco/kling-v1-5',  'female', '18-25', 'ugc_authentic', 'fr', 'Style UGC authentique, ton naturel'),
('fr_female_28_ugc_02', 'replicate', 'lucataco/kling-v1-5',  'female', '25-35', 'ugc_authentic', 'fr', 'Style UGC, ton confiant'),
('fr_female_35_ugc_03', 'replicate', 'lucataco/kling-v1-5',  'female', '30-40', 'ugc_authentic', 'fr', 'Style t\u00e9moignage, ton mature'),
('fr_female_22_selfie', 'replicate', 'lucataco/kling-v1-5',  'female', '18-25', 'selfie',        'fr', 'Format selfie cam\u00e9ra avant'),
('fr_male_28_ugc_01',   'replicate', 'lucataco/kling-v1-5',  'male',   '25-35', 'ugc_authentic', 'fr', 'Style UGC masculin'),
-- Runway avatars
('fr_female_25_studio', 'runway',    'gen3_alpha_turbo',      'female', '20-30', 'studio',        'fr', 'Style studio, \u00e9clairage pro'),
('fr_female_30_voiceover', 'runway', 'gen3_alpha_turbo',      'female', '25-40', 'voiceover',     'fr', 'Voiceover + B-roll produit')
ON CONFLICT (avatar_key) DO NOTHING;

-- \u2500\u2500 Templates de scripts bootstrap (FR, tous types) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
INSERT INTO media.script_templates
    (hook_type, awareness_level, angle_category, language, hook_template, body_template, cta_template, duration_secs, win_rate, source)
VALUES

-- PAIN POINT hooks
('pain_point', 'problem_aware', 'r\u00e9sultat', 'fr',
 'J''en avais MARRE de [douleur principale]. J''ai tout essay\u00e9... jusqu''\u00e0 ce que je d\u00e9couvre \u00e7a.',
 'S\u00e9rieusement, [b\u00e9n\u00e9fice 1] en [dur\u00e9e]. Et le truc c''est que [b\u00e9n\u00e9fice 2]. Ma peau/corps/[zone] a chang\u00e9 en [d\u00e9lai]. C''est [produit].',
 'Le lien est dans ma bio. Commandez avant que le stock parte \u2014 ils sont souvent \u00e9puis\u00e9s.',
 30, 0.72, 'manual'),

('pain_point', 'solution_aware', 'comparaison', 'fr',
 'Arr\u00eatez de gaspiller de l''argent sur [concurrent/m\u00e9thode]. Voici POURQUOI.',
 '[Produit] fait exactement ce que [concurrent] ne peut pas faire : [diff\u00e9renciateur unique]. J''ai test\u00e9 les deux pendant [dur\u00e9e], et la diff\u00e9rence est [r\u00e9sultat chiffr\u00e9].',
 'Lien en bio. Code [CODE] pour -[X]%.',
 28, 0.68, 'manual'),

-- TRANSFORMATION hooks
('transformation', 'problem_aware', 'avant-apr\u00e8s', 'fr',
 'Il y a [dur\u00e9e], j''\u00e9tais \u00e0 [\u00e9tat initial]. Aujourd''hui : [\u00e9tat actuel]. Voici ce qui a tout chang\u00e9.',
 'J''ai commenc\u00e9 \u00e0 utiliser [produit] il y a [dur\u00e9e]. Semaine 1 : [r\u00e9sultat initial]. Semaine [X] : [r\u00e9sultat principal]. Ce que personne ne dit, c''est que [insight unique].',
 'Si tu veux les m\u00eames r\u00e9sultats, le lien est en bio.',
 32, 0.78, 'manual'),

-- CURIOSITY hooks
('curiosity', 'unaware', 'd\u00e9couverte', 'fr',
 'Ce [produit] que tout le monde s''arrache en ce moment... je l''ai test\u00e9 pour vous.',
 'Honn\u00eatement je ne m''attendais pas \u00e0 \u00e7a. [B\u00e9n\u00e9fice 1] d\u00e8s la [premi\u00e8re/deuxi\u00e8me] utilisation. Et [b\u00e9n\u00e9fice 2] que personne ne mentionne dans les avis.',
 'Vous pouvez le trouver en bio. Franchement \u00e7a vaut le test.',
 28, 0.65, 'manual'),

-- SOCIAL PROOF hooks
('social_proof', 'most_aware', 't\u00e9moignage', 'fr',
 '[X]+ personnes l''ont command\u00e9 cette semaine. Voici pourquoi.',
 'J''\u00e9tais sceptique au d\u00e9part. Mais quand j''ai vu [preuve sociale : avis/r\u00e9sultats/photos], j''ai compris. [B\u00e9n\u00e9fice principal] + [b\u00e9n\u00e9fice secondaire]. Apr\u00e8s [dur\u00e9e] d''utilisation, je comprends l''engouement.',
 'Stock limit\u00e9. Lien en bio.',
 30, 0.70, 'manual'),

-- QUESTION hook
('question', 'problem_aware', '\u00e9ducatif', 'fr',
 'Tu savais que [fait surprenant sur le probl\u00e8me] ? Parce que moi je le savais pas.',
 'C''est pour \u00e7a que [produit] fonctionne diff\u00e9remment de tout ce qu''on nous vend d''habitude. Il [m\u00e9canisme unique en termes simples]. R\u00e9sultat : [b\u00e9n\u00e9fice principal] sans [inconv\u00e9nient habituel].',
 'Le lien est en bio si tu veux essayer.',
 30, 0.63, 'manual')

ON CONFLICT DO NOTHING;

-- \u2500\u2500 Schedules AGENT_UGC_FACTORY \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
INSERT INTO agents.registry
    (agent_id, name, category, tier, description, capabilities, is_active)
VALUES
    ('AGENT_UGC_FACTORY', 'UGC Factory', 'creative', 'full_organism',
     'G\u00e9n\u00e9ration native UGC vid\u00e9o : produit \u2192 script \u2192 avatar \u2192 assemblage \u2192 Meta/TikTok',
     '["video.generate","script.write","avatar.render","media.assemble","llm.generate"]'::jsonb,
     TRUE)
ON CONFLICT (agent_id) DO UPDATE SET
    description  = EXCLUDED.description,
    capabilities = EXCLUDED.capabilities,
    is_active    = TRUE;

INSERT INTO agents.schedule
    (agent_id, task_type, tier, schedule_type, cron_expression, priority, scope, input_schema, default_input)
VALUES
    ('AGENT_UGC_FACTORY', 'ugc.generate_batch',  'full_organism', 'cron',    '0 8 * * *',        8, 'per_tenant', '{}', '{"max_jobs":5}'),
    ('AGENT_UGC_FACTORY', 'ugc.process_queue',   'full_organism', 'cron',    '*/10 * * * *',     9, 'global',     '{}', '{}'),
    ('AGENT_UGC_FACTORY', 'ugc.analyze_winners', 'full_organism', 'cron',    '0 6 * * *',        6, 'per_tenant', '{}', '{}')
ON CONFLICT DO NOTHING;

-- \u2500\u2500 ENV vars n\u00e9cessaires (documentation) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
-- REPLICATE_API_KEY     \u2192 Kling v1.5 (avatar talking head + b-roll)
-- RUNWAYML_API_KEY      \u2192 Gen3 Alpha Turbo (vid\u00e9o studio)
-- ELEVENLABS_API_KEY    \u2192 Voix synth\u00e9tique FR (optionnel, fallback browser TTS)
-- ANTHROPIC_API_KEY     \u2192 Scripts LLM (d\u00e9j\u00e0 pr\u00e9sent)
-- FFMPEG_PATH           \u2192 /usr/bin/ffmpeg (install\u00e9 sur le serveur)
-- MEDIA_STORAGE_BUCKET  \u2192 S3/Supabase Storage pour les vid\u00e9os g\u00e9n\u00e9r\u00e9es
-- MEDIA_CDN_URL         \u2192 URL publique CDN pour les vid\u00e9os

-- ============================================================
-- R\u00c9SUM\u00c9 MIGRATION 016 \u2014 AGENT_UGC_FACTORY
-- Sch\u00e9ma cr\u00e9\u00e9      : media
-- Tables cr\u00e9\u00e9es    : media.ugc_jobs, media.avatar_library,
--                    media.script_templates, media.broll_library,
--                    media.assembly_log (5 tables)
-- Bootstrap data   : 7 avatars, 6 templates de scripts FR
-- Agent enregistr\u00e9 : AGENT_UGC_FACTORY
-- Schedules        : 3 crons (batch 8h, queue 10min, winners 6h)
-- D\u00e9pendances ext. : Replicate (Kling), RunwayML, ElevenLabs (optionnel)
-- Z\u00e9ro d\u00e9pendance  : Arrim / Freepik / MakeUGC \u2014 tout est natif
-- ============================================================
MIGRATION016
echo "Migration 016 ajout\u00e9e : $(wc -l < /home/claude/aegis-final-merged/migrations/000_consolidated.sql) lignes total"
-- RLS PATCH — tables sans tenant isolation
ALTER TABLE media.script_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE media.broll_library     ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON media.script_templates
    USING (tenant_id = current_setting('app.tenant_id')::UUID);
CREATE POLICY tenant_isolation ON media.broll_library
    USING (tenant_id = current_setting('app.tenant_id')::UUID);
