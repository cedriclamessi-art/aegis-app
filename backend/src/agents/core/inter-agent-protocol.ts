/**
 * InterAgentProtocol — AEGIS v3.5
 * Wires all agents to the deliberation bus.
 * Agents that can VETO: AGENT_GUARDRAIL, AGENT_CPA_GUARDIAN
 * Actions requiring deliberation:
 *   - scale > +30% budget (AGENT_SCALE)
 *   - kill (AGENT_STOP_LOSS)
 *   - new DCT launch (AGENT_DCT_322)
 *   - strategy activation (AGENT_STRATEGIES)
 */

import { Redis } from 'ioredis';
import { Pool } from 'pg';

type Vote = 'approve' | 'veto';

interface DeliberationEvent {
  deliberation_id: string;
  action_type:     string;
  risk_level:      string;
  initiated_by:    string;
  required_agents: string[];
  payload:         unknown;
}

interface VetoPolicy {
  action_type:     string;
  conditions:      (payload: unknown, db: Pool, shopId: string) => Promise<{ veto: boolean; reason?: string }>;
}

// ── GUARDRAIL veto policies ────────────────────────────────
const GUARDRAIL_POLICIES: VetoPolicy[] = [
  {
    action_type: 'scale_budget',
    conditions: async (payload: any, db, shopId) => {
      // Veto if new budget exceeds daily spend cap
      const { rows } = await db.query(
        `SELECT value FROM guardrail_configs WHERE shop_id = $1 AND key = 'daily_spend_cap'`, [shopId]
      );
      const cap = parseFloat(rows[0]?.value ?? 500);
      if (payload.new_budget > cap) {
        return { veto: true, reason: `Budget €${payload.new_budget} exceeds daily cap €${cap}` };
      }
      return { veto: false };
    }
  },
  {
    action_type: 'create_dct',
    conditions: async (payload: any, db, shopId) => {
      // Veto if total active ad sets would exceed 20
      const { rows } = await db.query(
        `SELECT COUNT(*) as cnt FROM ad_metrics_latest WHERE shop_id = $1 AND status = 'active'`, [shopId]
      );
      if (parseInt(rows[0].cnt) >= 20) {
        return { veto: true, reason: `Already ${rows[0].cnt} active ad sets — pause before launching new DCT` };
      }
      return { veto: false };
    }
  },
];

// ── CPA GUARDIAN veto policies ────────────────────────────
const CPA_GUARDIAN_POLICIES: VetoPolicy[] = [
  {
    action_type: 'scale_budget',
    conditions: async (payload: any, db, shopId) => {
      // Veto if CPA is already above threshold
      const { rows } = await db.query(
        `SELECT AVG(cpa) AS cpa FROM ad_metrics_latest WHERE shop_id = $1 AND status = 'active'`, [shopId]
      );
      const { rows: cfg } = await db.query(
        `SELECT value FROM guardrail_configs WHERE shop_id = $1 AND key = 'cpa_max'`, [shopId]
      );
      const cpa    = parseFloat(rows[0]?.cpa ?? 0);
      const cpaMax = parseFloat(cfg[0]?.value ?? 45);
      if (cpa > cpaMax * 0.9) {
        return { veto: true, reason: `CPA €${cpa.toFixed(2)} already near limit €${cpaMax} — no scaling` };
      }
      return { veto: false };
    }
  },
];

// ── Protocol handler ──────────────────────────────────────
export class InterAgentProtocol {
  private sub: Redis;
  private pub: Redis;
  private db:  Pool;

  constructor(db: Pool, redis: Redis) {
    this.db  = db;
    this.sub = redis.duplicate();
    this.pub = redis;
  }

  /**
   * Start listening for deliberation requests on the bus.
   * Call this at app startup — runs forever.
   */
  async start(): Promise<void> {
    // Subscribe to deliberation events per shop
    await this.sub.psubscribe('aegis:deliberation:*');

    this.sub.on('pmessage', async (_pattern, channel, message) => {
      // Skip result channels
      if (channel.includes(':result:')) return;

      try {
        const event: DeliberationEvent = JSON.parse(message);
        await this.handleDeliberation(event, this.extractShopId(channel));
      } catch (err) {
        console.error('[InterAgentProtocol] Error handling deliberation:', err);
      }
    });

    console.log('[InterAgentProtocol] Listening for deliberation requests');
  }

  private async handleDeliberation(event: DeliberationEvent, shopId: string): Promise<void> {
    const { deliberation_id, action_type, required_agents, payload } = event;

    // Each required agent evaluates based on its policies
    for (const agentName of required_agents) {
      const policies = this.getPoliciesForAgent(agentName);
      const policy   = policies.find(p => p.action_type === action_type);

      let vote:   Vote   = 'approve';
      let reason: string = 'No policy — auto-approve';

      if (policy) {
        const result = await policy.conditions(payload, this.db, shopId);
        vote   = result.veto ? 'veto' : 'approve';
        reason = result.reason ?? 'Policy passed';
      }

      await this.castVote(deliberation_id, agentName, vote, reason);
    }
  }

  private async castVote(
    deliberationId: string,
    agentName:      string,
    vote:           Vote,
    reason:         string
  ): Promise<void> {
    const voteEntry = { agent: agentName, vote, reason, ts: new Date().toISOString() };

    await this.db.query(
      `UPDATE agent_deliberations
       SET votes        = votes || $1::jsonb,
           voted_agents = array_append(voted_agents, $2)
       WHERE id = $3`,
      [JSON.stringify(voteEntry), agentName, deliberationId]
    );

    // Check if all votes are in and resolve
    const { rows } = await this.db.query(
      `SELECT required_agents, voted_agents, votes FROM agent_deliberations WHERE id = $1`,
      [deliberationId]
    );
    if (!rows[0]) return;

    const allVoted = rows[0].required_agents.every((a: string) => rows[0].voted_agents.includes(a));
    if (!allVoted) return;

    const hasVeto = (rows[0].votes as Array<{vote: string}>).some(v => v.vote === 'veto');
    const status  = hasVeto ? 'vetoed' : 'approved';

    await this.db.query(
      `UPDATE agent_deliberations SET status = $1, decided_at = NOW() WHERE id = $2`,
      [status, deliberationId]
    );

    await this.pub.publish(
      `aegis:deliberation:result:${deliberationId}`,
      JSON.stringify({ status, deliberation_id: deliberationId })
    );
  }

  private getPoliciesForAgent(agentName: string): VetoPolicy[] {
    const map: Record<string, VetoPolicy[]> = {
      'AGENT_GUARDRAIL':    GUARDRAIL_POLICIES,
      'AGENT_CPA_GUARDIAN': CPA_GUARDIAN_POLICIES,
    };
    return map[agentName] ?? [];
  }

  private extractShopId(channel: string): string {
    // channel: aegis:deliberation:{shop_id}
    return channel.split(':')[2] ?? '';
  }
}
