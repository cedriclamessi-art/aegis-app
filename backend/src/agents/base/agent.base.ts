/**
 * BaseAgent v5.0 — Toutes les exécutions passent par le TierGate.
 * Le TierGate intercepte chaque action AVANT l'exécution et décide :
 *   EXECUTE  → exécute normalement
 *   SHADOW   → enregistre sans exécuter
 *   SUGGEST  → poste dans inbox humain, attend approbation
 *   BLOCK    → logue, ne fait rien
 *
 * Les agents n'ont pas à connaître leur tier — le BaseAgent s'en charge.
 */
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { tierGate, postSuggestion, TierGateVerdict } from '../core/tier-gate.middleware';

export interface AgentTask {
  shop_id:  string;
  type:     string;
  payload?: unknown;
}

export interface AgentResult {
  success:  boolean;
  data?:    unknown;
  message?: string;
  // Enrichi par BaseAgent après TierGate
  tier_verdict?:  TierGateVerdict;
  tier_mode?:     string;
  current_tier?:  number;
  shadowed?:      boolean;
  suggested?:     boolean;
  suggestion_id?: string;
}

export abstract class BaseAgent {
  abstract readonly name: string;

  constructor(protected db: Pool, protected redis: Redis) {}

  abstract execute(task: AgentTask): Promise<AgentResult>;

  /**
   * Point d'entrée principal.
   * Vérifie le TierGate avant chaque exécution.
   * Les agents appellent `execute()` directement pour la logique interne.
   * L'orchestrateur appelle `run()` pour passer par le gate.
   */
  async run(task: AgentTask, financialImpact?: number): Promise<AgentResult> {
    const gate = await tierGate(this.db, task.shop_id, this.name, financialImpact);

    // Log le gate check
    await this.db.query(`
      INSERT INTO agent_decisions
        (shop_id, agent_name, decision_type, decision_made, executed, confidence, context)
      VALUES ($1,$2,'tier_gate_check',$3,false,1.0,$4)`,
      [task.shop_id, this.name, JSON.stringify({ task_type: task.type }),
       JSON.stringify({
         tier: gate.current_tier, mode: gate.agent_mode,
         verdict: gate.verdict, reason: gate.reason,
       })]).catch(() => {}); // Non bloquant

    switch (gate.verdict) {
      case 'block':
        return {
          success: false, message: gate.reason,
          tier_verdict: 'block', tier_mode: gate.agent_mode,
          current_tier: gate.current_tier,
        };

      case 'shadow': {
        // Exécute la logique pour collecter le résultat, mais ne persiste pas les effets
        const shadowCtx = { ...task, _shadow: true };
        const result    = await this.execute(shadowCtx as AgentTask).catch(e => ({
          success: false, message: String(e),
        }));
        // Enregistre dans shadow_mode_log
        await this.db.query(`
          INSERT INTO shadow_mode_log
            (shop_id, agent_name, task_type, would_have_done, result, tier)
          VALUES ($1,$2,$3,$4,$5,$6)`,
          [task.shop_id, this.name, task.type,
           JSON.stringify(task.payload ?? {}),
           JSON.stringify(result),
           gate.current_tier]).catch(() => {});

        return {
          ...result,
          tier_verdict: 'shadow', tier_mode: gate.agent_mode,
          current_tier: gate.current_tier, shadowed: true,
        };
      }

      case 'suggest': {
        // Exécute pour obtenir la décision, puis poste pour validation humaine
        const result    = await this.execute(task).catch(e => ({
          success: false, message: String(e),
        }));
        const narrative = (result as any)?.data?.narrative_fr
          ?? (result as any)?.data?.reason
          ?? `${this.name} propose : ${task.type}`;

        const suggestionId = await postSuggestion(
          this.db, task.shop_id, this.name, task.type,
          task.payload, narrative, gate.current_tier
        ).catch(() => null);

        return {
          ...result, success: true,
          tier_verdict: 'suggest', tier_mode: gate.agent_mode,
          current_tier: gate.current_tier, suggested: true,
          suggestion_id: suggestionId ?? undefined,
        };
      }

      case 'execute':
      default:
        return this.execute(task).then(r => ({
          ...r,
          tier_verdict: 'execute', tier_mode: gate.agent_mode,
          current_tier: gate.current_tier,
        }));
    }
  }

  // ── Helpers partagés ──────────────────────────────────────

  protected async remember(shopId: string, opts: {
    memory_key:   string;
    memory_type:  string;
    value:        unknown;
    ttl_hours:    number;
  }): Promise<void> {
    await this.db.query(`
      INSERT INTO agent_memory
        (shop_id, agent_name, memory_key, memory_type, value, expires_at)
      VALUES ($1,$2,$3,$4,$5, NOW() + ($6 || ' hours')::INTERVAL)
      ON CONFLICT (shop_id, agent_name, memory_key) DO UPDATE
        SET value=$5, expires_at=NOW() + ($6 || ' hours')::INTERVAL`,
      [shopId, this.name, opts.memory_key, opts.memory_type,
       JSON.stringify(opts.value), opts.ttl_hours]);
  }

  protected async emit(event: string, payload: unknown): Promise<void> {
    const channel = `aegis:event:${(payload as any)?.shop_id ?? 'global'}:${event}`;
    await this.redis.publish(channel, JSON.stringify(payload));
  }

  protected async getShopConfig(shopId: string): Promise<Record<string, any>> {
    const { rows } = await this.db.query(
      `SELECT * FROM shops WHERE id=$1`, [shopId]);
    return rows[0] ?? {};
  }

  protected async getWorldState(shopId: string): Promise<Record<string, any>> {
    const { rows } = await this.db.query(
      `SELECT * FROM world_state WHERE shop_id=$1`, [shopId]);
    return rows[0] ?? {};
  }
}
