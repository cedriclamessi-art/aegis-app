/**
 * NotificationsService v3.7 — Slack alerts distinct from Morning Brief
 * Immediate push for: anomalies, human overrides, ROI milestones, system events
 */
import { Pool } from 'pg';
import { Redis } from 'ioredis';

type Severity = 'info' | 'warning' | 'critical' | 'emergency';

interface Notification {
  title:    string;
  message:  string;
  severity: Severity;
  data?:    Record<string, unknown>;
}

export class NotificationsService {
  constructor(private db: Pool, private redis: Redis) {
    this.listenForEvents();
  }

  private listenForEvents(): void {
    const sub = this.redis.duplicate();
    sub.psubscribe('aegis:*');
    sub.on('pmessage', async (_pattern, channel, message) => {
      const shopId = channel.split(':')[2];
      if (!shopId) return;

      try {
        const payload = JSON.parse(message);
        await this.routeEvent(shopId, channel, payload);
      } catch { /* ignore */ }
    });
  }

  private async routeEvent(shopId: string, channel: string, payload: any): Promise<void> {
    // Anomaly critical
    if (channel.includes('anomaly_critical')) {
      await this.send(shopId, {
        title: `🚨 ${payload.type?.replace(/_/g, ' ')}`,
        message: payload.title,
        severity: payload.severity,
      });
    }

    // Human override detected
    if (channel.includes('sync_guardian:override_detected')) {
      await this.send(shopId, {
        title: '👤 Human override detected',
        message: `${payload.platform} ${payload.entity_type} ${payload.entity_id} was modified outside AEGIS. Actions paused 4h.`,
        severity: 'warning',
      });
    }

    // Profitability alert
    if (channel.includes('profitability_alert')) {
      await this.send(shopId, {
        title: '💸 Profitability alert',
        message: `Entity ${payload.entity_id} losing €${Math.abs(payload.loss).toFixed(0)} contribution margin. Break-even CPA: €${payload.break_even_cpa?.toFixed(0)}.`,
        severity: 'critical',
      });
    }
  }

  async send(shopId: string, notif: Notification): Promise<void> {
    const { rows: prefs } = await this.db.query(`
      SELECT * FROM brief_delivery_preferences WHERE shop_id = $1 AND enabled = true`, [shopId]);
    if (!prefs[0]) return;

    const p = prefs[0];

    // Slack (separate from morning brief)
    if (p.slack_enabled && p.slack_webhook_url) {
      const color = { info: '#36a64f', warning: '#f7c948', critical: '#e01e5a', emergency: '#7c0000' }[notif.severity];
      await fetch(p.slack_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: p.slack_channel,
          attachments: [{
            color,
            title: notif.title,
            text: notif.message,
            footer: 'AEGIS Intelligence',
            ts: Math.floor(Date.now() / 1000),
          }],
        }),
      }).catch(() => {});
    }

    // WhatsApp for emergency only
    if (p.whatsapp_enabled && p.whatsapp_number && notif.severity === 'emergency') {
      await fetch(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: p.whatsapp_number.replace(/\D/g, ''),
          type: 'text',
          text: { body: `🚨 AEGIS URGENCE\n${notif.title}\n${notif.message}` },
        }),
      }).catch(() => {});
    }
  }
}
