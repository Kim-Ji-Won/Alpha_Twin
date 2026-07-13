// 프레임 25 — 프로필 (P0 임시 로그인 상태에 대응하는 Mock 사용자)
import { AppSettings, NotificationSettings, UserProfile } from '../types';

export const mockProfile: UserProfile = {
  name: '김지현',
  email: 'jihyun@email.com',
  joinedAt: '2026.03',
  plan: 'PRO',
  interests: ['반도체', '전력 인프라', 'AI 소프트웨어'],
};

export const defaultAppSettings: AppSettings = {
  changeColorMode: 'international',
  numberUnit: 'won',
  returnDisplay: 'pct',
  language: 'ko',
  animationsEnabled: true,
};

// 디자인 프레임 25: 속보(분석 없는 알림)는 기본 OFF, 충돌은 우선 ON
export const defaultNotificationSettings: NotificationSettings = {
  contradiction: true,
  reinforcement: true,
  event: true,
  regime: true,
  data: false,
  risk: true,
};
