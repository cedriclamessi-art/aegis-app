/**
 * TierGate v5.0
 * Middleware qui intercepte chaque action d'agent et vérifie
 * si le tier actuel du shop autorise l'exécution.
 *
 * 3 niveaux de réponse :
 *   EXECUTE  — action autorisée, tier + mode permettent l'exécution
 *   SUGGEST  — action possible mais tier dit "suggest" → poste dans inbox humain
 *   BLOCK    — tier dit "observe/shadow/disabled" → log sans exécuter
 */
import { Pool } from 'pg';

export type TierGateVerdict = 'execute' | 'suggest' | 'block' | 'shadow';

export interface TierGateResult {
  verdict:              TierGateVerdict;
  agent_mode:           string;
  current_tier:         number;
  max_financial_impact: number | null;
  reason:               string;
}

export async function tierGate(
  db:               Pool,
  shopId:           string,
  agentName:        string,
  financialImpact?: number
): Promise<TierGateResult> {

  // Get current tier
  const { rows: [tierRow] } = await db.query(
    `SELECT current_tier FROM shop_tiers WHERE shop_id=$1`, [shopId]);
  const tier = tierRow?.current_tier ?? 1;

  // Get agent config for this tier
  const { rows: [config] } = await db.query(
    `SELECT mode, max_financial_impact, requires_human_confirm
     FROM tier_agent_config WHERE tier=$1 AND agent_name=$2`,
    [tier, agentName]);

  if (!config) {
    // No config = default to shadow for safety
    return { verdict: 'shadow', agent_mode: 'shadow', current_tier: tier,
             max_financial_impact: null, reason: 'No tier config found — defaulting to shadow' };
  }

  const mode      = config.mode;
  const maxImpact = config.max_financial_impact ? parseFloat(config.max_financial_impact) : null;

  // Evaluate verdict based on mode
  switch (mode) {
    case 'disabled':
      return { verdict: 'block', agent_mode: mode, current_tier: tier,
               max_financial_impact: maxImpact, reason: `Agent disabled at tier ${tier}` };

    case 'observe':
    case 'shadow':
      return { verdict: 'shadow', agent_mode: mode, current_tier: tier,
               max_financial_impact: maxImpact,
               reason: `Agent in ${mode} mode at tier ${tier} — recording only` };

    case 'suggest':
      return { verdict: 'suggest', agent_mode: mode, current_tier: tier,
               max_financial_impact: maxImpact,
               reason: `Agent in suggest mode at tier ${tier} — requires human approval` };

    case 'semi_auto':
      // Check financial impact threshold
      if (financialImpact !== undefined && maxImpact !== null && financialImpact > maxImpact) {
        return { verdict: 'suggest', agent_mode: mode, current_tier: tier,
                 max_financial_impact: maxImpact,
                 reason: `Impact €${financialImpact} > tier ${tier} limit €${maxImpact} — escalating to suggest` };
      }
      return { verdict: 'execute', agent_mode: mode, current_tier: tier,
               max_financial_impact: maxImpact,
               reason: `Semi-auto approved at tier ${tier} (impact €${financialImpact ?? 0} ≤ €${maxImpact ?? '∞'})` };

    case 'auto':
      return { verdict: 'execute', agent_mode: mode, current_tier: tier,
               max_financial_impact: maxImpact, reason: `Full auto at tier ${tier}` };

    default:
      return { verdict: 'shadow', agent_mode: mode, current_tier: tier,
               max_financial_impact: maxImpact, reason: 'Unknown mode — shadow fallback' };
  }
}

/**
 * Poste une suggestion dans la boîte de réception humaine
 * quand un agent est en mode "suggest".
 */
export async function postSuggestion(
  db:         Pool,
  shopId:     string,
  agentName:  string,
  actionType: string,
  payload:    any,
  narrative:  string,
  tier:       number
): Promise<string> {
  const { rows: [row] } = await db.query(`
    INSERT INTO agent_decisions
      (shop_id, agent_name, decision_type, decision_made, executed,
       confidence, context)
    VALUES ($1,$2,$3,$4,false,0.85,$5)
    RETURNING id`,
    [shopId, agentName, actionType, JSON.stringify(payload),
     JSON.stringify({ tier, mode: 'suggest', narrative, awaiting_human: true })]);

  return row.id;
}
