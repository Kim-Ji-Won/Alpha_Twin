// 상태는 색+기호+텍스트 삼중 표기 (HANDOFF 규칙) — 방향 관련 공통 매핑.
import { colors } from '@/src/theme';
import { Direction } from '@/src/types';

export function directionColor(direction: Direction): string {
  switch (direction) {
    case 'positive':
      return colors.pos;
    case 'negative':
      return colors.neg;
    case 'mixed':
      return colors.warn;
    default:
      return colors.mut;
  }
}

export function directionSymbol(direction: Direction): string {
  switch (direction) {
    case 'positive':
      return '▲';
    case 'negative':
      return '▼';
    case 'mixed':
      return '◆';
    default:
      return '';
  }
}

export function directionLabel(direction: Direction): string {
  switch (direction) {
    case 'positive':
      return '긍정';
    case 'negative':
      return '부정';
    case 'mixed':
      return '혼합';
    default:
      return '중립';
  }
}

// 등락·점수 변화 표기: '+3', '−6' (디자인은 U+2212 minus 사용)
export function signed(n: number, suffix = ''): string {
  const abs = Math.abs(n);
  const body = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${body}${suffix}`;
}
