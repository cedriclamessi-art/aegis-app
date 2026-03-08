/**
 * AGENT_EMAIL_RECOVERY v4.2
 * Intelligent cart abandonment recovery.
 * Injects winning creative context into Klaviyo flows — not generic emails.
 * "Vous avez oublié votre serviette exfoliante" → specific to their segment,
 * the current winning angle, the best hook of the week.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import { LLMAuditService } from '../core/llm-audit.service';

export class AgentEmailRecovery extends BaseAgent {
  readonly name = 'AGENT_EMAIL_RECOVERY';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'process_abandonment': return this.processAbandonment(task);
      case 'inject_flow':         return this.injectFlow(task);
      case 'mark_recovered':      return this.markRecovered(task);
      case 'get_stats':           return this.getStats(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /** Called when Shopify webhook fires for checkout abandonment. */
  private async processAbandonment(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { email, cart_value, product_ids, session_id } = payload as any;

    // Look up RFM segment
    const { rows: rfm } = await this.db.query(`
      SELECT segment FROM customer_rfm cr
      JOIN customers c ON c.id = cr.customer_id
      WHERE c.shop_id=$1 AND c.email=$2 ORDER BY cr.computed_at DESC LIMIT 1`,
      [shop_id, email]);

    // Get converting angle for this customer (from attribution)
    const { rows: attr } = await this.db.query(`
      SELECT converting_angle, converting_hook FROM attribution_events
      WHERE shop_id=$1 AND customer_email=$2 ORDER BY event_time DESC LIMIT 1`,
      [shop_id, email]);

    // Get current best creative hook (from creative knowledge)
    const { rows: hook } = await this.db.query(`
      SELECT hook_type, content_angle FROM creative_knowledge
      WHERE shop_id=$1 AND valid_until > NOW()
      ORDER BY confidence DESC LIMIT 1`, [shop_id]);

    const rfmSegment      = rfm[0]?.segment ?? 'unknown';
    const convertingAngle = attr[0]?.converting_angle ?? hook[0]?.content_angle ?? 'transformation';
    const bestHook        = attr[0]?.converting_hook  ?? hook[0]?.hook_type     ?? 'question';

    // Store abandonment event
    const { rows: [ev] } = await this.db.query(`
      INSERT INTO cart_abandonment_events
        (shop_id, customer_email, session_id, cart_value, product_ids,
         rfm_segment, converting_angle, best_creative_hook)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [shop_id, email, session_id ?? null, cart_value, product_ids ?? [],
       rfmSegment, convertingAngle, bestHook]);

    // Trigger Klaviyo flow injection
    await this.injectFlow({ ...task, type: 'inject_flow', payload: { event_id: ev.id, email, rfmSegment, convertingAngle, bestHook, cart_value, product_ids } });

    return { success: true, data: { event_id: ev.id, segment: rfmSegment, angle: convertingAngle } };
  }

  /** Injects dynamic content into the Klaviyo abandoned cart flow. */
  private async injectFlow(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { event_id, email, rfmSegment, convertingAngle, bestHook, cart_value } = payload as any;

    const klaviyoKey = await this.getKlaviyoKey(shop_id);
    if (!klaviyoKey) return { success: false, message: 'Klaviyo not configured' };

    // Build personalised content
    const llm = new LLMAuditService(this.db);
    let emailContent: any = {};
    try {
      const { text } = await llm.call({
        shop_id, agent_name: this.name, call_purpose: 'email_recovery_content',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Génère le contenu d'un email de récupération de panier abandonné pour Blissal (serviettes exfoliantes FR).

Client: segment ${rfmSegment}, panier abandonné €${cart_value}
Angle créatif qui convertit ce profil: ${convertingAngle}
Meilleur hook du moment: ${bestHook}

Génère en JSON:
{
  "subject": "...",
  "preheader": "...",
  "headline": "...",
  "body": "...(2-3 phrases)",
  "cta": "...",
  "ps": "...(urgence ou social proof)"
}

Ton: personnel, bénéfice-centré, pas promotionnel. Pas de majuscules excessives.`
        }]
      });
      emailContent = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      // Fallback content
      emailContent = {
        subject:   'Votre serviette Blissal vous attend',
        preheader: 'Elle transforme votre routine en 30 secondes',
        headline:  'Vous avez oublié quelque chose',
        body:      'Votre panier est toujours là. Des milliers de Françaises ont déjà adopté la serviette exfoliante Blissal — rejoignez-les.',
        cta:       'Finaliser ma commande',
        ps:        'Livraison gratuite dès €35 d\'achat.',
      };
    }

    // Trigger Klaviyo event with injected properties
    const klaviyoPayload = {
      data: {
        type:       'event',
        attributes: {
          profile:    { data: { type: 'profile', attributes: { email } } },
          metric:     { data: { type: 'metric', attributes: { name: 'AEGIS Cart Recovery' } } },
          properties: {
            cart_value,
            rfm_segment:       rfmSegment,
            converting_angle:  convertingAngle,
            email_subject:     emailContent.subject,
            email_headline:    emailContent.headline,
            email_body:        emailContent.body,
            email_cta:         emailContent.cta,
            email_ps:          emailContent.ps,
          },
        },
      },
    };

    const res = await fetch('https://a.klaviyo.com/api/events/', {
      method:  'POST',
      headers: {
        'Authorization': `Klaviyo-API-Key ${klaviyoKey}`,
        'Content-Type':  'application/json',
        'revision':      '2024-02-15',
      },
      body: JSON.stringify(klaviyoPayload),
    });

    if (event_id) {
      await this.db.query(`
        UPDATE cart_abandonment_events SET flow_content_injected=$1 WHERE id=$2`,
        [JSON.stringify(emailContent), event_id]);
    }

    return { success: res.ok, data: { klaviyo_status: res.status, content: emailContent } };
  }

  private async markRecovered(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { email, order_id } = payload as any;
    await this.db.query(`
      UPDATE cart_abandonment_events SET recovered=true, recovered_at=NOW(), recovery_order_id=$1
      WHERE shop_id=$2 AND customer_email=$3 AND recovered=false
        AND created_at > NOW() - INTERVAL '72 hours'`,
      [order_id, shop_id, email]);
    return { success: true };
  }

  private async getStats(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE recovered) AS recovered,
        COUNT(*) FILTER (WHERE recovered)::numeric / NULLIF(COUNT(*),0) AS recovery_rate,
        AVG(cart_value) AS avg_cart_value,
        SUM(cart_value) FILTER (WHERE recovered) AS recovered_revenue
      FROM cart_abandonment_events WHERE shop_id=$1 AND created_at > NOW() - INTERVAL '30 days'`,
      [task.shop_id]);
    return { success: true, data: rows[0] ?? {} };
  }

  private async getKlaviyoKey(shopId: string): Promise<string | null> {
    const { rows } = await this.db.query(
      `SELECT api_key FROM klaviyo_config WHERE shop_id=$1`, [shopId]);
    return rows[0]?.api_key ?? null;
  }
}
