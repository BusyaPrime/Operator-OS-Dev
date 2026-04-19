import { VertexAI } from '@google-cloud/vertexai';
import type { ServiceCheck } from '@operator-os/contracts';

import type { GenerateTextInput, GenerateTextResult } from '../types.js';
import type { AIProvider } from './ai-provider.js';
import {
  buildConfiguredCheck,
  buildNotConfiguredCheck,
  detectApplicationDefaultCredentials,
  IntegrationError,
  mapGoogleIntegrationError
} from '../integrations/runtime.js';

interface VertexAIProviderOptions {
  project: string;
  location: string;
  model: string;
}

export class VertexAIProvider implements AIProvider {
  readonly name = 'vertex-ai';
  readonly model: string;

  #adcStatus = detectApplicationDefaultCredentials();
  #client?: VertexAI;
  #options: VertexAIProviderOptions;

  constructor(options: VertexAIProviderOptions) {
    this.#options = options;
    this.model = options.model;
  }

  describeReadiness(): ServiceCheck {
    if (!this.#adcStatus.available) {
      return buildNotConfiguredCheck('vertex', this.#adcStatus.message, {
        location: this.#options.location,
        model: this.#options.model,
        project: this.#options.project
      });
    }

    return buildConfiguredCheck(
      'vertex',
      'Vertex AI provider is configured through ADC / service identity.',
      {
        location: this.#options.location,
        model: this.#options.model,
        project: this.#options.project
      }
    );
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    if (!this.#adcStatus.available) {
      throw new IntegrationError({
        code: 'missing_adc',
        dependency: 'vertex',
        message: this.#adcStatus.message,
        statusCode: 503
      });
    }

    const model = this.#getModel(input.maxOutputTokens);
    try {
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
        throw new IntegrationError({
          code: 'upstream_error',
          dependency: 'vertex',
          message:
            'Vertex AI returned no text candidate. Verify model access, ADC, and request safety settings.',
          statusCode: 502
        });
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
    } catch (error) {
      throw mapGoogleIntegrationError('vertex', error);
    }
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
