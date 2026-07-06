import { Scenario, ScenarioResult } from '../types';
import { mockScenario, mockScenarioResult, scenarioTemplates } from '../mocks';
const delay = (ms = 350) => new Promise(r => setTimeout(r, ms));
export const scenarioService = {
  templates: scenarioTemplates,
  // 자연어 → 구조화된 시나리오 (실서비스: LLM 파싱)
  async parse(rawQuery: string): Promise<Scenario> { await delay(600); return { ...mockScenario, rawQuery }; },
  async run(scenarioId: string): Promise<ScenarioResult> { await delay(900); return mockScenarioResult; },
};
