/**
 * AGENT_ORCHESTRATOR v3.5 — AEGIS Brain
 * Runs every 15 minutes per shop (independently, via shop_scheduler_state).
 * 1. Consolidates world state from all agent memories
 * 2. Dispatches evaluation tasks to relevant agents
 * 3. Handles deliberation requests from agents
 * 4. Triggers AGENT_EVALUATOR for pending feedback loops
 */

import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import { WorldStateService } from './world-state.service';

export class AgentOrchestrator extends BaseAgent {
  readonly name = 'AGENT_ORCHESTRATOR';
  private worldStateService: WorldStateService;

  constructor(db: any, redis: any) {
    super(db, redis);
    this.worldStateService = new WorldStateService(db, redis);
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'run_cycle':      return this.runCycle(task);
      case 'deliberate':     return this.handleDeliberation(task);
      case 'consolidate':    return this.consolidateWorldState(task);
      default: throw new Error(`Unknown task: ${task.type}`);
    }
  }

  /**
   * Main 15-minute cycle for one shop.
   * Reads shop_scheduler_state to prevent concurrent runs.
   */
  private async runCycle(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // 1. Acquire lock — prevent concurrent cycles for same shop
    const locked = await this.acquireSchedulerLock(shop_id);
    if (!locked) {
      return { success: false, message: `Cycle already running for shop ${shop_id}` };
    }

    try {
      // 2. Consolidate world state
      const world = await this.worldStateService.consolidate(shop_id);

      // 3. Deposit world state observation into agent memory
      await this.remember(shop_id, {
        memory_key:  'world_state_summary',
        memory_type: 'context',
        value: {
          empire_index: world.empire_index,
          empire_mode:  world.empire_mode,
          risk_level:   world.risk_level,
          signals_count: world.active_signals.length,
          warnings_count: world.active_warnings.length,
        },
        ttl_hours: 1,
      });

      // 4. Dispatch agent tasks based on world state
      const dispatched = await this.dispatchAgents(shop_id, world);

      // 5. Trigger pending feedback evaluations
      await this.triggerPendingEvaluations(shop_id);

      // 6. Update scheduler state
      await this.releaseSchedulerLock(shop_id);

      return {
        success: true,
        data: {
          empire_mode:  world.empire_mode,
          empire_index: world.empire_index,
          risk_level:   world.risk_level,
          agents_dispatched: dispatched,
        },
      };
    } catch (err) {
      await this.releaseSchedulerLock(shop_id);
      throw err;
    }
  }

  private async dispatchAgents(shopId: string, world: any): Promise<string[]> {
    const dispatched: string[] = [];

    // Always run: scale check, stop loss check
    await this.emit('dispatch', { agent: 'AGENT_SCALE',      task: 'evaluate', shop_id: shopId, world });
    await this.emit('dispatch', { agent: 'AGENT_STOP_LOSS',  task: 'evaluate', shop_id: shopId, world });
    await this.emit('dispatch', { agent: 'AGENT_ANOMALY',    task: 'scan',     shop_id: shopId });
    dispatched.push('AGENT_SCALE', 'AGENT_STOP_LOSS', 'AGENT_ANOMALY');

    // Creative fatigue — every cycle
    await this.emit('dispatch', { agent: 'AGENT_CREATIVE_ANALYST', task: 'check_fatigue', shop_id: shopId });
    dispatched.push('AGENT_CREATIVE_ANALYST');

    // Inventory check — every cycle
    await this.emit('dispatch', { agent: 'AGENT_INVENTORY', task: 'check_levels', shop_id: shopId });
    dispatched.push('AGENT_INVENTORY');

    // Intelligence / spy — every 3 cycles (45min)
    const cycleCount = await this.getCycleCount(shopId);
    if (cycleCount % 3 === 0) {
      await this.emit('dispatch', { agent: 'AGENT_SPY', task: 'scan_competitors', shop_id: shopId });
      dispatched.push('AGENT_SPY');
    }

    // Morning brief — once daily at 06:00
    const hour = new Date().getHours();
    if (hour === 6) {
      await this.emit('dispatch', { agent: 'AGENT_BRIEF', task: 'generate', shop_id: shopId });
      dispatched.push('AGENT_BRIEF');
    }

    return dispatched;
  }

  private async consolidateWorldState(task: AgentTask): Promise<AgentResult> {
    const world = await this.worldStateService.consolidate(task.shop_id);
    return { success: true, data: world };
  }

  /**
   * Handle a deliberation request from any agent.
   * Forwards the request to required voters.
   */
  private async handleDeliberation(task: AgentTask): Promise<AgentResult> {
    const { deliberation_id, required_agents } = task.payload as any;

    // Subscribe required agents
    for (const agent of required_agents) {
      await this.emit('deliberation_request', {
        deliberation_id,
        requesting_agent: agent,
        shop_id: task.shop_id,
      });
    }

    return { success: true, data: { deliberation_id, notified: required_agents } };
  }

  private async triggerPendingEvaluations(shopId: string): Promise<void> {
    // Find outcomes that are due for evaluation
    const { rows } = await this.db.query(
      `SELECT id, decision_id, agent_name, decision_type, metrics_before
       FROM action_outcomes
       WHERE shop_id = $1 AND evaluated = false AND evaluate_after <= NOW()
       LIMIT 20`,
      [shopId]
    );

    for (const outcome of rows) {
      await this.emit('dispatch', {
        agent: 'AGENT_EVALUATOR',
        task:  'evaluate_outcome',
        shop_id: shopId,
        payload: outcome,
      });
    }
  }

  private async acquireSchedulerLock(shopId: string): Promise<boolean> {
    const key = `aegis:lock:orchestrator:${shopId}`;
    const result = await this.redis.set(key, '1', 'EX', 900, 'NX'); // 15min TTL
    return result === 'OK';
  }

  private async releaseSchedulerLock(shopId: string): Promise<void> {
    await this.redis.del(`aegis:lock:orchestrator:${shopId}`);
    await this.db.query(
      `UPDATE shop_scheduler_state
       SET last_run_at = NOW(),
           run_count_today = run_count_today + 1,
           next_evaluation_at = NOW() + INTERVAL '15 minutes',
           current_run_id = NULL,
           updated_at = NOW()
       WHERE shop_id = $1`,
      [shopId]
    );
  }

  private async getCycleCount(shopId: string): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT run_count_today FROM shop_scheduler_state WHERE shop_id = $1`, [shopId]
    );
    return rows[0]?.run_count_today ?? 0;
  }
}

// v3.6 dispatch additions (appended)
// Add to dispatchAgents():
// - AGENT_PROFITABILITY: every cycle
// - AGENT_ATTRIBUTION: reconcile daily at 23:00
// - AGENT_CREATIVE_VISION: tag untagged daily
// - AGENT_FORECASTER: generate every evening at 22:00
// - AGENT_DELIVERY: send brief via all channels at 06:00
