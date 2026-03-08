/**
 * AGENT_DELIVERY v3.6 — Morning Brief distribution
 * Sends the Morning Brief via Email (Resend), Slack webhook, and/or WhatsApp.
 * An alert that stays in a dashboard isn't an alert.
 */

import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';

interface BriefContent {
  date:            string;
  empire_index:    number;
  kpis: {
    revenue_24h:  number;
    roas:         number;
    cpa:          number;
    spend:        number;
    active_ads:   number;
  };
  winner_creative: { name: string; roas: number; cpa: number; ctr: number } | null;
  priority_actions: Array<{ priority: string; text: string }>;
  night_actions:    Array<{ time: string; label: string; text: string }>;
  stock_alerts:     Array<{ sku: string; days_left: number }>;
  competitor_moves: Array<{ name: string; move: string }>;
}

export class AgentDelivery extends BaseAgent {
  readonly name = 'AGENT_DELIVERY';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'send_brief':     return this.sendBrief(task);
      case 'send_alert':     return this.sendAlert(task);
      case 'test_channels':  return this.testChannels(task);
      default: throw new Error(`Unknown task: ${task.type}`);
    }
  }

  /**
   * Send Morning Brief to all enabled channels.
   */
  private async sendBrief(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const brief = payload as BriefContent;

    // Fetch delivery preferences
    const { rows: prefs } = await this.db.query(
      `SELECT * FROM brief_delivery_preferences WHERE shop_id = $1 AND enabled = true`,
      [shop_id]
    );
    if (!prefs[0]) return { success: false, message: 'No delivery preferences configured' };

    const p = prefs[0];
    const results: Record<string, unknown> = {};

    // Send via all enabled channels
    if (p.email_enabled && p.email_address) {
      results.email = await this.sendEmail(p.email_address, brief, p.digest_format);
    }
    if (p.slack_enabled && p.slack_webhook_url) {
      results.slack = await this.sendSlack(p.slack_webhook_url, p.slack_channel, brief);
    }
    if (p.whatsapp_enabled && p.whatsapp_number) {
      results.whatsapp = await this.sendWhatsApp(p.whatsapp_number, brief);
    }

    // Log delivery
    for (const [channel, result] of Object.entries(results)) {
      await this.db.query(
        `INSERT INTO brief_delivery_log (shop_id, brief_date, channel, status, error_msg, delivered_at)
         VALUES ($1, CURRENT_DATE, $2, $3, $4, NOW())`,
        [shop_id, channel, (result as any)?.success ? 'sent' : 'failed', (result as any)?.error ?? null]
      );
    }

    return { success: true, data: results };
  }

  /**
   * Send email via Resend API.
   */
  private async sendEmail(
    to: string, brief: BriefContent, format: string
  ): Promise<{ success: boolean; error?: string }> {
    const html = this.buildEmailHTML(brief, format);

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:    'AEGIS <brief@aegis.app>',
          to:      [to],
          subject: `☀ AEGIS Brief — ${brief.date} · Empire ${brief.empire_index}/100 · ${this.formatRevenue(brief.kpis.revenue_24h)}`,
          html,
        }),
      });

      const data = await response.json() as any;
      if (!response.ok) return { success: false, error: data.message };
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Send Slack message via webhook.
   */
  private async sendSlack(
    webhookUrl: string, channel: string, brief: BriefContent
  ): Promise<{ success: boolean; error?: string }> {
    const actions = brief.priority_actions.slice(0, 3).map(a =>
      `• *${a.priority}* — ${a.text}`
    ).join('\n');

    const stockAlert = brief.stock_alerts.length > 0
      ? `\n⚠ *Stock critique :* ${brief.stock_alerts.map(s => `${s.sku} (J+${s.days_left})`).join(', ')}`
      : '';

    const blocks = [
      { type: 'header', text: { type: 'plain_text', text: `☀ AEGIS Morning Brief — ${brief.date}` } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Revenue 24h*\n€${brief.kpis.revenue_24h.toLocaleString('fr-FR')}` },
          { type: 'mrkdwn', text: `*ROAS*\n${brief.kpis.roas.toFixed(2)}×` },
          { type: 'mrkdwn', text: `*CPA*\n€${brief.kpis.cpa.toFixed(2)}` },
          { type: 'mrkdwn', text: `*Empire Index*\n${brief.empire_index}/100` },
        ],
      },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: `*⚡ Actions prioritaires*\n${actions}${stockAlert}` } },
    ];

    if (brief.winner_creative) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*🏆 Winner* — ${brief.winner_creative.name} · ROAS ${brief.winner_creative.roas.toFixed(2)}× · CPA €${brief.winner_creative.cpa.toFixed(2)}` },
      } as any);
    }

    try {
      const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, blocks, text: `AEGIS Brief ${brief.date}` }),
      });
      return { success: resp.ok };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Send WhatsApp via WhatsApp Business API (Cloud API).
   */
  private async sendWhatsApp(
    to: string, brief: BriefContent
  ): Promise<{ success: boolean; error?: string }> {
    const compact = this.buildWhatsAppMessage(brief);

    try {
      const resp = await fetch(
        `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: to.replace(/\D/g, ''),
            type: 'text',
            text: { body: compact },
          }),
        }
      );
      const data = await resp.json() as any;
      if (!resp.ok) return { success: false, error: data.error?.message };
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Send an immediate alert (for critical anomalies, not just morning brief).
   */
  private async sendAlert(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { severity, title, message } = payload as any;

    const { rows: prefs } = await this.db.query(
      `SELECT * FROM brief_delivery_preferences WHERE shop_id = $1 AND enabled = true`,
      [shop_id]
    );
    if (!prefs[0]) return { success: false, message: 'No delivery configured' };

    const p = prefs[0];
    const emoji = severity === 'emergency' ? '🚨' : severity === 'critical' ? '⚠️' : 'ℹ️';

    if (p.slack_enabled && p.slack_webhook_url) {
      await fetch(p.slack_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `${emoji} *AEGIS ALERT* — ${title}\n${message}`,
          channel: p.slack_channel,
        }),
      });
    }

    if (p.whatsapp_enabled && p.whatsapp_number && severity === 'emergency') {
      await this.sendWhatsApp(p.whatsapp_number, null as any);
    }

    return { success: true };
  }

  private async testChannels(task: AgentTask): Promise<AgentResult> {
    const testBrief: BriefContent = {
      date: new Date().toLocaleDateString('fr-FR'),
      empire_index: 72,
      kpis: { revenue_24h: 1284, roas: 3.2, cpa: 22, spend: 284, active_ads: 6 },
      winner_creative: { name: 'Transformation V2', roas: 3.8, cpa: 18, ctr: 4.2 },
      priority_actions: [
        { priority: 'URGENT', text: 'Scaler Transformation V2 : +20% budget' },
        { priority: 'HIGH', text: 'Lancer DCT Itération 2' },
      ],
      night_actions: [{ time: '03:41', label: 'Scale', text: 'Transformation V2 +30%' }],
      stock_alerts: [{ sku: 'S-003 Bleu Marine', days_left: 8 }],
      competitor_moves: [{ name: 'Ecovia', move: '2 nouvelles ads lancées' }],
    };
    return this.sendBrief({ ...task, payload: testBrief });
  }

  private buildEmailHTML(brief: BriefContent, format: string): string {
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#06070F;color:#F1F5F9;margin:0;padding:0}
  .container{max-width:600px;margin:0 auto;padding:24px}
  .header{background:linear-gradient(135deg,#7C3AED,#10B981);padding:20px;border-radius:12px;text-align:center;margin-bottom:16px}
  .header h1{margin:0;font-size:22px;color:white}
  .kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px}
  .kpi{background:#111226;border:1px solid rgba(139,92,246,.2);border-radius:10px;padding:14px;text-align:center}
  .kpi-val{font-size:22px;font-weight:800;color:#A78BFA}
  .kpi-lbl{font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.06em;margin-top:3px}
  .card{background:#111226;border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:16px;margin-bottom:12px}
  .action-item{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04)}
  .priority{font-family:monospace;font-size:9px;padding:2px 8px;border-radius:10px;flex-shrink:0}
  .p-urgent{background:rgba(244,63,94,.2);color:#F43F5E;border:1px solid rgba(244,63,94,.4)}
  .p-high{background:rgba(139,92,246,.2);color:#A78BFA;border:1px solid rgba(139,92,246,.4)}
  .p-med{background:rgba(245,158,11,.2);color:#F59E0B;border:1px solid rgba(245,158,11,.4)}
  .footer{text-align:center;color:#475569;font-size:11px;margin-top:20px}
</style></head><body><div class="container">
  <div class="header"><h1>☀ AEGIS Morning Brief</h1><p style="color:rgba(255,255,255,.7);margin:4px 0 0">${brief.date} · Empire Index ${brief.empire_index}/100</p></div>
  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-val">€${brief.kpis.revenue_24h.toLocaleString('fr-FR')}</div><div class="kpi-lbl">Revenue 24h</div></div>
    <div class="kpi"><div class="kpi-val">${brief.kpis.roas.toFixed(1)}×</div><div class="kpi-lbl">ROAS</div></div>
    <div class="kpi"><div class="kpi-val">€${brief.kpis.cpa.toFixed(0)}</div><div class="kpi-lbl">CPA</div></div>
    <div class="kpi"><div class="kpi-val">€${brief.kpis.spend.toFixed(0)}</div><div class="kpi-lbl">Spend</div></div>
    <div class="kpi"><div class="kpi-val">${brief.kpis.active_ads}</div><div class="kpi-lbl">Ads actives</div></div>
    <div class="kpi"><div class="kpi-val">${brief.empire_index}</div><div class="kpi-lbl">Empire Index</div></div>
  </div>
  ${brief.winner_creative ? `<div class="card"><strong>🏆 Winner</strong> — ${brief.winner_creative.name} · ROAS ${brief.winner_creative.roas.toFixed(2)}× · CPA €${brief.winner_creative.cpa.toFixed(2)} · CTR ${brief.winner_creative.ctr.toFixed(1)}%</div>` : ''}
  <div class="card"><strong>⚡ Actions prioritaires</strong>
    ${brief.priority_actions.map(a => `<div class="action-item"><span class="priority p-${a.priority.toLowerCase()}">${a.priority}</span><span style="font-size:12px">${a.text}</span></div>`).join('')}
  </div>
  ${brief.stock_alerts.length ? `<div class="card" style="border-color:rgba(244,63,94,.3)"><strong>📦 Stock critique</strong><br/><br/>${brief.stock_alerts.map(s => `<div style="font-size:12px">• ${s.sku} — rupture dans <strong style="color:#F43F5E">J+${s.days_left}</strong></div>`).join('')}</div>` : ''}
  <div class="footer">AEGIS · Autonomous E-Commerce Intelligence · Blissal SAS<br/><a href="https://aegis.app" style="color:#7C3AED">Voir dashboard complet →</a></div>
</div></body></html>`;
  }

  private buildWhatsAppMessage(brief: BriefContent): string {
    const actions = brief.priority_actions.slice(0, 2).map(a => `• ${a.text}`).join('\n');
    const stock = brief.stock_alerts.length ? `\n⚠ Stock critique: ${brief.stock_alerts[0].sku} J+${brief.stock_alerts[0].days_left}` : '';
    return `☀ *AEGIS Brief — ${brief.date}*

💰 €${brief.kpis.revenue_24h.toLocaleString('fr-FR')} · ROAS ${brief.kpis.roas.toFixed(1)}× · CPA €${brief.kpis.cpa.toFixed(0)}
📊 Empire Index ${brief.empire_index}/100

⚡ *Actions:*
${actions}${stock}

→ Dashboard: https://aegis.app`;
  }

  private formatRevenue(n: number): string {
    return `€${n.toLocaleString('fr-FR')}`;
  }
}
