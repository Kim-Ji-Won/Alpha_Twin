// P3-A — 앱 전체 모션 정책.
// 규칙: (설정 '애니메이션 사용' ON) && (시스템 Reduce Motion OFF) 일 때만 장식 모션 실행.
// 모션이 꺼져도 정보는 동일하게 보여야 하며(정적 완성 상태), UI가 깨지면 안 된다.
import { useSyncExternalStore } from 'react';
import { settingsService } from '@/src/services';
import { useReducedMotion } from '@/lib/useReducedMotion';

let animationsEnabled = true; // 설정 로드 전 기본값 (defaultAppSettings와 동일)
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach(l => l());
}

/** 루트 레이아웃에서 1회 호출 — 저장된 설정을 스토어에 로드 */
export async function loadMotionPreference(): Promise<void> {
  try {
    const s = await settingsService.getAppSettings();
    if (s.animationsEnabled !== animationsEnabled) {
      animationsEnabled = s.animationsEnabled;
      notify();
    }
  } catch {}
}

/** 설정 화면 토글 — AsyncStorage 저장 + 전 화면 즉시 반영 */
export async function setMotionEnabled(value: boolean): Promise<void> {
  animationsEnabled = value;
  notify();
  await settingsService.saveAppSettings({ animationsEnabled: value });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 설정의 '애니메이션 사용' 값 (Reduce Motion 미포함) */
export function useMotionPreference(): boolean {
  return useSyncExternalStore(subscribe, () => animationsEnabled, () => animationsEnabled);
}

/** 최종 판정 — 모든 장식 모션은 이 값을 따라야 한다 */
export function useShouldAnimate(): boolean {
  const pref = useMotionPreference();
  const reduced = useReducedMotion();
  return pref && !reduced;
}

// 공통 모션 상수 (HANDOFF: 펄스 2.2s · dash 1.4s · draw-in ~0.8s)
export const motionConfig = {
  pulseDuration: 2200,
  dashDuration: 1400,
  drawInDuration: 800,
  foldDuration: 220,
} as const;

export function getMotionDuration(base: number, shouldAnimate: boolean): number {
  return shouldAnimate ? base : 0;
}
