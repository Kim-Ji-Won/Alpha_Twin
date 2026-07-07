import { Scenario, ScenarioResult, ScenarioTemplate } from '../types';
import { mockScenario, scenarioResultFor, scenarioTemplates } from '../mocks';
const delay = (ms = 350) => new Promise(r => setTimeout(r, ms));

// P1: 파싱된 시나리오를 세션 메모리에 보관 — 결과 화면이 scenarioId로 조회.
// 실서비스에서는 서버가 시나리오를 저장하고 id로 결과를 반환한다 (시그니처 유지).
const parsedCache = new Map<string, Scenario>();
let seq = 0;

export const scenarioService = {
  templates: scenarioTemplates as ScenarioTemplate[],
  // 자연어 → 구조화된 시나리오 (실서비스: LLM 파싱). templateId를 주면 해당 템플릿 구조를 사용.
  async parse(rawQuery: string, opts?: { symbol?: string; templateId?: string }): Promise<Scenario> {
    await delay(600);
    const template =
      scenarioTemplates.find(t => t.id === opts?.templateId) ??
      // 자유 입력 Mock 파서: 키워드로 가장 가까운 템플릿 매칭, 없으면 환율 시나리오
      scenarioTemplates.find(t => rawQuery.includes(t.label)) ??
      scenarioTemplates[0];
    const scenario: Scenario = {
      id: `sc-${++seq}`,
      rawQuery: rawQuery || template.rawQuery,
      parsed: template.parsed,
      templateId: template.id,
      symbol: opts?.symbol ?? mockScenario.symbol,
      title: template.title,
      badge: template.badge,
      parseConfidence: opts?.templateId ? 0.98 : 0.92,
    };
    parsedCache.set(scenario.id, scenario);
    return scenario;
  },
  getParsed(scenarioId: string): Scenario | undefined {
    return parsedCache.get(scenarioId);
  },
  async run(scenarioId: string): Promise<ScenarioResult> {
    await delay(900);
    const scenario = parsedCache.get(scenarioId);
    const symbol = scenario?.symbol ?? '000660';
    return { ...scenarioResultFor(scenario?.templateId, symbol), scenarioId };
  },
};
