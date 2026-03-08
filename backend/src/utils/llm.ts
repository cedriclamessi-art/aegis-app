/**
 * AEGIS — LLM Utility
 * Wrapper Anthropic Claude pour génération de contenu
 */

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.LLM_API_KEY,
});

export const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
export const DEFAULT_MAX_TOKENS = 2048;

export interface LLMOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

/**
 * Appel LLM simple — retourne le texte généré
 */
export async function llmGenerate(
  prompt: string,
  options: LLMOptions = {}
): Promise<string> {
  const {
    model = DEFAULT_MODEL,
    maxTokens = DEFAULT_MAX_TOKENS,
    systemPrompt,
  } = options;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: prompt },
  ];

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    ...(systemPrompt && {
      system: systemPrompt,
    }),
    messages,
  });

  const block = response.content[0];
  if (block.type !== 'text') {
    throw new Error(`Unexpected LLM response type: ${block.type}`);
  }

  return block.text;
}

/**
 * Appel LLM avec parsing JSON strict
 */
export async function llmGenerateJSON<T = unknown>(
  prompt: string,
  options: LLMOptions = {}
): Promise<T> {
  const systemPrompt =
    options.systemPrompt ??
    'Tu réponds UNIQUEMENT en JSON valide, sans markdown, sans backticks, sans texte avant ou après.';

  const raw = await llmGenerate(prompt, { ...options, systemPrompt });

  try {
    return JSON.parse(raw) as T;
  } catch {
    // Attempt to extract JSON block if model added surrounding text
    const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]) as T;
    }
    throw new Error(`LLM response is not valid JSON: ${raw.slice(0, 200)}`);
  }
}

export default { llmGenerate, llmGenerateJSON };
