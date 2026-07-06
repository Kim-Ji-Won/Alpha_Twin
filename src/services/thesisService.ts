import { InvestmentThesis } from '../types';
import { mockThesis } from '../mocks';
const delay = (ms = 350) => new Promise(r => setTimeout(r, ms));
export const thesisService = {
  async get(id: string): Promise<InvestmentThesis> { await delay(); return mockThesis; },
  async listForUser(): Promise<InvestmentThesis[]> { await delay(); return [mockThesis]; },
  // 자연어 → 구조화: 실제 구현 시 LLM API. 미리보기 UI는 이 반환 형태를 그대로 렌더.
  async structureFromText(rawText: string): Promise<Pick<InvestmentThesis, 'hypotheses' | 'signals' | 'killCriteria'>> {
    await delay(700);
    return { hypotheses: mockThesis.hypotheses.map(h => ({ ...h, status: 'unverified' as const, evidenceNote: '' })), signals: mockThesis.signals, killCriteria: mockThesis.killCriteria };
  },
  async save(thesis: Partial<InvestmentThesis>): Promise<{ id: string }> { await delay(); return { id: 'th-1' }; },
};
