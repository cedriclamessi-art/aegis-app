/**
 * AuditService v3.7 — Who changed what, when, from where
 * Called by API middleware and all agents that make config changes.
 */
import { Pool } from 'pg';

export class AuditService {
  constructor(private db: Pool) {}

  async log(opts: {
    shop_id?:    string;
    user_id?:    string;
    agent_name?: string;
    action:      string;
    entity_type?: string;
    entity_id?:  string;
    old_value?:  unknown;
    new_value?:  unknown;
    ip_address?: string;
    user_agent?: string;
  }): Promise<void> {
    await this.db.query(`
      INSERT INTO audit_log (shop_id, user_id, agent_name, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [opts.shop_id, opts.user_id, opts.agent_name, opts.action, opts.entity_type,
       opts.entity_id, opts.old_value ? JSON.stringify(opts.old_value) : null,
       opts.new_value ? JSON.stringify(opts.new_value) : null, opts.ip_address, opts.user_agent]);
  }

  async getShopLog(shopId: string, limit = 100): Promise<unknown[]> {
    const { rows } = await this.db.query(`
      SELECT al.*, ua.email AS user_email
      FROM audit_log al
      LEFT JOIN user_accounts ua ON ua.id = al.user_id
      WHERE al.shop_id = $1 ORDER BY al.created_at DESC LIMIT $2`, [shopId, limit]);
    return rows;
  }
}
