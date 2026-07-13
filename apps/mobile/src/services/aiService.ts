import { AIAnalysis, Evidence } from '../types';
import { analysisForQuestion, mockAnalysis, mockAnalysisVariants } from '../mocks';
const delay = (ms = 350) => new Promise(r => setTimeout(r, ms));

// 이번 세션에서 생성된 답변 캐시 — 근거 상세 화면이 analysisId로 조회한다.
const answered = new Map<string, AIAnalysis>();
let seq = 0;

export const aiService = {
  // 실서비스: LLM은 수치를 생성하지 않고 ML/DL 분석 결과를 설명만 한다.
  // 응답은 반드시 AIAnalysis 구조(결론/근거/반대/데이터/출처/신뢰도)로 반환.
  async ask(question: string): Promise<AIAnalysis> {
    await delay(1100);
    const base = analysisForQuestion(question);
    const instance: AIAnalysis = { ...base, id: `${base.id}#${++seq}` };
    answered.set(instance.id, instance);
    return instance;
  },
  // 근거 상세(프레임 23) — 세션 캐시 → 사전 정의 변형 → 대표 답변 순으로 조회
  async getAnalysis(analysisId: string): Promise<AIAnalysis> {
    await delay(250);
    return (
      answered.get(analysisId) ??
      mockAnalysisVariants.find(v => v.id === analysisId) ??
      mockAnalysis
    );
  },
  async getEvidence(answerId: string): Promise<Evidence> {
    await delay();
    return (await this.getAnalysis(answerId)).evidence;
  },
};
