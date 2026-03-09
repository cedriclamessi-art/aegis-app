/**
 * TaskPlanner — File-based persistent task planning for agents
 * =============================================================
 * Inspired by: OthmanAdi/planning-with-files (Manus AI context engineering)
 *
 * Core insight: AI agents drift after many tool calls. The filesystem
 * (or PostgreSQL) becomes persistent working memory that survives
 * context resets.
 *
 * Patterns implemented:
 * - 3-file persistent state: task_plan, findings, progress
 * - Attention refresh: re-read plan before every significant action
 * - 3-Strike Error Protocol: mutate → rethink → escalate
 * - 5-Question Reboot Check: verify agent can resume
 * - Phased task decomposition with checkbox subtasks
 */

// ── Types ──────────────────────────────────────────────────────────

export type PhaseStatus = 'pending' | 'in_progress' | 'complete' | 'blocked';

export interface PhaseSubtask {
  description: string;
  completed:   boolean;
  completedAt?: Date;
}

export interface TaskPhase {
  name:         string;
  status:       PhaseStatus;
  subtasks:     PhaseSubtask[];
  startedAt?:   Date;
  completedAt?: Date;
  assignedAgent?: string;
}

export interface TaskDecision {
  decision:  string;
  rationale: string;
  agentId:   string;
  timestamp: Date;
}

export interface TaskError {
  error:      string;
  attempt:    number;
  strategy:   string;
  resolution: string;
  agentId:    string;
  timestamp:  Date;
}

export interface TaskFinding {
  id:        string;
  category:  'requirement' | 'research' | 'technical_decision' | 'issue' | 'observation';
  title:     string;
  content:   string;
  source:    string;
  agentId:   string;
  timestamp: Date;
  tags:      string[];
}

export interface ProgressEntry {
  phase:       string;
  action:      string;
  agentId:     string;
  success:     boolean;
  details?:    string;
  durationMs?: number;
  timestamp:   Date;
}

export interface TaskPlan {
  id:            string;
  goal:          string;
  shopId:        string;
  currentPhase:  string;
  phases:        TaskPhase[];
  decisions:     TaskDecision[];
  errors:        TaskError[];
  findings:      TaskFinding[];
  progress:      ProgressEntry[];
  createdAt:     Date;
  updatedAt:     Date;
}

export interface RebootCheck {
  canResume:      boolean;
  whereAmI:       string;
  whereGoing:     string[];
  whatIsGoal:     string;
  whatLearned:    string[];
  whatDone:       string[];
  missingContext: string[];
}

export interface AttentionContext {
  goal:            string;
  currentPhase:    string;
  phaseProgress:   string;
  recentDecisions: TaskDecision[];
  recentErrors:    TaskError[];
  recentFindings:  TaskFinding[];
  recentActions:   ProgressEntry[];
  systemPrompt:    string;
}

// ── TaskPlanner Engine ─────────────────────────────────────────────

class TaskPlannerEngine {
  private plans = new Map<string, TaskPlan>();

  // ── Create ────────────────────────────────────────────────────

  createPlan(opts: {
    goal:     string;
    shopId:   string;
    phases:   Array<{ name: string; subtasks: string[]; assignedAgent?: string }>;
    agentId:  string;
  }): TaskPlan {
    const id = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const plan: TaskPlan = {
      id,
      goal:         opts.goal,
      shopId:       opts.shopId,
      currentPhase: opts.phases[0]?.name ?? 'unknown',
      phases: opts.phases.map((p, i) => ({
        name:          p.name,
        status:        i === 0 ? 'in_progress' : 'pending',
        subtasks:      p.subtasks.map(s => ({ description: s, completed: false })),
        startedAt:     i === 0 ? new Date() : undefined,
        assignedAgent: p.assignedAgent,
      })),
      decisions: [],
      errors:    [],
      findings:  [],
      progress:  [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.plans.set(id, plan);
    return plan;
  }

  getPlan(planId: string): TaskPlan | undefined {
    return this.plans.get(planId);
  }

  // ── Attention Refresh (Pre-Action Context) ────────────────────
  //    The most powerful pattern: re-read the plan before every
  //    significant action to prevent goal drift.

  refreshContext(planId: string): AttentionContext | null {
    const plan = this.plans.get(planId);
    if (!plan) return null;

    const currentPhaseObj = plan.phases.find(p => p.status === 'in_progress');
    const completed = plan.phases.filter(p => p.status === 'complete').length;
    const total = plan.phases.length;

    const phaseProgress = currentPhaseObj
      ? `Phase "${currentPhaseObj.name}" (${completed}/${total} phases complete). ` +
        `Subtasks: ${currentPhaseObj.subtasks.filter(s => s.completed).length}/${currentPhaseObj.subtasks.length} done.`
      : `${completed}/${total} phases complete.`;

    return {
      goal:            plan.goal,
      currentPhase:    plan.currentPhase,
      phaseProgress,
      recentDecisions: plan.decisions.slice(-3),
      recentErrors:    plan.errors.slice(-3),
      recentFindings:  plan.findings.slice(-5),
      recentActions:   plan.progress.slice(-5),
      systemPrompt:    this.buildSystemPrompt(plan),
    };
  }

  private buildSystemPrompt(plan: TaskPlan): string {
    const currentPhase = plan.phases.find(p => p.status === 'in_progress');
    const pending = plan.phases.filter(p => p.status === 'pending').map(p => p.name);
    const errors = plan.errors.slice(-2);

    let prompt = `[GOAL] ${plan.goal}\n`;
    prompt += `[PHASE] ${plan.currentPhase} (${currentPhase?.subtasks.filter(s => !s.completed).length ?? 0} subtasks remaining)\n`;
    if (pending.length > 0) prompt += `[NEXT] ${pending.slice(0, 3).join(' → ')}\n`;
    if (errors.length > 0) {
      prompt += `[ERRORS] ${errors.map(e => `${e.error} (attempt ${e.attempt}: ${e.resolution})`).join(' | ')}\n`;
    }
    return prompt;
  }

  // ── Phase Management ──────────────────────────────────────────

  advancePhase(planId: string): boolean {
    const plan = this.plans.get(planId);
    if (!plan) return false;

    const currentIdx = plan.phases.findIndex(p => p.status === 'in_progress');
    if (currentIdx < 0) return false;

    // Complete current phase
    plan.phases[currentIdx].status = 'complete';
    plan.phases[currentIdx].completedAt = new Date();

    // Start next phase
    if (currentIdx + 1 < plan.phases.length) {
      plan.phases[currentIdx + 1].status = 'in_progress';
      plan.phases[currentIdx + 1].startedAt = new Date();
      plan.currentPhase = plan.phases[currentIdx + 1].name;
    }

    plan.updatedAt = new Date();
    return true;
  }

  completeSubtask(planId: string, phaseName: string, subtaskIndex: number): boolean {
    const plan = this.plans.get(planId);
    if (!plan) return false;

    const phase = plan.phases.find(p => p.name === phaseName);
    if (!phase || subtaskIndex >= phase.subtasks.length) return false;

    phase.subtasks[subtaskIndex].completed = true;
    phase.subtasks[subtaskIndex].completedAt = new Date();

    // Auto-advance if all subtasks complete
    if (phase.subtasks.every(s => s.completed)) {
      this.advancePhase(planId);
    }

    plan.updatedAt = new Date();
    return true;
  }

  // ── Record Decision ──────────────────────────────────────────

  recordDecision(planId: string, decision: Omit<TaskDecision, 'timestamp'>): void {
    const plan = this.plans.get(planId);
    if (!plan) return;

    plan.decisions.push({ ...decision, timestamp: new Date() });
    plan.updatedAt = new Date();
  }

  // ── Record Finding (2-Action Rule) ───────────────────────────
  //    After every 2 external API calls, persist intermediate results.

  recordFinding(planId: string, finding: Omit<TaskFinding, 'id' | 'timestamp'>): string {
    const plan = this.plans.get(planId);
    if (!plan) return '';

    const id = `find_${Date.now()}_${Math.random().toString(36).slice(2, 4)}`;
    plan.findings.push({ ...finding, id, timestamp: new Date() });
    plan.updatedAt = new Date();
    return id;
  }

  // ── Record Progress ──────────────────────────────────────────

  recordProgress(planId: string, entry: Omit<ProgressEntry, 'timestamp'>): void {
    const plan = this.plans.get(planId);
    if (!plan) return;

    plan.progress.push({ ...entry, timestamp: new Date() });
    plan.updatedAt = new Date();
  }

  // ── 3-Strike Error Protocol ──────────────────────────────────
  //    1st failure: mutate approach
  //    2nd failure: try fundamentally different strategy
  //    3rd failure: escalate / ask for help

  async executeWithStrikes<T>(
    planId: string,
    operationKey: string,
    agentId: string,
    strategies: Array<{ label: string; fn: () => Promise<T> }>,
  ): Promise<{ success: boolean; result?: T; escalated: boolean }> {
    for (let i = 0; i < Math.min(strategies.length, 3); i++) {
      try {
        const result = await strategies[i].fn();

        this.recordError(planId, {
          error: operationKey,
          attempt: i + 1,
          strategy: strategies[i].label,
          resolution: 'success',
          agentId,
        });

        return { success: true, result, escalated: false };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);

        this.recordError(planId, {
          error: `${operationKey}: ${errMsg}`,
          attempt: i + 1,
          strategy: strategies[i].label,
          resolution: i < 2 ? `Trying strategy ${i + 2}` : 'ESCALATING',
          agentId,
        });
      }
    }

    return { success: false, escalated: true };
  }

  private recordError(planId: string, error: Omit<TaskError, 'timestamp'>): void {
    const plan = this.plans.get(planId);
    if (!plan) return;

    plan.errors.push({ ...error, timestamp: new Date() });
    plan.updatedAt = new Date();
  }

  // ── 5-Question Reboot Check ──────────────────────────────────
  //    Can the agent resume from where it left off?

  rebootCheck(planId: string): RebootCheck {
    const plan = this.plans.get(planId);
    if (!plan) {
      return {
        canResume: false,
        whereAmI: '', whereGoing: [], whatIsGoal: '',
        whatLearned: [], whatDone: [],
        missingContext: ['plan_not_found'],
      };
    }

    const missing: string[] = [];
    if (!plan.currentPhase) missing.push('current_phase');
    if (!plan.goal) missing.push('goal');
    if (plan.findings.length === 0) missing.push('no_findings');
    if (plan.progress.length === 0) missing.push('no_progress');

    return {
      canResume: missing.length === 0,
      whereAmI: plan.currentPhase,
      whereGoing: plan.phases
        .filter(p => p.status !== 'complete')
        .map(p => p.name),
      whatIsGoal: plan.goal,
      whatLearned: plan.findings.slice(-10).map(f => `[${f.category}] ${f.title}`),
      whatDone: plan.progress.slice(-10).map(p => `[${p.phase}] ${p.action}`),
      missingContext: missing,
    };
  }

  // ── Completion Status ────────────────────────────────────────

  getCompletionStatus(planId: string): {
    total: number; complete: number; inProgress: number;
    pending: number; blocked: number; percentComplete: number;
  } | null {
    const plan = this.plans.get(planId);
    if (!plan) return null;

    const total = plan.phases.length;
    const complete = plan.phases.filter(p => p.status === 'complete').length;
    const inProgress = plan.phases.filter(p => p.status === 'in_progress').length;
    const pending = plan.phases.filter(p => p.status === 'pending').length;
    const blocked = plan.phases.filter(p => p.status === 'blocked').length;

    return {
      total, complete, inProgress, pending, blocked,
      percentComplete: total > 0 ? Math.round((complete / total) * 100) : 0,
    };
  }

  // ── List all plans for a shop ────────────────────────────────

  getShopPlans(shopId: string): TaskPlan[] {
    return Array.from(this.plans.values())
      .filter(p => p.shopId === shopId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }
}

// ── Singleton Export ─────────────────────────────────────────────

export const taskPlanner = new TaskPlannerEngine();
