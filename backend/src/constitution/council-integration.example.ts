/**
 * Council Integration Example v4.0
 * ============================================================
 * Shows how existing agents integrate the Council gate.
 * Every agent that executes a reviewable action must call councilGate()
 * before touching Meta/Shopify/Klaviyo.
 *
 * The pattern is identical across all agents — 3 lines added.
 * ============================================================
 */
import { councilGate, requiresCouncilReview } from './council.middleware';
import { ConstitutionalCouncil } from './council.agent';

// ─── Example: AGENT_SCALE integrating the Council ────────────
export class AgentScaleWithCouncil {
  private council: ConstitutionalCouncil;

  async scaleAdset(shopId: string, adsetId: string, oldBudget: number, newBudget: number): Promise<void> {
    const payload = { action: 'budget_scale', adset_id: adsetId, old_budget: oldBudget, new_budget: newBudget };

    // ── COUNCIL GATE ─────────────────────────────────────────
    const gate = await councilGate(this.council, shopId, 'AGENT_SCALE', 'budget_scale', payload);
    if (!gate.approved) {
      // Log the veto and stop
      console.error(`[COUNCIL VETO] ${gate.veto_reason}`);
      await this.logDecision(shopId, {
        decision_type: 'budget_scale', subject_id: adsetId,
        decision_made: { ...payload, vetoed: true, veto_reason: gate.veto_reason },
        confidence: 0, executed: false,
      });
      return; // Hard stop. No execution.
    }
    // ── END COUNCIL GATE ─────────────────────────────────────

    // Proceed with execution
    await this.updateMetaBudget(adsetId, newBudget);
  }

  // ─── Example: AGENT_STOP_LOSS killing an ad ───────────────
  async killAd(shopId: string, adId: string, dailyBudget: number): Promise<void> {
    const payload = { action: 'ad_kill', ad_id: adId, daily_budget: dailyBudget };

    // ── COUNCIL GATE ─────────────────────────────────────────
    const gate = await councilGate(this.council, shopId, 'AGENT_STOP_LOSS', 'ad_kill', payload);
    if (!gate.approved) {
      console.error(`[COUNCIL VETO] Ad kill blocked: ${gate.veto_reason}`);
      return;
    }
    // ── END COUNCIL GATE ─────────────────────────────────────

    await this.pauseMetaAd(adId);
  }

  // ─── Example: AGENT_KLAVIYO syncing segments ──────────────
  async syncToKlaviyo(shopId: string, listId: string, customers: unknown[]): Promise<void> {
    const payload = { action: 'sync_segments', list_id: listId, record_count: (customers as any[]).length };

    // ── COUNCIL GATE (Article 3 check) ────────────────────────
    const gate = await councilGate(this.council, shopId, 'AGENT_KLAVIYO', 'sync_segments', payload);
    if (!gate.approved) {
      console.error(`[COUNCIL VETO] Klaviyo sync blocked — destination not whitelisted: ${gate.veto_reason}`);
      // Notify owner: they need to whitelist this Klaviyo list in Constitution settings
      return;
    }
    // ── END COUNCIL GATE ─────────────────────────────────────

    await this.pushToKlaviyo(listId, customers);
  }

  // Stubs
  private async logDecision(_: string, __: unknown) {}
  private async updateMetaBudget(_: string, __: number) {}
  private async pauseMetaAd(_: string) {}
  private async pushToKlaviyo(_: string, __: unknown[]) {}
}

/*
 * Integration checklist for each agent:
 *
 * 1. Import councilGate from constitution/council.middleware
 * 2. Inject ConstitutionalCouncil via constructor
 * 3. Before any Meta/Shopify/Klaviyo call that matches REVIEWABLE_ACTIONS:
 *    const gate = await councilGate(this.council, shopId, this.name, actionType, payload)
 *    if (!gate.approved) return; // hard stop
 * 4. That's it. The Council handles logging, suspension, and alerts.
 *
 * Agents to update:
 *  AGENT_SCALE          → budget_scale, budget_increase
 *  AGENT_STOP_LOSS      → ad_kill, campaign_pause
 *  AGENT_DAYPARTING     → daypart_adjust
 *  AGENT_PRICING        → price_apply
 *  AGENT_KLAVIYO        → sync_segments, trigger_post_purchase
 *  WebhookService       → webhook_dispatch
 */
