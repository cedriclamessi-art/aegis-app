/**
 * AEGIS Constitution v4.0
 * ============================================================
 * These articles are the supreme law of the AEGIS system.
 * They cannot be overridden by any agent, world state, or API call.
 * They are versioned in Git — not stored in the database.
 * Changing them requires a code commit and redeploy.
 *
 * Inspired by the French Conseil Constitutionnel:
 * a body separate from government that protects fundamental law.
 * ============================================================
 */

export const CONSTITUTION_VERSION = '1.0.0';
export const CONSTITUTION_DATE    = '2026-03-05';

export interface ConstitutionalArticle {
  id:          string;
  title:       string;
  description: string;
  check:       (ctx: ActionContext) => ConstitutionalViolation | null;
}

export interface ActionContext {
  shop_id:          string;
  agent_name:       string;
  action_type:      string;
  action_payload:   Record<string, unknown>;
  financial_impact: number;           // € estimated
  is_irreversible:  boolean;
  has_human_auth:   boolean;          // explicit human approval in last 24h?
  audit_log_available: boolean;
  destination_type?: string;          // for data export actions
  destination_id?:   string;
  daily_spend_so_far: number;         // actual € spent today
  max_daily_spend_config: number;     // from guardrail_configs
  agent_violation_count_today: number; // consecutive violations
}

export interface ConstitutionalViolation {
  article:    string;
  reason:     string;
  severity:   'block' | 'warn';  // block = hard veto, warn = log only
}

// ── ABSOLUTE SPEND CAP ──────────────────────────────────────
// Hard-coded. Not from database. Not configurable via API.
// 3× the configured max_daily_spend as an absolute ceiling.
const ABSOLUTE_SPEND_MULTIPLIER = 3.0;

// ── THE FIVE ARTICLES ────────────────────────────────────────

export const ARTICLES: ConstitutionalArticle[] = [

  {
    id:    'article_1_human_primacy',
    title: 'Primauté humaine',
    description:
      'Toute action irréversible requiert une autorisation humaine traçable. ' +
      'AEGIS ne peut jamais effacer une trace d\'autorisation.',
    check: (ctx) => {
      if (!ctx.is_irreversible) return null;
      if (ctx.has_human_auth)   return null;
      return {
        article:  'article_1_human_primacy',
        reason:   `Action irréversible (${ctx.action_type}) sans autorisation humaine tracée dans les 24h. ` +
                  `Approuver manuellement dans le dashboard avant d'exécuter.`,
        severity: 'block',
      };
    },
  },

  {
    id:    'article_2_spend_cap',
    title: 'Plafond de dépense absolu',
    description:
      'Aucune dépense ne peut dépasser 3× le max_daily_spend configuré, ' +
      'peu importe l\'empire_mode, la confiance des agents, ou les délibérations.',
    check: (ctx) => {
      const absoluteCap = ctx.max_daily_spend_config * ABSOLUTE_SPEND_MULTIPLIER;
      const projectedSpend = ctx.daily_spend_so_far + ctx.financial_impact;

      if (projectedSpend <= absoluteCap) return null;

      return {
        article:  'article_2_spend_cap',
        reason:   `Plafond absolu atteint: dépense projetée €${projectedSpend.toFixed(0)} ` +
                  `dépasse le plafond constitutionnel de €${absoluteCap.toFixed(0)} ` +
                  `(${ABSOLUTE_SPEND_MULTIPLIER}× max_daily_spend de €${ctx.max_daily_spend_config}). ` +
                  `Intervention humaine requise.`,
        severity: 'block',
      };
    },
  },

  {
    id:    'article_3_data_sovereignty',
    title: 'Souveraineté des données client',
    description:
      'Aucun agent ne peut exporter des données client vers une destination ' +
      'non whitelistée explicitement par un humain.',
    check: (ctx) => {
      const exportActions = ['sync_segments', 'trigger_post_purchase', 'trigger_winback',
                             'push_replenishment', 'webhook_dispatch', 'email_send'];
      if (!exportActions.includes(ctx.action_type)) return null;
      if (!ctx.destination_type || !ctx.destination_id) return null;
      // Whitelist check is async — handled separately in council.agent.ts
      // This article marks the action for whitelist verification
      if (ctx.destination_type && !ctx.has_human_auth) {
        return {
          article:  'article_3_data_sovereignty',
          reason:   `Export de données vers ${ctx.destination_type}:${ctx.destination_id} ` +
                    `non confirmé dans la whitelist constitutionnelle. ` +
                    `Ajouter la destination dans Settings → Constitution → Destinations approuvées.`,
          severity: 'block',
        };
      }
      return null;
    },
  },

  {
    id:    'article_4_agent_suspension',
    title: 'Droit de suspension',
    description:
      'Le Conseil peut suspendre tout agent pour 24h après 3 violations ' +
      'de guardrails consécutives, sans intervention humaine.',
    check: (ctx) => {
      if (ctx.agent_violation_count_today < 3) return null;
      // Agent has 3+ violations — suspend
      return {
        article:  'article_4_agent_suspension',
        reason:   `${ctx.agent_name} a commis ${ctx.agent_violation_count_today} violations ` +
                  `de guardrails aujourd\'hui. Suspension automatique 24h activée. ` +
                  `Un humain peut lever la suspension dans Settings → Agents.`,
        severity: 'block',
      };
    },
  },

  {
    id:    'article_5_transparency',
    title: 'Transparence obligatoire',
    description:
      'Aucune décision ne peut être exécutée si l\'audit log est indisponible. ' +
      'Intégrité du registre garantie.',
    check: (ctx) => {
      if (ctx.audit_log_available) return null;
      return {
        article:  'article_5_transparency',
        reason:   'L\'audit log est indisponible. Toute exécution est suspendue ' +
                  'jusqu\'à restauration de la traçabilité. ' +
                  'Vérifier la connexion PostgreSQL et les permissions sur audit_log.',
        severity: 'block',
      };
    },
  },

];

export const CONSTITUTION = {
  version:  CONSTITUTION_VERSION,
  date:     CONSTITUTION_DATE,
  articles: ARTICLES,
} as const;

// ── ARTICLE 6 — PROTECTION DE LA RÉPUTATION (ajout v5.0) ────
// Si le NPS composite < 30 : bloquer toute action d'acquisition.
// Aucune dépense publicitaire ne doit recruter de nouveaux clients
// quand le produit a un problème avéré.
export const ARTICLE_6_NPS_THRESHOLD = 30;
export const ARTICLE_6_ACQUISITION_ACTIONS = new Set([
  'budget_scale', 'budget_increase', 'dct_launch', 'campaign_activate',
]);

export async function checkArticle6(
  ctx: ActionContext,
  db: any
): Promise<ConstitutionalViolation | null> {
  if (!ARTICLE_6_ACQUISITION_ACTIONS.has(ctx.action_type)) return null;

  // Check if Article 6 block is active
  const { rows } = await db.query(`
    SELECT blocked_until FROM reputation_alerts
    WHERE shop_id=$1 AND acquisition_blocked=true
      AND blocked_until > NOW() AND acknowledged=false
    ORDER BY created_at DESC LIMIT 1`, [ctx.shop_id]);

  if (!rows[0]) return null;

  return {
    article:       'article_6_reputation',
    severity:      'block',
    reason:        `Article 6 — Réputation. NPS composite < ${ARTICLE_6_NPS_THRESHOLD}. Acquisition suspendue jusqu'au ${new Date(rows[0].blocked_until).toLocaleDateString('fr-FR')}.`,
    financial_impact: ctx.financial_impact,
  };
}
