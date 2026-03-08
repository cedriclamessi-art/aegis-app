// ============================================================
// AEGIS — AGENT_STRATEGY_ORGANIC
//
// Mission primaire :
//   Construire une audience organique durable AVANT et PENDANT
//   les ads payantes. UGC automatisés, calendrier éditorial,
//   stratégie de distribution, boucles de croissance.
//
// Flux :
//   product.ingested → personas → stratégie → scripts UGC →
//   calendrier → brief créateurs → repurposing → review → iterate
//
// Communication :
//   ← MARKET_INTEL  : tendances, viraux, hooks détectés
//   ← ORCHESTRATOR  : nouveau produit à traiter
//   → COPY           : valider le ton, brand voice
//   → CREATIVE       : briefs créas pour les UGC
//   → MEDIA_BUYER    : signaler les contenus organiques qui
//                      méritent d'être boostés (dark posts)
//   → ANALYTICS      : demander les perfs post-publication
//   → LEARNING       : envoyer les patterns organiques gagnants
// ============================================================

import { AgentBase, AgentTask, AgentResult } from '../base/agent.base';
import { db } from '../../utils/db';
import { callLLM } from '../../utils/llm';

// ─── Interfaces ───────────────────────────────────────────
interface Persona {
  id: string;
  name: string;
  age_range: string;
  pain_points: string[];
  aspirations: string[];
  content_hooks: string[];
  platforms: string[];
  buying_triggers: string[];
  objections: string[];
}

interface UGCScript {
  title: string;
  script_type: string;
  platform: string;
  duration_seconds: number;
  hook: string;
  hook_variants: string[];
  script_body: string;
  cta: string;
  hashtags: string[];
  music_mood: string;
  visual_notes: string;
  predicted_score: number;
  hook_score: number;
  persona_target: string;
  content_pillar: string;
}

// ════════════════════════════════════════════════════════════
export class StrategyOrganicAgent extends AgentBase {
  readonly agentId = 'AGENT_STRATEGY_ORGANIC';
  readonly taskTypes = [
    'strategy.organic_plan',
    'ugc.generate_scripts',
    'ugc.batch_production',
    'content.calendar_build',
    'content.repurpose',
    'audience.segment',
    'audience.persona_build',
    'brand.voice_define',
    'organic.post_schedule',
    'organic.performance_review',
    'organic.growth_loop',
    'AGENT_STRATEGY_ORGANIC.handle_message',
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    await this.heartbeat();
    await this.trace('info', `Démarrage: ${task.taskType}`, { taskId: task.id });

    switch (task.taskType) {
      case 'strategy.organic_plan':      return this.buildOrganicPlan(task);
      case 'ugc.generate_scripts':       return this.generateUGCScripts(task);
      case 'ugc.batch_production':       return this.batchUGCProduction(task);
      case 'content.calendar_build':     return this.buildContentCalendar(task);
      case 'content.repurpose':          return this.repurposeContent(task);
      case 'audience.persona_build':     return this.buildPersonas(task);
      case 'brand.voice_define':         return this.defineBrandVoice(task);
      case 'organic.performance_review': return this.reviewPerformance(task);
      case 'organic.growth_loop':        return this.growthLoop(task);
      case 'AGENT_STRATEGY_ORGANIC.handle_message': return this.handleMessage(task);
      default:
        return { success: false, error: `Unknown task: ${task.taskType}` };
    }
  }

  // ════════════════════════════════════════════════════════
  // 1. PLAN ORGANIQUE GLOBAL
  // Construit ou met à jour la stratégie organique du tenant
  // ════════════════════════════════════════════════════════
  private async buildOrganicPlan(task: AgentTask): Promise<AgentResult> {
    if (!task.tenantId) return { success: false, error: 'tenant_id required' };

    // Récupérer les produits actifs
    const products = await db.query(
      `SELECT id, title, normalized_data, market_context
       FROM store.products
       WHERE tenant_id = $1 AND status = 'enriched'
       ORDER BY created_at DESC LIMIT 5`,
      [task.tenantId]
    );

    // Récupérer les signaux intel actifs
    const intelFeed = await this.readIntelFeed(task.tenantId, 15);
    const trendingKeywords = await db.query(
      `SELECT keyword, trend_score, trend_direction FROM trending_keywords
       WHERE last_updated_at > NOW() - INTERVAL '7 days'
       ORDER BY trend_score DESC LIMIT 20`
    );

    // Vérifier si stratégie existante
    const existing = await db.query(
      `SELECT id FROM intel.organic_strategies
       WHERE tenant_id = $1 AND status = 'active' LIMIT 1`,
      [task.tenantId]
    );

    const productContext = products.rows.map(p => ({
      id: p.id,
      title: p.title,
      category: p.normalized_data?.category,
      price: p.normalized_data?.price,
      key_benefits: p.normalized_data?.key_benefits,
    }));

    const prompt = `Tu es un expert en croissance organique DTC (Direct-to-Consumer) et UGC marketing.

PRODUITS :
${JSON.stringify(productContext, null, 2)}

TENDANCES ACTUELLES :
${trendingKeywords.rows.slice(0, 10).map(k => `${k.keyword} (score: ${k.trend_score}, direction: ${k.trend_direction})`).join('\n')}

MISSION : Construire une stratégie de croissance organique complète pour ce(s) produit(s).

Génère un JSON avec exactement cette structure :
{
  "name": "Stratégie Organique Q[trimestre] [Année]",
  "brand_voice": {
    "tone": "3 mots clés de ton",
    "persona": "l'archétype de la marque en 1 phrase",
    "forbidden": ["à éviter 1", "à éviter 2", "à éviter 3"],
    "pillars": ["pilier 1", "pilier 2", "pilier 3", "pilier 4"]
  },
  "target_personas": [
    {
      "id": "persona_1",
      "name": "Prénom + description courte",
      "age_range": "25-35",
      "pain_points": ["douleur 1", "douleur 2", "douleur 3"],
      "aspirations": ["aspiration 1", "aspiration 2"],
      "content_hooks": ["type de contenu qui résonne 1", "type 2", "type 3"],
      "platforms": ["tiktok", "instagram"],
      "buying_triggers": ["déclencheur achat 1", "déclencheur 2"],
      "objections": ["objection 1", "objection 2"]
    },
    {
      "id": "persona_2",
      "name": "Prénom + description courte",
      "age_range": "35-50",
      "pain_points": ["..."],
      "aspirations": ["..."],
      "content_hooks": ["..."],
      "platforms": ["instagram", "pinterest"],
      "buying_triggers": ["..."],
      "objections": ["..."]
    }
  ],
  "content_pillars": ["Éducation", "Transformation", "Coulisses", "Communauté"],
  "platforms": ["tiktok", "instagram", "youtube_shorts"],
  "kpis": {
    "followers_m3": 5000,
    "avg_views_per_video": 15000,
    "ugc_pieces_per_month": 30,
    "organic_revenue_share_pct_target": 25
  },
  "content_rhythm": {
    "tiktok": "1 vidéo/jour",
    "instagram_reels": "5/semaine",
    "instagram_stories": "3/jour",
    "youtube_shorts": "3/semaine",
    "pinterest": "10 pins/semaine"
  },
  "growth_loops": [
    {
      "name": "Nom de la boucle",
      "mechanic": "Description du mécanisme",
      "trigger": "Ce qui démarre la boucle",
      "flywheel": "Comment elle s'auto-alimente"
    }
  ],
  "90_day_roadmap": [
    {"phase": "J1-J30", "focus": "Fondations", "actions": ["action 1", "action 2"]},
    {"phase": "J31-J60", "focus": "Momentum", "actions": ["action 1", "action 2"]},
    {"phase": "J61-J90", "focus": "Scale", "actions": ["action 1", "action 2"]}
  ]
}

Réponds UNIQUEMENT avec le JSON. Pas de texte avant ou après.`;

    const raw = await callLLM(prompt, { max_tokens: 3000, json_mode: true });
    let plan: Record<string, unknown>;
    try {
      plan = JSON.parse(raw);
    } catch {
      return { success: false, error: 'LLM parse error', retryable: true };
    }

    // Upsert la stratégie
    let strategyId: string;
    if (existing.rows.length > 0) {
      strategyId = existing.rows[0].id;
      await db.query(
        `UPDATE intel.organic_strategies
         SET name=$1, brand_voice=$2::jsonb, target_personas=$3::jsonb,
             content_pillars=$4::jsonb, platforms=$5::jsonb, kpis=$6::jsonb,
             last_reviewed_at=NOW(), updated_at=NOW()
         WHERE id=$7`,
        [
          plan.name, JSON.stringify(plan.brand_voice), JSON.stringify(plan.target_personas),
          JSON.stringify(plan.content_pillars), JSON.stringify(plan.platforms),
          JSON.stringify(plan.kpis), strategyId
        ]
      );
    } else {
      const result = await db.query(
        `INSERT INTO intel.organic_strategies
         (tenant_id, name, status, brand_voice, target_personas, content_pillars, platforms, kpis, active_from)
         VALUES ($1,$2,'active',$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,NOW())
         RETURNING id`,
        [
          task.tenantId, plan.name, JSON.stringify(plan.brand_voice),
          JSON.stringify(plan.target_personas), JSON.stringify(plan.content_pillars),
          JSON.stringify(plan.platforms), JSON.stringify(plan.kpis)
        ]
      );
      strategyId = result.rows[0].id;
    }

    // Notifier les agents qui ont besoin de ce contexte
    await this.send({
      fromAgent: this.agentId,
      toAgent: 'AGENT_COPY',
      messageType: 'DATA_PUSH',
      subject: '📣 Brand voice & personas définis — mettre à jour le tone of voice',
      payload: { brand_voice: plan.brand_voice, personas: plan.target_personas, strategyId },
      tenantId: task.tenantId,
      priority: 7,
    });

    await this.send({
      fromAgent: this.agentId,
      toAgent: 'AGENT_CREATIVE',
      messageType: 'DATA_PUSH',
      subject: '🎨 Pilliers contenus & ton visuel définis',
      payload: { pillars: plan.content_pillars, brand_voice: plan.brand_voice, strategyId },
      tenantId: task.tenantId,
      priority: 6,
    });

    await this.trace('info', `Stratégie organique créée: ${strategyId}`, { plan: plan.name });

    // Déclencher immédiatement la production UGC
    await db.query(
      `INSERT INTO jobs.queue (tenant_id, agent_id, task_type, payload, priority)
       VALUES ($1,'AGENT_STRATEGY_ORGANIC','ugc.batch_production',$2::jsonb,8)`,
      [task.tenantId, JSON.stringify({ strategyId, batch_size: 15, scope: 'initial' })]
    );

    return {
      success: true,
      output: { strategyId, personas: (plan.target_personas as unknown[]).length, platforms: plan.platforms }
    };
  }

  // ════════════════════════════════════════════════════════
  // 2. GÉNÉRATION BATCH DE SCRIPTS UGC
  // Cœur de l'automatisation — produit N scripts prêts à filmer
  // ════════════════════════════════════════════════════════
  private async batchUGCProduction(task: AgentTask): Promise<AgentResult> {
    if (!task.tenantId) return { success: false, error: 'tenant_id required' };
    const batchSize = (task.input.batch_size as number) ?? 10;

    // Récupérer la stratégie active
    const strategy = await db.query(
      `SELECT * FROM intel.organic_strategies
       WHERE tenant_id = $1 AND status = 'active' LIMIT 1`,
      [task.tenantId]
    );
    if (strategy.rows.length === 0) {
      // Pas de stratégie → en créer une d'abord
      await db.query(
        `INSERT INTO jobs.queue (tenant_id, agent_id, task_type, payload, priority)
         VALUES ($1,'AGENT_STRATEGY_ORGANIC','strategy.organic_plan','{}',9)`,
        [task.tenantId]
      );
      return { success: false, error: 'No active strategy — plan queued', retryable: false };
    }

    const strat = strategy.rows[0];
    const personas: Persona[] = strat.target_personas ?? [];
    const pillars: string[] = strat.content_pillars ?? [];
    const platforms: string[] = strat.platforms ?? ['tiktok', 'instagram'];

    // Récupérer les produits et tendances
    const products = await db.query(
      `SELECT id, title, normalized_data, market_context FROM store.products
       WHERE tenant_id = $1 AND status = 'enriched' ORDER BY created_at DESC LIMIT 3`,
      [task.tenantId]
    );

    const trendingHooks = await db.query(
      `SELECT hook_text, hook_type, score FROM intel.hook_library
       WHERE (tenant_id=$1 OR tenant_id IS NULL) AND score > 6
       ORDER BY score DESC LIMIT 20`,
      [task.tenantId]
    );

    const viralCreatives = await db.query(
      `SELECT hook_text, source, viral_score, angles FROM viral_creatives
       WHERE detected_at > NOW() - INTERVAL '7 days'
       ORDER BY viral_score DESC LIMIT 10`
    );

    // Définir le mix de types de scripts à produire
    const scriptMix = this.buildScriptMix(batchSize, pillars, platforms);
    const scripts: UGCScript[] = [];

    for (const spec of scriptMix) {
      const persona = personas[Math.floor(Math.random() * personas.length)];
      const product = products.rows[Math.floor(Math.random() * products.rows.length)];
      if (!product) continue;

      const script = await this.generateSingleScript({
        spec,
        persona,
        product,
        brandVoice: strat.brand_voice,
        trendingHooks: trendingHooks.rows,
        viralRefs: viralCreatives.rows,
        strategyId: strat.id,
      });

      if (script) scripts.push(script);
    }

    // Sauvegarder tous les scripts
    let saved = 0;
    for (const script of scripts) {
      await db.query(
        `INSERT INTO intel.ugc_scripts
         (tenant_id, strategy_id, title, script_type, format, platform, duration_seconds,
          hook, hook_variants, script_body, cta, hashtags, music_mood, visual_notes,
          predicted_score, hook_score, persona_target, content_pillar, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,'ready')`,
        [
          task.tenantId, strat.id, script.title, script.script_type,
          script.platform === 'pinterest' ? '2:3' : '9:16',
          script.platform, script.duration_seconds,
          script.hook, JSON.stringify(script.hook_variants), script.script_body,
          script.cta, JSON.stringify(script.hashtags), script.music_mood,
          script.visual_notes, script.predicted_score, script.hook_score,
          script.persona_target, script.content_pillar
        ]
      );
      saved++;
    }

    // Pousser signal vers le calendrier
    await db.query(
      `INSERT INTO jobs.queue (tenant_id, agent_id, task_type, payload, priority)
       VALUES ($1,'AGENT_STRATEGY_ORGANIC','content.calendar_build',$2::jsonb,6)`,
      [task.tenantId, JSON.stringify({ strategyId: strat.id, scope: 'next_30_days' })]
    );

    // Informer CREATIVE pour les briefs visuels
    await this.send({
      fromAgent: this.agentId,
      toAgent: 'AGENT_CREATIVE',
      messageType: 'COMMAND',
      subject: `📱 ${saved} scripts UGC prêts — créer les briefs visuels`,
      payload: { count: saved, strategyId: strat.id, action: 'create_visual_briefs' },
      tenantId: task.tenantId,
      priority: 7,
    });

    await this.trace('info', `Batch UGC terminé: ${saved} scripts`, { batchSize });
    return { success: true, output: { scripts_generated: saved, strategy: strat.name } };
  }

  // ════════════════════════════════════════════════════════
  // 3. GÉNÉRATION D'UN SCRIPT UNIQUE
  // ════════════════════════════════════════════════════════
  private async generateUGCScripts(task: AgentTask): Promise<AgentResult> {
    // Version single-script (déclenchée par trigger viral)
    const { platform, script_type, persona_id, product_id, viral_ref } = task.input;

    const strategy = await db.query(
      `SELECT * FROM intel.organic_strategies
       WHERE tenant_id = $1 AND status = 'active' LIMIT 1`,
      [task.tenantId]
    );
    if (!strategy.rows.length) return { success: false, error: 'No active strategy' };
    const strat = strategy.rows[0];

    const product = await db.query(
      `SELECT * FROM store.products WHERE id = $1`,
      [product_id]
    );

    const persona = (strat.target_personas as Persona[])
      .find(p => p.id === persona_id) ?? strat.target_personas[0];

    const script = await this.generateSingleScript({
      spec: {
        platform: platform as string ?? 'tiktok',
        script_type: script_type as string ?? 'hook_reel',
        duration: 30,
        pillar: 'Transformation',
      },
      persona,
      product: product.rows[0],
      brandVoice: strat.brand_voice,
      trendingHooks: [],
      viralRefs: viral_ref ? [viral_ref] : [],
      strategyId: strat.id,
    });

    if (!script) return { success: false, error: 'Script generation failed', retryable: true };

    const result = await db.query(
      `INSERT INTO intel.ugc_scripts
       (tenant_id, strategy_id, title, script_type, platform, duration_seconds,
        hook, hook_variants, script_body, cta, hashtags, music_mood, visual_notes,
        predicted_score, hook_score, persona_target, content_pillar, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,'ready')
       RETURNING id`,
      [
        task.tenantId, strat.id, script.title, script.script_type, script.platform,
        script.duration_seconds, script.hook, JSON.stringify(script.hook_variants),
        script.script_body, script.cta, JSON.stringify(script.hashtags),
        script.music_mood, script.visual_notes, script.predicted_score,
        script.hook_score, script.persona_target, script.content_pillar
      ]
    );

    return { success: true, output: { script_id: result.rows[0].id, hook: script.hook, score: script.predicted_score } };
  }

  // ─── LLM : génère un script complet ──────────────────────
  private async generateSingleScript(params: {
    spec: { platform: string; script_type: string; duration: number; pillar: string };
    persona: Persona;
    product: Record<string, unknown>;
    brandVoice: Record<string, unknown>;
    trendingHooks: Array<{ hook_text: string; hook_type: string; score: number }>;
    viralRefs: Array<{ hook_text: string; source: string; viral_score: number }>;
    strategyId: string;
  }): Promise<UGCScript | null> {
    const { spec, persona, product, brandVoice, trendingHooks, viralRefs } = params;

    const prompt = `Tu es un expert UGC copywriter spécialisé en contenu organique viral DTC.

PRODUIT :
- Titre: ${product.title}
- Catégorie: ${(product.normalized_data as Record<string, unknown>)?.category ?? 'beauté'}
- Prix: ${(product.normalized_data as Record<string, unknown>)?.price ?? 'N/A'}€
- Bénéfices clés: ${JSON.stringify((product.normalized_data as Record<string, unknown>)?.key_benefits ?? [])}

PERSONA CIBLE :
${JSON.stringify(persona, null, 2)}

BRAND VOICE :
- Ton: ${(brandVoice as Record<string, string>).tone}
- Persona marque: ${(brandVoice as Record<string, string>).persona}
- Interdit: ${JSON.stringify((brandVoice as Record<string, unknown>).forbidden)}

SPECS DU CONTENU :
- Plateforme: ${spec.platform}
- Type: ${spec.script_type}
- Durée cible: ${spec.duration} secondes
- Pilier: ${spec.pillar}

HOOKS PERFORMANTS (inspiration) :
${trendingHooks.slice(0, 5).map(h => `[score ${h.score}] ${h.hook_text}`).join('\n')}

CRÉAS VIRALES RÉCENTES (inspiration format, PAS copie) :
${viralRefs.slice(0, 3).map(v => `${v.hook_text} (${v.source})`).join('\n')}

MISSION : Génère un script UGC ${spec.platform} de ${spec.duration}s, type "${spec.script_type}".
Le hook doit ARRÊTER le scroll dans les 3 premières secondes.
Le script doit être naturel, authentique, PAS corporate.

JSON exact à retourner :
{
  "title": "Titre interne du script",
  "hook": "La première phrase exacte (0-3s) — doit être PERCUTANTE",
  "hook_variants": ["variante A", "variante B", "variante C", "variante D", "variante E"],
  "script_body": "Script complet avec timecodes :\\n[0:00-0:03] Hook: ...\\n[0:03-0:15] ...\\n[0:15-0:40] ...\\n[0:40-0:55] ...\\n[0:55-1:00] CTA: ...",
  "cta": "Call to action final",
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5"],
  "music_mood": "énergie du son recommandé",
  "visual_notes": "Instructions pour le créateur : angle caméra, éclairage, props, transitions",
  "predicted_score": 7.5,
  "hook_score": 8.2,
  "persona_target": "${persona.id}",
  "content_pillar": "${spec.pillar}"
}

Réponds UNIQUEMENT avec le JSON.`;

    const raw = await callLLM(prompt, { max_tokens: 1500, json_mode: true });
    try {
      const parsed = JSON.parse(raw) as UGCScript;
      return {
        ...parsed,
        script_type: spec.script_type,
        platform: spec.platform,
        duration_seconds: spec.duration,
        format: spec.platform === 'pinterest' ? '2:3' : '9:16',
      };
    } catch {
      return null;
    }
  }

  // ════════════════════════════════════════════════════════
  // 4. CALENDRIER ÉDITORIAL
  // Place les scripts dans un calendrier optimisé
  // ════════════════════════════════════════════════════════
  private async buildContentCalendar(task: AgentTask): Promise<AgentResult> {
    if (!task.tenantId) return { success: false, error: 'tenant_id required' };

    const strategy = await db.query(
      `SELECT * FROM intel.organic_strategies WHERE tenant_id=$1 AND status='active' LIMIT 1`,
      [task.tenantId]
    );
    if (!strategy.rows.length) return { success: false, error: 'No active strategy' };
    const strat = strategy.rows[0];
    const platforms: string[] = strat.platforms ?? ['tiktok', 'instagram'];

    // Récupérer les scripts ready non planifiés
    const scripts = await db.query(
      `SELECT id, platform, script_type, predicted_score, persona_target, content_pillar
       FROM intel.ugc_scripts
       WHERE tenant_id=$1 AND status='ready'
         AND id NOT IN (SELECT script_id FROM intel.content_calendar WHERE script_id IS NOT NULL)
       ORDER BY predicted_score DESC LIMIT 60`,
      [task.tenantId]
    );

    if (scripts.rows.length === 0) {
      // Trigger une nouvelle production
      await db.query(
        `INSERT INTO jobs.queue (tenant_id, agent_id, task_type, payload, priority)
         VALUES ($1,'AGENT_STRATEGY_ORGANIC','ugc.batch_production',$2::jsonb,8)`,
        [task.tenantId, JSON.stringify({ batch_size: 20 })]
      );
      return { success: true, output: { scheduled: 0, message: 'Production UGC relancée' } };
    }

    // Calcul des best time slots par plateforme
    const timeSlots: Record<string, string[]> = {
      tiktok:           ['07:00', '12:00', '17:00', '20:00', '22:00'],
      instagram:        ['08:00', '12:30', '17:30', '21:00'],
      instagram_reels:  ['08:00', '12:30', '17:30', '21:00'],
      youtube_shorts:   ['09:00', '15:00', '20:00'],
      pinterest:        ['08:00', '14:00', '20:00'],
    };

    // Fréquences par plateforme (posts/semaine)
    const frequencies: Record<string, number> = {
      tiktok: 7, instagram: 5, instagram_reels: 4, youtube_shorts: 3, pinterest: 10,
    };

    let scheduled = 0;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1); // commence demain
    startDate.setHours(0, 0, 0, 0);

    for (const platform of platforms) {
      const freq = frequencies[platform] ?? 3;
      const slots = timeSlots[platform] ?? ['09:00'];
      const platformScripts = scripts.rows.filter(s => s.platform === platform);
      if (platformScripts.length === 0) continue;

      // Répartir sur 30 jours
      const postsTotal = Math.min(freq * 4, platformScripts.length); // 4 semaines
      const intervalDays = 28 / postsTotal;

      for (let i = 0; i < postsTotal; i++) {
        const script = platformScripts[i % platformScripts.length];
        const date = new Date(startDate);
        date.setDate(date.getDate() + Math.round(i * intervalDays));

        const slot = slots[i % slots.length];
        const [h, m] = slot.split(':').map(Number);
        date.setHours(h, m, 0, 0);

        await db.query(
          `INSERT INTO intel.content_calendar
           (tenant_id, strategy_id, script_id, platform, content_type, title, scheduled_at, best_time_slot)
           VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
           ON CONFLICT DO NOTHING`,
          [
            task.tenantId, strat.id, script.id, platform,
            platform.includes('youtube') ? 'short' : 'ugc_video',
            `${platform} - ${script.content_pillar} - J+${Math.round(i * intervalDays)}`,
            date.toISOString(),
          ]
        );
        scheduled++;

        // Marquer le script comme assigné au calendrier
        await db.query(
          `UPDATE intel.ugc_scripts SET status='assigned' WHERE id=$1`,
          [script.id]
        );
      }
    }

    await this.trace('info', `Calendrier construit: ${scheduled} posts planifiés`, { platforms });

    // Notifier ORCHESTRATOR
    await this.send({
      fromAgent: this.agentId,
      toAgent: 'AGENT_ORCHESTRATOR',
      messageType: 'EVENT',
      subject: `📅 Calendrier éditorial 30 jours prêt — ${scheduled} posts planifiés`,
      payload: { scheduled, platforms, strategyId: strat.id },
      tenantId: task.tenantId,
      priority: 5,
    });

    return { success: true, output: { scheduled, platforms, strategy: strat.name } };
  }

  // ════════════════════════════════════════════════════════
  // 5. REPURPOSING AUTOMATIQUE
  // Un contenu → toutes ses déclinaisons
  // ════════════════════════════════════════════════════════
  private async repurposeContent(task: AgentTask): Promise<AgentResult> {
    if (!task.tenantId) return { success: false, error: 'tenant_id required' };

    // Récupérer les contenus publiés performants non encore repurposés
    const performers = await db.query(
      `SELECT cc.id, cc.script_id, cc.platform, cc.views, cc.engagement_rate,
              us.script_body, us.hook, us.content_pillar
       FROM intel.content_calendar cc
       JOIN intel.ugc_scripts us ON us.id = cc.script_id
       WHERE cc.tenant_id = $1
         AND cc.status = 'published'
         AND cc.views > 5000
         AND cc.script_id NOT IN (
           SELECT source_id FROM intel.repurposing_map WHERE tenant_id = $1
         )
       ORDER BY cc.views DESC LIMIT 10`,
      [task.tenantId]
    );

    const repurposeMap: Record<string, string[]> = {
      tiktok:           ['instagram_reels', 'youtube_shorts', 'pinterest'],
      instagram_reels:  ['tiktok', 'youtube_shorts', 'pinterest'],
      youtube_shorts:   ['tiktok', 'instagram_reels'],
    };

    const types: Record<string, string[]> = {
      'tiktok → instagram_reels':  ['trim_to_30s', 'add_subtitles', 'adjust_aspect_1:1'],
      'tiktok → youtube_shorts':   ['add_subtitles', 'add_end_screen'],
      'tiktok → pinterest':        ['extract_hook', 'pin_format_2:3'],
      'instagram_reels → tiktok':  ['add_text_overlay', 'remove_watermark'],
    };

    let repurposed = 0;
    for (const content of performers.rows) {
      const targets = repurposeMap[content.platform] ?? [];
      for (const targetPlatform of targets) {
        const key = `${content.platform} → ${targetPlatform}`;
        const repurposeTypes = types[key] ?? ['adapt_format'];

        await db.query(
          `INSERT INTO intel.repurposing_map
           (tenant_id, source_id, repurpose_type, target_platform, status)
           VALUES ($1,$2,$3,$4,'queued')`,
          [task.tenantId, content.script_id, repurposeTypes.join('+'), targetPlatform]
        );
        repurposed++;
      }
    }

    // Informer CREATIVE des repurposings à traiter
    if (repurposed > 0) {
      await this.send({
        fromAgent: this.agentId,
        toAgent: 'AGENT_CREATIVE',
        messageType: 'COMMAND',
        subject: `♻️ ${repurposed} repurposings à traiter`,
        payload: {
          count: repurposed, action: 'process_repurposing',
          sources: performers.rows.map(p => ({ id: p.script_id, views: p.views, platform: p.platform }))
        },
        tenantId: task.tenantId,
        priority: 6,
      });
    }

    return { success: true, output: { repurposed, source_pieces: performers.rows.length } };
  }

  // ════════════════════════════════════════════════════════
  // 6. BUILD PERSONAS (déclenché par product.ingested)
  // ════════════════════════════════════════════════════════
  private async buildPersonas(task: AgentTask): Promise<AgentResult> {
    const { productId } = task.input;

    const product = await db.query(
      `SELECT title, normalized_data, market_context FROM store.products WHERE id=$1`,
      [productId as string]
    );
    if (!product.rows.length) return { success: false, error: 'Product not found' };
    const p = product.rows[0];

    const prompt = `Tu es expert en psychologie consommateur et stratégie UGC.

PRODUIT : ${p.title}
CATÉGORIE : ${(p.normalized_data as Record<string, unknown>)?.category}
PRIX : ${(p.normalized_data as Record<string, unknown>)?.price}€
BÉNÉFICES : ${JSON.stringify((p.normalized_data as Record<string, unknown>)?.key_benefits)}
CONTEXTE MARCHÉ : ${JSON.stringify(p.market_context)}

Génère 3 personas ultra-précis pour ce produit.

JSON :
{
  "personas": [
    {
      "id": "persona_1",
      "name": "Prénom réaliste + tag (ex: 'Marie, 34ans, maman active')",
      "age_range": "30-40",
      "pain_points": ["douleur précise 1","douleur précise 2","douleur précise 3"],
      "aspirations": ["aspiration 1","aspiration 2"],
      "content_hooks": ["format contenu qui résonne avec elle","format 2","format 3"],
      "platforms": ["tiktok","instagram"],
      "buying_triggers": ["ce qui la fait acheter 1","ce qui la fait acheter 2"],
      "objections": ["doute 1","doute 2"],
      "discovery_channel": "comment elle découvre les produits",
      "content_consumption": "quel type de contenu elle consomme"
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`;

    const raw = await callLLM(prompt, { max_tokens: 2000, json_mode: true });
    try {
      const data = JSON.parse(raw) as { personas: Persona[] };

      // Mettre à jour la stratégie active avec ces personas
      await db.query(
        `UPDATE intel.organic_strategies
         SET target_personas = $1::jsonb, updated_at = NOW()
         WHERE tenant_id = $2 AND status = 'active'`,
        [JSON.stringify(data.personas), task.tenantId]
      );

      return { success: true, output: { personas: data.personas.length } };
    } catch {
      return { success: false, error: 'Parse failed', retryable: true };
    }
  }

  // ════════════════════════════════════════════════════════
  // 7. REVIEW PERFORMANCE + LEARNING LOOP
  // ════════════════════════════════════════════════════════
  private async reviewPerformance(task: AgentTask): Promise<AgentResult> {
    if (!task.tenantId) return { success: false, error: 'tenant_id required' };

    // Récupérer les perfs de la semaine
    const weekStats = await db.query(
      `SELECT platform, content_type,
              COUNT(*) as posts,
              AVG(views) as avg_views,
              AVG(engagement_rate) as avg_er,
              SUM(follows_gained) as total_follows,
              SUM(revenue_attributed) as total_revenue,
              MAX(views) as best_views
       FROM intel.content_calendar
       WHERE tenant_id=$1
         AND published_at > NOW() - INTERVAL '7 days'
         AND status = 'published'
       GROUP BY platform, content_type`,
      [task.tenantId]
    );

    // Identifier les winners (vues > 2x la moyenne)
    const winners = await db.query(
      `WITH avg_views AS (
         SELECT AVG(views) as mean FROM intel.content_calendar
         WHERE tenant_id=$1 AND status='published'
           AND published_at > NOW() - INTERVAL '30 days'
       )
       SELECT cc.id, cc.platform, cc.views, cc.engagement_rate, cc.follows_gained,
              us.hook, us.script_type, us.content_pillar, us.persona_target
       FROM intel.content_calendar cc
       JOIN intel.ugc_scripts us ON us.id = cc.script_id
       CROSS JOIN avg_views
       WHERE cc.tenant_id=$1
         AND cc.status='published'
         AND cc.views > avg_views.mean * 2
         AND cc.published_at > NOW() - INTERVAL '7 days'
       ORDER BY cc.views DESC`,
      [task.tenantId]
    );

    // Envoyer les patterns gagnants à AGENT_LEARNING
    if (winners.rows.length > 0) {
      await this.send({
        fromAgent: this.agentId,
        toAgent: 'AGENT_LEARNING',
        messageType: 'DATA_PUSH',
        subject: `📈 ${winners.rows.length} contenus organiques gagnants — extraction patterns`,
        payload: {
          winners: winners.rows,
          period: '7d',
          type: 'organic_content',
        },
        tenantId: task.tenantId,
        priority: 6,
      });

      // Sauvegarder les hooks gagnants dans la bibliothèque
      for (const w of winners.rows) {
        await db.query(
          `INSERT INTO intel.hook_library
           (tenant_id, hook_text, hook_type, platform, avg_view_rate, usage_count, score, source)
           VALUES ($1,$2,'tested',$3,$4,1,$5,'tested')
           ON CONFLICT DO NOTHING`,
          [
            task.tenantId, w.hook, w.platform,
            Math.min(w.views / 100000, 1), // normalise en taux
            Math.min(10, (w.views / 10000) * 7 + (w.engagement_rate ?? 0) * 3),
          ]
        );
      }
    }

    // Signal vers MEDIA_BUYER : contenus organiques à booster
    const boostCandidates = winners.rows.filter(w => w.views > 10000);
    if (boostCandidates.length > 0) {
      await this.send({
        fromAgent: this.agentId,
        toAgent: 'AGENT_MEDIA_BUYER',
        messageType: 'COMMAND',
        subject: `🚀 ${boostCandidates.length} contenus organiques à promouvoir en dark post`,
        payload: {
          candidates: boostCandidates.map(c => ({
            calendar_id: c.id,
            platform: c.platform,
            views: c.views,
            engagement_rate: c.engagement_rate,
            recommendation: 'Booster avec budget 20-50€/j — contenu organique validé',
          })),
          action: 'create_dark_posts',
        },
        tenantId: task.tenantId,
        priority: 8,
      });
    }

    // Rapport vers ORCHESTRATOR
    await this.send({
      fromAgent: this.agentId,
      toAgent: 'AGENT_ORCHESTRATOR',
      messageType: 'DATA_PUSH',
      subject: '📊 Weekly Organic Report',
      payload: { weekStats: weekStats.rows, winners: winners.rows.length, boostCandidates: boostCandidates.length },
      tenantId: task.tenantId,
      priority: 4,
    });

    return {
      success: true,
      output: {
        platforms_reviewed: weekStats.rows.length,
        winners_detected: winners.rows.length,
        boost_candidates: boostCandidates.length,
        stats: weekStats.rows,
      }
    };
  }

  // ════════════════════════════════════════════════════════
  // 8. GROWTH LOOP — Réagir aux viraux du MARKET_INTEL
  // ════════════════════════════════════════════════════════
  private async growthLoop(task: AgentTask): Promise<AgentResult> {
    // Lire l'intel feed pour les nouveaux signaux
    const feed = await this.readIntelFeed(task.tenantId, 20);
    const viralSignals = (feed as Array<{
      feed_type: string;
      data_refs: string[];
      title: string;
      action_hint: string;
    }>).filter(f => ['viral_creative', 'breakout_keyword', 'tiktok_trend'].includes(f.feed_type));

    if (viralSignals.length === 0) return { success: true, output: { loops_triggered: 0 } };

    let triggered = 0;
    for (const signal of viralSignals.slice(0, 5)) {
      // Générer un script rapide qui surfe sur le trend
      await db.query(
        `INSERT INTO jobs.queue (tenant_id, agent_id, task_type, payload, priority)
         VALUES ($1,'AGENT_STRATEGY_ORGANIC','ugc.generate_scripts',$2::jsonb,9)`,
        [
          task.tenantId,
          JSON.stringify({
            platform: 'tiktok',
            script_type: 'trend_hijack',
            viral_ref: signal,
            urgency: 'high',
            note: `Surfer sur: ${signal.title}`,
          })
        ]
      );
      triggered++;
    }

    await this.trace('info', `Growth loop: ${triggered} trend scripts lancés`, {});
    return { success: true, output: { loops_triggered: triggered } };
  }

  // ════════════════════════════════════════════════════════
  // 9. DÉFINIR LA BRAND VOICE
  // ════════════════════════════════════════════════════════
  private async defineBrandVoice(task: AgentTask): Promise<AgentResult> {
    const { reference_brands, adjectives, anti_patterns } = task.input;

    const prompt = `Tu es expert en brand identity et content marketing.

Marques de référence: ${JSON.stringify(reference_brands ?? [])}
Adjectifs souhaités: ${JSON.stringify(adjectives ?? [])}
À éviter absolument: ${JSON.stringify(anti_patterns ?? [])}

Génère une brand voice complète en JSON :
{
  "tone": "3 mots clés séparés par virgule",
  "persona": "L'archétype de la marque en 1 phrase (ex: le coach bienveillant qui dit la vérité)",
  "voice_attributes": ["attribut 1","attribut 2","attribut 3","attribut 4"],
  "sentence_style": "description du style de phrase (ex: courtes, directes, avec questions rhétoriques)",
  "vocabulary": {"use":["mot 1","mot 2","mot 3"],"avoid":["mot 4","mot 5","mot 6"]},
  "forbidden": ["comportement à éviter 1","comportement 2","comportement 3"],
  "pillars": ["pilier éditorial 1","pilier 2","pilier 3","pilier 4"],
  "examples": {
    "good": "Exemple de phrase dans le ton",
    "bad": "Exemple de phrase à éviter et pourquoi"
  }
}

Réponds UNIQUEMENT avec le JSON.`;

    const raw = await callLLM(prompt, { max_tokens: 1000, json_mode: true });
    try {
      const brandVoice = JSON.parse(raw);
      await db.query(
        `UPDATE intel.organic_strategies
         SET brand_voice = $1::jsonb, updated_at = NOW()
         WHERE tenant_id = $2 AND status = 'active'`,
        [JSON.stringify(brandVoice), task.tenantId]
      );
      return { success: true, output: { brand_voice: brandVoice } };
    } catch {
      return { success: false, error: 'Parse failed', retryable: true };
    }
  }

  // ─── Handle messages entrants ────────────────────────────
  private async handleMessage(task: AgentTask): Promise<AgentResult> {
    const { fromAgent, messageType, payload } = task.input as {
      fromAgent: string; messageType: string; payload: Record<string, unknown>;
    };

    // MARKET_INTEL → viral détecté → générer script trend-hijack
    if (fromAgent === 'AGENT_MARKET_INTEL' && (payload.feedType === 'viral_creative' || payload.feedType === 'breakout_keyword')) {
      return this.growthLoop({ ...task, input: { ...task.input, signal: payload } });
    }

    // ORCHESTRATOR → nouveau produit ingéré
    if (fromAgent === 'AGENT_ORCHESTRATOR' && (payload.action === 'new_product' || payload.trigger === 'product.ingested')) {
      return this.buildPersonas({ ...task, input: { productId: payload.productId } });
    }

    // ANALYTICS → performance données disponibles
    if (fromAgent === 'AGENT_ANALYTICS' && messageType === 'DATA_PUSH') {
      return this.reviewPerformance(task);
    }

    return { success: true, output: { handled: false } };
  }

  // ─── Helper : construire le mix de types de scripts ──────
  private buildScriptMix(
    total: number,
    pillars: string[],
    platforms: string[]
  ): Array<{ platform: string; script_type: string; duration: number; pillar: string }> {
    const types = [
      'hook_reel', 'transformation', 'ingredient_focus', 'objection_killer',
      'social_proof', 'routine_hack', 'educational', 'storytime', 'day_in_life',
    ];
    const durations: Record<string, number[]> = {
      tiktok: [15, 30, 60], instagram: [30, 60], youtube_shorts: [60], pinterest: [15],
    };

    return Array.from({ length: total }, (_, i) => {
      const platform = platforms[i % platforms.length] ?? 'tiktok';
      const platformDurations = durations[platform] ?? [30];
      return {
        platform,
        script_type: types[i % types.length],
        duration: platformDurations[i % platformDurations.length],
        pillar: pillars[i % pillars.length] ?? 'Éducation',
      };
    });
  }
}
