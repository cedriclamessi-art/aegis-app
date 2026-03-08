/**
 * LLMauditService v3.9
 * Wraps every Anthropic call. Logs cost, latency, and value impact.
 * After 30 days: know which LLM calls are worth €0.02 and which aren't.
 */
import Anthropic from '@anthropic-ai/sdk';
import { Pool } from 'pg';

// Pricing per 1M tokens (claude-sonnet-4-5 as of 2026)
const PRICING = {
  'claude-sonnet-4-5':   { input: 3.0,  output: 15.0  },  // $/1M tokens
  'claude-haiku-4-5':    { input: 0.25, output: 1.25  },
  'claude-opus-4-5':     { input: 15.0, output: 75.0  },
};

export interface LLMCallOptions {
  shop_id?:       string;
  agent_name:     string;
  call_purpose:   string;
  model?:         string;
  max_tokens?:    number;
  messages:       Anthropic.MessageParam[];
  system?:        string;
}

export class LLMAuditService {
  private client: Anthropic;

  constructor(private db: Pool) {
    this.client = new Anthropic();
  }

  /**
   * Drop-in replacement for anthropic.messages.create().
   * All agents should use this instead of calling Anthropic directly.
   */
  async call(opts: LLMCallOptions): Promise<{ text: string; logId: string }> {
    const model   = opts.model ?? 'claude-sonnet-4-5';
    const startMs = Date.now();
    let logId     = '';
    let error: string | undefined;
    let response: Anthropic.Message | undefined;

    try {
      response = await this.client.messages.create({
        model,
        max_tokens: opts.max_tokens ?? 1000,
        system: opts.system,
        messages: opts.messages,
      });
    } catch (err) {
      error = String(err);
    }

    const latencyMs    = Date.now() - startMs;
    const inputTokens  = response?.usage?.input_tokens  ?? 0;
    const outputTokens = response?.usage?.output_tokens ?? 0;

    // Persist call log
    try {
      const { rows } = await this.db.query(`
        INSERT INTO llm_call_log
          (shop_id, agent_name, call_purpose, model, input_tokens, output_tokens, latency_ms, error)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [opts.shop_id ?? null, opts.agent_name, opts.call_purpose,
         model, inputTokens, outputTokens, latencyMs, error ?? null]);
      logId = rows[0]?.id ?? '';
    } catch { /* non-blocking */ }

    if (error || !response) throw new Error(error ?? 'LLM call failed');

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as Anthropic.TextBlock).text)
      .join('');

    return { text, logId };
  }

  /** Mark a call as used (output was applied to a decision). */
  async markUsed(logId: string, decisionChanged = false): Promise<void> {
    if (!logId) return;
    await this.db.query(
      `UPDATE llm_call_log SET output_used=true, decision_changed=$1 WHERE id=$2`,
      [decisionChanged, logId]).catch(() => {});
  }

  /** Mark quality score after AGENT_EVALUATOR rates outcome. */
  async rateQuality(logId: string, score: number): Promise<void> {
    if (!logId) return;
    await this.db.query(
      `UPDATE llm_call_log SET quality_score=$1 WHERE id=$2`,
      [score, logId]).catch(() => {});
  }

  /** Daily cost report — which calls are worth it. */
  async getCostReport(shopId: string, days = 30): Promise<unknown> {
    await this.db.query('REFRESH MATERIALIZED VIEW llm_cost_summary').catch(() => {});
    const { rows } = await this.db.query(`
      SELECT agent_name, call_purpose,
             SUM(call_count)      AS calls,
             SUM(total_cost_usd)  AS cost_usd,
             AVG(avg_latency_ms)  AS avg_latency,
             AVG(usage_rate)      AS usage_rate,
             AVG(avg_quality)     AS avg_quality
      FROM llm_cost_summary
      WHERE shop_id=$1 AND day > CURRENT_DATE - $2
      GROUP BY agent_name, call_purpose
      ORDER BY cost_usd DESC`, [shopId, days]);

    const total = rows.reduce((s: number, r: any) => s + parseFloat(r.cost_usd), 0);
    const lowValue = rows.filter((r: any) =>
      parseFloat(r.usage_rate) < 0.5 || parseFloat(r.avg_quality ?? 0) < 0.4
    );

    return {
      total_cost_usd: total,
      by_agent: rows,
      low_value_calls: lowValue,
      recommendation: lowValue.length > 0
        ? `Consider disabling or simplifying: ${lowValue.map((r: any) => `${r.agent_name}/${r.call_purpose}`).join(', ')}`
        : 'All LLM calls appear to generate value.',
    };
  }
}
