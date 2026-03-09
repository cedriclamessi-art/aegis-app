/**
 * AEGIS Agent Infrastructure — Central Export Barrel
 * ====================================================
 * All 28 base modules available from a single import:
 *
 *   import { BaseAgent, rateLimiter, circuitBreakerRegistry } from './base';
 *
 * Modules grouped by concern:
 *   Core:        BaseAgent, AgentBase, AgentTask
 *   Execution:   executionLog, observability, persistence
 *   Routing:     modelRouter, rateLimiter, circuitBreakerRegistry
 *   Memory:      memorySystem, memoryHierarchy
 *   Planning:    taskPlanner, subAgentOrchestrator
 *   Quality:     qualityGate, hookRegistry
 *   Config:      layeredConfig, teamPresets, agentPermissions
 *   Intelligence: skillExtraction, metaAdsLibrary, innerMonologue
 *   Advanced:    turnBudget, workRegistry, triggerActivation,
 *                progressiveDisclosure, sleeptimeCompute,
 *                conversationCompaction, toolRuleGraph,
 *                agentStateSerialization, providerAbstraction
 */

// ── Core ───────────────────────────────────────────────────────────
export {
  BaseAgent,
  AgentBase,
  type AgentTask,
  type AgentResult,
  type RiskLevel,
  type EmpireMode,
  type WorldState,
} from './agent.base';

// ── Execution & Observability ──────────────────────────────────────
export { executionLog, type ExecutionLogEntry, type ToolCallRecord, type LogQuery } from './execution-log';
export { observability, type ObservabilityEvent, type EventType, type AgentHeartbeat, type PerformanceMetrics, type SystemAlert } from './observability';
export { persistence, type PersistenceConfig } from './persistence';

// ── Routing & Rate Limiting ────────────────────────────────────────
export { modelRouter } from './model-router';
export { rateLimiter } from './rate-limiter';
export { circuitBreakerRegistry } from './circuit-breaker';

// ── Memory ─────────────────────────────────────────────────────────
export { memorySystem } from './memory-system';
export { memoryHierarchy } from './memory-hierarchy';

// ── Planning & Orchestration ───────────────────────────────────────
export { taskPlanner, type TaskPlan, type TaskPhase, type AttentionContext, type RebootCheck } from './task-planner';
export { subAgentOrchestrator, aggregateResults, aegisPipelines, type SubAgentResult, type WorkerTask, type PipelinePhase } from './sub-agent-orchestrator';

// ── Quality & Hooks ────────────────────────────────────────────────
export { qualityGate } from './quality-gate';
export { hookEngine } from './hooks';

// ── Configuration ──────────────────────────────────────────────────
export { layeredConfig } from './layered-config';
export { teamPresets } from './team-presets';
export { agentPermissions } from './agent-permissions';

// ── Intelligence ───────────────────────────────────────────────────
export { skillExtraction, type Skill, type SkillRecommendation } from './skill-extraction';
export { createMetaAdsLibrary } from './meta-ads-library';
export { innerMonologue } from './inner-monologue';

// ── Advanced Modules ───────────────────────────────────────────────
export { turnBudget } from './turn-budget';
export { workRegistry } from './work-registry';
export { triggerActivation } from './trigger-activation';
export { progressiveDisclosure } from './progressive-disclosure';
export { sleeptimeCompute } from './sleeptime-compute';
export { conversationCompaction } from './conversation-compaction';
export { toolRuleGraph } from './tool-rule-graph';
export { agentStateSerialization } from './agent-state-serialization';
export { providerAbstraction } from './provider-abstraction';
