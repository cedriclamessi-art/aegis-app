/**
 * Layered Configuration — Platform < Tenant < Session overrides
 * ================================================================
 * Sources: Cranot/claude-code-guide, Yeachan-Heo/oh-my-claudecode,
 *          alirezarezvani/claude-skills
 *
 * Configuration layers (lowest to highest priority):
 *   1. Platform defaults  — hardcoded AEGIS baseline
 *   2. Tenant (shop)      — per-shop overrides from DB
 *   3. Session            — runtime overrides for current pipeline
 *   4. Agent              — per-agent instance overrides
 *
 * Features:
 *   - Deep merge with override semantics
 *   - Type-safe config access with dot notation
 *   - Change tracking and audit log
 *   - Schema validation
 *   - Hot reload from DB without restart
 *   - Config inheritance chain
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type ConfigLayer = 'platform' | 'tenant' | 'session' | 'agent';

export interface ConfigEntry {
  key:       string;
  value:     unknown;
  layer:     ConfigLayer;
  source:    string;        // Who/what set it
  updatedAt: Date;
  expiresAt?: Date;
}

export interface ConfigSchema {
  key:          string;
  type:         'string' | 'number' | 'boolean' | 'object' | 'array';
  required:     boolean;
  defaultValue: unknown;
  description:  string;
  minValue?:    number;
  maxValue?:    number;
  allowedValues?: unknown[];
  sensitive?:   boolean;     // Mask in logs
}

export interface ConfigChange {
  key:       string;
  oldValue:  unknown;
  newValue:  unknown;
  layer:     ConfigLayer;
  changedBy: string;
  timestamp: Date;
}

// ── Platform Defaults ─────────────────────────────────────────────────────

const PLATFORM_DEFAULTS: Record<string, unknown> = {
  // Pipeline settings
  'pipeline.maxSteps':              11,
  'pipeline.stepTimeoutMs':         300000,    // 5 min per step
  'pipeline.retryOnFailure':        true,
  'pipeline.maxRetries':            2,
  'pipeline.qualityGateEnabled':    true,

  // Agent settings
  'agent.defaultModel':             'claude-haiku-4-20250514',
  'agent.smartModel':               'claude-sonnet-4-20250514',
  'agent.maxTokens':                4096,
  'agent.temperature':              0.7,
  'agent.maxTurns':                 10,
  'agent.turnBudgetUsd':            0.50,
  'agent.totalBudgetUsd':           5.00,

  // Business rules
  'business.minMargin':             30,        // 30% minimum margin
  'business.targetRoas':            2.5,
  'business.minTestBudget':         30,        // 30€ minimum test
  'business.maxTestBudget':         500,       // 500€ maximum test
  'business.scaleFactor':           1.3,       // 30% budget increase on scale
  'business.killRoasThreshold':     1.0,       // Kill campaigns below 1.0x

  // Ralph Loop
  'ralph.waitHours':                48,
  'ralph.maxIterations':            10,
  'ralph.exitConsecutiveDays':      7,
  'ralph.circuitBreakerThreshold':  3,

  // Scheduled tasks
  'scheduler.timezone':             'Europe/Paris',
  'scheduler.dailyRunHour':         6,
  'scheduler.maxConcurrent':        3,

  // Review system
  'review.autoReviewEnabled':       true,
  'review.minPassScore':            70,
  'review.blockOnCritical':         true,

  // Rate limiting
  'rateLimit.callsPerHour':         200,
  'rateLimit.tokensPerDay':         500000,
  'rateLimit.maxConcurrentPipelines': 5,

  // Hooks
  'hooks.preExecuteEnabled':        true,
  'hooks.postExecuteEnabled':       true,
  'hooks.budgetCheckEnabled':       true,

  // Memory
  'memory.enabled':                 true,
  'memory.maxObservationsPerAgent': 100,
  'memory.patternExtractionEnabled': true,

  // Providers
  'provider.primary':               'anthropic',
  'provider.fallbackEnabled':       true,
  'provider.maxCostPerDayUsd':      50,

  // UI
  'ui.language':                    'fr',
  'ui.theme':                       'aegis-dark',
  'ui.dashboardRefreshMs':          30000,
};

// ── Config Schema ─────────────────────────────────────────────────────────

const CONFIG_SCHEMA: ConfigSchema[] = [
  { key: 'pipeline.maxSteps',           type: 'number',  required: true,  defaultValue: 11,    description: 'Maximum pipeline steps' },
  { key: 'pipeline.stepTimeoutMs',      type: 'number',  required: true,  defaultValue: 300000, description: 'Step timeout in ms', minValue: 10000, maxValue: 600000 },
  { key: 'business.minMargin',          type: 'number',  required: true,  defaultValue: 30,    description: 'Minimum margin %', minValue: 10, maxValue: 90 },
  { key: 'business.targetRoas',         type: 'number',  required: true,  defaultValue: 2.5,   description: 'Target ROAS', minValue: 1.0, maxValue: 20 },
  { key: 'agent.defaultModel',          type: 'string',  required: true,  defaultValue: 'claude-haiku-4-20250514', description: 'Default LLM model' },
  { key: 'agent.maxTurns',             type: 'number',  required: true,  defaultValue: 10,    description: 'Max agent turns', minValue: 1, maxValue: 100 },
  { key: 'agent.totalBudgetUsd',       type: 'number',  required: true,  defaultValue: 5.00,  description: 'Max cost per agent run', minValue: 0.01, maxValue: 100 },
  { key: 'provider.primary',           type: 'string',  required: true,  defaultValue: 'anthropic', description: 'Primary LLM provider', allowedValues: ['anthropic', 'openai', 'mistral'] },
  { key: 'provider.maxCostPerDayUsd',  type: 'number',  required: true,  defaultValue: 50,    description: 'Max daily LLM cost', sensitive: true, minValue: 1, maxValue: 10000 },
  { key: 'ui.language',                type: 'string',  required: true,  defaultValue: 'fr',  description: 'UI language', allowedValues: ['fr', 'en', 'es', 'de'] },
];

// ── Layered Config Engine ─────────────────────────────────────────────────

class LayeredConfigEngine {
  private layers: Map<ConfigLayer, Map<string, ConfigEntry>> = new Map();
  private changeLog: ConfigChange[] = [];
  private schemas: Map<string, ConfigSchema> = new Map();

  constructor() {
    // Initialize layers
    this.layers.set('platform', new Map());
    this.layers.set('tenant', new Map());
    this.layers.set('session', new Map());
    this.layers.set('agent', new Map());

    // Load platform defaults
    for (const [key, value] of Object.entries(PLATFORM_DEFAULTS)) {
      this.setInternal('platform', key, value, 'system-defaults');
    }

    // Load schemas
    for (const schema of CONFIG_SCHEMA) {
      this.schemas.set(schema.key, schema);
    }
  }

  // ── Get config value (resolves through layers) ──────────────────────

  get<T = unknown>(key: string, context?: { shopId?: string; agentId?: string }): T {
    // Check layers from highest to lowest priority
    const layerOrder: ConfigLayer[] = ['agent', 'session', 'tenant', 'platform'];

    for (const layer of layerOrder) {
      const layerMap = this.layers.get(layer);
      if (!layerMap) continue;

      // Try context-specific key first
      if (context?.shopId && layer === 'tenant') {
        const shopKey = `${context.shopId}:${key}`;
        const entry = layerMap.get(shopKey);
        if (entry && !this.isExpired(entry)) return entry.value as T;
      }
      if (context?.agentId && layer === 'agent') {
        const agentKey = `${context.agentId}:${key}`;
        const entry = layerMap.get(agentKey);
        if (entry && !this.isExpired(entry)) return entry.value as T;
      }

      // Try generic key
      const entry = layerMap.get(key);
      if (entry && !this.isExpired(entry)) return entry.value as T;
    }

    // Check schema for default
    const schema = this.schemas.get(key);
    if (schema) return schema.defaultValue as T;

    return undefined as T;
  }

  // ── Set config value ────────────────────────────────────────────────

  set(layer: ConfigLayer, key: string, value: unknown, source: string, options?: {
    shopId?: string;
    agentId?: string;
    expiresAt?: Date;
  }): { success: boolean; error?: string } {
    // Validate against schema
    const validation = this.validate(key, value);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Build full key with context
    let fullKey = key;
    if (options?.shopId && layer === 'tenant') fullKey = `${options.shopId}:${key}`;
    if (options?.agentId && layer === 'agent') fullKey = `${options.agentId}:${key}`;

    // Record change
    const oldValue = this.get(key);
    this.changeLog.push({
      key: fullKey,
      oldValue,
      newValue: value,
      layer,
      changedBy: source,
      timestamp: new Date(),
    });

    // Set value
    this.setInternal(layer, fullKey, value, source, options?.expiresAt);

    return { success: true };
  }

  // ── Bulk set for tenant ─────────────────────────────────────────────

  setTenantConfig(shopId: string, overrides: Record<string, unknown>, source: string): void {
    for (const [key, value] of Object.entries(overrides)) {
      this.set('tenant', key, value, source, { shopId });
    }
  }

  // ── Bulk set for session ────────────────────────────────────────────

  setSessionConfig(overrides: Record<string, unknown>, source: string, ttlMs?: number): void {
    const expiresAt = ttlMs ? new Date(Date.now() + ttlMs) : undefined;
    for (const [key, value] of Object.entries(overrides)) {
      this.set('session', key, value, source, { expiresAt });
    }
  }

  // ── Get all config for a context ────────────────────────────────────

  getAll(context?: { shopId?: string; agentId?: string }): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Start with platform defaults
    for (const [key, value] of Object.entries(PLATFORM_DEFAULTS)) {
      result[key] = value;
    }

    // Override with each layer
    const layerOrder: ConfigLayer[] = ['platform', 'tenant', 'session', 'agent'];
    for (const layer of layerOrder) {
      const layerMap = this.layers.get(layer);
      if (!layerMap) continue;

      for (const [fullKey, entry] of layerMap) {
        if (this.isExpired(entry)) continue;

        // Extract base key from context-prefixed key
        let baseKey = fullKey;
        if (context?.shopId && fullKey.startsWith(`${context.shopId}:`)) {
          baseKey = fullKey.slice(context.shopId.length + 1);
        } else if (context?.agentId && fullKey.startsWith(`${context.agentId}:`)) {
          baseKey = fullKey.slice(context.agentId.length + 1);
        } else if (fullKey.includes(':') && layer !== 'platform') {
          continue; // Skip other context-specific keys
        }

        result[baseKey] = entry.value;
      }
    }

    return result;
  }

  // ── Validation ──────────────────────────────────────────────────────

  validate(key: string, value: unknown): { valid: boolean; error?: string } {
    const schema = this.schemas.get(key);
    if (!schema) return { valid: true }; // No schema = no validation

    // Type check
    if (schema.type === 'number' && typeof value !== 'number') {
      return { valid: false, error: `${key} must be a number` };
    }
    if (schema.type === 'string' && typeof value !== 'string') {
      return { valid: false, error: `${key} must be a string` };
    }
    if (schema.type === 'boolean' && typeof value !== 'boolean') {
      return { valid: false, error: `${key} must be a boolean` };
    }

    // Range check
    if (typeof value === 'number') {
      if (schema.minValue !== undefined && value < schema.minValue) {
        return { valid: false, error: `${key} must be >= ${schema.minValue}` };
      }
      if (schema.maxValue !== undefined && value > schema.maxValue) {
        return { valid: false, error: `${key} must be <= ${schema.maxValue}` };
      }
    }

    // Allowed values
    if (schema.allowedValues && !schema.allowedValues.includes(value)) {
      return { valid: false, error: `${key} must be one of: ${schema.allowedValues.join(', ')}` };
    }

    return { valid: true };
  }

  // ── Change audit ────────────────────────────────────────────────────

  getChangeLog(since?: Date, key?: string): ConfigChange[] {
    let changes = this.changeLog;
    if (since) changes = changes.filter(c => c.timestamp >= since);
    if (key) changes = changes.filter(c => c.key.endsWith(key));
    return changes.slice(-100);
  }

  // ── Clear session/agent layers ──────────────────────────────────────

  clearSession(): void {
    this.layers.set('session', new Map());
  }

  clearAgent(agentId?: string): void {
    if (agentId) {
      const agentLayer = this.layers.get('agent');
      if (agentLayer) {
        for (const key of agentLayer.keys()) {
          if (key.startsWith(`${agentId}:`)) {
            agentLayer.delete(key);
          }
        }
      }
    } else {
      this.layers.set('agent', new Map());
    }
  }

  // ── Internal helpers ────────────────────────────────────────────────

  private setInternal(
    layer: ConfigLayer,
    key: string,
    value: unknown,
    source: string,
    expiresAt?: Date,
  ): void {
    const layerMap = this.layers.get(layer)!;
    layerMap.set(key, {
      key,
      value,
      layer,
      source,
      updatedAt: new Date(),
      expiresAt,
    });
  }

  private isExpired(entry: ConfigEntry): boolean {
    return !!entry.expiresAt && entry.expiresAt < new Date();
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const layeredConfig = new LayeredConfigEngine();
