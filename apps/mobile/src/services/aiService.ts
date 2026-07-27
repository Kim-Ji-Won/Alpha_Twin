import {
  AiAnalysisSession,
  AiAnalystResponseDto,
  AiConversationMessage,
  AiHistoryMessageDto,
} from '../types/ai';

export const AI_QUESTION_MAX_CHARS = 2_000;
export const AI_HISTORY_MAX_MESSAGES = 6;
export const AI_HISTORY_MAX_CHARS = 8_000;

const sessions = new Map<string, AiAnalysisSession>();
let sessionSequence = 0;

export function buildAiHistory(messages: AiConversationMessage[]): AiHistoryMessageDto[] {
  const history = messages.flatMap<AiHistoryMessageDto>(message => {
    if (message.role === 'user') {
      return message.completed
        ? [{ role: 'user', content: message.content.slice(0, AI_QUESTION_MAX_CHARS) }]
        : [];
    }
    return [{
      role: 'assistant',
      content: message.response.answer.slice(0, AI_QUESTION_MAX_CHARS),
    }];
  });

  const bounded = history.slice(-AI_HISTORY_MAX_MESSAGES);
  let total = bounded.reduce((sum, message) => sum + message.content.length, 0);
  while (bounded.length > 0 && total > AI_HISTORY_MAX_CHARS) {
    const removeCount =
      bounded[0]?.role === 'user' && bounded[1]?.role === 'assistant' ? 2 : 1;
    const removed = bounded.splice(0, removeCount);
    total -= removed.reduce((sum, message) => sum + message.content.length, 0);
  }
  return bounded;
}

export function createAiAnalysisSession(input: {
  symbol: string;
  companyName: string;
  question: string;
  response: AiAnalystResponseDto;
}): AiAnalysisSession {
  sessionSequence += 1;
  const createdAt = new Date().toISOString();
  const analysisId = `ai-${Date.now().toString(36)}-${sessionSequence.toString(36)}`;
  const session: AiAnalysisSession = { ...input, analysisId, createdAt };
  sessions.set(analysisId, session);
  return session;
}

export function getAiAnalysisSession(analysisId: string): AiAnalysisSession | null {
  return sessions.get(analysisId) ?? null;
}

export function clearAiAnalysisSessions(): void {
  sessions.clear();
}
