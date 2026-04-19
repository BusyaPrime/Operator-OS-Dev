import { VertexAI } from '@google-cloud/vertexai';

import type { GenerateTextInput, GenerateTextResult } from '../types.js';
import type { AIProvider } from './ai-provider.js';

interface VertexAIProviderOptions {
  project: string;
  location: string;
  model: string;
}

export class VertexAIProvider implements AIProvider {
  readonly name = 'vertex-ai';
  readonly model: string;

  #client?: VertexAI;
  #options: VertexAIProviderOptions;

  constructor(options: VertexAIProviderOptions) {
    this.#options = options;
    this.model = options.model;
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const model = this.#getModel(input.maxOutputTokens);
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
      labels: input.labels,
      systemInstruction: input.systemInstruction
        ? {
            role: 'system',
            parts: [{ text: input.systemInstruction }]
          }
        : undefined
    });

    const response = result.response;
    const text = this.#extractText(response);

    if (!text) {
      throw new Error(
        'Vertex AI returned no text candidate. Verify model access, ADC, and request safety settings.'
      );
    }

    return {
      provider: this.name,
      model: this.model,
      text,
      usage: {
        promptTokenCount: response.usageMetadata?.promptTokenCount,
        candidatesTokenCount: response.usageMetadata?.candidatesTokenCount,
        totalTokenCount: response.usageMetadata?.totalTokenCount
      }
    };
  }

  summarizeOperatorState(state: unknown) {
    return this.generateText({
      systemInstruction:
        'You summarize operator state for a trusted phone-first control surface. Stay concise, explicit, and operationally useful.',
      prompt: `Summarize this operator state for a mobile operator view:\n${JSON.stringify(
        state,
        null,
        2
      )}`,
      labels: {
        capability: 'summarize-operator-state'
      }
    });
  }

  explainAgentActivity(activity: unknown) {
    return this.generateText({
      systemInstruction:
        'You explain desktop agent activity in plain operational language and highlight what requires user attention.',
      prompt: `Explain this agent activity timeline:\n${JSON.stringify(
        activity,
        null,
        2
      )}`,
      labels: {
        capability: 'explain-agent-activity'
      }
    });
  }

  suggestCostOptimizations(snapshot: unknown) {
    return this.generateText({
      systemInstruction:
        'You analyze operator costs and suggest practical optimization steps without overstating confidence.',
      prompt: `Suggest cost optimizations for this snapshot:\n${JSON.stringify(
        snapshot,
        null,
        2
      )}`,
      labels: {
        capability: 'suggest-cost-optimizations'
      }
    });
  }

  planTaskBreakdown(task: unknown) {
    return this.generateText({
      systemInstruction:
        'You break operator tasks into explicit, auditable, low-risk steps.',
      prompt: `Create a task breakdown for:\n${JSON.stringify(task, null, 2)}`,
      labels: {
        capability: 'plan-task-breakdown'
      }
    });
  }

  #getModel(maxOutputTokens = 1024) {
    this.#client ??= new VertexAI({
      project: this.#options.project,
      location: this.#options.location
    });

    return this.#client.getGenerativeModel({
      model: this.#options.model,
      generationConfig: {
        maxOutputTokens
      }
    });
  }

  #extractText(response: {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string | null;
        }>;
      };
    }>;
  }) {
    return (
      response.candidates
        ?.flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('\n')
        .trim() ?? ''
    );
  }
}
