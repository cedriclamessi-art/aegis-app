/**
 * WebhookService v3.9 — Outgoing webhooks
 * Routes AEGIS events to Notion, Zapier, Make, Slack, or any URL.
 * HMAC signed. Retries 3× with exponential backoff.
 * Events: anomaly_critical, dct_winner_found, brief_delivered,
 *         profitability_alert, human_override, forecast_ready,
 *         champion_found, stock_critical, agent_decision
 */
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import * as crypto from 'crypto';

export const WEBHOOK_EVENTS = [
  'anomaly_critical', 'dct_winner_found', 'brief_delivered',
  'profitability_alert', 'human_override', 'forecast_ready',
  'champion_found', 'stock_critical', 'agent_decision',
  'guardrail_proposal', 'pixel_health_degraded', 'shadow_report_ready',
] as const;

export type WebhookEvent = typeof WEBHOOK_EVENTS[number];

export class WebhookService {
  constructor(private db: Pool, private redis: Redis) {
    this.listenForEvents();
  }

  private listenForEvents(): void {
    const sub = this.redis.duplicate();
    sub.psubscribe('aegis:*');
    sub.on('pmessage', async (_p, channel, message) => {
      const parts  = channel.split(':');
      const shopId = parts[2];
      const event  = parts[3] as WebhookEvent;
      if (!shopId || !event) return;

      try {
        const payload = JSON.parse(message);
        await this.dispatch(shopId, event, payload);
      } catch { /* ignore */ }
    });
  }

  async dispatch(shopId: string, event: WebhookEvent, payload: unknown): Promise<void> {
    const { rows: endpoints } = await this.db.query(`
      SELECT * FROM webhook_endpoints
      WHERE shop_id=$1 AND is_active=true AND $2=ANY(events)`,
      [shopId, event]);

    for (const endpoint of endpoints) {
      await this.deliver(endpoint, event, payload);
    }
  }

  private async deliver(endpoint: any, event: string, payload: unknown, attempt = 1): Promise<void> {
    const body = JSON.stringify({
      event,
      shop_id:   endpoint.shop_id,
      timestamp: new Date().toISOString(),
      data:      payload,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-AEGIS-Event':   event,
      'X-AEGIS-Version': '3.9',
    };

    // HMAC signature
    if (endpoint.secret) {
      const sig = crypto.createHmac('sha256', endpoint.secret).update(body).digest('hex');
      headers['X-AEGIS-Signature'] = `sha256=${sig}`;
    }

    const startMs = Date.now();
    let success = false;
    let statusCode = 0;
    let responseBody = '';

    try {
      const res = await fetch(endpoint.url, { method: 'POST', headers, body });
      statusCode   = res.status;
      responseBody = await res.text().catch(() => '');
      success      = res.ok;
    } catch (err) {
      responseBody = String(err);
    }

    const durationMs = Date.now() - startMs;

    // Log delivery
    await this.db.query(`
      INSERT INTO webhook_delivery_log
        (webhook_id, event_type, payload, response_status, response_body, duration_ms, success, attempt_number)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [endpoint.id, event, JSON.stringify(payload), statusCode,
       responseBody.slice(0, 500), durationMs, success, attempt]).catch(() => {});

    if (success) {
      await this.db.query(
        `UPDATE webhook_endpoints SET last_triggered_at=NOW(), fail_count=0 WHERE id=$1`,
        [endpoint.id]).catch(() => {});
    } else {
      await this.db.query(
        `UPDATE webhook_endpoints SET fail_count=fail_count+1 WHERE id=$1`,
        [endpoint.id]).catch(() => {});

      // Retry up to 3 times with exponential backoff (2s, 4s, 8s)
      if (attempt < 3) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(r => setTimeout(r, delay));
        await this.deliver(endpoint, event, payload, attempt + 1);
      } else {
        // Disable endpoint after 10 consecutive failures
        const { rows } = await this.db.query(
          `SELECT fail_count FROM webhook_endpoints WHERE id=$1`, [endpoint.id]);
        if (parseInt(rows[0]?.fail_count ?? 0) >= 10) {
          await this.db.query(
            `UPDATE webhook_endpoints SET is_active=false WHERE id=$1`, [endpoint.id]);
        }
      }
    }
  }

  // ── Management API helpers ──────────────────────────────

  async createEndpoint(shopId: string, opts: {
    name: string; url: string; events: string[]; secret?: string;
  }): Promise<string> {
    const { rows } = await this.db.query(`
      INSERT INTO webhook_endpoints (shop_id, name, url, events, secret)
      VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [shopId, opts.name, opts.url, opts.events, opts.secret ?? null]);
    return rows[0].id;
  }

  async testEndpoint(endpointId: string, shopId: string): Promise<boolean> {
    const { rows } = await this.db.query(
      `SELECT * FROM webhook_endpoints WHERE id=$1 AND shop_id=$2`, [endpointId, shopId]);
    if (!rows[0]) return false;
    await this.deliver(rows[0], 'test', { message: 'AEGIS webhook test', timestamp: new Date().toISOString() });
    return true;
  }
}
