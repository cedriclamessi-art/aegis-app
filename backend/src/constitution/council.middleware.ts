/**
 * Council Middleware v4.0
 * ============================================================
 * Wraps the BaseAgent execute() method.
 * All agents inherit this — they cannot opt out.
 * Action types that require Council review are declared here.
 * ============================================================
 */
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { ConstitutionalCouncil } from './council.agent';

// Actions that must pass through the Council
const REVIEWABLE_ACTIONS: Record<string, {
  isIrreversible: boolean;
  estimateImpact: (payload: Record<string, unknown>) => number;
  destinationType?: (payload: Record<string, unknown>) => string | undefined;
  destinationId?:   (payload: Record<string, unknown>) => string | undefined;
}> = {
  // Budget changes — financial impact
  'budget_scale':       { isIrreversible: false, estimateImpact: (p: any) => Math.abs((p.new_budget ?? 0) - (p.old_budget ?? 0)) * 7 },
  'budget_increase':    { isIrreversible: false, estimateImpact: (p: any) => Math.abs((p.new_budget ?? 0) - (p.old_budget ?? 0)) * 7 },
  'daypart_adjust':     { isIrreversible: false, estimateImpact: (p: any) => Math.abs((p.new_budget ?? 0) - (p.old_budget ?? 0)) },

  // Campaign actions — irreversible
  'ad_kill':            { isIrreversible: true,  estimateImpact: (p: any) => parseFloat(p.daily_budget ?? 0) * 7 },
  'campaign_pause':     { isIrreversible: true,  estimateImpact: (p: any) => parseFloat(p.daily_budget ?? 0) * 3 },
  'campaign_delete':    { isIrreversible: true,  estimateImpact: (p: any) => parseFloat(p.lifetime_spend ?? 0) },

  // Pricing — irreversible
  'price_apply':        { isIrreversible: true,  estimateImpact: (p: any) => parseFloat(p.price_delta ?? 0) * 100 },

  // Data exports — Article 3
  'sync_segments':      {
    isIrreversible: false, estimateImpact: () => 0,
    destinationType: () => 'klaviyo',
    destinationId:   (p: any) => p.list_id,
  },
  'trigger_post_purchase': {
    isIrreversible: false, estimateImpact: () => 0,
    destinationType: () => 'klaviyo',
    destinationId:   (p: any) => p.flow_id,
  },
  'webhook_dispatch':   {
    isIrreversible: false, estimateImpact: () => 0,
    destinationType: () => 'webhook',
    destinationId:   (p: any) => p.webhook_id,
  },
};

export function requiresCouncilReview(actionType: string): boolean {
  return actionType in REVIEWABLE_ACTIONS;
}

export async function councilGate(
  council:       ConstitutionalCouncil,
  shopId:        string,
  agentName:     string,
  actionType:    string,
  actionPayload: Record<string, unknown>,
): Promise<{ approved: boolean; review_id: string; veto_reason?: string }> {

  // Check if agent is suspended first
  const suspension = await council.isAgentSuspended(shopId, agentName);
  if (suspension.suspended) {
    return {
      approved:    false,
      review_id:   'suspended',
      veto_reason: `${agentName} est suspendu jusqu'au ${suspension.until?.toLocaleString('fr-FR')}. ` +
                   `Raison: ${suspension.reason}`,
    };
  }

  // If action doesn't require review, pass through
  if (!requiresCouncilReview(actionType)) {
    return { approved: true, review_id: 'passthrough' };
  }

  const rules = REVIEWABLE_ACTIONS[actionType];
  const review = await council.review(shopId, agentName, actionType, actionPayload, {
    financialImpact:  rules.estimateImpact(actionPayload),
    isIrreversible:   rules.isIrreversible,
    destinationType:  rules.destinationType?.(actionPayload),
    destinationId:    rules.destinationId?.(actionPayload),
  });

  return {
    approved:    review.verdict === 'approved',
    review_id:   review.review_id,
    veto_reason: review.veto_reason,
  };
}
