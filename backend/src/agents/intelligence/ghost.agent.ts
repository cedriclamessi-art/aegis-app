/**
 * AGENT_GHOST — Analyse Invisible & Détection Silencieuse
 * ═══════════════════════════════════════════════════════════
 *
 * MISSION : Observer sans être vu. Détecter ce que personne ne cherche.
 *
 * GHOST est l'agent d'observation silencieuse d'AEGIS.
 * Il ne crée rien. Il ne modifie rien. Il n'alerte pas directement l'utilisateur.
 * Il observe, analyse, et dépose ses découvertes dans la mémoire du système
 * pour que les autres agents puissent agir.
 *
 * ── 4 MODES D'OBSERVATION ──────────────────────────────────────────
 *
 * 1. PERFORMANCE GHOST
 *    Observe les micro-tendances invisibles dans les données :
 *    - Baisse progressive du CTR sur 7 jours (avant que ça devienne critique)
 *    - Augmentation lente du CPA (fatigue créative silencieuse)
 *    - Changement de pattern dans les heures de conversion
 *    - Dégradation du taux de repeat purchase
 *
 * 2. COMPETITOR GHOST
 *    Surveillance furtive de la concurrence :
 *    - Nouvelles créatives lancées par les concurrents
 *    - Changements de prix détectés
 *    - Nouveaux produits apparus dans la niche
 *    - Variations de dépense publicitaire estimée
 *
 * 3. BEHAVIOR GHOST
 *    Analyse invisible du comportement utilisateur :
 *    - Pages les plus visitées avant conversion
 *    - Points de friction dans le funnel (abandon)
 *    - Segments clients silencieux (n'achètent plus sans raison apparente)
 *    - Patterns saisonniers émergents
 *
 * 4. OPPORTUNITY GHOST
 *    Détection d'opportunités non exploitées :
 *    - Produits complémentaires potentiels
 *    - Audiences sous-exploitées
 *    - Canaux non testés avec potentiel
 *    - Créneaux horaires non couverts
 *
 * PHILOSOPHIE :
 *   GHOST ne déclenche jamais d'action directe.
 *   Il écrit dans agent_memory avec memory_type = 'ghost_signal'.
 *   Les autres agents lisent ces signaux et décident d'agir.
 *   Un ghost_signal non lu après 48h est escaladé vers la Morning Brief.
 */

import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import Anthropic from '@anthropic-ai/sdk';

// ── Types ────────────────────────────────────────────────────────────────

export type GhostMode = 'performance' | 'competitor' | 'behavior' | 'opportunity';

export interface GhostSignal {
  id:           string;
  mode:         GhostMode;
  severity:     'whisper' | 'murmur' | 'alert';
  // whisper = observation subtile, peut attendre
  // murmur  = pattern confirmé sur 3+ jours, à considérer
  // alert   = signal fort, nécessite attention dans les 24h
  category:     string;
  title:        string;
  observation:  string;
  evidence:     GhostEvidence[];
  suggestion:   string;
  targetAgent:  string;        // Quel agent devrait réagir
  confidence:   number;        // 0-1
  detectedAt:   string;
  expiresAt:    string;
}

export interface GhostEvidence {
  metric:       string;
  baseline:     number;
  current:      number;
  delta_pct:    number;
  period:       string;        // "7d" | "14d" | "30d"
  trend:        'improving' | 'stable' | 'declining';
}

export interface GhostReport {
  shopId:       string;
  mode:         GhostMode;
  signals:      GhostSignal[];
  scanDuration: number;
  scannedAt:    string;
}

// ── Agent Implementation ─────────────────────────────────────────────────

export class AgentGhost extends BaseAgent {
  readonly name = 'AGENT_GHOST';
  private claude: Anthropic;

  constructor(db: Pool, redis: Redis) {
    super(db, redis);
    this.claude = new Anthropic();
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'full_scan':       return this.fullScan(task);
      case 'performance':     return this.scanPerformance(task);
      case 'competitor':      return this.scanCompetitor(task);
      case 'behavior':        return this.scanBehavior(task);
      case 'opportunity':     return this.scanOpportunity(task);
      case 'get_signals':     return this.getActiveSignals(task);
      case 'escalate':        return this.escalateStaleSignals(task);
      default: throw new Error(`GHOST: Unknown task type: ${task.type}`);
    }
  }

  // ── Full Scan ──────────────────────────────────────────────────────────
  // Runs all 4 ghost modes in sequence. Typically triggered daily at 4am.

  private async fullScan(task: AgentTask): Promise<AgentResult> {
    const start   = Date.now();
    const shopId  = task.shop_id;
    const signals: GhostSignal[] = [];

    // Run all 4 modes
    const modes: GhostMode[] = ['performance', 'competitor', 'behavior', 'opportunity'];
    for (const mode of modes) {
      try {
        const modeSignals = await this.runGhostMode(shopId, mode);
        signals.push(...modeSignals);
      } catch (err) {
        // Ghost never fails globally — log and continue
        console.warn(`[GHOST] Mode ${mode} failed for ${shopId}:`, (err as Error).message);
      }
    }

    // Persist signals to memory
    for (const signal of signals) {
      await this.remember(shopId, {
        memory_key:  `ghost_${signal.mode}_${signal.id}`,
        memory_type: 'ghost_signal',
        value:       signal,
        ttl_hours:   signal.severity === 'alert' ? 48 : signal.severity === 'murmur' ? 96 : 168,
      });
    }

    const report: GhostReport = {
      shopId,
      mode:         'performance', // full scan
      signals,
      scanDuration: Date.now() - start,
      scannedAt:    new Date().toISOString(),
    };

    // Emit event for other agents to pick up
    if (signals.length > 0) {
      await this.emit('ghost:signals_detected', {
        shop_id:      shopId,
        signal_count: signals.length,
        severities:   {
          whisper: signals.filter(s => s.severity === 'whisper').length,
          murmur:  signals.filter(s => s.severity === 'murmur').length,
          alert:   signals.filter(s => s.severity === 'alert').length,
        },
      });
    }

    return { success: true, data: report };
  }

  // ── Mode Router ────────────────────────────────────────────────────────

  private async runGhostMode(shopId: string, mode: GhostMode): Promise<GhostSignal[]> {
    switch (mode) {
      case 'performance':  return this.detectPerformanceSignals(shopId);
      case 'competitor':   return this.detectCompetitorSignals(shopId);
      case 'behavior':     return this.detectBehaviorSignals(shopId);
      case 'opportunity':  return this.detectOpportunitySignals(shopId);
    }
  }

  // ── 1. PERFORMANCE GHOST ───────────────────────────────────────────────

  private async detectPerformanceSignals(shopId: string): Promise<GhostSignal[]> {
    const signals: GhostSignal[] = [];

    // Detect slow CTR degradation (invisible to daily monitoring)
    const { rows: ctrTrend } = await this.db.query(`
      SELECT
        date_trunc('day', recorded_at) AS day,
        AVG(ctr) AS avg_ctr
      FROM ad_metrics
      WHERE shop_id = $1
        AND recorded_at > NOW() - INTERVAL '14 days'
      GROUP BY day
      ORDER BY day`, [shopId]);

    if (ctrTrend.length >= 7) {
      const recentAvg = ctrTrend.slice(-3).reduce((s: number, r: any) => s + parseFloat(r.avg_ctr || 0), 0) / 3;
      const olderAvg  = ctrTrend.slice(0, 3).reduce((s: number, r: any) => s + parseFloat(r.avg_ctr || 0), 0) / 3;
      const deltaPct  = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;

      if (deltaPct < -10) {
        signals.push(this.buildSignal('performance', {
          severity:    deltaPct < -25 ? 'alert' : 'murmur',
          category:    'ctr_erosion',
          title:       'Érosion silencieuse du CTR',
          observation: `Le CTR moyen a baissé de ${Math.abs(deltaPct).toFixed(1)}% sur 14 jours (${olderAvg.toFixed(2)}% → ${recentAvg.toFixed(2)}%).`,
          evidence:    [{
            metric: 'ctr', baseline: olderAvg, current: recentAvg,
            delta_pct: deltaPct, period: '14d', trend: 'declining',
          }],
          suggestion:  'Rafraîchir les créatives publicitaires. Les hooks actuels fatiguent.',
          targetAgent: 'AGENT_DCT_ITERATION',
          confidence:  Math.min(0.95, 0.6 + Math.abs(deltaPct) / 100),
        }));
      }
    }

    // Detect CPA creep (slow increase)
    const { rows: cpaTrend } = await this.db.query(`
      SELECT
        date_trunc('day', recorded_at) AS day,
        AVG(cpa) AS avg_cpa
      FROM ad_metrics
      WHERE shop_id = $1
        AND recorded_at > NOW() - INTERVAL '14 days'
        AND cpa > 0
      GROUP BY day
      ORDER BY day`, [shopId]);

    if (cpaTrend.length >= 7) {
      const recentCpa = cpaTrend.slice(-3).reduce((s: number, r: any) => s + parseFloat(r.avg_cpa || 0), 0) / 3;
      const olderCpa  = cpaTrend.slice(0, 3).reduce((s: number, r: any) => s + parseFloat(r.avg_cpa || 0), 0) / 3;
      const cpaDelta  = olderCpa > 0 ? ((recentCpa - olderCpa) / olderCpa) * 100 : 0;

      if (cpaDelta > 15) {
        signals.push(this.buildSignal('performance', {
          severity:    cpaDelta > 30 ? 'alert' : 'murmur',
          category:    'cpa_creep',
          title:       'Augmentation progressive du CPA',
          observation: `Le CPA a augmenté de ${cpaDelta.toFixed(1)}% sur 14 jours (${olderCpa.toFixed(2)}€ → ${recentCpa.toFixed(2)}€).`,
          evidence:    [{
            metric: 'cpa', baseline: olderCpa, current: recentCpa,
            delta_pct: cpaDelta, period: '14d', trend: 'declining',
          }],
          suggestion:  'Tester de nouveaux audiences ou réduire la fréquence.',
          targetAgent: 'AGENT_SCALE',
          confidence:  Math.min(0.95, 0.6 + cpaDelta / 100),
        }));
      }
    }

    // Detect conversion time shift
    const { rows: convHours } = await this.db.query(`
      SELECT
        EXTRACT(HOUR FROM recorded_at) AS hour,
        SUM(conversions) AS total_conv,
        CASE
          WHEN recorded_at > NOW() - INTERVAL '7 days' THEN 'recent'
          ELSE 'older'
        END AS period
      FROM ad_metrics
      WHERE shop_id = $1
        AND recorded_at > NOW() - INTERVAL '14 days'
        AND conversions > 0
      GROUP BY hour, period`, [shopId]);

    if (convHours.length > 10) {
      const recentHours = convHours.filter((r: any) => r.period === 'recent');
      const olderHours  = convHours.filter((r: any) => r.period === 'older');

      const peakRecent = recentHours.sort((a: any, b: any) => b.total_conv - a.total_conv)[0];
      const peakOlder  = olderHours.sort((a: any, b: any) => b.total_conv - a.total_conv)[0];

      if (peakRecent && peakOlder && Math.abs(peakRecent.hour - peakOlder.hour) >= 3) {
        signals.push(this.buildSignal('performance', {
          severity:    'whisper',
          category:    'conversion_time_shift',
          title:       'Changement d\'heure de pointe des conversions',
          observation: `Le pic de conversions a migré de ${peakOlder.hour}h à ${peakRecent.hour}h.`,
          evidence:    [{
            metric: 'peak_conversion_hour', baseline: peakOlder.hour, current: peakRecent.hour,
            delta_pct: 0, period: '14d', trend: 'stable',
          }],
          suggestion:  'Ajuster le dayparting pour concentrer le budget sur les nouvelles heures de pointe.',
          targetAgent: 'AGENT_DAYPARTING',
          confidence:  0.65,
        }));
      }
    }

    return signals;
  }

  // ── 2. COMPETITOR GHOST ────────────────────────────────────────────────

  private async detectCompetitorSignals(shopId: string): Promise<GhostSignal[]> {
    const signals: GhostSignal[] = [];

    // Check intel patterns for competitor changes
    const { rows: recentIntel } = await this.db.query(`
      SELECT * FROM intel_signals
      WHERE shop_id = $1
        AND created_at > NOW() - INTERVAL '7 days'
        AND signal_type IN ('competitor_new_ad', 'competitor_price_change', 'competitor_new_product')
      ORDER BY created_at DESC
      LIMIT 20`, [shopId]);

    // New competitor ads detected
    const newAds = recentIntel.filter((r: any) => r.signal_type === 'competitor_new_ad');
    if (newAds.length >= 5) {
      signals.push(this.buildSignal('competitor', {
        severity:    newAds.length >= 10 ? 'alert' : 'murmur',
        category:    'competitor_ad_surge',
        title:       `${newAds.length} nouvelles pubs concurrentes cette semaine`,
        observation: `Activité publicitaire en hausse chez les concurrents : ${newAds.length} nouvelles créatives détectées en 7 jours.`,
        evidence:    [{
          metric: 'competitor_new_ads', baseline: 2, current: newAds.length,
          delta_pct: ((newAds.length - 2) / 2) * 100, period: '7d', trend: 'declining',
        }],
        suggestion:  'Analyser les angles utilisés par la concurrence. Préparer des contre-créatives.',
        targetAgent: 'AGENT_COMPETITIVE_INTEL',
        confidence:  0.80,
      }));
    }

    // Price drops from competitors
    const priceChanges = recentIntel.filter((r: any) => r.signal_type === 'competitor_price_change');
    if (priceChanges.length > 0) {
      const avgDrop = priceChanges.reduce((s: number, r: any) =>
        s + (parseFloat(r.payload?.delta_pct || 0)), 0) / priceChanges.length;

      if (avgDrop < -10) {
        signals.push(this.buildSignal('competitor', {
          severity:    'alert',
          category:    'competitor_price_war',
          title:       'Guerre des prix détectée',
          observation: `${priceChanges.length} concurrent(s) ont baissé leur prix de ${Math.abs(avgDrop).toFixed(1)}% en moyenne.`,
          evidence:    [{
            metric: 'competitor_avg_price_change', baseline: 0, current: avgDrop,
            delta_pct: avgDrop, period: '7d', trend: 'declining',
          }],
          suggestion:  'Renforcer la proposition de valeur (offre, bonus, garantie) plutôt que baisser les prix.',
          targetAgent: 'AGENT_PRICING',
          confidence:  0.85,
        }));
      }
    }

    return signals;
  }

  // ── 3. BEHAVIOR GHOST ──────────────────────────────────────────────────

  private async detectBehaviorSignals(shopId: string): Promise<GhostSignal[]> {
    const signals: GhostSignal[] = [];

    // Detect abandoned cart spike
    const { rows: cartData } = await this.db.query(`
      SELECT
        date_trunc('day', recorded_at) AS day,
        SUM(add_to_cart) AS atc,
        SUM(purchases) AS purchases
      FROM funnel_metrics
      WHERE shop_id = $1
        AND recorded_at > NOW() - INTERVAL '14 days'
      GROUP BY day
      ORDER BY day`, [shopId]);

    if (cartData.length >= 7) {
      const recentConvRate = cartData.slice(-3).reduce((s: number, r: any) => {
        const atc = parseInt(r.atc || 0);
        return s + (atc > 0 ? parseInt(r.purchases || 0) / atc : 0);
      }, 0) / 3;

      const olderConvRate = cartData.slice(0, 3).reduce((s: number, r: any) => {
        const atc = parseInt(r.atc || 0);
        return s + (atc > 0 ? parseInt(r.purchases || 0) / atc : 0);
      }, 0) / 3;

      const convDelta = olderConvRate > 0 ? ((recentConvRate - olderConvRate) / olderConvRate) * 100 : 0;

      if (convDelta < -15) {
        signals.push(this.buildSignal('behavior', {
          severity:    convDelta < -30 ? 'alert' : 'murmur',
          category:    'cart_abandonment_spike',
          title:       'Hausse des abandons panier',
          observation: `Le taux ATC→Purchase a baissé de ${Math.abs(convDelta).toFixed(1)}% (${(olderConvRate * 100).toFixed(1)}% → ${(recentConvRate * 100).toFixed(1)}%).`,
          evidence:    [{
            metric: 'atc_to_purchase_rate', baseline: olderConvRate, current: recentConvRate,
            delta_pct: convDelta, period: '14d', trend: 'declining',
          }],
          suggestion:  'Vérifier le checkout (frais cachés ? délai livraison ?). Activer email recovery si pas déjà fait.',
          targetAgent: 'AGENT_EMAIL_RECOVERY',
          confidence:  Math.min(0.90, 0.6 + Math.abs(convDelta) / 100),
        }));
      }
    }

    // Detect silent churn (customers who haven't returned)
    const { rows: churnData } = await this.db.query(`
      SELECT COUNT(*) AS silent_churners
      FROM customers
      WHERE shop_id = $1
        AND last_purchase_at < NOW() - INTERVAL '60 days'
        AND last_purchase_at > NOW() - INTERVAL '120 days'
        AND total_orders >= 2`, [shopId]);

    const silentChurners = parseInt(churnData[0]?.silent_churners || 0);
    if (silentChurners > 10) {
      signals.push(this.buildSignal('behavior', {
        severity:    silentChurners > 50 ? 'alert' : silentChurners > 25 ? 'murmur' : 'whisper',
        category:    'silent_churn',
        title:       `${silentChurners} clients fidèles silencieux`,
        observation: `${silentChurners} clients avec 2+ commandes n'ont pas acheté depuis 60-120 jours.`,
        evidence:    [{
          metric: 'silent_churners', baseline: 0, current: silentChurners,
          delta_pct: 0, period: '60d', trend: 'declining',
        }],
        suggestion:  'Lancer une campagne de réactivation ciblée (email + retargeting).',
        targetAgent: 'AGENT_KLAVIYO',
        confidence:  0.75,
      }));
    }

    return signals;
  }

  // ── 4. OPPORTUNITY GHOST ───────────────────────────────────────────────

  private async detectOpportunitySignals(shopId: string): Promise<GhostSignal[]> {
    const signals: GhostSignal[] = [];

    // Detect under-utilized channels
    const { rows: channelData } = await this.db.query(`
      SELECT
        channel,
        SUM(revenue) AS total_revenue,
        SUM(spend) AS total_spend,
        AVG(roas) AS avg_roas
      FROM channel_performance
      WHERE shop_id = $1
        AND recorded_at > NOW() - INTERVAL '30 days'
      GROUP BY channel`, [shopId]);

    const totalRevenue = channelData.reduce((s: number, r: any) => s + parseFloat(r.total_revenue || 0), 0);

    for (const ch of channelData) {
      const chRevPct = totalRevenue > 0 ? (parseFloat(ch.total_revenue || 0) / totalRevenue) * 100 : 0;
      const chRoas   = parseFloat(ch.avg_roas || 0);

      // High ROAS but low share = under-exploited channel
      if (chRoas > 3.0 && chRevPct < 15) {
        signals.push(this.buildSignal('opportunity', {
          severity:    'murmur',
          category:    'underutilized_channel',
          title:       `Canal ${ch.channel} sous-exploité (ROAS ${chRoas.toFixed(1)}×)`,
          observation: `${ch.channel} a un ROAS de ${chRoas.toFixed(1)}× mais ne représente que ${chRevPct.toFixed(1)}% du CA.`,
          evidence:    [{
            metric: 'channel_roas', baseline: 2.0, current: chRoas,
            delta_pct: ((chRoas - 2.0) / 2.0) * 100, period: '30d', trend: 'improving',
          }],
          suggestion:  `Augmenter le budget sur ${ch.channel}. Le ROAS supporte un scaling.`,
          targetAgent: 'AGENT_BUDGET_OPTIMIZER',
          confidence:  0.80,
        }));
      }
    }

    // Detect AOV improvement opportunity
    const { rows: aovData } = await this.db.query(`
      SELECT
        AVG(order_value) AS avg_aov,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY order_value) AS p75_aov
      FROM orders
      WHERE shop_id = $1
        AND created_at > NOW() - INTERVAL '30 days'`, [shopId]);

    if (aovData[0]?.avg_aov && aovData[0]?.p75_aov) {
      const avgAov = parseFloat(aovData[0].avg_aov);
      const p75Aov = parseFloat(aovData[0].p75_aov);
      const upliftPotential = ((p75Aov - avgAov) / avgAov) * 100;

      if (upliftPotential > 20) {
        signals.push(this.buildSignal('opportunity', {
          severity:    'murmur',
          category:    'aov_uplift_potential',
          title:       `Potentiel AOV +${upliftPotential.toFixed(0)}%`,
          observation: `AOV moyen : ${avgAov.toFixed(2)}€. 25% des commandes sont à ${p75Aov.toFixed(2)}€+. Potentiel de +${upliftPotential.toFixed(0)}%.`,
          evidence:    [{
            metric: 'aov', baseline: avgAov, current: p75Aov,
            delta_pct: upliftPotential, period: '30d', trend: 'stable',
          }],
          suggestion:  'Tester des upsells, bundles ou seuil de livraison gratuite.',
          targetAgent: 'AGENT_AOV',
          confidence:  0.70,
        }));
      }
    }

    // Use Claude to find non-obvious opportunities
    try {
      const worldState = await this.db.query(
        `SELECT * FROM world_state WHERE shop_id = $1`, [shopId]);

      if (worldState.rows[0]) {
        const ws = worldState.rows[0];
        const resp = await this.claude.messages.create({
          model:      'claude-sonnet-4-5',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: `AEGIS GHOST mode. Shop ${shopId}.
Empire Index: ${ws.empire_index}/100. ROAS 24h: ${ws.roas_24h}×. Spend: ${ws.spend_24h}€. Active ads: ${ws.active_ads}.
Channels: ${JSON.stringify(channelData.map((c: any) => ({ ch: c.channel, rev: c.total_revenue, roas: c.avg_roas })))}.

En tant qu'analyste invisible, identifie UNE opportunité non évidente que les agents spécialisés pourraient manquer.
Réponds en JSON : {"title": "...", "observation": "...", "suggestion": "...", "targetAgent": "...", "confidence": 0.X}`
          }],
        });

        const text = (resp.content[0] as { text: string }).text;
        try {
          const opp = JSON.parse(text);
          if (opp.title && opp.observation) {
            signals.push(this.buildSignal('opportunity', {
              severity:    'whisper',
              category:    'ai_detected_opportunity',
              title:       opp.title,
              observation: opp.observation,
              evidence:    [],
              suggestion:  opp.suggestion || 'À analyser',
              targetAgent: opp.targetAgent || 'AGENT_STRATEGIES',
              confidence:  Math.min(0.85, parseFloat(opp.confidence || 0.6)),
            }));
          }
        } catch { /* JSON parse failed, skip AI signal */ }
      }
    } catch { /* Claude unavailable, continue without AI signal */ }

    return signals;
  }

  // ── Mode-specific scan wrappers ────────────────────────────────────────

  private async scanPerformance(task: AgentTask): Promise<AgentResult> {
    const signals = await this.detectPerformanceSignals(task.shop_id);
    for (const s of signals) {
      await this.remember(task.shop_id, {
        memory_key: `ghost_performance_${s.id}`, memory_type: 'ghost_signal',
        value: s, ttl_hours: s.severity === 'alert' ? 48 : 96,
      });
    }
    return { success: true, data: { signals, mode: 'performance' } };
  }

  private async scanCompetitor(task: AgentTask): Promise<AgentResult> {
    const signals = await this.detectCompetitorSignals(task.shop_id);
    for (const s of signals) {
      await this.remember(task.shop_id, {
        memory_key: `ghost_competitor_${s.id}`, memory_type: 'ghost_signal',
        value: s, ttl_hours: s.severity === 'alert' ? 48 : 96,
      });
    }
    return { success: true, data: { signals, mode: 'competitor' } };
  }

  private async scanBehavior(task: AgentTask): Promise<AgentResult> {
    const signals = await this.detectBehaviorSignals(task.shop_id);
    for (const s of signals) {
      await this.remember(task.shop_id, {
        memory_key: `ghost_behavior_${s.id}`, memory_type: 'ghost_signal',
        value: s, ttl_hours: s.severity === 'alert' ? 48 : 96,
      });
    }
    return { success: true, data: { signals, mode: 'behavior' } };
  }

  private async scanOpportunity(task: AgentTask): Promise<AgentResult> {
    const signals = await this.detectOpportunitySignals(task.shop_id);
    for (const s of signals) {
      await this.remember(task.shop_id, {
        memory_key: `ghost_opportunity_${s.id}`, memory_type: 'ghost_signal',
        value: s, ttl_hours: s.severity === 'alert' ? 48 : 168,
      });
    }
    return { success: true, data: { signals, mode: 'opportunity' } };
  }

  // ── Get Active Signals ─────────────────────────────────────────────────

  private async getActiveSignals(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT memory_key, value, created_at, expires_at
      FROM agent_memory
      WHERE shop_id = $1
        AND memory_type = 'ghost_signal'
        AND expires_at > NOW()
      ORDER BY created_at DESC`, [task.shop_id]);

    const signals = rows.map((r: any) => ({
      ...(typeof r.value === 'string' ? JSON.parse(r.value) : r.value),
      memoryKey:  r.memory_key,
      createdAt:  r.created_at,
      expiresAt:  r.expires_at,
    }));

    return {
      success: true,
      data: {
        total:    signals.length,
        alerts:   signals.filter((s: any) => s.severity === 'alert'),
        murmurs:  signals.filter((s: any) => s.severity === 'murmur'),
        whispers: signals.filter((s: any) => s.severity === 'whisper'),
      },
    };
  }

  // ── Escalate Stale Signals ─────────────────────────────────────────────
  // Signals unread for 48h get pushed to Morning Brief

  private async escalateStaleSignals(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT memory_key, value, created_at
      FROM agent_memory
      WHERE shop_id = $1
        AND memory_type = 'ghost_signal'
        AND created_at < NOW() - INTERVAL '48 hours'
        AND expires_at > NOW()
        AND NOT (value->>'escalated')::boolean`, [task.shop_id]);

    const escalated: string[] = [];
    for (const row of rows) {
      const signal = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      if (signal.severity !== 'whisper') {
        // Mark as escalated
        signal.escalated = true;
        await this.db.query(`
          UPDATE agent_memory SET value = $1
          WHERE shop_id = $2 AND memory_key = $3`,
          [JSON.stringify(signal), task.shop_id, row.memory_key]);

        // Emit for Morning Brief
        await this.emit('ghost:escalated', {
          shop_id: task.shop_id,
          signal,
          reason: 'Signal non traité depuis 48h',
        });

        escalated.push(signal.title);
      }
    }

    return { success: true, data: { escalated_count: escalated.length, escalated } };
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private buildSignal(mode: GhostMode, params: {
    severity: 'whisper' | 'murmur' | 'alert';
    category: string;
    title: string;
    observation: string;
    evidence: GhostEvidence[];
    suggestion: string;
    targetAgent: string;
    confidence: number;
  }): GhostSignal {
    const id = `${mode}_${params.category}_${Date.now()}`;
    return {
      id,
      mode,
      severity:    params.severity,
      category:    params.category,
      title:       params.title,
      observation: params.observation,
      evidence:    params.evidence,
      suggestion:  params.suggestion,
      targetAgent: params.targetAgent,
      confidence:  params.confidence,
      detectedAt:  new Date().toISOString(),
      expiresAt:   new Date(Date.now() + (
        params.severity === 'alert' ? 48 * 3600000 :
        params.severity === 'murmur' ? 96 * 3600000 : 168 * 3600000
      )).toISOString(),
    };
  }
}
