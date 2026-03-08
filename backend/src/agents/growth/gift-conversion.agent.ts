/**
 * AGENT_GIFT_CONVERSION v7.0 — Hack #85
 * Convertit les destinataires de cadeaux en clients directs.
 * Identifié via : option "c'est un cadeau", question verbatim, ou signaux Klaviyo.
 * Envoie un email de bienvenue personnalisé avec code promo unique.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import { tierGate } from '../core/tier-gate.middleware';
import { LLMAuditService } from '../core/llm-audit.service';

export class AgentGiftConversion extends BaseAgent {
  readonly name = 'AGENT_GIFT_CONVERSION';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'detect_gifts':    return this.detectGifts(task);
      case 'send_welcome':    return this.sendWelcome(task);
      case 'track_conversion':return this.trackConversion(task);
      case 'get_stats':       return this.getStats(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /** Détecte les commandes cadeaux depuis Shopify et le survey verbatim. */
  private async detectGifts(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // Source 1: Option "c'est un cadeau" dans Shopify
    const { rows: giftOrders } = await this.db.query(`
      SELECT o.shopify_order_id, o.customer_email, o.note_attributes,
             ARRAY_AGG(oi.shopify_product_id) AS product_ids
      FROM shopify_orders o
      JOIN shopify_order_items oi ON oi.shopify_order_id=o.shopify_order_id AND oi.shop_id=$1
      WHERE o.shop_id=$1
        AND o.created_at > NOW() - INTERVAL '7 days'
        AND (
          o.note_attributes::text ILIKE '%gift%'
          OR o.note_attributes::text ILIKE '%cadeau%'
          OR o.note_attributes::text ILIKE '%is_gift%'
        )
        AND NOT EXISTS (
          SELECT 1 FROM gift_recipients gr WHERE gr.order_id=o.shopify_order_id AND gr.shop_id=$1
        )
      GROUP BY o.shopify_order_id, o.customer_email, o.note_attributes
      LIMIT 100`, [shop_id]);

    // Source 2: Verbatims où le client dit "c'était un cadeau"
    const { rows: verbatimGifts } = await this.db.query(`
      SELECT cv.order_id, cv.customer_email
      FROM customer_verbatims cv
      WHERE cv.shop_id=$1
        AND (
          cv.why_bought ILIKE '%cadeau%' OR cv.why_bought ILIKE '%gift%'
          OR cv.main_benefit ILIKE '%offrir%'
        )
        AND NOT EXISTS (
          SELECT 1 FROM gift_recipients gr WHERE gr.order_id=cv.order_id AND gr.shop_id=$1
        )
      LIMIT 50`, [shop_id]);

    let detected = 0;
    for (const order of giftOrders) {
      await this.db.query(`
        INSERT INTO gift_recipients (shop_id, order_id, buyer_email, product_ids, identified_via)
        VALUES ($1,$2,$3,$4,'checkout_gift_option') ON CONFLICT (shop_id, order_id) DO NOTHING`,
        [shop_id, order.shopify_order_id, order.customer_email, order.product_ids]);
      detected++;
    }
    for (const v of verbatimGifts) {
      await this.db.query(`
        INSERT INTO gift_recipients (shop_id, order_id, buyer_email, product_ids, identified_via)
        VALUES ($1,$2,$3,'{}','verbatim_survey') ON CONFLICT (shop_id, order_id) DO NOTHING`,
        [shop_id, v.order_id, v.customer_email]);
      detected++;
    }

    return { success: true, data: { detected } };
  }

  /** Envoie l'email de bienvenue au destinataire du cadeau. */
  private async sendWelcome(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const gate = await tierGate(this.db, shop_id, this.name);

    const { rows: pending } = await this.db.query(`
      SELECT * FROM gift_recipients
      WHERE shop_id=$1 AND welcome_sent_at IS NULL
        AND recipient_email IS NOT NULL
      LIMIT 50`, [shop_id]);

    // Aussi les cadeaux sans email destinataire → email à l'acheteur
    const { rows: pendingBuyer } = await this.db.query(`
      SELECT * FROM gift_recipients
      WHERE shop_id=$1 AND welcome_sent_at IS NULL
        AND recipient_email IS NULL
        AND identified_via='checkout_gift_option'
      LIMIT 50`, [shop_id]);

    let sent = 0;
    for (const gift of [...pending, ...pendingBuyer]) {
      const targetEmail = gift.recipient_email ?? gift.buyer_email;
      const code = `WELCOME${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

      if (gate.verdict === 'shadow' || gate.verdict === 'block') {
        await this.db.query(`
          UPDATE gift_recipients SET welcome_code=$1 WHERE id=$2`, [code, gift.id]);
        continue;
      }

      // Génère email personnalisé
      const llm = new LLMAuditService(this.db);
      let emailContent = { subject: '', body: '' };
      try {
        const { text } = await llm.call({
          shop_id, agent_name: this.name, call_purpose: 'gift_welcome_email',
          max_tokens: 200,
          messages: [{
            role: 'user',
            content: `Rédige un email de bienvenue pour quelqu'un qui vient de recevoir une serviette exfoliante Blissal en cadeau.
${gift.recipient_email ? 'C\'est le destinataire du cadeau.' : 'C\'est l\'acheteur — demande-lui de partager ce code avec le destinataire.'}
Code promo first-order: ${code} (-15%)
2 phrases max, chaleureux, pas commercial. EN FRANÇAIS.
Format JSON: {"subject": "...", "body": "..."}`
          }]
        });
        emailContent = JSON.parse(text.replace(/```json|```/g, '').trim());
      } catch {
        emailContent = {
          subject: gift.recipient_email
            ? 'Votre cadeau Blissal vous attend 🎁'
            : 'Partagez ce code avec votre proche 💝',
          body: `Bienvenue chez Blissal ! Profitez de -15% sur votre première commande avec le code ${code}.`,
        };
      }

      await this.emit('delivery:gift_welcome', {
        shop_id, to: targetEmail,
        subject: emailContent.subject, body: emailContent.body,
        promo_code: code,
      });

      await this.db.query(`
        UPDATE gift_recipients SET
          welcome_sent_at=NOW(), welcome_code=$1
        WHERE id=$2`, [code, gift.id]);

      sent++;
    }

    return { success: true, data: { sent, mode: gate.agent_mode } };
  }

  private async trackConversion(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { promo_code, order_id, revenue } = payload as any;

    await this.db.query(`
      UPDATE gift_recipients SET
        converted=true, converted_order_id=$1,
        converted_at=NOW(), conversion_revenue=$2
      WHERE shop_id=$3 AND welcome_code=$4`,
      [order_id, revenue, shop_id, promo_code]);

    return { success: true, data: { converted: true } };
  }

  private async getStats(task: AgentTask): Promise<AgentResult> {
    const { rows: [stats] } = await this.db.query(`
      SELECT
        COUNT(*) AS total_gifts,
        COUNT(*) FILTER (WHERE welcome_sent_at IS NOT NULL) AS welcomed,
        COUNT(*) FILTER (WHERE converted=true) AS converted,
        SUM(conversion_revenue) AS total_revenue,
        COUNT(*) FILTER (WHERE converted) * 1.0 / NULLIF(COUNT(*) FILTER (WHERE welcome_sent_at IS NOT NULL),0) AS conversion_rate
      FROM gift_recipients WHERE shop_id=$1`, [task.shop_id]);
    return { success: true, data: stats };
  }
}
