/**
 * Team Presets — Pre-configured agent compositions for common workflows
 * ======================================================================
 * Sources: wshobson/agents, Blader/Claudeception,
 *          Dicklesworthstone/claude_code_agent_farm
 *
 * A "team" is a composition of agents that work together on a workflow.
 * Each team has:
 *   - A conductor agent (orchestrates the team)
 *   - Worker agents (execute specific tasks)
 *   - Shared context (all agents can read/write)
 *   - Turn budgets (limits per agent)
 *   - Quality gates between steps
 *
 * Built-in teams:
 *   1. LAUNCH_TEAM     — Full product launch pipeline
 *   2. AUDIT_TEAM      — Store + campaign + creative audit
 *   3. OPTIMIZE_TEAM   — Campaign optimization cycle
 *   4. CREATIVE_TEAM   — Creative generation + testing
 *   5. ANALYTICS_TEAM  — Full analytics + reporting
 *   6. PROTECTION_TEAM — Budget protection + risk monitoring
 *   7. GROWTH_TEAM     — Growth hacking + scaling
 *   8. RESEARCH_TEAM   — Market research + competitor analysis
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface TeamPreset {
  id:           string;
  name:         string;
  description:  string;
  conductor:    string;           // Agent ID that orchestrates
  workers:      TeamWorker[];
  sharedContext: Record<string, unknown>;
  maxTotalTurns: number;
  maxCostUsd:    number;
  tier?:         number;          // Minimum tier required
  tags:          string[];
}

export interface TeamWorker {
  agentId:       string;
  role:          string;          // Human-readable role description
  maxTurns:      number;
  costBudgetUsd: number;
  required:      boolean;         // Team fails if this agent fails
  dependsOn?:    string[];        // Agent IDs that must complete first
  inputs?:       string[];        // Keys from shared context to read
  outputs?:      string[];        // Keys this agent writes to shared context
}

export interface TeamExecution {
  teamId:         string;
  executionId:    string;
  shopId:         string;
  status:         'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  conductor:      string;
  workers:        WorkerExecution[];
  sharedContext:  Record<string, unknown>;
  startedAt:      Date;
  completedAt?:   Date;
  totalCostUsd:   number;
  totalTurns:     number;
  result?:        unknown;
  error?:         string;
}

export interface WorkerExecution {
  agentId:       string;
  status:        'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  turnsUsed:     number;
  costUsd:       number;
  startedAt?:    Date;
  completedAt?:  Date;
  output?:       unknown;
  error?:        string;
}

// ── Built-in Team Presets ─────────────────────────────────────────────────

const BUILT_IN_TEAMS: TeamPreset[] = [
  // 1. LAUNCH TEAM — Full product launch
  {
    id: 'LAUNCH_TEAM',
    name: 'Product Launch Team',
    description: 'Complete product launch: ingest → analyze → build → test → scale',
    conductor: 'AGENT_PIPELINE_ORCHESTRATOR',
    workers: [
      {
        agentId: 'AGENT_PRODUCT_INGEST',
        role: 'Product data extraction and validation',
        maxTurns: 5,
        costBudgetUsd: 0.50,
        required: true,
        outputs: ['productData', 'images', 'pricing'],
      },
      {
        agentId: 'AGENT_SPY',
        role: 'Market research and competitor analysis',
        maxTurns: 8,
        costBudgetUsd: 1.00,
        required: false,
        dependsOn: ['AGENT_PRODUCT_INGEST'],
        inputs: ['productData'],
        outputs: ['competitors', 'marketAnalysis'],
      },
      {
        agentId: 'AGENT_OFFER_ENGINE',
        role: 'Offer construction with pricing and margins',
        maxTurns: 5,
        costBudgetUsd: 0.50,
        required: true,
        dependsOn: ['AGENT_PRODUCT_INGEST', 'AGENT_SPY'],
        inputs: ['productData', 'competitors', 'marketAnalysis'],
        outputs: ['offer', 'hooks', 'sellingPrice', 'margin'],
      },
      {
        agentId: 'AGENT_COPY_CHIEF',
        role: 'Marketing copy and creative direction',
        maxTurns: 8,
        costBudgetUsd: 1.00,
        required: true,
        dependsOn: ['AGENT_OFFER_ENGINE'],
        inputs: ['offer', 'hooks', 'productData'],
        outputs: ['copy', 'headlines', 'descriptions'],
      },
      {
        agentId: 'AGENT_STORE_BUILDER',
        role: 'Store page generation and deployment',
        maxTurns: 10,
        costBudgetUsd: 1.50,
        required: true,
        dependsOn: ['AGENT_COPY_CHIEF'],
        inputs: ['copy', 'images', 'offer'],
        outputs: ['storeUrl', 'pageHtml', 'sections'],
      },
      {
        agentId: 'AGENT_AD_LAUNCHER',
        role: 'Ad creation and test launch',
        maxTurns: 8,
        costBudgetUsd: 1.00,
        required: true,
        dependsOn: ['AGENT_STORE_BUILDER'],
        inputs: ['storeUrl', 'copy', 'images', 'offer'],
        outputs: ['campaignId', 'adIds', 'testBudget'],
      },
    ],
    sharedContext: {},
    maxTotalTurns: 50,
    maxCostUsd: 8.00,
    tier: 1,
    tags: ['launch', 'pipeline', 'full'],
  },

  // 2. AUDIT TEAM — Complete audit
  {
    id: 'AUDIT_TEAM',
    name: 'Audit Team',
    description: 'Full audit: store quality, campaign performance, creative review',
    conductor: 'AGENT_PIPELINE_ORCHESTRATOR',
    workers: [
      {
        agentId: 'AGENT_STORE_AUDITOR',
        role: 'Store quality and conversion audit',
        maxTurns: 8,
        costBudgetUsd: 1.00,
        required: true,
        outputs: ['storeAudit', 'storeScore'],
      },
      {
        agentId: 'AGENT_CAMPAIGN_MONITOR',
        role: 'Campaign performance analysis',
        maxTurns: 5,
        costBudgetUsd: 0.50,
        required: true,
        outputs: ['campaignAudit', 'roasData'],
      },
      {
        agentId: 'AGENT_CREATIVE_SCORER',
        role: 'Creative fatigue and quality scoring',
        maxTurns: 5,
        costBudgetUsd: 0.50,
        required: false,
        outputs: ['creativeAudit', 'fatigueScores'],
      },
    ],
    sharedContext: {},
    maxTotalTurns: 25,
    maxCostUsd: 3.00,
    tier: 2,
    tags: ['audit', 'quality', 'review'],
  },

  // 3. OPTIMIZE TEAM — Campaign optimization
  {
    id: 'OPTIMIZE_TEAM',
    name: 'Optimization Team',
    description: 'Campaign optimization: analyze → decide → iterate',
    conductor: 'AGENT_RALPH',
    workers: [
      {
        agentId: 'AGENT_RESULTS_48H',
        role: 'Collect and analyze 48h results',
        maxTurns: 5,
        costBudgetUsd: 0.50,
        required: true,
        outputs: ['metrics', 'classification'],
      },
      {
        agentId: 'AGENT_BUDGET_OPTIMIZER',
        role: 'Budget rebalancing based on performance',
        maxTurns: 3,
        costBudgetUsd: 0.30,
        required: false,
        dependsOn: ['AGENT_RESULTS_48H'],
        inputs: ['metrics', 'classification'],
        outputs: ['budgetPlan'],
      },
      {
        agentId: 'AGENT_COPY_CHIEF',
        role: 'Generate new creative variants',
        maxTurns: 8,
        costBudgetUsd: 1.00,
        required: false,
        dependsOn: ['AGENT_RESULTS_48H'],
        inputs: ['metrics', 'classification'],
        outputs: ['newCreatives'],
      },
    ],
    sharedContext: {},
    maxTotalTurns: 20,
    maxCostUsd: 3.00,
    tier: 1,
    tags: ['optimize', 'iterate', 'ralph'],
  },

  // 4. CREATIVE TEAM — Creative production
  {
    id: 'CREATIVE_TEAM',
    name: 'Creative Team',
    description: 'Creative generation: copy + visuals + review',
    conductor: 'AGENT_COPY_CHIEF',
    workers: [
      {
        agentId: 'AGENT_PSYCHO_MARKETING',
        role: 'Psychological angle and persuasion strategy',
        maxTurns: 5,
        costBudgetUsd: 0.50,
        required: true,
        outputs: ['psychoProfile', 'angles', 'triggers'],
      },
      {
        agentId: 'AGENT_UGC_FACTORY',
        role: 'User-generated content style creative',
        maxTurns: 8,
        costBudgetUsd: 1.00,
        required: false,
        dependsOn: ['AGENT_PSYCHO_MARKETING'],
        inputs: ['psychoProfile', 'angles'],
        outputs: ['ugcContent', 'scripts'],
      },
      {
        agentId: 'AGENT_CREATIVE_SCORER',
        role: 'Score and rank creative variants',
        maxTurns: 3,
        costBudgetUsd: 0.30,
        required: true,
        dependsOn: ['AGENT_UGC_FACTORY'],
        inputs: ['ugcContent'],
        outputs: ['rankedCreatives', 'scores'],
      },
    ],
    sharedContext: {},
    maxTotalTurns: 20,
    maxCostUsd: 3.00,
    tier: 2,
    tags: ['creative', 'copy', 'content'],
  },

  // 5. ANALYTICS TEAM
  {
    id: 'ANALYTICS_TEAM',
    name: 'Analytics Team',
    description: 'Full analytics: data collection + reporting + insights',
    conductor: 'AGENT_REPORT_GENERATOR',
    workers: [
      {
        agentId: 'AGENT_DATA_PROCESSOR',
        role: 'Data collection and aggregation',
        maxTurns: 5,
        costBudgetUsd: 0.50,
        required: true,
        outputs: ['rawData', 'aggregations'],
      },
      {
        agentId: 'AGENT_TREND_ANALYZER',
        role: 'Trend detection and forecasting',
        maxTurns: 5,
        costBudgetUsd: 0.50,
        required: false,
        dependsOn: ['AGENT_DATA_PROCESSOR'],
        inputs: ['rawData', 'aggregations'],
        outputs: ['trends', 'forecasts'],
      },
      {
        agentId: 'AGENT_REPORT_GENERATOR',
        role: 'Report generation and visualization',
        maxTurns: 5,
        costBudgetUsd: 0.50,
        required: true,
        dependsOn: ['AGENT_DATA_PROCESSOR', 'AGENT_TREND_ANALYZER'],
        inputs: ['rawData', 'aggregations', 'trends'],
        outputs: ['report', 'dashboardData'],
      },
    ],
    sharedContext: {},
    maxTotalTurns: 20,
    maxCostUsd: 2.50,
    tier: 2,
    tags: ['analytics', 'reporting', 'data'],
  },

  // 6. PROTECTION TEAM
  {
    id: 'PROTECTION_TEAM',
    name: 'Protection Team',
    description: 'Budget protection: monitoring + stop-loss + alerts',
    conductor: 'AGENT_BUDGET_PROTECTOR',
    workers: [
      {
        agentId: 'AGENT_CAMPAIGN_MONITOR',
        role: 'Real-time campaign monitoring',
        maxTurns: 3,
        costBudgetUsd: 0.30,
        required: true,
        outputs: ['campaignStatus', 'alerts'],
      },
      {
        agentId: 'AGENT_STOP_LOSS',
        role: 'Stop-loss enforcement and budget capping',
        maxTurns: 3,
        costBudgetUsd: 0.30,
        required: true,
        dependsOn: ['AGENT_CAMPAIGN_MONITOR'],
        inputs: ['campaignStatus', 'alerts'],
        outputs: ['actions', 'killedCampaigns'],
      },
    ],
    sharedContext: {},
    maxTotalTurns: 10,
    maxCostUsd: 1.00,
    tier: 1,
    tags: ['protection', 'budget', 'safety'],
  },

  // 7. GROWTH TEAM
  {
    id: 'GROWTH_TEAM',
    name: 'Growth Team',
    description: 'Growth hacking: audience expansion + scaling + new angles',
    conductor: 'AGENT_GROWTH_HACKER',
    workers: [
      {
        agentId: 'AGENT_AUDIENCE_FINDER',
        role: 'Find new audiences and lookalikes',
        maxTurns: 8,
        costBudgetUsd: 1.00,
        required: true,
        outputs: ['audiences', 'lookalikes'],
      },
      {
        agentId: 'AGENT_SCALING_ADVISOR',
        role: 'Scaling strategy and budget planning',
        maxTurns: 5,
        costBudgetUsd: 0.50,
        required: true,
        dependsOn: ['AGENT_AUDIENCE_FINDER'],
        inputs: ['audiences'],
        outputs: ['scalingPlan', 'budgetIncrease'],
      },
      {
        agentId: 'AGENT_TREND_ANALYZER',
        role: 'Market trend identification for new angles',
        maxTurns: 5,
        costBudgetUsd: 0.50,
        required: false,
        outputs: ['trends', 'opportunities'],
      },
    ],
    sharedContext: {},
    maxTotalTurns: 25,
    maxCostUsd: 3.50,
    tier: 3,
    tags: ['growth', 'scaling', 'audiences'],
  },

  // 8. RESEARCH TEAM
  {
    id: 'RESEARCH_TEAM',
    name: 'Research Team',
    description: 'Market research: competitor analysis + pricing + trends',
    conductor: 'AGENT_SPY',
    workers: [
      {
        agentId: 'AGENT_SPY',
        role: 'Competitor store and product analysis',
        maxTurns: 10,
        costBudgetUsd: 1.50,
        required: true,
        outputs: ['competitors', 'competitorPricing'],
      },
      {
        agentId: 'AGENT_TREND_ANALYZER',
        role: 'Market trends and demand analysis',
        maxTurns: 5,
        costBudgetUsd: 0.50,
        required: false,
        outputs: ['trends', 'demandSignals'],
      },
      {
        agentId: 'AGENT_NICHE_FINDER',
        role: 'Niche identification and validation',
        maxTurns: 8,
        costBudgetUsd: 1.00,
        required: false,
        dependsOn: ['AGENT_SPY', 'AGENT_TREND_ANALYZER'],
        inputs: ['competitors', 'trends'],
        outputs: ['niches', 'opportunities'],
      },
    ],
    sharedContext: {},
    maxTotalTurns: 30,
    maxCostUsd: 4.00,
    tier: 2,
    tags: ['research', 'spy', 'market'],
  },
];

// ── Team Preset Engine ────────────────────────────────────────────────────

class TeamPresetEngine {
  private presets: Map<string, TeamPreset> = new Map();
  private executions: Map<string, TeamExecution> = new Map();

  constructor() {
    for (const preset of BUILT_IN_TEAMS) {
      this.presets.set(preset.id, preset);
    }
  }

  // ── Get presets ─────────────────────────────────────────────────────

  getPreset(teamId: string): TeamPreset | undefined {
    return this.presets.get(teamId);
  }

  listPresets(filter?: { tier?: number; tag?: string }): TeamPreset[] {
    let results = Array.from(this.presets.values());
    if (filter?.tier) {
      results = results.filter(p => !p.tier || p.tier <= filter.tier!);
    }
    if (filter?.tag) {
      results = results.filter(p => p.tags.includes(filter.tag!));
    }
    return results;
  }

  // ── Register custom preset ──────────────────────────────────────────

  registerPreset(preset: TeamPreset): void {
    this.presets.set(preset.id, preset);
  }

  // ── Start team execution ────────────────────────────────────────────

  startExecution(teamId: string, shopId: string, context?: Record<string, unknown>): TeamExecution {
    const preset = this.presets.get(teamId);
    if (!preset) throw new Error(`Team preset ${teamId} not found`);

    const execution: TeamExecution = {
      teamId,
      executionId: `team_${teamId}_${Date.now()}`,
      shopId,
      status: 'running',
      conductor: preset.conductor,
      workers: preset.workers.map(w => ({
        agentId: w.agentId,
        status: 'pending',
        turnsUsed: 0,
        costUsd: 0,
      })),
      sharedContext: { ...preset.sharedContext, ...context },
      startedAt: new Date(),
      totalCostUsd: 0,
      totalTurns: 0,
    };

    this.executions.set(execution.executionId, execution);
    return execution;
  }

  // ── Update worker status ────────────────────────────────────────────

  updateWorker(executionId: string, agentId: string, update: Partial<WorkerExecution>): void {
    const execution = this.executions.get(executionId);
    if (!execution) return;

    const worker = execution.workers.find(w => w.agentId === agentId);
    if (!worker) return;

    Object.assign(worker, update);

    // Recalculate totals
    execution.totalCostUsd = execution.workers.reduce((sum, w) => sum + w.costUsd, 0);
    execution.totalTurns = execution.workers.reduce((sum, w) => sum + w.turnsUsed, 0);

    // Check if all done
    const allDone = execution.workers.every(w =>
      ['completed', 'failed', 'skipped'].includes(w.status)
    );
    if (allDone) {
      const anyRequiredFailed = execution.workers.some(w => {
        const preset = this.presets.get(execution.teamId);
        const workerDef = preset?.workers.find(pw => pw.agentId === w.agentId);
        return workerDef?.required && w.status === 'failed';
      });

      execution.status = anyRequiredFailed ? 'failed' : 'completed';
      execution.completedAt = new Date();
    }
  }

  // ── Get next runnable workers ───────────────────────────────────────

  getNextWorkers(executionId: string): TeamWorker[] {
    const execution = this.executions.get(executionId);
    if (!execution) return [];

    const preset = this.presets.get(execution.teamId);
    if (!preset) return [];

    const completedIds = new Set(
      execution.workers
        .filter(w => w.status === 'completed')
        .map(w => w.agentId)
    );

    const pendingIds = new Set(
      execution.workers
        .filter(w => w.status === 'pending')
        .map(w => w.agentId)
    );

    return preset.workers.filter(w => {
      if (!pendingIds.has(w.agentId)) return false;

      // Check dependencies
      if (w.dependsOn) {
        return w.dependsOn.every(dep => completedIds.has(dep));
      }
      return true;
    });
  }

  // ── Shared context management ───────────────────────────────────────

  setContext(executionId: string, key: string, value: unknown): void {
    const execution = this.executions.get(executionId);
    if (execution) {
      execution.sharedContext[key] = value;
    }
  }

  getContext(executionId: string): Record<string, unknown> {
    return this.executions.get(executionId)?.sharedContext || {};
  }

  // ── Get execution ───────────────────────────────────────────────────

  getExecution(executionId: string): TeamExecution | undefined {
    return this.executions.get(executionId);
  }

  getActiveExecutions(shopId?: string): TeamExecution[] {
    return Array.from(this.executions.values())
      .filter(e => e.status === 'running')
      .filter(e => !shopId || e.shopId === shopId);
  }

  // ── Summary ─────────────────────────────────────────────────────────

  getExecutionSummary(executionId: string): string {
    const exec = this.executions.get(executionId);
    if (!exec) return 'Execution not found';

    const completed = exec.workers.filter(w => w.status === 'completed').length;
    const failed = exec.workers.filter(w => w.status === 'failed').length;
    const pending = exec.workers.filter(w => w.status === 'pending').length;

    return [
      `Team: ${exec.teamId} [${exec.status}]`,
      `Workers: ${completed} done, ${failed} failed, ${pending} pending`,
      `Cost: $${exec.totalCostUsd.toFixed(2)} | Turns: ${exec.totalTurns}`,
      exec.completedAt
        ? `Duration: ${((exec.completedAt.getTime() - exec.startedAt.getTime()) / 1000).toFixed(0)}s`
        : `Running since ${exec.startedAt.toISOString()}`,
    ].join('\n');
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const teamPresets = new TeamPresetEngine();
