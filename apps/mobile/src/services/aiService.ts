import { AIAnalysis, Evidence } from '../types';
import { mockAnalysis } from '../mocks';
const delay = (ms = 350) => new Promise(r => setTimeout(r, ms));
export const aiService = {
  // 실서비스: LLM은 수치를 생성하지 않고 ML/DL 분석 결과를 설명만 한다.
  // 응답은 반드시 AIAnalysis 구조(결론/근거/반대/데이터/출처/신뢰도)로 반환.
  async ask(question: string): Promise<AIAnalysis> { await delay(1100); return { ...mockAnalysis, question }; },
  async getEvidence(answerId: string): Promise<Evidence> { await delay(); return mockAnalysis.evidence; },
};
