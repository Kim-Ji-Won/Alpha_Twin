import { Stock } from '../types';
// Values match the design frames exactly — do not "improve" them.
export const mockStocks: Stock[] = [
  { symbol: '000660', name: 'SK하이닉스', sector: '반도체', price: 178400, changePct: 2.34, healthScore: 74, thesisId: 'th-1' },
  { symbol: '005930', name: '삼성전자', sector: '반도체', price: 84200, changePct: 0.71, healthScore: 66 },
  { symbol: '042700', name: '한미반도체', sector: '반도체 장비', price: 142000, changePct: 4.12, healthScore: 51, flags: ['narrative_gap'] },
  { symbol: '010120', name: 'LS일렉트릭', sector: '전력 인프라', price: 312500, changePct: 1.88, healthScore: 81, thesisId: 'th-2', flags: ['anomaly'] },
  { symbol: '035420', name: '네이버', sector: 'AI 소프트웨어', price: 228000, changePct: -0.44, healthScore: 63 },
  { symbol: '005380', name: '현대차', sector: '자동차', price: 264000, changePct: -1.02, healthScore: 58, thesisId: 'th-3' },
];
