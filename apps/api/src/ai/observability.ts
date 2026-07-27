import { AiContextSource, AiProviderUsage } from './contracts.js';

export interface AiLogEvent {
  operation: 'ai-analyst';
  provider: string;
  model: string;
  reasoningEffort: string;
  promptVersion: string;
  contextSchemaVersion: string;
  symbol: string;
  availableSources: AiContextSource[];
  missingSources: AiContextSource[];
  staleSources: AiContextSource[];
  questionChars: number;
  historyMessages: number;
  historyChars: number;
  durationMs: number;
  responseStatus?: string;
  requestId?: string;
  providerRequestId?: string | null;
  providerStatus?: number;
  providerCode?: string;
  usage?: AiProviderUsage;
  outcome: 'success' | 'failure';
}

export interface AiSafeLogger {
  info(data: object, message: string): void;
  warn(data: object, message: string): void;
  error(data: object, message: string): void;
}

export class AiObservability {
  private logger?: AiSafeLogger;

  setLogger(logger: AiSafeLogger): void {
    this.logger = logger;
  }

  record(event: AiLogEvent): void {
    const payload = { aiAnalyst: event };
    if (event.outcome === 'failure') this.logger?.error(payload, 'AI analyst event');
    else this.logger?.info(payload, 'AI analyst event');
  }
}
