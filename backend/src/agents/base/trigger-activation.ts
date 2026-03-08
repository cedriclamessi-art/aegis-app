/**
 * Trigger Activation — Event-driven agent activation with phrase detection
 * =========================================================================
 * Sources: daymade/claude-code-skills, coreyhaines31/marketing-skills,
 *          jeremylongshore/claude-code-plugins-plus-skills
 *
 * Agents can be activated by:
 *   1. Trigger phrases  — Natural language patterns (e.g., "analyze my store")
 *   2. Events           — System events (e.g., campaign created, ROAS drop)
 *   3. Schedules        — Time-based (cron-like)
 *   4. Thresholds       — Metric thresholds (e.g., ROAS < 1.0)
 *   5. Webhooks         — External webhook payloads
 *   6. Chain triggers   — One agent completing triggers another
 *
 * Each trigger has:
 *   - Activation pattern (regex, keyword, event name)
 *   - Priority (which trigger wins if multiple match)
 *   - Cooldown (minimum time between activations)
 *   - Conditions (additional context checks)
 *   - Target agent (which agent to invoke)
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type TriggerType = 'phrase' | 'event' | 'schedule' | 'threshold' | 'webhook' | 'chain';

export interface Trigger {
  id:            string;
  name:          string;
  type:          TriggerType;
  agentId:       string;           // Agent to invoke
  enabled:       boolean;
  priority:      number;           // Lower = higher priority
  cooldownMs:    number;           // Minimum time between activations
  lastFiredAt?:  Date;
  tier?:         number;           // Minimum tier required

  // Type-specific config
  phrases?:      string[];         // For 'phrase' type
  phraseRegex?:  string;           // Regex pattern for phrases
  eventName?:    string;           // For 'event' type
  threshold?:    ThresholdConfig;  // For 'threshold' type
  chainFrom?:    string;           // For 'chain' — agent ID that triggers this
  webhookPath?:  string;           // For 'webhook' — URL path

  // Additional conditions
  conditions?:   TriggerCondition[];
  metadata?:     Record<string, unknown>;
}

export interface ThresholdConfig {
  metric:    string;               // e.g., 'roas', 'ctr', 'spend'
  operator:  '>' | '<' | '>=' | '<=' | '==' | '!=';
  value:     number;
  duration?: number;               // How long condition must persist (ms)
}

export interface TriggerCondition {
  field:     string;
  operator:  '>' | '<' | '>=' | '<=' | '==' | '!=' | 'contains' | 'not_contains';
  value:     string | number | boolean;
}

export interface TriggerMatch {
  trigger:     Trigger;
  confidence:  number;             // 0-1
  matchedText?: string;
  context:     Record<string, unknown>;
}

export interface TriggerExecution {
  triggerId:   string;
  agentId:     string;
  firedAt:     Date;
  input:       string;
  context:     Record<string, unknown>;
  result?:     unknown;
  status:      'fired' | 'completed' | 'failed' | 'cooldown';
}

// ── Built-in Triggers ─────────────────────────────────────────────────────

const BUILT_IN_TRIGGERS: Trigger[] = [
  // Phrase triggers
  {
    id: 'trig_analyze_store',
    name: 'Analyze Store',
    type: 'phrase',
    agentId: 'AGENT_STORE_AUDITOR',
    enabled: true,
    priority: 10,
    cooldownMs: 300000,   // 5 min
    phrases: ['analyse ma boutique', 'analyze my store', 'audit store', 'store quality'],
    phraseRegex: '(analy[sz]e|audit|check|review).*(store|boutique|shop)',
  },
  {
    id: 'trig_launch_product',
    name: 'Launch Product',
    type: 'phrase',
    agentId: 'AGENT_PIPELINE_ORCHESTRATOR',
    enabled: true,
    priority: 5,
    cooldownMs: 600000,   // 10 min
    phrases: ['lance ce produit', 'launch this product', 'start pipeline', 'create campaign'],
    phraseRegex: '(launch|lance|start|begin|create).*(product|produit|campaign|campagne|pipeline)',
  },
  {
    id: 'trig_check_roas',
    name: 'Check ROAS',
    type: 'phrase',
    agentId: 'AGENT_CAMPAIGN_MONITOR',
    enabled: true,
    priority: 15,
    cooldownMs: 60000,    // 1 min
    phrases: ['check roas', 'roas status', 'campaign performance', 'performance campagne'],
    phraseRegex: '(check|show|get|voir).*(roas|performance|metrics|results)',
  },
  {
    id: 'trig_generate_copy',
    name: 'Generate Copy',
    type: 'phrase',
    agentId: 'AGENT_COPY_CHIEF',
    enabled: true,
    priority: 20,
    cooldownMs: 120000,   // 2 min
    phrases: ['write copy', 'generate ad', 'create headline', 'marketing text'],
    phraseRegex: '(write|create|generate|make).*(copy|ad|headline|text|hook|description)',
  },
  {
    id: 'trig_spy_competitors',
    name: 'Spy Competitors',
    type: 'phrase',
    agentId: 'AGENT_SPY',
    enabled: true,
    priority: 20,
    cooldownMs: 300000,
    phrases: ['spy competitors', 'analyse concurrents', 'competitor analysis', 'market research'],
    phraseRegex: '(spy|analy[sz]e|research|find).*(competitor|concurrent|market|niche)',
  },
  {
    id: 'trig_protect_budget',
    name: 'Protect Budget',
    type: 'phrase',
    agentId: 'AGENT_BUDGET_PROTECTOR',
    enabled: true,
    priority: 5,
    cooldownMs: 60000,
    phrases: ['protect budget', 'stop spending', 'kill campaign', 'emergency stop'],
    phraseRegex: '(protect|stop|kill|pause|emergency).*(budget|spending|campaign|campagne)',
  },
  {
    id: 'trig_daily_report',
    name: 'Daily Report',
    type: 'phrase',
    agentId: 'AGENT_REPORT_GENERATOR',
    enabled: true,
    priority: 25,
    cooldownMs: 60000,
    phrases: ['daily report', 'rapport journalier', 'show report', 'generate report'],
    phraseRegex: '(show|generate|create|get|voir).*(report|rapport|summary|recap)',
  },

  // Event triggers
  {
    id: 'trig_event_campaign_created',
    name: 'Campaign Created',
    type: 'event',
    agentId: 'AGENT_CAMPAIGN_MONITOR',
    enabled: true,
    priority: 10,
    cooldownMs: 0,
    eventName: 'campaign:created',
  },
  {
    id: 'trig_event_pipeline_complete',
    name: 'Pipeline Complete',
    type: 'event',
    agentId: 'AGENT_REPORT_GENERATOR',
    enabled: true,
    priority: 20,
    cooldownMs: 0,
    eventName: 'pipeline:complete',
  },

  // Threshold triggers
  {
    id: 'trig_threshold_roas_drop',
    name: 'ROAS Drop Alert',
    type: 'threshold',
    agentId: 'AGENT_BUDGET_PROTECTOR',
    enabled: true,
    priority: 1,
    cooldownMs: 3600000,  // 1h
    threshold: {
      metric: 'roas',
      operator: '<',
      value: 1.0,
      duration: 3600000,  // Must persist 1h
    },
  },
  {
    id: 'trig_threshold_spend_high',
    name: 'High Spend Alert',
    type: 'threshold',
    agentId: 'AGENT_STOP_LOSS',
    enabled: true,
    priority: 1,
    cooldownMs: 1800000,  // 30 min
    threshold: {
      metric: 'daily_spend',
      operator: '>',
      value: 200,
    },
  },
  {
    id: 'trig_threshold_fatigue_high',
    name: 'Creative Fatigue',
    type: 'threshold',
    agentId: 'AGENT_COPY_CHIEF',
    enabled: true,
    priority: 10,
    cooldownMs: 86400000, // 24h
    threshold: {
      metric: 'fatigue_score',
      operator: '>',
      value: 0.7,
    },
  },

  // Chain triggers
  {
    id: 'trig_chain_ingest_to_analyze',
    name: 'Ingest → Analyze',
    type: 'chain',
    agentId: 'AGENT_SPY',
    enabled: true,
    priority: 10,
    cooldownMs: 0,
    chainFrom: 'AGENT_PRODUCT_INGEST',
  },
  {
    id: 'trig_chain_results_to_ralph',
    name: 'Results → Ralph',
    type: 'chain',
    agentId: 'AGENT_RALPH',
    enabled: true,
    priority: 5,
    cooldownMs: 0,
    chainFrom: 'AGENT_RESULTS_48H',
  },
];

// ── Trigger Activation Engine ─────────────────────────────────────────────

class TriggerActivationEngine {
  private triggers: Map<string, Trigger> = new Map();
  private executionLog: TriggerExecution[] = [];

  constructor() {
    for (const trigger of BUILT_IN_TRIGGERS) {
      this.triggers.set(trigger.id, trigger);
    }
  }

  // ── Match phrase ────────────────────────────────────────────────────

  matchPhrase(input: string, tier: number = 1): TriggerMatch[] {
    const lower = input.toLowerCase().trim();
    const matches: TriggerMatch[] = [];

    for (const trigger of this.triggers.values()) {
      if (!trigger.enabled || trigger.type !== 'phrase') continue;
      if (trigger.tier && tier < trigger.tier) continue;
      if (!this.checkCooldown(trigger)) continue;

      let confidence = 0;
      let matchedText = '';

      // Check exact phrases
      if (trigger.phrases) {
        for (const phrase of trigger.phrases) {
          if (lower.includes(phrase.toLowerCase())) {
            confidence = Math.max(confidence, 0.9);
            matchedText = phrase;
          }
        }
      }

      // Check regex
      if (trigger.phraseRegex) {
        try {
          const regex = new RegExp(trigger.phraseRegex, 'i');
          const match = lower.match(regex);
          if (match) {
            confidence = Math.max(confidence, 0.7);
            matchedText = matchedText || match[0];
          }
        } catch {
          // Invalid regex, skip
        }
      }

      if (confidence > 0) {
        matches.push({
          trigger,
          confidence,
          matchedText,
          context: { originalInput: input },
        });
      }
    }

    // Sort by priority then confidence
    return matches.sort((a, b) => {
      if (a.trigger.priority !== b.trigger.priority) {
        return a.trigger.priority - b.trigger.priority;
      }
      return b.confidence - a.confidence;
    });
  }

  // ── Fire event trigger ──────────────────────────────────────────────

  fireEvent(eventName: string, context: Record<string, unknown> = {}): TriggerMatch[] {
    const matches: TriggerMatch[] = [];

    for (const trigger of this.triggers.values()) {
      if (!trigger.enabled || trigger.type !== 'event') continue;
      if (trigger.eventName !== eventName) continue;
      if (!this.checkCooldown(trigger)) continue;

      matches.push({
        trigger,
        confidence: 1.0,
        context,
      });
    }

    return matches;
  }

  // ── Check threshold ─────────────────────────────────────────────────

  checkThreshold(metric: string, value: number, context: Record<string, unknown> = {}): TriggerMatch[] {
    const matches: TriggerMatch[] = [];

    for (const trigger of this.triggers.values()) {
      if (!trigger.enabled || trigger.type !== 'threshold') continue;
      if (!trigger.threshold || trigger.threshold.metric !== metric) continue;
      if (!this.checkCooldown(trigger)) continue;

      const { operator, value: threshold } = trigger.threshold;
      let triggered = false;

      switch (operator) {
        case '>': triggered = value > threshold; break;
        case '<': triggered = value < threshold; break;
        case '>=': triggered = value >= threshold; break;
        case '<=': triggered = value <= threshold; break;
        case '==': triggered = value === threshold; break;
        case '!=': triggered = value !== threshold; break;
      }

      if (triggered) {
        matches.push({
          trigger,
          confidence: 1.0,
          context: { ...context, metric, value, threshold },
        });
      }
    }

    return matches;
  }

  // ── Fire chain trigger ──────────────────────────────────────────────

  fireChain(completedAgentId: string, context: Record<string, unknown> = {}): TriggerMatch[] {
    const matches: TriggerMatch[] = [];

    for (const trigger of this.triggers.values()) {
      if (!trigger.enabled || trigger.type !== 'chain') continue;
      if (trigger.chainFrom !== completedAgentId) continue;
      if (!this.checkCooldown(trigger)) continue;

      matches.push({
        trigger,
        confidence: 1.0,
        context: { ...context, chainFrom: completedAgentId },
      });
    }

    return matches;
  }

  // ── Record execution ────────────────────────────────────────────────

  recordExecution(triggerId: string, agentId: string, input: string, context: Record<string, unknown>): void {
    const trigger = this.triggers.get(triggerId);
    if (trigger) {
      trigger.lastFiredAt = new Date();
    }

    this.executionLog.push({
      triggerId,
      agentId,
      firedAt: new Date(),
      input,
      context,
      status: 'fired',
    });

    // Keep last 500
    if (this.executionLog.length > 500) {
      this.executionLog = this.executionLog.slice(-500);
    }
  }

  // ── Register custom trigger ─────────────────────────────────────────

  register(trigger: Trigger): void {
    this.triggers.set(trigger.id, trigger);
  }

  unregister(triggerId: string): void {
    this.triggers.delete(triggerId);
  }

  enable(triggerId: string): void {
    const t = this.triggers.get(triggerId);
    if (t) t.enabled = true;
  }

  disable(triggerId: string): void {
    const t = this.triggers.get(triggerId);
    if (t) t.enabled = false;
  }

  // ── List triggers ───────────────────────────────────────────────────

  listTriggers(type?: TriggerType): Trigger[] {
    let results = Array.from(this.triggers.values());
    if (type) results = results.filter(t => t.type === type);
    return results.sort((a, b) => a.priority - b.priority);
  }

  // ── Execution history ───────────────────────────────────────────────

  getExecutionHistory(limit = 50): TriggerExecution[] {
    return this.executionLog.slice(-limit);
  }

  // ── Cooldown check ──────────────────────────────────────────────────

  private checkCooldown(trigger: Trigger): boolean {
    if (trigger.cooldownMs === 0) return true;
    if (!trigger.lastFiredAt) return true;
    return Date.now() - trigger.lastFiredAt.getTime() >= trigger.cooldownMs;
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const triggerActivation = new TriggerActivationEngine();
