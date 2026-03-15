// src/utils/errors.ts

export class AegisError extends Error {
  constructor(
    message: string,
    public code: string,
    public severity: 'low' | 'medium' | 'high' | 'critical',
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = 'AegisError';
  }
}

export class AgentExecutionError extends AegisError {
  constructor(agentCode: string, task: string, cause: Error) {
    super(
      `Agent ${agentCode} failed on task ${task}`,
      'AGENT_EXECUTION_FAILED',
      'high',
      { agentCode, task, originalError: cause.message }
    );
  }
}

export class TurbulenceDetectedError extends AegisError {
  constructor(detector: string, metrics: any) {
    super(
      `Turbulence detected: ${detector}`,
      'TURBULENCE_DETECTED',
      'critical',
      { detector, metrics }
    );
  }
}

// Usage dans le code
try {
  await agent.execute(task);
} catch (error) {
  if (error instanceof AegisError) {
    await this.ghost.logError(error);
    
    if (error.severity === 'critical') {
      await this.ceo.escalate(error);
    }
  }
  throw error;
}