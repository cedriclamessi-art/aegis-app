/**
 * Decision Inspector API v3.9
 * Exposes the full reasoning trail of every AEGIS decision.
 * Dashboard: click any action → see world state, memories consulted,
 * rules evaluated, LLM reasoning, deliberation, outcome 6h later.
 */
import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

export function decisionInspectorRouter(db: Pool): Router {
  const router = Router();

  /**
   * GET /api/shops/:shopId/decisions
   * Paginated list of all decisions, with summary fields.
   */
  router.get('/:shopId/decisions', async (req: Request, res: Response) => {
    const { shopId } = req.params;
    const { limit = 50, offset = 0, agent, verdict, from, to } = req.query;

    let where = `WHERE shop_id = $1`;
    const params: any[] = [shopId];

    if (agent)   { params.push(agent);   where += ` AND agent_name = $${params.length}`; }
    if (verdict) { params.push(verdict); where += ` AND verdict = $${params.length}`; }
    if (from)    { params.push(from);    where += ` AND created_at >= $${params.length}`; }
    if (to)      { params.push(to);      where += ` AND created_at <= $${params.length}`; }

    params.push(Math.min(parseInt(limit as string), 200));
    params.push(parseInt(offset as string));

    const { rows } = await db.query(`
      SELECT id, agent_name, decision_type, subject_type, subject_id,
             decision_made, confidence, executed, executed_at, created_at,
             deliberation_outcome, outcome_score, verdict
      FROM decision_inspector
      ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params);

    // Stats
    const { rows: stats } = await db.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE verdict = 'good_decision')   AS good,
        COUNT(*) FILTER (WHERE verdict = 'bad_decision')    AS bad,
        COUNT(*) FILTER (WHERE verdict = 'pending')         AS pending,
        AVG(confidence) AS avg_confidence,
        AVG(outcome_score) FILTER (WHERE outcome_score IS NOT NULL) AS avg_outcome
      FROM decision_inspector WHERE shop_id = $1
        ${from ? `AND created_at >= '${from}'` : ''}
        ${to   ? `AND created_at <= '${to}'`   : ''}`, [shopId]);

    res.json({ decisions: rows, stats: stats[0] });
  });

  /**
   * GET /api/shops/:shopId/decisions/:id
   * Full decision trace — every field, human readable.
   */
  router.get('/:shopId/decisions/:id', async (req: Request, res: Response) => {
    const { shopId, id } = req.params;

    const { rows } = await db.query(`
      SELECT * FROM decision_inspector WHERE shop_id=$1 AND id=$2`, [shopId, id]);

    if (!rows[0]) return res.status(404).json({ error: 'Decision not found' });

    const d = rows[0];

    // Fetch related LLM calls
    const { rows: llmCalls } = await db.query(`
      SELECT call_purpose, model, input_tokens, output_tokens,
             estimated_cost_usd, latency_ms, output_used, quality_score
      FROM llm_call_log
      WHERE shop_id=$1 AND created_at BETWEEN $2 - INTERVAL '10 seconds' AND $2 + INTERVAL '10 seconds'
        AND agent_name=$3`,
      [shopId, d.created_at, d.agent_name]);

    // Build human-readable trace
    const trace = buildHumanTrace(d, llmCalls);

    res.json({
      decision: d,
      llm_calls: llmCalls,
      human_trace: trace,
    });
  });

  /**
   * GET /api/shops/:shopId/decisions/agent/:agentName/stats
   * Per-agent performance: win rate, avg confidence, cost.
   */
  router.get('/:shopId/decisions/agent/:agentName/stats', async (req: Request, res: Response) => {
    const { shopId, agentName } = req.params;

    const { rows } = await db.query(`
      SELECT
        COUNT(*)                      AS total_decisions,
        AVG(confidence)               AS avg_confidence,
        COUNT(*) FILTER (WHERE verdict='good_decision') AS good_decisions,
        COUNT(*) FILTER (WHERE verdict='bad_decision')  AS bad_decisions,
        AVG(outcome_score) FILTER (WHERE outcome_score IS NOT NULL) AS avg_outcome,
        COUNT(*) FILTER (WHERE deliberation_outcome='approved') AS deliberations_passed,
        COUNT(*) FILTER (WHERE deliberation_outcome='vetoed')   AS deliberations_vetoed
      FROM decision_inspector
      WHERE shop_id=$1 AND agent_name=$2
        AND created_at > NOW() - INTERVAL '30 days'`, [shopId, agentName]);

    const { rows: llmCost } = await db.query(`
      SELECT SUM(estimated_cost_usd) AS total_cost, COUNT(*) AS call_count
      FROM llm_call_log
      WHERE shop_id=$1 AND agent_name=$2 AND created_at > NOW() - INTERVAL '30 days'`,
      [shopId, agentName]);

    res.json({
      agent: agentName,
      stats: rows[0],
      llm_cost_30d: llmCost[0],
    });
  });

  return router;
}

function buildHumanTrace(d: any, llmCalls: any[]): string {
  const lines: string[] = [];
  const ts = new Date(d.created_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });

  lines.push(`🤖 ${d.agent_name} — ${d.decision_type.toUpperCase()}`);
  lines.push(`📅 ${ts}`);
  lines.push(`🎯 Subject: ${d.subject_type} ${d.subject_id}`);
  lines.push('');

  // World state
  if (d.world_state_snapshot) {
    const ws = d.world_state_snapshot as any;
    lines.push(`🌍 World State at decision time:`);
    lines.push(`   Empire Index: ${ws.empire_index ?? 'N/A'}`);
    lines.push(`   Mode: ${ws.empire_mode ?? 'unknown'}`);
    lines.push(`   ROAS: ${ws.roas_24h ?? 'N/A'}×  CPA: €${ws.cpa_24h ?? 'N/A'}`);
    lines.push('');
  }

  // Rules
  if (Array.isArray(d.rules_evaluated) && d.rules_evaluated.length > 0) {
    lines.push(`⚙️ Rules evaluated:`);
    for (const rule of d.rules_evaluated) {
      lines.push(`   ${rule.passed ? '✓' : '✗'} ${rule.rule}: ${rule.value ?? ''}`);
    }
    lines.push('');
  }

  // Decision
  if (d.decision_made) {
    const dec = d.decision_made as any;
    lines.push(`📋 Decision:`);
    lines.push(`   Action: ${dec.action}`);
    if (dec.old_budget !== undefined) lines.push(`   Budget: €${dec.old_budget} → €${dec.new_budget} (×${dec.multiplier ?? '?'})`);
    lines.push(`   Confidence: ${((d.confidence ?? 0) * 100).toFixed(0)}%`);
    lines.push('');
  }

  // LLM
  if (d.llm_reasoning) {
    lines.push(`🧠 LLM reasoning:`);
    lines.push(`   "${String(d.llm_reasoning).slice(0, 300)}${String(d.llm_reasoning).length > 300 ? '...' : ''}"`);
    lines.push('');
  }

  // Deliberation
  if (d.deliberation_outcome) {
    const icon = d.deliberation_outcome === 'approved' ? '✅' : '❌';
    lines.push(`🗳️ Deliberation: ${icon} ${d.deliberation_outcome.toUpperCase()}`);
    if (d.deliberation_veto) lines.push(`   Veto reason: ${d.deliberation_veto}`);
    lines.push('');
  }

  // Outcome
  if (d.outcome_score !== null && d.outcome_score !== undefined) {
    const score = parseFloat(d.outcome_score);
    const icon  = score >= 0.7 ? '🟢' : score >= 0.3 ? '🟡' : '🔴';
    lines.push(`📊 Outcome (6h later): ${icon} ${d.verdict} (score: ${score.toFixed(2)})`);
    if (d.metrics_before && d.metrics_after) {
      const before = d.metrics_before as any;
      const after  = d.metrics_after  as any;
      lines.push(`   ROAS: ${parseFloat(before.roas ?? 0).toFixed(2)}× → ${parseFloat(after.roas ?? 0).toFixed(2)}×`);
      lines.push(`   CPA:  €${parseFloat(before.cpa ?? 0).toFixed(2)} → €${parseFloat(after.cpa ?? 0).toFixed(2)}`);
    }
  } else {
    lines.push(`⏳ Outcome: pending evaluation`);
  }

  // LLM cost
  if (llmCalls.length > 0) {
    const cost = llmCalls.reduce((s, c) => s + parseFloat(c.estimated_cost_usd ?? 0), 0);
    lines.push('');
    lines.push(`💰 LLM cost for this decision: $${cost.toFixed(4)}`);
  }

  return lines.join('\n');
}
