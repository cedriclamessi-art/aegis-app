/**
 * AGENT_LOYALTY v7.0 — Hack #91
 * Programme de fidélité complet : points, niveaux, récompenses.
 * Déclenché par palier — T2 observe, T3 gère les points auto,
 * T4 optimise les récompenses, T5 personnalise par segment.
 *
 * 4 niveaux : Bronze → Argent → Or → Platine
 * Accrual : 10 pts/€ · 50 pts avis · 200 pts parrainage
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import { tierGate } from '../core/tier-gate.middleware';
import { ThresholdHelper } from '../core/threshold.helper';

export class AgentLoyalty extends BaseAgent {
  readonly name = 'AGENT_LOYALTY';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'setup':              return this.setup(task);
      case 'award_points':       return this.awardPoints(task);
      case 'process_redemption': return this.processRedemption(task);
      case 'upgrade_tiers':      return this.upgradeTiers(task);
      case 'generate_campaigns': return this.generateCampaigns(task);
      case 'get_account':        return this.getAccount(task);
      case 'expire_points':      return this.expirePoints(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  private async setup(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const config = (payload ?? {}) as any;

    await this.db.query(`
      INSERT INTO loyalty_programs (shop_id, program_name, points_per_eur, points_per_review, points_per_referral)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (shop_id) DO UPDATE SET
        program_name=$2, points_per_eur=$3, points_per_review=$4, points_per_referral=$5`,
      [shop_id,
       config.program_name ?? 'Programme Fidélité',
       config.points_per_eur ?? 10,
       config.points_per_review ?? 50,
       config.points_per_referral ?? 200]);

    return { success: true, data: { message: 'Programme de fidélité configuré' } };
  }

  /** Attribue des points suite à un événement (achat, avis, parrainage). */
  async awardPoints(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { customer_id, event_type, reference_id, amount_eur } = payload as any;

    const gate = await tierGate(this.db, shop_id, this.name);
    if (gate.verdict === 'block' || gate.verdict === 'shadow') {
      return { success: true, data: { skipped: true, mode: gate.agent_mode } };
    }

    const { rows: [program] } = await this.db.query(
      `SELECT * FROM loyalty_programs WHERE shop_id=$1 AND is_active=true`, [shop_id]);
    if (!program) return { success: false, message: 'No active loyalty program' };

    let points = 0;
    let description = '';

    switch (event_type) {
      case 'purchase':
        points = Math.floor((amount_eur ?? 0) * program.points_per_eur);
        description = `Achat €${amount_eur?.toFixed(2)} → ${points} pts`;
        break;
      case 'review':
        points = program.points_per_review;
        description = `Avis client → ${points} pts`;
        break;
      case 'referral':
        points = program.points_per_referral;
        description = `Parrainage → ${points} pts`;
        break;
      case 'birthday':
        points = 100;
        description = `Bonus anniversaire → ${points} pts`;
        break;
      case 'signup':
        points = 50;
        description = `Inscription programme → ${points} pts`;
        break;
    }

    if (points <= 0) return { success: false, message: 'No points to award' };

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + program.points_validity_days);

    await this.db.query(`
      INSERT INTO loyalty_transactions
        (shop_id, customer_id, points, transaction_type, reference_id, description, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [shop_id, customer_id, points, event_type, reference_id, description, expiresAt]);

    // Update account
    await this.db.query(`
      INSERT INTO loyalty_accounts (shop_id, customer_id, total_points, available_points, lifetime_points)
      VALUES ($1,$2,$3,$3,$3)
      ON CONFLICT (shop_id, customer_id) DO UPDATE SET
        total_points     = loyalty_accounts.total_points + $3,
        available_points = loyalty_accounts.available_points + $3,
        lifetime_points  = loyalty_accounts.lifetime_points + $3,
        last_activity_at = NOW()`,
      [shop_id, customer_id, points]);

    // Check tier upgrade
    await this.upgradeTiers({ ...task, payload: { customer_id } });

    return { success: true, data: { points_awarded: points, description } };
  }

  private async upgradeTiers(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { customer_id } = (payload ?? {}) as any;

    const { rows: [account] } = await this.db.query(
      `SELECT * FROM loyalty_accounts WHERE shop_id=$1 AND customer_id=$2`, [shop_id, customer_id]);
    if (!account) return { success: true, data: {} };

    const { rows: [program] } = await this.db.query(
      `SELECT tiers FROM loyalty_programs WHERE shop_id=$1`, [shop_id]);
    if (!program) return { success: true, data: {} };

    const tiers = program.tiers as any[];
    const lifetimePts = parseInt(account.lifetime_points);

    // Trouve le tier applicable (le plus haut où lifetime_points >= min_points)
    let newTier = tiers[0].name;
    for (const tier of tiers) {
      if (lifetimePts >= tier.min_points) newTier = tier.name;
    }

    if (newTier !== account.current_tier) {
      await this.db.query(`
        UPDATE loyalty_accounts SET current_tier=$1, tier_entered_at=NOW()
        WHERE shop_id=$2 AND customer_id=$3`, [newTier, shop_id, customer_id]);

      // Notifie Klaviyo
      await this.emit('klaviyo:loyalty_tier_upgrade', {
        shop_id, customer_id, new_tier: newTier, old_tier: account.current_tier,
      });
    }

    return { success: true, data: { current_tier: newTier } };
  }

  /** Expire les points dépassant leur date de validité. */
  private async expirePoints(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    const { rows: expired } = await this.db.query(`
      SELECT customer_id, SUM(points) AS points_to_expire
      FROM loyalty_transactions
      WHERE shop_id=$1 AND expires_at < NOW()
        AND points > 0
        AND NOT EXISTS (
          SELECT 1 FROM loyalty_transactions lt2
          WHERE lt2.reference_id=loyalty_transactions.id::text
            AND lt2.transaction_type='expiry'
        )
      GROUP BY customer_id`, [shop_id]);

    let totalExpired = 0;
    for (const row of expired) {
      const pts = parseInt(row.points_to_expire);
      await this.db.query(`
        INSERT INTO loyalty_transactions (shop_id, customer_id, points, transaction_type, description)
        VALUES ($1,$2,$3,'expiry','Points expirés')`,
        [shop_id, row.customer_id, -pts]);

      await this.db.query(`
        UPDATE loyalty_accounts SET
          available_points = GREATEST(0, available_points - $1),
          total_points = GREATEST(0, total_points - $1)
        WHERE shop_id=$2 AND customer_id=$3`,
        [pts, shop_id, row.customer_id]);

      totalExpired += pts;
    }

    return { success: true, data: { points_expired: totalExpired, customers_affected: expired.length } };
  }

  /** Génère des campagnes ciblées basées sur les niveaux de fidélité. */
  private async generateCampaigns(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // Clients proches d'un upgrade de tier
    const { rows: nearUpgrade } = await this.db.query(`
      SELECT la.customer_id, la.current_tier, la.lifetime_points,
             c.email,
             (lp.tiers->1->>'min_points')::INTEGER AS next_tier_min,
             (lp.tiers->1->>'name') AS next_tier_name
      FROM loyalty_accounts la
      JOIN customers c ON c.id=la.customer_id
      JOIN loyalty_programs lp ON lp.shop_id=$1
      WHERE la.shop_id=$1 AND la.current_tier='Bronze'
        AND la.lifetime_points >= ((lp.tiers->1->>'min_points')::INTEGER - 100)
      LIMIT 200`, [shop_id]);

    if (nearUpgrade.length > 0) {
      await this.emit('klaviyo:loyalty_near_upgrade', {
        shop_id, customers: nearUpgrade.map(c => ({
          email: c.email, points: c.lifetime_points,
          points_needed: c.next_tier_min - c.lifetime_points,
          next_tier: c.next_tier_name,
        })),
      });
    }

    // Champions fidélité inactifs depuis 60j
    const { rows: dormantChamps } = await this.db.query(`
      SELECT la.customer_id, c.email, la.available_points, la.current_tier
      FROM loyalty_accounts la
      JOIN customers c ON c.id=la.customer_id
      WHERE la.shop_id=$1
        AND la.current_tier IN ('Or','Platine')
        AND la.last_activity_at < NOW() - INTERVAL '60 days'
        AND la.available_points >= 200
      LIMIT 100`, [shop_id]);

    if (dormantChamps.length > 0) {
      await this.emit('klaviyo:loyalty_dormant_vip', {
        shop_id, customers: dormantChamps,
        message: 'Vos points expirent dans 90 jours — profitez-en maintenant',
      });
    }

    return { success: true, data: {
      near_upgrade_notified: nearUpgrade.length,
      dormant_vip_reactivated: dormantChamps.length,
    }};
  }

  private async processRedemption(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { customer_id, points_to_redeem, order_id } = payload as any;

    const { rows: [account] } = await this.db.query(
      `SELECT * FROM loyalty_accounts WHERE shop_id=$1 AND customer_id=$2`, [shop_id, customer_id]);

    if (!account || account.available_points < points_to_redeem) {
      return { success: false, message: 'Solde de points insuffisant' };
    }

    await this.db.query(`
      INSERT INTO loyalty_transactions (shop_id, customer_id, points, transaction_type, reference_id, description)
      VALUES ($1,$2,$3,'redemption',$4,$5)`,
      [shop_id, customer_id, -points_to_redeem, order_id,
       `Utilisation de ${points_to_redeem} pts — bon de réduction`]);

    await this.db.query(`
      UPDATE loyalty_accounts SET
        available_points = available_points - $1,
        total_points = total_points - $1
      WHERE shop_id=$2 AND customer_id=$3`,
      [points_to_redeem, shop_id, customer_id]);

    return { success: true, data: { redeemed: points_to_redeem } };
  }

  private async getAccount(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { customer_id } = payload as any;
    const { rows: [account] } = await this.db.query(
      `SELECT la.*, lp.tiers FROM loyalty_accounts la
       JOIN loyalty_programs lp ON lp.shop_id=la.shop_id
       WHERE la.shop_id=$1 AND la.customer_id=$2`, [shop_id, customer_id]);
    const { rows: txs } = await this.db.query(
      `SELECT * FROM loyalty_transactions WHERE shop_id=$1 AND customer_id=$2
       ORDER BY created_at DESC LIMIT 10`, [shop_id, customer_id]);
    return { success: true, data: { account, transactions: txs } };
  }
}
