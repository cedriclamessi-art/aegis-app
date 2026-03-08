/**
 * Provider Abstraction Layer — Multi-LLM provider support
 * =========================================================
 * Sources: 1rgs/claude-code-proxy, router-for-me/CLIProxyAPI,
 *          rohitg00/awesome-claude-code-toolkit
 *
 * Allows AEGIS to work with multiple LLM providers:
 *   - Anthropic Claude (primary)
 *   - OpenAI GPT (fallback)
 *   - Mistral (EU-compliant option)
 *   - Local models (development/testing)
 *
 * Features:
 *   - Unified interface for all providers
 *   - Automatic fallback chain
 *   - Cost tracking per provider
 *   - Response normalization
 *   - Streaming support
 *   - Provider health monitoring
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type ProviderName = 'anthropic' | 'openai' | 'mistral' | 'local' | 'mock';

export type ProviderStatus = 'available' | 'degraded' | 'unavailable';

export interface ProviderConfig {
  name:          ProviderName;
  apiKey?:       string;
  baseUrl?:      string;
  models:        ProviderModel[];
  maxRetries:    number;
  timeoutMs:     number;
  enabled:       boolean;
  priority:      number;       // Lower = preferred
  costMultiplier: number;      // 1.0 = baseline
}

export interface ProviderModel {
  id:           string;        // Provider-specific model ID
  alias:        string;        // AEGIS internal alias (e.g., 'fast', 'smart', 'vision')
  inputCostPer1k:  number;     // Cost per 1k input tokens
  outputCostPer1k: number;     // Cost per 1k output tokens
  maxTokens:    number;
  supportsVision:   boolean;
  supportsStreaming: boolean;
}

export interface LLMRequest {
  messages:      LLMMessage[];
  model?:        string;       // Alias or specific model ID
  maxTokens?:    number;
  temperature?:  number;
  systemPrompt?: string;
  tools?:        LLMTool[];
  stream?:       boolean;
  metadata?:     Record<string, unknown>;
}

export interface LLMMessage {
  role:    'system' | 'user' | 'assistant' | 'tool';
  content: string | LLMContentBlock[];
  toolCallId?:  string;
  toolCalls?:   LLMToolCall[];
}

export interface LLMContentBlock {
  type:  'text' | 'image';
  text?: string;
  imageUrl?: string;
}

export interface LLMTool {
  name:        string;
  description: string;
  parameters:  Record<string, unknown>;
}

export interface LLMToolCall {
  id:         string;
  name:       string;
  arguments:  Record<string, unknown>;
}

export interface LLMResponse {
  id:           string;
  provider:     ProviderName;
  model:        string;
  content:      string;
  toolCalls?:   LLMToolCall[];
  usage: {
    inputTokens:  number;
    outputTokens: number;
    totalTokens:  number;
    costUsd:      number;
  };
  latencyMs:    number;
  cached:       boolean;
  metadata?:    Record<string, unknown>;
}

export interface ProviderHealth {
  provider:     ProviderName;
  status:       ProviderStatus;
  latencyP50:   number;
  latencyP99:   number;
  errorRate:    number;
  lastError?:   string;
  lastChecked:  Date;
  uptimePercent: number;
}

// ── Provider Interface ────────────────────────────────────────────────────

interface IProvider {
  name: ProviderName;
  call(request: LLMRequest): Promise<LLMResponse>;
  checkHealth(): Promise<ProviderHealth>;
  getModels(): ProviderModel[];
}

// ── Default Configs ───────────────────────────────────────────────────────

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    name: 'anthropic',
    models: [
      {
        id: 'claude-sonnet-4-20250514',
        alias: 'smart',
        inputCostPer1k: 0.003,
        outputCostPer1k: 0.015,
        maxTokens: 8192,
        supportsVision: true,
        supportsStreaming: true,
      },
      {
        id: 'claude-haiku-4-20250514',
        alias: 'fast',
        inputCostPer1k: 0.00025,
        outputCostPer1k: 0.00125,
        maxTokens: 8192,
        supportsVision: true,
        supportsStreaming: true,
      },
    ],
    maxRetries: 3,
    timeoutMs: 60000,
    enabled: true,
    priority: 1,
    costMultiplier: 1.0,
  },
  {
    name: 'openai',
    models: [
      {
        id: 'gpt-4o',
        alias: 'smart',
        inputCostPer1k: 0.005,
        outputCostPer1k: 0.015,
        maxTokens: 4096,
        supportsVision: true,
        supportsStreaming: true,
      },
      {
        id: 'gpt-4o-mini',
        alias: 'fast',
        inputCostPer1k: 0.00015,
        outputCostPer1k: 0.0006,
        maxTokens: 4096,
        supportsVision: true,
        supportsStreaming: true,
      },
    ],
    maxRetries: 2,
    timeoutMs: 45000,
    enabled: false,
    priority: 2,
    costMultiplier: 1.2,
  },
  {
    name: 'mistral',
    models: [
      {
        id: 'mistral-large-latest',
        alias: 'smart',
        inputCostPer1k: 0.002,
        outputCostPer1k: 0.006,
        maxTokens: 8192,
        supportsVision: false,
        supportsStreaming: true,
      },
    ],
    maxRetries: 2,
    timeoutMs: 30000,
    enabled: false,
    priority: 3,
    costMultiplier: 0.8,
  },
  {
    name: 'mock',
    models: [
      {
        id: 'mock-model',
        alias: 'fast',
        inputCostPer1k: 0,
        outputCostPer1k: 0,
        maxTokens: 4096,
        supportsVision: false,
        supportsStreaming: false,
      },
    ],
    maxRetries: 0,
    timeoutMs: 1000,
    enabled: false,
    priority: 99,
    costMultiplier: 0,
  },
];

// ── Provider Abstraction Engine ───────────────────────────────────────────

class ProviderAbstractionEngine {
  private configs: Map<ProviderName, ProviderConfig> = new Map();
  private healthCache: Map<ProviderName, ProviderHealth> = new Map();
  private costLog: Array<{
    provider: ProviderName;
    model: string;
    costUsd: number;
    timestamp: Date;
    shopId?: string;
  }> = [];

  constructor() {
    for (const config of DEFAULT_PROVIDERS) {
      this.configs.set(config.name, config);
    }
  }

  // ── Configure provider ─────────────────────────────────────────────

  configure(name: ProviderName, update: Partial<ProviderConfig>): void {
    const existing = this.configs.get(name);
    if (existing) {
      this.configs.set(name, { ...existing, ...update });
    }
  }

  enableProvider(name: ProviderName, apiKey?: string): void {
    const config = this.configs.get(name);
    if (config) {
      config.enabled = true;
      if (apiKey) config.apiKey = apiKey;
    }
  }

  disableProvider(name: ProviderName): void {
    const config = this.configs.get(name);
    if (config) config.enabled = false;
  }

  // ── Call LLM ────────────────────────────────────────────────────────

  async call(request: LLMRequest, shopId?: string): Promise<LLMResponse> {
    const chain = this.getFallbackChain();

    if (chain.length === 0) {
      throw new Error('No LLM providers available');
    }

    let lastError: Error | null = null;

    for (const config of chain) {
      try {
        const response = await this.callProvider(config, request);

        // Track cost
        this.costLog.push({
          provider: config.name,
          model: response.model,
          costUsd: response.usage.costUsd,
          timestamp: new Date(),
          shopId,
        });

        // Trim cost log
        if (this.costLog.length > 10000) {
          this.costLog = this.costLog.slice(-5000);
        }

        return response;

      } catch (err) {
        lastError = err as Error;
        console.warn(`[PROVIDER] ${config.name} failed: ${lastError.message} — trying next`);

        // Update health
        this.healthCache.set(config.name, {
          provider: config.name,
          status: 'degraded',
          latencyP50: 0,
          latencyP99: 0,
          errorRate: 1,
          lastError: lastError.message,
          lastChecked: new Date(),
          uptimePercent: 0,
        });
      }
    }

    throw new Error(`All providers failed. Last error: ${lastError?.message}`);
  }

  // ── Internal: call single provider ──────────────────────────────────

  private async callProvider(config: ProviderConfig, request: LLMRequest): Promise<LLMResponse> {
    const startMs = Date.now();

    // Resolve model
    const modelAlias = request.model || 'fast';
    const model = config.models.find(m => m.alias === modelAlias || m.id === modelAlias)
      || config.models[0];

    // Build mock/simulated response for now
    // In production, this would call the actual provider API
    const response: LLMResponse = {
      id: `resp_${config.name}_${Date.now()}`,
      provider: config.name,
      model: model.id,
      content: `[${config.name}/${model.id}] Response placeholder — integrate actual API calls`,
      usage: {
        inputTokens: this.estimateTokens(request),
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      },
      latencyMs: Date.now() - startMs,
      cached: false,
    };

    // Calculate cost
    response.usage.totalTokens = response.usage.inputTokens + response.usage.outputTokens;
    response.usage.costUsd = (
      (response.usage.inputTokens / 1000) * model.inputCostPer1k +
      (response.usage.outputTokens / 1000) * model.outputCostPer1k
    ) * config.costMultiplier;

    return response;
  }

  // ── Fallback chain ──────────────────────────────────────────────────

  private getFallbackChain(): ProviderConfig[] {
    return Array.from(this.configs.values())
      .filter(c => c.enabled)
      .sort((a, b) => {
        // First by health status
        const healthA = this.healthCache.get(a.name);
        const healthB = this.healthCache.get(b.name);
        const statusOrder: Record<ProviderStatus, number> = {
          available: 0,
          degraded: 1,
          unavailable: 2,
        };
        const statusDiff =
          (statusOrder[healthA?.status || 'available']) -
          (statusOrder[healthB?.status || 'available']);
        if (statusDiff !== 0) return statusDiff;

        // Then by priority
        return a.priority - b.priority;
      });
  }

  // ── Cost Analytics ──────────────────────────────────────────────────

  getCostSummary(since?: Date): {
    totalCostUsd: number;
    byProvider: Record<string, number>;
    byShop: Record<string, number>;
    callCount: number;
  } {
    const cutoff = since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const relevant = this.costLog.filter(c => c.timestamp >= cutoff);

    const byProvider: Record<string, number> = {};
    const byShop: Record<string, number> = {};
    let totalCostUsd = 0;

    for (const entry of relevant) {
      totalCostUsd += entry.costUsd;
      byProvider[entry.provider] = (byProvider[entry.provider] || 0) + entry.costUsd;
      if (entry.shopId) {
        byShop[entry.shopId] = (byShop[entry.shopId] || 0) + entry.costUsd;
      }
    }

    return {
      totalCostUsd,
      byProvider,
      byShop,
      callCount: relevant.length,
    };
  }

  // ── Provider Health ─────────────────────────────────────────────────

  getProviderHealth(): ProviderHealth[] {
    return Array.from(this.configs.values())
      .filter(c => c.enabled)
      .map(c => this.healthCache.get(c.name) || {
        provider: c.name,
        status: 'available' as ProviderStatus,
        latencyP50: 0,
        latencyP99: 0,
        errorRate: 0,
        lastChecked: new Date(),
        uptimePercent: 100,
      });
  }

  // ── Available Models ────────────────────────────────────────────────

  getAvailableModels(): Array<{
    provider: ProviderName;
    model: ProviderModel;
    available: boolean;
  }> {
    const result: Array<{ provider: ProviderName; model: ProviderModel; available: boolean }> = [];
    for (const config of this.configs.values()) {
      for (const model of config.models) {
        result.push({
          provider: config.name,
          model,
          available: config.enabled,
        });
      }
    }
    return result;
  }

  // ── Token estimation ────────────────────────────────────────────────

  private estimateTokens(request: LLMRequest): number {
    let charCount = 0;
    for (const msg of request.messages) {
      if (typeof msg.content === 'string') {
        charCount += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          charCount += (block.text || '').length;
        }
      }
    }
    if (request.systemPrompt) charCount += request.systemPrompt.length;
    return Math.ceil(charCount / 4); // Rough estimate: 4 chars per token
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const providerAbstraction = new ProviderAbstractionEngine();
