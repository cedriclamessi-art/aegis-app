/**
 * AGENT_PERFORMANCE_BILLING v5.0
 * Modèle hybride: €99 fixe + 3% du ROI certifié au-dessus de la baseline.
 * ROI certifié = revenus attribués à AEGIS (depuis aegis_roi_summary).
 * Baseline = moyenne des 3 mois précédant l'activation d'AEGIS.
 * Facture générée le 1er du mois. Paiement via Stripe.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';

const BASE_FEE_EUR      = 99;
const PERFORMANCE_PCT   = 0.03;  // 3%
const PERFORMANCE_CAP   = 2000;  // Max performance fee par mois (optionnel)

export class AgentPerformanceBilling extends BaseAgent {
  readonly name = 'AGENT_PERFORMANCE_BILLING';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'compute_month':  return this.computeMonth(task);
      case 'issue_invoice':  return this.issueInvoice(task);
      case 'get_history':    return this.getHistory(task);
      case 'preview':        return this.preview(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /** Calculé le 1er du mois — combine base + performance. */
  private async computeMonth(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const now        = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // ROI certifié ce mois (depuis aegis_roi_summary)
    const { rows: roi } = await this.db.query(`
      SELECT COALESCE(SUM(total_revenue_attributed), 0) AS certified_roi
      FROM aegis_roi_summary
      WHERE shop_id=$1 AND period_month=$2`, [shop_id, monthStart]);

    const certifiedRoi = parseFloat(roi[0]?.certified_roi ?? 0);

    // Baseline : moyenne des 3 mois avant activation
    const { rows: baseline } = await this.db.query(`
      SELECT COALESCE(AVG(total_revenue_attributed), 0) AS baseline
      FROM aegis_roi_summary
      WHERE shop_id=$1
        AND period_month < (SELECT MIN(period_month) FROM aegis_roi_summary WHERE shop_id=$1)
        + INTERVAL '3 months'
      LIMIT 3`, [shop_id]);

    const roiBaseline = parseFloat(baseline[0]?.baseline ?? 0);

    // Upsert billing record
    const { rows: [bill] } = await this.db.query(`
      INSERT INTO performance_billing (shop_id, billing_month, base_fee, certified_roi, roi_baseline)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (shop_id, billing_month) DO UPDATE SET
        certified_roi=$4, roi_baseline=$5
      RETURNING *`, [shop_id, monthStart, BASE_FEE_EUR, certifiedRoi, roiBaseline]);

    await this.remember(shop_id, {
      memory_key: `billing_${monthStart.toISOString().slice(0,7)}`,
      memory_type: 'observation',
      value: {
        base_fee:      BASE_FEE_EUR,
        performance_fee: parseFloat(bill.performance_fee ?? 0).toFixed(2),
        total_fee:     parseFloat(bill.total_fee ?? 0).toFixed(2),
        certified_roi: certifiedRoi.toFixed(0),
        message:       `Facture ${monthStart.toLocaleDateString('fr-FR',{month:'long',year:'numeric'})} — Base: €${BASE_FEE_EUR} + Performance: €${parseFloat(bill.performance_fee??0).toFixed(0)} = Total: €${parseFloat(bill.total_fee??0).toFixed(0)}`,
        severity: 'info',
      },
      ttl_hours: 720,
    });

    return { success: true, data: {
      billing_month:    monthStart,
      base_fee:         BASE_FEE_EUR,
      certified_roi:    certifiedRoi,
      roi_baseline:     roiBaseline,
      roi_above_baseline: Math.max(0, certifiedRoi - roiBaseline),
      performance_fee:  parseFloat(bill.performance_fee ?? 0),
      total_fee:        parseFloat(bill.total_fee ?? 0),
    }};
  }

  /** Émet la facture via Stripe. */
  private async issueInvoice(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { billing_month } = payload as any;

    const { rows: [bill] } = await this.db.query(
      `SELECT * FROM performance_billing WHERE shop_id=$1 AND billing_month=$2`,
      [shop_id, billing_month]);

    if (!bill) return { success: false, message: 'Billing record not found' };
    if (bill.invoice_status !== 'pending')
      return { success: false, message: `Invoice already ${bill.invoice_status}` };

    // Stripe integration (appel réel en production)
    const stripePayload = {
      customer:    await this.getStripeCustomerId(shop_id),
      currency:    'eur',
      description: `AEGIS ${new Date(billing_month).toLocaleDateString('fr-FR',{month:'long',year:'numeric'})}`,
      metadata:    {
        base_fee:        bill.base_fee,
        certified_roi:   bill.certified_roi,
        performance_fee: bill.performance_fee,
      },
      line_items: [
        { description: 'Abonnement AEGIS (base)', amount: Math.round(BASE_FEE_EUR * 100), quantity: 1 },
        ...(parseFloat(bill.performance_fee) > 0 ? [{
          description: `Performance AEGIS — 3% × €${parseFloat(bill.roi_above_baseline).toFixed(0)} ROI certifié`,
          amount: Math.round(parseFloat(bill.performance_fee) * 100),
          quantity: 1,
        }] : []),
      ],
    };

    // En production: const invoice = await stripe.invoices.create(stripePayload);
    const mockInvoiceId = `inv_${Date.now()}`;

    await this.db.query(`
      UPDATE performance_billing SET
        invoice_status='issued', issued_at=NOW(), stripe_invoice_id=$1
      WHERE shop_id=$2 AND billing_month=$3`,
      [mockInvoiceId, shop_id, billing_month]);

    await this.emit('billing:invoice_issued', {
      shop_id, billing_month, total_fee: parseFloat(bill.total_fee),
      stripe_invoice_id: mockInvoiceId,
    });

    return { success: true, data: { invoice_id: mockInvoiceId, total: parseFloat(bill.total_fee) } };
  }

  /** Aperçu temps réel — "si le mois se terminait aujourd'hui". */
  private async preview(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0,0,0,0);

    const { rows: roi } = await this.db.query(`
      SELECT COALESCE(SUM(revenue_attributed), 0) AS roi
      FROM aegis_roi_events
      WHERE shop_id=$1 AND event_date >= $2`, [shop_id, monthStart]);

    const certifiedRoi     = parseFloat(roi[0]?.roi ?? 0);
    const { rows: bl }     = await this.db.query(`
      SELECT COALESCE(AVG(total_revenue_attributed),0)/30*${new Date().getDate()} AS daily_baseline
      FROM aegis_roi_summary WHERE shop_id=$1 LIMIT 3`, [shop_id]);
    const baseline         = parseFloat(bl[0]?.daily_baseline ?? 0);
    const aboveBaseline    = Math.max(0, certifiedRoi - baseline);
    const performanceFee   = Math.min(aboveBaseline * PERFORMANCE_PCT, PERFORMANCE_CAP);
    const totalFee         = BASE_FEE_EUR + performanceFee;

    return { success: true, data: {
      base_fee:         BASE_FEE_EUR,
      certified_roi:    certifiedRoi,
      above_baseline:   aboveBaseline,
      performance_fee:  parseFloat(performanceFee.toFixed(2)),
      total_fee:        parseFloat(totalFee.toFixed(2)),
      roi_multiple:     BASE_FEE_EUR > 0 ? (certifiedRoi / totalFee).toFixed(1) : '∞',
    }};
  }

  private async getHistory(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT * FROM performance_billing WHERE shop_id=$1
      ORDER BY billing_month DESC LIMIT 12`, [task.shop_id]);
    return { success: true, data: { history: rows } };
  }

  private async getStripeCustomerId(shopId: string): Promise<string> {
    const { rows } = await this.db.query(
      `SELECT stripe_customer_id FROM shops WHERE id=$1`, [shopId]);
    return rows[0]?.stripe_customer_id ?? '';
  }
}
