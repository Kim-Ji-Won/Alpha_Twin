import { useCallback, useEffect, useRef, useState } from 'react';

import {
  buildAiHistory,
  clearAiAnalysisSessions,
  createAiAnalysisSession,
} from '@/src/services/aiService';
import { alphaTwinApi, AlphaTwinApiError } from '@/src/services/alphaTwinApi';
import { AiConversationMessage, AiHistoryMessageDto } from '@/src/types/ai';

interface FailedRequest {
  symbol: string;
  question: string;
  history: AiHistoryMessageDto[];
  userMessageId: string;
}

export interface AiAnalystError {
  code: string;
  message: string;
}

function errorMessage(error: unknown): AiAnalystError | null {
  if (error instanceof AlphaTwinApiError) {
    if (error.code === 'REQUEST_ABORTED') return null;
    const messages: Record<string, string> = {
      INVALID_AI_REQUEST: '질문 형식을 확인해주세요.',
      INVALID_SYMBOL: '선택한 기업 정보를 확인해주세요.',
      AI_CONTEXT_NOT_FOUND: '선택한 기업의 분석 데이터를 확인할 수 없습니다.',
      AI_NOT_CONFIGURED: 'AI 분석 기능을 현재 사용할 수 없습니다.',
      AI_PROVIDER_UNAVAILABLE: 'AI 분석 서비스에 일시적으로 연결할 수 없습니다.',
      AI_PROVIDER_RATE_LIMITED: 'AI 분석 서비스가 혼잡합니다. 잠시 후 다시 시도해주세요.',
      AI_TIMEOUT: '분석 시간이 초과되었습니다.',
      AI_RATE_LIMITED: '짧은 시간에 요청이 많습니다. 잠시 후 다시 시도해주세요.',
      AI_OUTPUT_SCHEMA_INVALID: '분석 응답을 안전하게 검증하지 못했습니다. 다시 시도해주세요.',
      AI_EVIDENCE_INVALID: '분석 응답을 안전하게 검증하지 못했습니다. 다시 시도해주세요.',
      AI_OUTPUT_INCOMPLETE: '분석 응답을 안전하게 검증하지 못했습니다. 다시 시도해주세요.',
      INVALID_API_RESPONSE: '분석 응답을 안전하게 검증하지 못했습니다. 다시 시도해주세요.',
      NETWORK_UNAVAILABLE: '네트워크 연결을 확인한 뒤 다시 시도해주세요.',
      REQUEST_TIMEOUT: '서버 응답 시간이 초과되었습니다.',
      API_NOT_CONFIGURED: 'ALPHA TWIN 서버 연결 설정을 확인해주세요.',
    };
    return {
      code: error.code,
      message: messages[error.code]
        ?? (error.status === 404
          ? '선택한 기업의 분석 데이터를 확인할 수 없습니다.'
          : 'AI 분석을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.'),
    };
  }
  return {
    code: 'UNKNOWN',
    message: 'AI 분석을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.',
  };
}

export function useAiAnalyst(symbol: string | undefined, companyName: string) {
  const [messages, setMessages] = useState<AiConversationMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<AiAnalystError | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [lastFailedRequest, setLastFailedRequest] = useState<FailedRequest | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const activeRef = useRef(false);
  const symbolRef = useRef(symbol);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      generationRef.current += 1;
      controllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (symbolRef.current === symbol) return;
    symbolRef.current = symbol;
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setMessages([]);
    setIsGenerating(false);
    setError(null);
    setCancelled(false);
    setLastFailedRequest(null);
    clearAiAnalysisSessions();
  }, [symbol]);

  const runRequest = useCallback(async (
    request: FailedRequest,
    appendUserMessage: boolean,
  ) => {
    if (!symbol || request.symbol !== symbol || controllerRef.current) return;

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setCancelled(false);
    setLastFailedRequest(null);
    setIsGenerating(true);
    if (appendUserMessage) {
      setMessages(current => [
        ...current,
        {
          id: request.userMessageId,
          role: 'user',
          content: request.question,
          createdAt: new Date().toISOString(),
          completed: false,
        },
      ]);
    }

    try {
      const response = await alphaTwinApi.askAiAnalyst(
        {
          symbol: request.symbol,
          question: request.question,
          ...(request.history.length > 0 ? { history: request.history } : {}),
        },
        controller.signal,
      );
      if (
        !activeRef.current
        || controller.signal.aborted
        || generationRef.current !== generation
        || symbolRef.current !== request.symbol
      ) return;

      const session = createAiAnalysisSession({
        symbol: request.symbol,
        companyName,
        question: request.question,
        response,
      });
      setMessages(current => [
        ...current.map(message =>
          message.role === 'user' && message.id === request.userMessageId
            ? { ...message, completed: true }
            : message,
        ),
        {
          id: `assistant-${session.analysisId}`,
          role: 'assistant',
          response,
          analysisId: session.analysisId,
          createdAt: session.createdAt,
        },
      ]);
    } catch (requestError) {
      if (
        !activeRef.current
        || generationRef.current !== generation
        || symbolRef.current !== request.symbol
      ) return;
      const mapped = errorMessage(requestError);
      if (mapped) {
        setError(mapped);
        setLastFailedRequest(request);
      } else {
        setCancelled(true);
      }
    } finally {
      if (activeRef.current && generationRef.current === generation) {
        controllerRef.current = null;
        setIsGenerating(false);
      }
    }
  }, [companyName, symbol]);

  const sendQuestion = useCallback((rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (
      !symbol
      || !/^\d{6}$/.test(symbol)
      || question.length === 0
      || question.length > 2_000
      || controllerRef.current
    ) return false;
    const request: FailedRequest = {
      symbol,
      question,
      history: buildAiHistory(messages),
      userMessageId: `user-${Date.now().toString(36)}-${generationRef.current + 1}`,
    };
    void runRequest(request, true);
    return true;
  }, [messages, runRequest, symbol]);

  const cancel = useCallback(() => {
    if (!controllerRef.current) return;
    generationRef.current += 1;
    controllerRef.current.abort();
    controllerRef.current = null;
    setIsGenerating(false);
    setError(null);
    setLastFailedRequest(null);
    setCancelled(true);
  }, []);

  const retry = useCallback(() => {
    if (!lastFailedRequest || lastFailedRequest.symbol !== symbol || controllerRef.current) return;
    void runRequest(lastFailedRequest, false);
  }, [lastFailedRequest, runRequest, symbol]);

  const clearConversation = useCallback(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setMessages([]);
    setIsGenerating(false);
    setError(null);
    setCancelled(false);
    setLastFailedRequest(null);
    clearAiAnalysisSessions();
  }, []);

  return {
    messages,
    isGenerating,
    error,
    cancelled,
    canRetry: lastFailedRequest?.symbol === symbol,
    sendQuestion,
    cancel,
    retry,
    clearConversation,
  };
}
