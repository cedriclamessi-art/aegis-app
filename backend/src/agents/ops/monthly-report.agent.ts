/**
 * AGENT_MONTHLY_REPORT v4.1
 * Auto-generates a PDF executive report every 1st of the month.
 * Format designed to be shown to accountants, investors, co-founders.
 * Includes AEGIS ROI with methodology explained in plain language.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import { LLMAuditService } from '../core/llm-audit.service';
import Anthropic from '@anthropic-ai/sdk';

export class AgentMonthlyReport extends BaseAgent {
  readonly name = 'AGENT_MONTHLY_REPORT';
  private claude = new Anthropic();

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'generate': return this.generate(task);
      case 'get':      return this.getReport(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  private async generate(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // Determine report month
    const now        = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth(), 0);

    const monthLabel = monthStart.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

    // ── Gather all data ───────────────────────────────────
    const [metrics, profitability, roi, decisions, anomalies, rfm, creative, forecast] =
      await Promise.all([
        this.getMetrics(shop_id, monthStart, monthEnd),
        this.getProfitability(shop_id, monthStart, monthEnd),
        this.getROI(shop_id, monthStart),
        this.getTopDecisions(shop_id, monthStart, monthEnd),
        this.getAnomalies(shop_id, monthStart, monthEnd),
        this.getRFMSnapshot(shop_id),
        this.getCreativeInsights(shop_id),
        this.getLatestForecast(shop_id),
      ]);

    // ── Generate LLM executive summary ───────────────────
    const llm = new LLMAuditService(this.db);
    let executiveSummary = '';
    try {
      const { text } = await llm.call({
        shop_id, agent_name: this.name, call_purpose: 'monthly_report',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `Rédige un résumé exécutif en français pour le rapport mensuel AEGIS de Blissal.

Mois: ${monthLabel}
Chiffre d'affaires: €${(metrics.total_revenue ?? 0).toFixed(0)}
ROAS moyen: ${(metrics.avg_roas ?? 0).toFixed(2)}×
CPA moyen: €${(metrics.avg_cpa ?? 0).toFixed(2)}
Marge contribution: €${(profitability.total_margin ?? 0).toFixed(0)}
Impact AEGIS ce mois: €${((roi.revenue_attributed ?? 0) + (roi.cost_saved ?? 0)).toFixed(0)} (revenus + économies)
ROI AEGIS: ${roi.roi_multiple ?? '?'}×
Décisions exécutées: ${decisions.count ?? 0}
Anomalies détectées et résolues: ${anomalies.resolved ?? 0}
Champions clients: ${rfm.champions ?? 0}

Rédige 3 paragraphes: (1) performance globale, (2) actions clés d'AEGIS et leur impact, (3) recommandations pour le mois suivant.
Ton: professionnel, factuel, adapté à un investisseur ou expert-comptable.`
        }]
      });
      executiveSummary = text;
    } catch {
      executiveSummary = `Rapport automatique AEGIS — ${monthLabel}. Revenus: €${(metrics.total_revenue ?? 0).toFixed(0)}, ROAS: ${(metrics.avg_roas ?? 0).toFixed(2)}×, Impact AEGIS: €${((roi.revenue_attributed ?? 0) + (roi.cost_saved ?? 0)).toFixed(0)}.`;
    }

    // ── Generate PDF HTML ─────────────────────────────────
    const html = this.generateHTML({
      monthLabel, shop_id, executiveSummary,
      metrics, profitability, roi, decisions, anomalies, rfm, creative, forecast,
    });

    // Store data snapshot
    const dataSnapshot = {
      month: monthLabel, metrics, profitability, roi,
      decisions, anomalies, rfm, creative, executiveSummary,
    };

    const { rows: [report] } = await this.db.query(`
      INSERT INTO monthly_reports (shop_id, period_month, data_snapshot)
      VALUES ($1,$2,$3)
      ON CONFLICT (shop_id, period_month) DO UPDATE SET
        data_snapshot=$3, generated_at=NOW()
      RETURNING id`,
      [shop_id, monthStart, JSON.stringify(dataSnapshot)]);

    // Emit for delivery (email via AGENT_DELIVERY)
    await this.emit('report:monthly_ready', {
      shop_id, report_id: report.id, month: monthLabel,
      html, data: dataSnapshot,
    });

    await this.remember(shop_id, {
      memory_key: `monthly_report_${monthStart.toISOString().slice(0,7)}`,
      memory_type: 'observation',
      value: {
        month: monthLabel, report_id: report.id,
        revenue: metrics.total_revenue, roi_multiple: roi.roi_multiple,
        message: `Rapport mensuel ${monthLabel} généré`,
        severity: 'info',
      },
      ttl_hours: 720,
    });

    return { success: true, data: { report_id: report.id, month: monthLabel, html_length: html.length } };
  }

  private generateHTML(data: any): string {
    const { monthLabel, executiveSummary, metrics, profitability, roi, decisions, anomalies, rfm } = data;
    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color:#1a1a2e; background:#fff; }
  .cover { background: linear-gradient(135deg,#1a1a2e 0%,#16213e 60%,#0f3460 100%);
           color:#fff; padding:60px 50px; min-height:280px; }
  .cover h1 { font-size:32px; font-weight:700; letter-spacing:-0.5px; }
  .cover .sub { font-size:16px; opacity:0.7; margin-top:8px; }
  .cover .month { font-size:48px; font-weight:800; margin-top:20px; color:#e94560; }
  .cover .tagline { font-size:13px; opacity:0.5; margin-top:30px; letter-spacing:2px; text-transform:uppercase; }
  .body { padding:40px 50px; }
  h2 { font-size:20px; font-weight:700; margin: 30px 0 15px; padding-bottom:8px;
       border-bottom:2px solid #e94560; }
  .kpi-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:20px; }
  .kpi { background:#f8f9ff; border:1px solid #e8e8f0; border-radius:8px; padding:18px; }
  .kpi .label { font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#888; }
  .kpi .value { font-size:26px; font-weight:800; color:#1a1a2e; margin-top:4px; }
  .kpi .delta { font-size:12px; margin-top:4px; }
  .kpi .delta.pos { color:#22c55e; } .kpi .delta.neg { color:#ef4444; }
  .aegis-roi { background:linear-gradient(135deg,#1a1a2e,#0f3460); color:#fff;
               border-radius:12px; padding:28px; margin:20px 0; }
  .aegis-roi h3 { color:#e94560; font-size:14px; text-transform:uppercase; letter-spacing:2px; }
  .roi-number { font-size:52px; font-weight:900; margin:10px 0; }
  .roi-sub { font-size:13px; opacity:0.7; }
  .summary { background:#f8f9ff; border-left:4px solid #e94560;
             padding:20px; border-radius:0 8px 8px 0; font-size:14px; line-height:1.7; color:#333; }
  .decisions-list { font-size:13px; }
  .decision { padding:10px 0; border-bottom:1px solid #f0f0f0; }
  .decision .agent { font-weight:700; color:#e94560; font-size:11px; text-transform:uppercase; }
  footer { margin-top:40px; padding:20px 0; border-top:1px solid #eee;
           font-size:11px; color:#aaa; text-align:center; }
</style>
</head>
<body>
<div class="cover">
  <div class="tagline">AEGIS Intelligence Platform</div>
  <div class="month">${monthLabel}</div>
  <h1>Rapport Mensuel</h1>
  <div class="sub">Blissal — Analyse de performance & impact AEGIS</div>
</div>

<div class="body">

<h2>Indicateurs clés</h2>
<div class="kpi-grid">
  <div class="kpi">
    <div class="label">Chiffre d'affaires</div>
    <div class="value">€${((metrics.total_revenue ?? 0) / 1000).toFixed(1)}k</div>
  </div>
  <div class="kpi">
    <div class="label">ROAS moyen</div>
    <div class="value">${(metrics.avg_roas ?? 0).toFixed(2)}×</div>
  </div>
  <div class="kpi">
    <div class="label">CPA moyen</div>
    <div class="value">€${(metrics.avg_cpa ?? 0).toFixed(2)}</div>
  </div>
  <div class="kpi">
    <div class="label">Marge contribution</div>
    <div class="value">€${((profitability.total_margin ?? 0) / 1000).toFixed(1)}k</div>
  </div>
</div>

<div class="kpi-grid">
  <div class="kpi">
    <div class="label">Champions clients</div>
    <div class="value">${rfm.champions ?? 0}</div>
  </div>
  <div class="kpi">
    <div class="label">Clients à risque</div>
    <div class="value">${rfm.at_risk ?? 0}</div>
  </div>
  <div class="kpi">
    <div class="label">Décisions AEGIS</div>
    <div class="value">${decisions.count ?? 0}</div>
  </div>
  <div class="kpi">
    <div class="label">Anomalies résolues</div>
    <div class="value">${anomalies.resolved ?? 0}</div>
  </div>
</div>

<div class="aegis-roi">
  <h3>Impact AEGIS ce mois</h3>
  <div class="roi-number">${roi.roi_multiple ?? '?'}×</div>
  <div class="roi-sub">ROI sur abonnement AEGIS (€199/mois)</div>
  <div style="margin-top:16px; display:grid; grid-template-columns:1fr 1fr; gap:20px;">
    <div>
      <div style="font-size:11px; opacity:0.6; text-transform:uppercase;">Revenus attribués</div>
      <div style="font-size:22px; font-weight:700;">€${(roi.revenue_attributed ?? 0).toFixed(0)}</div>
      <div style="font-size:11px; opacity:0.5;">AGENT_SCALE — budgets optimisés</div>
    </div>
    <div>
      <div style="font-size:11px; opacity:0.6; text-transform:uppercase;">Pertes évitées</div>
      <div style="font-size:22px; font-weight:700;">€${(roi.cost_saved ?? 0).toFixed(0)}</div>
      <div style="font-size:11px; opacity:0.5;">AGENT_STOP_LOSS + AGENT_ANOMALY</div>
    </div>
  </div>
</div>

<h2>Résumé exécutif</h2>
<div class="summary">${executiveSummary.replace(/\n/g, '<br>')}</div>

<h2>Principales décisions AEGIS</h2>
<div class="decisions-list">
  ${(decisions.top ?? []).map((d: any) => `
  <div class="decision">
    <span class="agent">${d.agent_name}</span>
    <span style="margin-left:8px; color:#555;">${d.narrative_fr ?? d.decision_type}: ${d.subject_id}</span>
    <span style="float:right; font-size:12px; color:#888;">${new Date(d.created_at).toLocaleDateString('fr-FR')}</span>
  </div>`).join('') || '<div class="decision">Aucune décision ce mois.</div>'}
</div>

<footer>
  Généré automatiquement par AEGIS v4.1 · ${new Date().toLocaleDateString('fr-FR')} ·
  Blissal · Confidentiel
</footer>
</div>
</body>
</html>`;
  }

  // ── Data fetchers ─────────────────────────────────────────
  private async getMetrics(shopId: string, from: Date, to: Date) {
    const { rows } = await this.db.query(`
      SELECT SUM(revenue) AS total_revenue, AVG(roas) AS avg_roas, AVG(cpa) AS avg_cpa, SUM(spend) AS total_spend
      FROM ad_metrics WHERE shop_id=$1 AND recorded_at BETWEEN $2 AND $3`, [shopId, from, to]);
    return rows[0] ?? {};
  }

  private async getProfitability(shopId: string, from: Date, to: Date) {
    const { rows } = await this.db.query(`
      SELECT SUM(contribution_margin) AS total_margin, AVG(contribution_margin_pct) AS avg_margin_pct
      FROM profitability_metrics WHERE shop_id=$1 AND period_end BETWEEN $2 AND $3`, [shopId, from, to]);
    return rows[0] ?? {};
  }

  private async getROI(shopId: string, monthStart: Date) {
    const { rows } = await this.db.query(`
      SELECT total_revenue_attributed AS revenue_attributed, total_cost_saved AS cost_saved, roi_multiple
      FROM aegis_roi_summary WHERE shop_id=$1 AND period_month=$2`, [shopId, monthStart]);
    return rows[0] ?? { revenue_attributed: 0, cost_saved: 0, roi_multiple: 0 };
  }

  private async getTopDecisions(shopId: string, from: Date, to: Date) {
    const { rows } = await this.db.query(`
      SELECT ad.agent_name, ad.decision_type, ad.subject_id, ad.created_at, dn.narrative_fr
      FROM agent_decisions ad
      LEFT JOIN decision_narratives dn ON dn.decision_id = ad.id
      WHERE ad.shop_id=$1 AND ad.executed=true AND ad.created_at BETWEEN $2 AND $3
      ORDER BY ad.created_at DESC LIMIT 8`, [shopId, from, to]);
    const { rows: cnt } = await this.db.query(`
      SELECT COUNT(*) AS n FROM agent_decisions WHERE shop_id=$1 AND executed=true AND created_at BETWEEN $2 AND $3`,
      [shopId, from, to]);
    return { top: rows, count: parseInt(cnt[0]?.n ?? 0) };
  }

  private async getAnomalies(shopId: string, from: Date, to: Date) {
    const { rows } = await this.db.query(`
      SELECT COUNT(*) AS total, COUNT(resolved_at) AS resolved
      FROM anomalies WHERE shop_id=$1 AND created_at BETWEEN $2 AND $3`, [shopId, from, to]);
    return rows[0] ?? { total: 0, resolved: 0 };
  }

  private async getRFMSnapshot(shopId: string) {
    const { rows } = await this.db.query(`
      SELECT segment, COUNT(*) AS n FROM customer_rfm WHERE shop_id=$1 GROUP BY segment`, [shopId]);
    return Object.fromEntries(rows.map((r: any) => [r.segment, parseInt(r.n)]));
  }

  private async getCreativeInsights(shopId: string) {
    const { rows } = await this.db.query(`
      SELECT content_angle, hook_type, avg_roas FROM creative_tag_performance
      WHERE shop_id=$1 ORDER BY avg_roas DESC LIMIT 3`, [shopId]);
    return rows;
  }

  private async getLatestForecast(shopId: string) {
    const { rows } = await this.db.query(`
      SELECT revenue_14d_mid, narrative FROM forecasts WHERE shop_id=$1 ORDER BY generated_at DESC LIMIT 1`, [shopId]);
    return rows[0] ?? {};
  }

  private async getReport(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT id, period_month, generated_at, email_sent, data_snapshot->>'executiveSummary' AS summary
      FROM monthly_reports WHERE shop_id=$1 ORDER BY period_month DESC LIMIT 6`, [task.shop_id]);
    return { success: true, data: { reports: rows } };
  }
}
