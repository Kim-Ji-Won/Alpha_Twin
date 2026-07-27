import { CanonicalFinancialMetric } from './companyTwin';

export type AiAnalysisStatus =
  | 'answered'
  | 'partial'
  | 'insufficient_context'
  | 'boundary';

export type AiContextSource = 'market' | 'profile' | 'financial' | 'disclosures';
export type AiHistoryRole = 'user' | 'assistant';

export interface AiHistoryMessageDto {
  role: AiHistoryRole;
  content: string;
}

export interface AiAnalystRequestDto {
  symbol: string;
  question: string;
  history?: AiHistoryMessageDto[];
}

export interface AiAnalysisPointDto {
  text: string;
  evidenceRefs: string[];
}

export type AiDataReferenceDto =
  | {
      id: string;
      sourceType: 'market' | 'profile';
      label: string;
      asOf: string | null;
    }
  | {
      id: string;
      sourceType: 'financial';
      label: string;
      asOf: string | null;
      metric: CanonicalFinancialMetric;
      period: string;
    }
  | {
      id: string;
      sourceType: 'disclosure';
      label: string;
      asOf: string | null;
      receiptNumber: string;
      reportName: string;
      receiptDate: string;
    };

export interface AiAnalystResponseDto {
  schemaVersion: '1';
  status: AiAnalysisStatus;
  answer: string;
  supportingFactors: AiAnalysisPointDto[];
  riskFactors: AiAnalysisPointDto[];
  uncertainties: AiAnalysisPointDto[];
  followUpQuestion: string | null;
  dataReferences: AiDataReferenceDto[];
  metadata: {
    symbol: string;
    generatedAt: string;
    dataAsOf: {
      market: string | null;
      financialPeriod: string | null;
      latestDisclosureDate: string | null;
    };
    availableSources: AiContextSource[];
    missingSources: AiContextSource[];
    stale: boolean;
    staleSources: AiContextSource[];
  };
}

export interface AiUserMessage {
  id: string;
  role: 'user';
  content: string;
  createdAt: string;
  completed: boolean;
}

export interface AiAssistantMessage {
  id: string;
  role: 'assistant';
  response: AiAnalystResponseDto;
  analysisId: string;
  createdAt: string;
}

export type AiConversationMessage = AiUserMessage | AiAssistantMessage;

export interface AiAnalysisSession {
  analysisId: string;
  symbol: string;
  companyName: string;
  question: string;
  response: AiAnalystResponseDto;
  createdAt: string;
}
