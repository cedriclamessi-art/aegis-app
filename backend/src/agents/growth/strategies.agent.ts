/**
 * AGENT_STRATEGIES — v3.4
 * Manages activation/deactivation of pre-built strategy playbooks
 * Each strategy is a bundle of conditional rules applied to active ad sets
 */

import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';

export type StrategyCategory = 'scaling' | 'protection' | 'creative' | 'acquisition' | 'seasonal';
export type StrategyStatus = 'active' | 'inactive' | 'triggered' | 'paused';

export interface Strategy {
  id: string;
  name: string;
  category: StrategyCategory;
  description: string;
  conditions: StrategyCondition[];
  actions: StrategyAction[];
  status: StrategyStatus;
  shop_id: string;
}

export interface StrategyCondition {
  metric: string;  // e.g. 'roas', 'cpa', 'ctr', 'frequency'
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  value: number;
  window_hours?: number;
}

export interface StrategyAction {
  type: 'scale_budget' | 'kill_ad' | 'pause_ad' | 'alert' | 'create_dct' | 'boost_organic';
  params: Record<string, unknown>;
}

export class AgentStrategies extends BaseAgent {
  readonly name = 'AGENT_STRATEGIES';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'activate': return this.activateStrategy(task);
      case 'deactivate': return this.deactivateStrategy(task);
      case 'evaluate': return this.evaluateAllActive(task);
      case 'list': return this.listStrategies(task);
      default: throw new Error(`Unknown task: ${task.type}`);
    }
  }

  private async activateStrategy(task: AgentTask): Promise<AgentResult> {
    const { strategy_id } = task.payload;
    await this.db.query(
      `UPDATE strategies SET status = 'active', activated_at = NOW() WHERE id = $1 AND shop_id = $2`,
      [strategy_id, task.shop_id]
    );
    await this.emit('strategy_activated', { strategy_id, shop_id: task.shop_id });
    return { success: true, data: { strategy_id, status: 'active' } };
  }

  private async deactivateStrategy(task: AgentTask): Promise<AgentResult> {
    const { strategy_id } = task.payload;
    await this.db.query(
      `UPDATE strategies SET status = 'inactive' WHERE id = $1 AND shop_id = $2`,
      [strategy_id, task.shop_id]
    );
    return { success: true, data: { strategy_id, status: 'inactive' } };
  }

  private async evaluateAllActive(task: AgentTask): Promise<AgentResult> {
    // Fetch all active strategies for this shop
    const { rows: strategies } = await this.db.query<Strategy>(
      `SELECT * FROM strategies WHERE shop_id = $1 AND status = 'active'`,
      [task.shop_id]
    );

    const triggered = [];
    for (const strategy of strategies) {
      const met = await this.checkConditions(strategy, task.shop_id);
      if (met) {
        await this.executeActions(strategy, task.shop_id);
        triggered.push(strategy.id);
      }
    }

    return {
      success: true,
      data: { evaluated: strategies.length, triggered: triggered.length, triggered_ids: triggered },
    };
  }

  private async checkConditions(strategy: Strategy, shopId: string): Promise<boolean> {
    for (const cond of strategy.conditions) {
      const { rows } = await this.db.query(
        `SELECT AVG(${cond.metric}) as val FROM ad_metrics 
         WHERE shop_id = $1 AND created_at > NOW() - INTERVAL '${cond.window_hours || 24} hours'`,
        [shopId]
      );
      const val = parseFloat(rows[0]?.val ?? 0);
      const operators: Record<string, (a: number, b: number) => boolean> = {
        '>': (a, b) => a > b, '<': (a, b) => a < b,
        '>=': (a, b) => a >= b, '<=': (a, b) => a <= b,
        '==': (a, b) => a === b, '!=': (a, b) => a !== b,
      };
      if (!operators[cond.operator]?.(val, cond.value)) return false;
    }
    return true;
  }

  private async executeActions(strategy: Strategy, shopId: string): Promise<void> {
    for (const action of strategy.actions) {
      await this.emit('strategy_action', { type: action.type, params: action.params, shopId });
    }
    await this.db.query(
      `UPDATE strategies SET last_triggered_at = NOW(), trigger_count = trigger_count + 1 
       WHERE id = $1`, [strategy.id]
    );
  }

  private async listStrategies(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(
      `SELECT * FROM strategies WHERE shop_id = $1 ORDER BY category, name`,
      [task.shop_id]
    );
    return { success: true, data: { strategies: rows } };
  }
}
