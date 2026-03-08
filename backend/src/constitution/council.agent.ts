/**
 * AGENT_CONSTITUTIONAL_COUNCIL v4.0
 * ============================================================
 * The supreme oversight layer of AEGIS.
 * Intercepts ALL action executions before they reach Meta/Shopify/Klaviyo.
 * Cannot be bypassed by any agent, world state, or configuration.
 *
 * Separation of powers:
 *   - Agents PROPOSE and DECIDE
 *   - Deliberation protocol VALIDATES logic
 *   - Council ENFORCES constitutional principles
 *
 * The Council does not optimize. It does not suggest.
 * It only asks: "Does this action violate the Constitution?"
 * ============================================================
 */
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import {
  CONSTITUTION, ActionContext, ConstitutionalViolation
} from './constitution.config';

export type CouncilVerdict = 'approved' | 'vetoed' | 'deferred';

export interface CouncilReview {
  verdict:         CouncilVerdict;
  articles_invoked: string[];
  violations:      ConstitutionalViolation[];
  veto_reason?:    string;
  review_id:       string;
  duration_ms:     number;
}

export class ConstitutionalCouncil {
  constructor(
    private db:    Pool,
    private redis: Redis,
  ) {}

  /**
   * THE GATE.
   * Every action must pass through this before execution.
   * Returns approved → proceed. Vetoed → halt. Deferred → await human.
   */
  async review(
    shopId:        string,
    agentName:     string,
    actionType:    string,
    actionPayload: Record<string, unknown>,
    opts: {
      financialImpact?:  number;
      isIrreversible?:   boolean;
      destinationType?:  string;
      destinationId?:    string;
    } = {}
  ): Promise<CouncilReview> {
    const startMs = Date.now();

    // ── Build context ─────────────────────────────────────
    const ctx = await this.buildContext(shopId, agentName, actionType, actionPayload, opts);

    // ── Run all articles ──────────────────────────────────
    const violations: ConstitutionalViolation[] = [];
    const articlesInvoked: string[] = [];

    for (const article of CONSTITUTION.articles) {
      // Article 3 needs async whitelist check
      if (article.id === 'article_3_data_sovereignty' && opts.destinationType && opts.destinationId) {
        const whitelisted = await this.isWhitelisted(shopId, opts.destinationType, opts.destinationId);
        ctx.has_human_auth = whitelisted;
      }

      const violation = article.check(ctx);
      if (violation) {
        violations.push(violation);
        articlesInvoked.push(article.id);

        // Log each violation
        await this.logViolation(shopId, agentName, violation).catch(() => {});

        // Article 4: if suspension triggered, do it now
        if (article.id === 'article_4_agent_suspension') {
          await this.suspendAgent(shopId, agentName, violation.reason, ctx.agent_violation_count_today);
        }
      }
    }

    // ── Determine verdict ─────────────────────────────────
    const hardBlocks = violations.filter(v => v.severity === 'block');
    const verdict: CouncilVerdict = hardBlocks.length > 0 ? 'vetoed' : 'approved';

    const vetoReason = hardBlocks.length > 0
      ? hardBlocks.map(v => `[${v.article}] ${v.reason}`).join('\n\n')
      : undefined;

    const durationMs = Date.now() - startMs;

    // ── Persist review (immutable) ────────────────────────
    const reviewId = await this.persistReview({
      shopId, agentName, actionType, actionPayload,
      financialImpact: opts.financialImpact ?? 0,
      verdict, articlesInvoked, vetoReason, durationMs,
    });

    // ── Emit veto event for notifications ─────────────────
    if (verdict === 'vetoed') {
      await this.redis.publish(`aegis:council:${shopId}:veto`, JSON.stringify({
        agent_name:   agentName,
        action_type:  actionType,
        veto_reason:  vetoReason,
        review_id:    reviewId,
        articles:     articlesInvoked,
        severity:     'critical',
      })).catch(() => {});

      // Also send immediate alert
      await this.redis.publish(`aegis:anomaly_critical:${shopId}`, JSON.stringify({
        type:    'constitutional_veto',
        title:   `Conseil Constitutionnel: ${agentName} vetoed`,
        message: hardBlocks[0]?.reason.slice(0, 200),
        severity: 'critical',
      })).catch(() => {});
    }

    return {
      verdict,
      articles_invoked: articlesInvoked,
      violations,
      veto_reason: vetoReason,
      review_id:   reviewId,
      duration_ms: durationMs,
    };
  }

  // ── Context builder ───────────────────────────────────────
  private async buildContext(
    shopId:        string,
    agentName:     string,
    actionType:    string,
    actionPayload: Record<string, unknown>,
    opts:          { financialImpact?: number; isIrreversible?: boolean; destinationType?: string; destinationId?: string }
  ): Promise<ActionContext> {

    // Daily spend so far
    const { rows: spendRows } = await this.db.query(`
      SELECT COALESCE(SUM(spend), 0) AS today_spend
      FROM ad_metrics WHERE shop_id=$1 AND recorded_at > CURRENT_DATE`, [shopId]).catch(() => ({ rows: [{ today_spend: 0 }] }));

    // Max daily spend from guardrails
    const { rows: guardrail } = await this.db.query(`
      SELECT value::numeric AS v FROM guardrail_configs WHERE shop_id=$1 AND key='max_daily_spend'`, [shopId])
      .catch(() => ({ rows: [] }));

    // Recent human authorizations (last 24h)
    const { rows: humanAuth } = await this.db.query(`
      SELECT 1 FROM audit_log
      WHERE shop_id=$1 AND user_id IS NOT NULL AND agent_name IS NULL
        AND created_at > NOW() - INTERVAL '24 hours'
        AND action IN ('manual_approve','budget_manual','campaign_manual')
      LIMIT 1`, [shopId]).catch(() => ({ rows: [] }));

    // Audit log availability check
    let auditAvailable = true;
    try {
      await this.db.query('SELECT 1 FROM audit_log LIMIT 1');
    } catch {
      auditAvailable = false;
    }

    // Agent violations today
    const { rows: violations } = await this.db.query(`
      SELECT COUNT(*) AS cnt FROM constitution_violations
      WHERE shop_id=$1 AND agent_name=$2 AND created_at > CURRENT_DATE`, [shopId, agentName])
      .catch(() => ({ rows: [{ cnt: 0 }] }));

    return {
      shop_id:                    shopId,
      agent_name:                 agentName,
      action_type:                actionType,
      action_payload:             actionPayload,
      financial_impact:           opts.financialImpact ?? 0,
      is_irreversible:            opts.isIrreversible ?? false,
      has_human_auth:             humanAuth.length > 0,
      audit_log_available:        auditAvailable,
      destination_type:           opts.destinationType,
      destination_id:             opts.destinationId,
      daily_spend_so_far:         parseFloat(spendRows[0]?.today_spend ?? 0),
      max_daily_spend_config:     parseFloat(guardrail[0]?.v ?? 500),
      agent_violation_count_today: parseInt(violations[0]?.cnt ?? 0),
    };
  }

  // ── Whitelist check ───────────────────────────────────────
  private async isWhitelisted(shopId: string, destType: string, destId: string): Promise<boolean> {
    const { rows } = await this.db.query(`
      SELECT 1 FROM constitution_whitelist
      WHERE shop_id=$1 AND destination_type=$2 AND destination_id=$3 AND revoked_at IS NULL`,
      [shopId, destType, destId]).catch(() => ({ rows: [] }));
    return rows.length > 0;
  }

  // ── Agent suspension ──────────────────────────────────────
  private async suspendAgent(shopId: string, agentName: string, reason: string, violationCount: number): Promise<void> {
    await this.db.query(`
      INSERT INTO agent_suspensions
        (shop_id, agent_name, suspended_until, reason, violation_count)
      VALUES ($1,$2, NOW() + INTERVAL '24 hours', $3, $4)
      ON CONFLICT DO NOTHING`,
      [shopId, agentName, reason, violationCount]).catch(() => {});

    // Publish suspension event
    await this.redis.publish(`aegis:agent:suspended:${shopId}`, JSON.stringify({
      agent_name:     agentName,
      suspended_until: new Date(Date.now() + 86400000).toISOString(),
      reason,
      severity: 'critical',
    })).catch(() => {});
  }

  // ── Violation log ─────────────────────────────────────────
  private async logViolation(shopId: string, agentName: string, v: ConstitutionalViolation): Promise<void> {
    await this.db.query(`
      INSERT INTO constitution_violations (shop_id, agent_name, article_invoked, violation_type, details)
      VALUES ($1,$2,$3,$4,$5)`,
      [shopId, agentName, v.article, v.severity, JSON.stringify({ reason: v.reason })]);
  }

  // ── Persist review (immutable) ────────────────────────────
  private async persistReview(opts: {
    shopId:          string;
    agentName:       string;
    actionType:      string;
    actionPayload:   Record<string, unknown>;
    financialImpact: number;
    verdict:         CouncilVerdict;
    articlesInvoked: string[];
    vetoReason?:     string;
    durationMs:      number;
  }): Promise<string> {
    const { rows } = await this.db.query(`
      INSERT INTO constitution_reviews
        (shop_id, agent_name, action_type, action_payload, financial_impact,
         verdict, articles_invoked, veto_reason, duration_ms)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [opts.shopId, opts.agentName, opts.actionType,
       JSON.stringify(opts.actionPayload), opts.financialImpact,
       opts.verdict, opts.articlesInvoked, opts.vetoReason ?? null, opts.durationMs])
      .catch(() => ({ rows: [{ id: 'unknown' }] }));
    return rows[0]?.id ?? 'unknown';
  }

  // ── Status queries ────────────────────────────────────────

  async isAgentSuspended(shopId: string, agentName: string): Promise<{ suspended: boolean; until?: Date; reason?: string }> {
    const { rows } = await this.db.query(`
      SELECT suspended_until, reason FROM agent_suspensions
      WHERE shop_id=$1 AND agent_name=$2
        AND suspended_until > NOW() AND lifted_at IS NULL
      ORDER BY suspended_until DESC LIMIT 1`, [shopId, agentName]);

    if (!rows[0]) return { suspended: false };
    return { suspended: true, until: rows[0].suspended_until, reason: rows[0].reason };
  }

  async liftSuspension(shopId: string, agentName: string, liftedBy: string): Promise<void> {
    await this.db.query(`
      UPDATE agent_suspensions SET lifted_at=NOW(), lifted_by=$1
      WHERE shop_id=$2 AND agent_name=$3 AND lifted_at IS NULL`,
      [liftedBy, shopId, agentName]);

    await this.redis.publish(`aegis:agent:suspension_lifted:${shopId}`, JSON.stringify({
      agent_name: agentName, lifted_by: liftedBy,
    })).catch(() => {});
  }

  async getRecentReviews(shopId: string, limit = 50): Promise<unknown[]> {
    const { rows } = await this.db.query(`
      SELECT id, agent_name, action_type, financial_impact,
             verdict, articles_invoked, veto_reason, duration_ms, reviewed_at
      FROM constitution_reviews WHERE shop_id=$1
      ORDER BY reviewed_at DESC LIMIT $2`, [shopId, limit]);
    return rows;
  }

  async getConstitutionStatus(shopId: string): Promise<unknown> {
    const [reviews, violations, suspensions] = await Promise.all([
      this.db.query(`SELECT verdict, COUNT(*) AS n FROM constitution_reviews WHERE shop_id=$1 AND reviewed_at > NOW() - INTERVAL '24 hours' GROUP BY verdict`, [shopId]),
      this.db.query(`SELECT article_invoked, COUNT(*) AS n FROM constitution_violations WHERE shop_id=$1 AND created_at > NOW() - INTERVAL '7 days' GROUP BY article_invoked ORDER BY n DESC`, [shopId]),
      this.db.query(`SELECT agent_name, suspended_until, reason FROM agent_suspensions WHERE shop_id=$1 AND suspended_until > NOW() AND lifted_at IS NULL`, [shopId]),
    ]);

    return {
      constitution_version: '1.0.0',
      last_24h: {
        approved: parseInt(reviews.rows.find(r => r.verdict === 'approved')?.n ?? 0),
        vetoed:   parseInt(reviews.rows.find(r => r.verdict === 'vetoed')?.n   ?? 0),
      },
      top_violations_7d: violations.rows,
      active_suspensions: suspensions.rows,
      articles: CONSTITUTION.articles.map(a => ({ id: a.id, title: a.title })),
    };
  }

  async addToWhitelist(shopId: string, opts: {
    destinationType: string; destinationId: string; approvedBy: string; purpose: string;
  }): Promise<void> {
    await this.db.query(`
      INSERT INTO constitution_whitelist (shop_id, destination_type, destination_id, approved_by, purpose)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT (shop_id, destination_type, destination_id) DO UPDATE SET
        approved_by=$4, approved_at=NOW(), revoked_at=NULL, purpose=$5`,
      [shopId, opts.destinationType, opts.destinationId, opts.approvedBy, opts.purpose]);
  }
}
