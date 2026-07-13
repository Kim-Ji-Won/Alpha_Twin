// 숫자 표시 공통 포맷 — 전 화면 mono 폰트와 함께 사용.
export function formatKRW(n: number): string {
  return `₩${Math.round(n).toLocaleString('ko-KR')}`;
}

// 8420만원 단위 표기: 84,200,000 → '8,420만원'
export function formatManwon(n: number): string {
  const man = Math.round(n / 10_000);
  return `${man.toLocaleString('ko-KR')}만원`;
}

export function formatPct(n: number, digits = 2): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(digits)}%`;
}
