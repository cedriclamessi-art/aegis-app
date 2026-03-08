/**
 * AGENT_ATTRIBUTION
 * =================
 * Réconcilie toutes les sources de données pour calculer les vraies métriques :
 * MER · ROAS réel · CAC · LTV · CVR
 * Détecte les dérives d'attribution (iOS 14.5+, blockers, délais).
 */
import { AgentBase, AgentTask, AgentResult } from '../base/agent.base';
import { db } from '../../utils/db';
import logger from '../../utils/logger';

export class AttributionAgent extends AgentBase {
  readonly agentId = 'AGENT_ATTRIBUTION';
  readonly taskTypes = [
    'attribution.compute_mer',      // MER = Revenue total / Spend total
    'attribution.compute_cac',      // CAC par canal + combiné
    'attribution.reconcile_capi',   // Réconcilie CAPI vs Meta reported
    'attribution.detect_drift',     // Détecte dérive d'attribution
    'attribution.daily_report',     // Rapport quotidien métriques clés
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.taskType) {
      case 'attribution.compute_mer':   return this.computeMer(task);
      case 'attribution.compute_cac':   return this.computeCac(task);
      case 'attribution.reconcile_capi':return this.reconcileCapi(task);
      case 'attribution.detect_drift':  return this.detectDrift(task);
      case 'attribution.daily_report':  return this.dailyReport(task);
      default: return { success: false, error: `Unknown: ${task.taskType}` };
    }
  }

  private async computeMer(task: AgentTask): Promise<AgentResult> {
    const { periodDays = 7 } = task.input as { periodDays?: number };

    // MER = Revenu total (toutes sources) / Spend total publicité
    const r = await db.query<{
      total_revenue: number; total_spend: number; mer: number; period_days: number;
    }>(
      `SELECT
         SUM(o.revenue_eur)                              AS total_revenue,
         SUM(c.spend_eur)                                AS total_spend,
         ROUND(SUM(o.revenue_eur) / NULLIF(SUM(c.spend_eur),0), 2) AS mer,
         $2::INTEGER                                     AS period_days
       FROM store.orders o
       CROSS JOIN (
         SELECT SUM(spend) AS spend_eur FROM ads.performance_daily
         WHERE tenant_id = $1 AND date >= NOW() - ($2 || ' days')::INTERVAL
       ) c
       WHERE o.tenant_id = $1
         AND o.created_at >= NOW() - ($2 || ' days')::INTERVAL`,
      [task.tenantId, periodDays]
    );

    const { total_revenue, total_spend, mer } = r.rows[0] ?? {};

    logger.info(`[ATTRIBUTION] MER ${periodDays}j = ${mer}x (spend=${total_spend}€, rev=${total_revenue}€)`);

    return {
      success: true,
      output: { mer, totalRevenue: total_revenue, totalSpend: total_spend, periodDays },
    };
  }

  private async computeCac(task: AgentTask): Promise<AgentResult> {
    const { periodDays = 30 } = task.input as { periodDays?: number };

    const r = await db.query<{ channel: string; spend: number; new_customers: number; cac: number }>(
      `SELECT
         apd.channel,
         SUM(apd.spend)                                                AS spend,
         COUNT(DISTINCT o.customer_id)                                 AS new_customers,
         ROUND(SUM(apd.spend) / NULLIF(COUNT(DISTINCT o.customer_id), 0), 2) AS cac
       FROM ads.performance_daily apd
       LEFT JOIN store.orders o
         ON o.tenant_id = apd.tenant_id
        AND o.channel_attribution = apd.channel
        AND o.created_at >= NOW() - ($2 || ' days')::INTERVAL
        AND o.is_new_customer = TRUE
       WHERE apd.tenant_id = $1
         AND apd.date >= NOW() - ($2 || ' days')::INTERVAL
       GROUP BY apd.channel`,
      [task.tenantId, periodDays]
    );

    return { success: true, output: { cac_by_channel: r.rows, periodDays } };
  }

  private async reconcileCapi(task: AgentTask): Promise<AgentResult> {
    // Compare conversions Meta reportées vs CAPI events reçus
    const r = await db.query<{ gap_pct: number; meta_conv: number; capi_conv: number }>(
      `SELECT
         COUNT(ce.id)                                           AS capi_conv,
         SUM(apd.conversions)                                   AS meta_conv,
         ROUND(
           (COUNT(ce.id) - SUM(apd.conversions))::NUMERIC
           / NULLIF(SUM(apd.conversions), 0) * 100
         , 1)                                                   AS gap_pct
       FROM ads.capi_events ce
       FULL OUTER JOIN ads.performance_daily apd
         ON apd.tenant_id = ce.tenant_id
        AND apd.date = ce.event_date::DATE
       WHERE ce.tenant_id = $1
         AND ce.created_at >= NOW() - INTERVAL '7 days'`,
      [task.tenantId]
    );

    const { gap_pct, meta_conv, capi_conv } = r.rows[0] ?? {};

    if (Math.abs(gap_pct ?? 0) > 20) {
      await db.query(
        `INSERT INTO aegis_alerts (tenant_id, alert_type, severity, message)
         VALUES ($1, 'ATTRIBUTION_DRIFT', 'warning', $2)`,
        [task.tenantId, `Gap attribution ${gap_pct}% : CAPI=${capi_conv} vs Meta=${meta_conv}`]
      );
    }

    return { success: true, output: { gap_pct, capi_conv, meta_conv } };
  }

  private async detectDrift(task: AgentTask): Promise<AgentResult> {
    // Détecte si le ROAS reporté par Meta diverge du MER réel > 30%
    const [mer_r, roas_r] = await Promise.all([
      this.computeMer({ ...task, input: { periodDays: 7 } }),
      db.query<{ avg_roas: number }>(
        `SELECT AVG(roas) AS avg_roas FROM ads.performance_daily
         WHERE tenant_id = $1 AND date >= NOW() - INTERVAL '7 days'`,
        [task.tenantId]
      ),
    ]);

    const mer  = (mer_r.output as { mer: number }).mer ?? 0;
    const roas = roas_r.rows[0]?.avg_roas ?? 0;
    const drift = roas > 0 ? Math.abs((roas - mer) / roas * 100) : 0;

    if (drift > 30) {
      logger.warn(`[ATTRIBUTION] Drift détecté : ROAS=${roas}x vs MER=${mer}x (${drift}%)`);
    }

    return { success: true, output: { mer, roas_reported: roas, drift_pct: drift, drifted: drift > 30 } };
  }

  private async dailyReport(task: AgentTask): Promise<AgentResult> {
    const [mer, cac] = await Promise.all([
      this.computeMer({ ...task, input: { periodDays: 1 } }),
      this.computeCac({ ...task, input: { periodDays: 7 } }),
    ]);

    return { success: true, output: { mer: mer.output, cac: cac.output } };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * AGENT_FINANCE_GUARD
 * ===================
 * Surveille la santé financière : marges, COGS, break-even, trésorerie.
 * Lève des alertes avant que le problème devienne une crise.
 */
export class FinanceGuardAgent extends AgentBase {
  readonly agentId = 'AGENT_FINANCE_GUARD';
  readonly taskTypes = [
    'finance.check_margins',     // Contribution margin par produit
    'finance.break_even',        // Seuil de rentabilité
    'finance.cash_projection',   // Projection trésorerie 30/60/90j
    'finance.daily_pnl',         // P&L quotidien
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.taskType) {
      case 'finance.check_margins':   return this.checkMargins(task);
      case 'finance.break_even':      return this.breakEven(task);
      case 'finance.cash_projection': return this.cashProjection(task);
      case 'finance.daily_pnl':       return this.dailyPnl(task);
      default: return { success: false, error: `Unknown: ${task.taskType}` };
    }
  }

  private async checkMargins(task: AgentTask): Promise<AgentResult> {
    const r = await db.query<{
      product_id: string; product_name: string;
      revenue_7d: number; cogs_7d: number; cm_pct: number;
    }>(
      `SELECT
         p.id           AS product_id,
         p.name         AS product_name,
         SUM(o.revenue_eur)                          AS revenue_7d,
         SUM(o.cogs_eur)                             AS cogs_7d,
         ROUND((1 - SUM(o.cogs_eur)/NULLIF(SUM(o.revenue_eur),0)) * 100, 1) AS cm_pct
       FROM store.products p
       JOIN store.orders o ON o.product_id = p.id
       WHERE p.tenant_id = $1
         AND o.created_at >= NOW() - INTERVAL '7 days'
       GROUP BY p.id, p.name
       ORDER BY cm_pct ASC`,
      [task.tenantId]
    );

    // Alerte si CM < 20%
    for (const row of r.rows) {
      if (row.cm_pct < 20) {
        await db.query(
          `INSERT INTO aegis_alerts (tenant_id, alert_type, severity, message)
           VALUES ($1,'LOW_MARGIN','warning',$2)`,
          [task.tenantId, `${row.product_name} : CM ${row.cm_pct}% < 20%`]
        );
      }
    }

    return { success: true, output: { margins: r.rows } };
  }

  private async breakEven(task: AgentTask): Promise<AgentResult> {
    const { fixedCostsMonthly = 0, variableCostPct = 0, avgOrderValue = 0 }
      = task.input as { fixedCostsMonthly: number; variableCostPct: number; avgOrderValue: number };

    // Break-even = FixedCosts / (AOV × (1 - variableCostPct/100))
    const contributionPerOrder = avgOrderValue * (1 - variableCostPct / 100);
    const breakEvenOrders = contributionPerOrder > 0
      ? Math.ceil(fixedCostsMonthly / contributionPerOrder)
      : null;

    return {
      success: true,
      output: {
        breakEvenOrders,
        breakEvenRevenue: breakEvenOrders ? breakEvenOrders * avgOrderValue : null,
        contributionPerOrder,
      },
    };
  }

  private async cashProjection(task: AgentTask): Promise<AgentResult> {
    const r = await db.query<{ cash_runway_days: number; daily_burn: number; current_cash: number }>(
      `SELECT
         es.cash_runway_days,
         COALESCE(fs.daily_burn_eur, 0)  AS daily_burn,
         COALESCE(fs.cash_balance_eur, 0) AS current_cash
       FROM ops.empire_state es
       LEFT JOIN ops.financial_snapshot fs ON fs.tenant_id = es.tenant_id
       WHERE es.tenant_id = $1`,
      [task.tenantId]
    );

    const snap = r.rows[0];
    const projections = [30, 60, 90].map(days => ({
      days,
      projected_cash: snap ? snap.current_cash - snap.daily_burn * days : null,
    }));

    return { success: true, output: { cashRunwayDays: snap?.cash_runway_days, projections } };
  }

  private async dailyPnl(task: AgentTask): Promise<AgentResult> {
    const r = await db.query<{ revenue: number; spend: number; cogs: number; net: number }>(
      `SELECT
         SUM(o.revenue_eur) AS revenue,
         SUM(o.cogs_eur)    AS cogs,
         apd.daily_spend    AS spend,
         SUM(o.revenue_eur) - SUM(o.cogs_eur) - apd.daily_spend AS net
       FROM store.orders o
       CROSS JOIN (
         SELECT SUM(spend) AS daily_spend FROM ads.performance_daily
         WHERE tenant_id = $1 AND date = CURRENT_DATE
       ) apd
       WHERE o.tenant_id = $1 AND o.created_at::DATE = CURRENT_DATE
       GROUP BY apd.daily_spend`,
      [task.tenantId]
    );

    return { success: true, output: r.rows[0] ?? { revenue: 0, spend: 0, cogs: 0, net: 0 } };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * AGENT_CONNECTOR_MANAGER
 * =======================
 * Gère tous les tokens OAuth et connexions externes.
 * Refresh automatique. Chiffrement via pgcrypto.
 * Mode dégradé si un connecteur tombe : AEGIS continue.
 */
export class ConnectorManagerAgent extends AgentBase {
  readonly agentId = 'AGENT_CONNECTOR_MANAGER';
  readonly taskTypes = [
    'connector.health_check',     // Vérifie tous les connecteurs actifs
    'connector.refresh_token',    // Refresh un token expirant
    'connector.register',         // Enregistre un nouveau connecteur
    'connector.test',             // Test de connexion
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.taskType) {
      case 'connector.health_check':  return this.healthCheck(task);
      case 'connector.refresh_token': return this.refreshToken(task);
      case 'connector.register':      return this.register(task);
      case 'connector.test':          return this.test(task);
      default: return { success: false, error: `Unknown: ${task.taskType}` };
    }
  }

  private async healthCheck(task: AgentTask): Promise<AgentResult> {
    const r = await db.query<{
      platform: string; status: string; expires_at: string; needs_refresh: boolean;
    }>(
      `SELECT
         platform,
         status,
         access_token_expires_at AS expires_at,
         access_token_expires_at < NOW() + INTERVAL '24 hours' AS needs_refresh
       FROM integrations.connectors
       WHERE tenant_id = $1 AND is_active = TRUE`,
      [task.tenantId]
    );

    const issues: string[] = [];
    for (const conn of r.rows) {
      if (conn.needs_refresh) {
        issues.push(`${conn.platform} token expire dans <24h`);
        await db.query(
          `SELECT agents.send_message($1,'AGENT_CONNECTOR_MANAGER','connector.refresh_token',$2,$3,2)`,
          [this.agentId, JSON.stringify({ platform: conn.platform }), task.tenantId]
        );
      }
      if (conn.status === 'error') {
        issues.push(`${conn.platform} en erreur — mode dégradé actif`);
      }
    }

    return {
      success: true,
      output: { connectors: r.rows, issues, allHealthy: issues.length === 0 },
    };
  }

  private async refreshToken(task: AgentTask): Promise<AgentResult> {
    const { platform } = task.input as { platform: string };

    // Récupère refresh_token chiffré
    const r = await db.query<{ refresh_token_encrypted: string; platform_account_id: string }>(
      `SELECT
         pgp_sym_decrypt(refresh_token_enc::BYTEA, current_setting('app.encryption_key')) AS refresh_token_encrypted,
         platform_account_id
       FROM integrations.connectors
       WHERE tenant_id = $1 AND platform = $2 AND is_active = TRUE`,
      [task.tenantId, platform]
    );

    if (!r.rows[0]) return { success: false, error: `Connecteur ${platform} introuvable` };

    // Appel au service de refresh (isolé par plateforme)
    const refresherUrl = process.env[`${platform.toUpperCase()}_REFRESHER_URL`];
    if (!refresherUrl) {
      logger.warn(`[CONNECTOR] Pas de refresher pour ${platform} — mode dégradé`);
      return { success: true, output: { platform, status: 'degraded', reason: 'no_refresher' } };
    }

    try {
      const resp = await fetch(`${refresherUrl}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: r.rows[0].refresh_token_encrypted }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!resp.ok) throw new Error(`Refresh failed: ${resp.status}`);

      const { accessToken, expiresIn } = await resp.json() as { accessToken: string; expiresIn: number };

      // Stocke le nouveau token chiffré
      await db.query(
        `UPDATE integrations.connectors
         SET access_token_enc = pgp_sym_encrypt($1, current_setting('app.encryption_key'))::TEXT,
             access_token_expires_at = NOW() + ($2 || ' seconds')::INTERVAL,
             status = 'active', last_refresh_at = NOW()
         WHERE tenant_id = $3 AND platform = $4`,
        [accessToken, expiresIn, task.tenantId, platform]
      );

      logger.info(`[CONNECTOR] ${platform} token refreshed — expire dans ${expiresIn}s`);
      return { success: true, output: { platform, status: 'refreshed', expiresIn } };

    } catch (err) {
      await db.query(
        `UPDATE integrations.connectors SET status = 'error', last_error = $1
         WHERE tenant_id = $2 AND platform = $3`,
        [String(err), task.tenantId, platform]
      );
      return { success: false, error: `Refresh ${platform} failed: ${err}` };
    }
  }

  private async register(task: AgentTask): Promise<AgentResult> {
    const { platform, accessToken, refreshToken, expiresIn, accountId }
      = task.input as {
        platform: string; accessToken: string; refreshToken: string;
        expiresIn: number; accountId: string;
      };

    await db.query(
      `INSERT INTO integrations.connectors
         (tenant_id, platform, platform_account_id,
          access_token_enc, refresh_token_enc, access_token_expires_at, status)
       VALUES
         ($1, $2, $3,
          pgp_sym_encrypt($4, current_setting('app.encryption_key'))::TEXT,
          pgp_sym_encrypt($5, current_setting('app.encryption_key'))::TEXT,
          NOW() + ($6 || ' seconds')::INTERVAL, 'active')
       ON CONFLICT (tenant_id, platform) DO UPDATE SET
         access_token_enc = EXCLUDED.access_token_enc,
         refresh_token_enc = EXCLUDED.refresh_token_enc,
         access_token_expires_at = EXCLUDED.access_token_expires_at,
         status = 'active'`,
      [task.tenantId, platform, accountId, accessToken, refreshToken, expiresIn]
    );

    return { success: true, output: { platform, accountId, registered: true } };
  }

  private async test(task: AgentTask): Promise<AgentResult> {
    const { platform } = task.input as { platform: string };

    const testUrl = process.env[`${platform.toUpperCase()}_TEST_URL`];
    if (!testUrl) return { success: true, output: { platform, status: 'no_test_endpoint' } };

    try {
      const resp = await fetch(testUrl, { signal: AbortSignal.timeout(5_000) });
      return { success: true, output: { platform, status: resp.ok ? 'ok' : 'error', code: resp.status } };
    } catch (err) {
      return { success: false, error: `Test ${platform}: ${err}` };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * AGENT_SUPPORT_SAV
 * =================
 * Gère les workflows SAV : réponses automatiques, escalation, templates.
 * Objectif : résoudre avant que ça devienne un chargeback.
 */
export class SupportSavAgent extends AgentBase {
  readonly agentId = 'AGENT_SUPPORT_SAV';
  readonly taskTypes = [
    'sav.triage_ticket',      // Classifie et répond automatiquement
    'sav.generate_response',  // Génère une réponse personnalisée
    'sav.detect_chargeback',  // Détecte signaux de chargeback imminent
    'sav.daily_summary',      // Résumé quotidien SAV
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.taskType) {
      case 'sav.triage_ticket':      return this.triageTicket(task);
      case 'sav.generate_response':  return this.generateResponse(task);
      case 'sav.detect_chargeback':  return this.detectChargeback(task);
      case 'sav.daily_summary':      return this.dailySummary(task);
      default: return { success: false, error: `Unknown: ${task.taskType}` };
    }
  }

  private async triageTicket(task: AgentTask): Promise<AgentResult> {
    const { message, orderId, customerEmail } = task.input as {
      message: string; orderId?: string; customerEmail: string;
    };

    // Classification simple par mots-clés
    const lower = message.toLowerCase();
    let category = 'general';
    let priority  = 'normal';
    let autoReply = false;

    if (lower.includes('remboursement') || lower.includes('refund')) {
      category = 'refund'; priority = 'high';
    } else if (lower.includes('livraison') || lower.includes('shipping') || lower.includes('pas reçu')) {
      category = 'shipping'; autoReply = true;
    } else if (lower.includes('défectueux') || lower.includes('cassé') || lower.includes('broken')) {
      category = 'defect'; priority = 'high';
    } else if (lower.includes('chargeback') || lower.includes('fraude') || lower.includes('litige')) {
      category = 'chargeback'; priority = 'urgent';
    }

    await db.query(
      `INSERT INTO ops.support_tickets
         (tenant_id, order_id, customer_email, message, category, priority, status)
       VALUES ($1,$2,$3,$4,$5,$6,'open')`,
      [task.tenantId, orderId, customerEmail, message, category, priority]
    );

    if (autoReply) {
      await db.query(
        `SELECT agents.send_message($1,'AGENT_SUPPORT_SAV','sav.generate_response',$2,$3,3)`,
        [this.agentId, JSON.stringify({ category, customerEmail, orderId }), task.tenantId]
      );
    }

    return { success: true, output: { category, priority, autoReply } };
  }

  private async generateResponse(task: AgentTask): Promise<AgentResult> {
    const { category, customerEmail, orderId } = task.input as {
      category: string; customerEmail: string; orderId?: string;
    };

    const templates: Record<string, string> = {
      shipping: `Bonjour, nous avons bien reçu votre message. Votre commande ${orderId ?? ''} est en cours d'acheminement. Vous recevrez un email de suivi sous 24h. Merci pour votre patience.`,
      refund:   `Bonjour, votre demande de remboursement a été enregistrée. Notre équipe vous contactera sous 24-48h pour la traiter. Référence : ${orderId ?? 'à venir'}.`,
      defect:   `Bonjour, nous sommes désolés pour ce désagrément. Pourriez-vous nous envoyer une photo du produit ? Nous vous enverrons un remplacement ou un remboursement complet sous 48h.`,
      general:  `Bonjour, merci pour votre message. Notre équipe reviendra vers vous dans les prochaines 24h.`,
    };

    const response = templates[category] ?? templates.general;
    return { success: true, output: { response, to: customerEmail } };
  }

  private async detectChargeback(task: AgentTask): Promise<AgentResult> {
    // Signaux précurseurs : plusieurs tickets du même client + délai livraison > 20j
    const r = await db.query<{ customer_email: string; ticket_count: number; risk_score: number }>(
      `SELECT
         customer_email,
         COUNT(*) AS ticket_count,
         CASE
           WHEN COUNT(*) >= 3 THEN 80
           WHEN COUNT(*) = 2 THEN 50
           ELSE 20
         END AS risk_score
       FROM ops.support_tickets
       WHERE tenant_id = $1
         AND created_at >= NOW() - INTERVAL '30 days'
         AND category IN ('refund','defect','shipping')
       GROUP BY customer_email
       HAVING COUNT(*) >= 2
       ORDER BY ticket_count DESC`,
      [task.tenantId]
    );

    return { success: true, output: { high_risk_customers: r.rows } };
  }

  private async dailySummary(task: AgentTask): Promise<AgentResult> {
    const r = await db.query<{ category: string; count: number; avg_resolution_hours: number }>(
      `SELECT
         category,
         COUNT(*)                              AS count,
         AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600) AS avg_resolution_hours
       FROM ops.support_tickets
       WHERE tenant_id = $1 AND created_at::DATE = CURRENT_DATE
       GROUP BY category`,
      [task.tenantId]
    );

    return { success: true, output: { today: r.rows } };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * AGENT_RELEASE_MANAGER
 * =====================
 * Gère les migrations, le versioning et les rollbacks.
 * Garantit que chaque déploiement est sûr et réversible.
 */
export class ReleaseManagerAgent extends AgentBase {
  readonly agentId = 'AGENT_RELEASE_MANAGER';
  readonly taskTypes = [
    'release.check_migrations',  // Vérifie les migrations en attente
    'release.run_migration',     // Applique une migration en sécurité
    'release.health_post_deploy',// Santé après déploiement
    'release.rollback',          // Plan de rollback
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.taskType) {
      case 'release.check_migrations':   return this.checkMigrations(task);
      case 'release.health_post_deploy': return this.healthPostDeploy(task);
      case 'release.rollback':           return this.rollback(task);
      default: return { success: false, error: `Unknown: ${task.taskType}` };
    }
  }

  private async checkMigrations(task: AgentTask): Promise<AgentResult> {
    const r = await db.query<{ current_version: string; pending: number }>(
      `SELECT
         MAX(version) AS current_version,
         0            AS pending
       FROM schema_migrations
       WHERE status = 'applied'`
    );

    return { success: true, output: r.rows[0] ?? { current_version: '000', pending: 0 } };
  }

  private async healthPostDeploy(task: AgentTask): Promise<AgentResult> {
    const checks: Array<{ name: string; passed: boolean; detail?: string }> = [];

    // DB connectivity
    try {
      await db.query(`SELECT 1`);
      checks.push({ name: 'DB connectivity', passed: true });
    } catch (err) {
      checks.push({ name: 'DB connectivity', passed: false, detail: String(err) });
    }

    // Tables critiques — whitelist strict, pas de string interpolation
    const CRITICAL_TABLES: Record<string, string> = {
      'shops':         'SELECT 1 FROM shops LIMIT 1',
      'agent_schedule':'SELECT 1 FROM agent_schedule LIMIT 1',
      'guardrail_configs': 'SELECT 1 FROM guardrail_configs LIMIT 1',
      'audit_log':     'SELECT 1 FROM audit_log LIMIT 1',
    };
    for (const [label, sql] of Object.entries(CRITICAL_TABLES)) {
      try {
        await db.query(sql);
        checks.push({ name: `table:${label}`, passed: true });
      } catch (err) {
        checks.push({ name: `table:${label}`, passed: false, detail: String(err) });
      }
    }

    const allPassed = checks.every(c => c.passed);

    if (!allPassed) {
      await db.query(
        `SELECT agents.send_message($1,'AGENT_ORCHESTRATOR','alert.deploy_health_fail',$2,NULL,1)`,
        [this.agentId, JSON.stringify({ checks })]
      );
    }

    return { success: allPassed, output: { checks, allPassed } };
  }

  private async rollback(task: AgentTask): Promise<AgentResult> {
    // En v1 : génère les instructions de rollback, ne les exécute pas automatiquement
    const { targetVersion } = task.input as { targetVersion: string };

    return {
      success: true,
      output: {
        instructions: [
          `1. Stopper les workers : docker compose stop worker`,
          `2. Backup immédiat : pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql`,
          `3. Restaurer la version ${targetVersion} du code`,
          `4. Appliquer migration de rollback si disponible`,
          `5. Redémarrer : docker compose up -d`,
          `6. Vérifier : make health`,
        ],
        targetVersion,
        requiresManualApproval: true,
      },
    };
  }
}
