import type { ServiceCheck } from '@operator-os/contracts';

export interface GenerateTextInput {
  prompt: string;
  systemInstruction?: string;
  labels?: Record<string, string>;
  maxOutputTokens?: number;
}

export interface GenerateTextResult {
  provider: string;
  model: string;
  text: string;
  usage?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  describeReadiness(): ServiceCheck;
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
  summarizeOperatorState(state: unknown): Promise<GenerateTextResult>;
  explainAgentActivity(activity: unknown): Promise<GenerateTextResult>;
  suggestCostOptimizations(snapshot: unknown): Promise<GenerateTextResult>;
  planTaskBreakdown(task: unknown): Promise<GenerateTextResult>;
}

export interface OperatorModule {
  name: string;
  describeReadiness(): ServiceCheck;
}
