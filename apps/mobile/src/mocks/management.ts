import { ManagementRecord } from '../types';
export const mockManagement: ManagementRecord = {
  symbol: '000660',
  fulfillmentRate: 0.64, quarters: 8, peerAverage: 0.58,
  commitments: [
    { text: '북미 매출 비중 20% 달성', status: 'achieved', note: '4Q25' },
    { text: '신규 공장 3분기 가동', status: 'achieved', note: '3Q25' },
    { text: '영업이익률 15% 달성', status: 'delayed', note: '2분기 지연' },
    { text: '신제품 출시', status: 'delayed', note: '1분기 지연' },
    { text: '자사주 매입 계획', status: 'withdrawn', note: '1Q26 철회' },
  ],
  languageShift: { assertive: -12, conditional: 8, note: '표현 변화는 사실 기록이며, 실제 실적과의 일치 여부는 다음 발표에서 확인됩니다.' },
  guidanceConsistency: [
    { label: '매출 목표', rate: 0.88 }, { label: '영업이익률', rate: 0.61 }, { label: '일정 준수', rate: 0.54 },
  ],
};
