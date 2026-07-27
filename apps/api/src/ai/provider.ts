import {
  AiProviderInput,
  AiProviderOutcome,
} from './contracts.js';

export interface AiAnalysisProvider {
  readonly id: string;
  readonly model: string;
  readonly reasoningEffort: string;
  isConfigured(): boolean;
  analyze(input: AiProviderInput, signal?: AbortSignal): Promise<AiProviderOutcome>;
}
