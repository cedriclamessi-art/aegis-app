/**
 * WorldStateService — AEGIS v3.5
 * Runs every 15 minutes. Consolidates all active agent memories
 * into a single world_state row per shop.
 * All agents read world_state before making decisions.
 */

import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { EmpireMode, RiskLevel, WorldState } from '../base/agent.base';
import Anthropic from '@anthropic-ai/sdk';

interface RawMemory {
  agent_name:  string;
  memory_key:  string;
  memory_type: string;
  value:       unknown;
  confidence:  number;
}

export class WorldStateService {
  private db:     Pool;
  private redis:  Redis;
  private claude: Anthropic;

  constructor(db: Pool, redis: Redis) {
    this.db     = db;
    this.redis  = redis;
    this.claude = new Anthropic();
  }

  /**
   * Consolidate all active agent memories into world_state for a shop.
   * Called by AGENT_ORCHESTRATOR every 15 minutes.
   */
  async consolidate(shopId: string): Promise<WorldState> {
    // 1. Fetch all non-expired memories
    const { rows: memories } = await this.db.query<RawMemory>(
      `SELECT agent_name, memory_key, memory_type, value, confidence
       FROM agent_memory
       WHERE shop_id = $1 AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [shopId]
    );

    // 2. Fetch current metrics from DB
    const { rows: metrics } = await this.db.query(
      `SELECT
         COALESCE(AVG(roas), 0)   AS roas_24h,
         COALESCE(AVG(cpa), 0)    AS cpa_24h,
         COALESCE(SUM(spend), 0)  AS spend_24h,
         COUNT(CASE WHEN status = 'active' THEN 1 END) AS active_ads
       FROM ad_metrics
       WHERE shop_id = $1 AND recorded_at > NOW() - INTERVAL '24 hours'`,
      [shopId]
    );

    // 3. Fetch Empire Index
    const { rows: empire } = await this.db.query(
      `SELECT score FROM empire_index WHERE shop_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [shopId]
    );
    const empireIndex = parseFloat(empire[0]?.score ?? 50);

    // 4. Compute Empire mode
    const empireMode: EmpireMode =
      empireIndex >= 80 ? 'aggressive' :
      empireIndex >= 60 ? 'balanced'   : 'conservative';

    // 5. Compute risk level from memory warnings
    const warnings = memories.filter(m => m.memory_type === 'warning');
    const criticalWarnings = warnings.filter(m => (m.value as {severity?: string}).severity === 'critical');
    const riskLevel: RiskLevel =
      criticalWarnings.length > 0 ? 'critical' :
      warnings.length > 2          ? 'high'     :
      warnings.length > 0          ? 'medium'   : 'low';

    // 6. Build signals and warnings arrays
    const activeSignals = memories
      .filter(m => m.memory_type === 'signal' || m.memory_type === 'opportunity')
      .map(m => ({
        source:    m.agent_name,
        key:       m.memory_key,
        value:     m.value,
        sentiment: m.memory_type === 'opportunity' ? 'positive' : 'neutral' as const,
      }));

    const activeWarnings = warnings.map(m => ({
      source:   m.agent_name,
      severity: ((m.value as {severity?: string}).severity ?? 'warning') as 'warning' | 'critical' | 'emergency',
      message:  ((m.value as {message?: string}).message ?? String(m.value)),
    }));

    // 7. Generate LLM recommendation if memories have changed significantly
    let recommendedMode: string | undefined;
    if (memories.length > 3) {
      try {
        const memSummary = memories.slice(0, 10).map(m =>
          `[${m.agent_name}] ${m.memory_key}: ${JSON.stringify(m.value)}`
        ).join('\n');

        const resp = await this.claude.messages.create({
          model:      'claude-sonnet-4-5',
          max_tokens: 150,
          messages: [{
            role: 'user',
            content: `AEGIS world state consolidation. Empire Index: ${empireIndex}/100. Mode: ${empireMode}.
Recent agent signals:
${memSummary}

In ONE sentence, what is the recommended operating mode for the next 15 minutes? Be specific.`
          }],
        });
        recommendedMode = (resp.content[0] as {text: string}).text;
      } catch { /* LLM optional */ }
    }

    const m0 = metrics[0] ?? {};
    const world: WorldState = {
      empire_index:    empireIndex,
      empire_mode:     empireMode,
      roas_24h:        parseFloat(m0.roas_24h ?? 0),
      cpa_24h:         parseFloat(m0.cpa_24h ?? 0),
      spend_24h:       parseFloat(m0.spend_24h ?? 0),
      active_ads:      parseInt(m0.active_ads ?? 0),
      risk_level:      riskLevel,
      active_signals:  activeSignals,
      active_warnings: activeWarnings,
    };

    // 8. Upsert world_state
    await this.db.query(
      `INSERT INTO world_state
         (shop_id, empire_index, empire_mode, roas_24h, cpa_24h, spend_24h,
          active_ads, risk_level, active_signals, active_warnings,
          recommended_mode, last_consolidated_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
       ON CONFLICT (shop_id) DO UPDATE SET
         empire_index     = EXCLUDED.empire_index,
         empire_mode      = EXCLUDED.empire_mode,
         roas_24h         = EXCLUDED.roas_24h,
         cpa_24h          = EXCLUDED.cpa_24h,
         spend_24h        = EXCLUDED.spend_24h,
         active_ads       = EXCLUDED.active_ads,
         risk_level       = EXCLUDED.risk_level,
         active_signals   = EXCLUDED.active_signals,
         active_warnings  = EXCLUDED.active_warnings,
         recommended_mode = EXCLUDED.recommended_mode,
         last_consolidated_at = NOW(), updated_at = NOW()`,
      [
        shopId, world.empire_index, world.empire_mode, world.roas_24h,
        world.cpa_24h, world.spend_24h, world.active_ads, world.risk_level,
        JSON.stringify(world.active_signals), JSON.stringify(world.active_warnings),
        recommendedMode ?? null,
      ]
    );

    // 9. Publish update event
    await this.redis.publish(`aegis:world_state:${shopId}`, JSON.stringify({ updated: true }));

    return world;
  }
}
