import AsyncStorage from '@react-native-async-storage/async-storage';
import { InvestmentThesis } from '../types';
import { mockTheses, mockThesis } from '../mocks';
const delay = (ms = 350) => new Promise(r => setTimeout(r, ms));

// P1: 사용자가 수정한 논제는 AsyncStorage에 종목별로 저장하고 Mock보다 우선한다.
// 실서비스 교체 시 이 메서드 본문만 서버 API로 바꾼다 (시그니처 유지).
const storageKey = (symbol: string) => `@alpha-twin/thesis:${symbol}`;

async function readStored(symbol: string): Promise<InvestmentThesis | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(symbol));
    return raw ? (JSON.parse(raw) as InvestmentThesis) : null;
  } catch {
    return null; // 저장소 실패 → Mock으로 폴백
  }
}

export const thesisService = {
  // P1 감사 #2 수정: id를 무시하지 않고 실제로 조회
  async get(id: string): Promise<InvestmentThesis | null> {
    await delay();
    const base = mockTheses.find(t => t.id === id) ?? null;
    if (!base) return null;
    return (await readStored(base.symbol)) ?? base;
  },
  // 종목 기준 조회 — 저장본 우선, 없으면 Mock, 논제 없는 종목은 null (empty 상태)
  async getBySymbol(symbol: string): Promise<InvestmentThesis | null> {
    await delay();
    return (await readStored(symbol)) ?? mockTheses.find(t => t.symbol === symbol) ?? null;
  },
  // Saved Twin 목록은 실제 사용자 저장 여부만 사용하고 Mock 논제를 분석 결과처럼 노출하지 않는다.
  async getStoredBySymbol(symbol: string): Promise<InvestmentThesis | null> {
    await delay();
    return readStored(symbol);
  },
  async listForUser(): Promise<InvestmentThesis[]> { await delay(); return mockTheses; },
  // 자연어 → 구조화: 실제 구현 시 LLM API. 미리보기 UI는 이 반환 형태를 그대로 렌더.
  async structureFromText(rawText: string): Promise<Pick<InvestmentThesis, 'hypotheses' | 'signals' | 'killCriteria'>> {
    await delay(700);
    // Mock 파서: 문장 단위로 잘라 가설 후보를 만들고, 지표·실패 조건은 대표 Mock 구조 사용
    const sentences = rawText
      .split(/[.。]|그리고|하며|,\s*/)
      .map(s => s.trim())
      .filter(s => s.length >= 6)
      .slice(0, 4);
    const hypotheses =
      sentences.length > 0
        ? sentences.map((text, i) => ({
            id: `h${i + 1}`,
            text: text.replace(/(이라고 생각한다|할 것이다|것 같다)$/g, '').trim(),
            status: 'unverified' as const,
            evidenceNote: '',
          }))
        : mockThesis.hypotheses.map(h => ({ ...h, status: 'unverified' as const, evidenceNote: '' }));
    return { hypotheses, signals: mockThesis.signals, killCriteria: mockThesis.killCriteria };
  },
  async save(thesis: InvestmentThesis): Promise<{ id: string }> {
    await delay();
    try {
      await AsyncStorage.setItem(storageKey(thesis.symbol), JSON.stringify(thesis));
    } catch {
      // 저장 실패 시에도 세션 내 화면 갱신은 진행 (다음 실행에서 Mock으로 복귀)
    }
    return { id: thesis.id };
  },
  // 사용자 수정 저장 취소/초기화용 (P1 로컬 전용)
  async resetLocal(symbol: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(storageKey(symbol));
    } catch {}
  },
};
