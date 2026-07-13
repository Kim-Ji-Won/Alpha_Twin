// P2 — 앱 설정·알림 설정·프로필 (프레임 25). 로컬 저장만, 실제 서버·푸시 없음.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppSettings, NotificationSettings, UserProfile } from '../types';
import { defaultAppSettings, defaultNotificationSettings, mockProfile } from '../mocks';
const delay = (ms = 150) => new Promise(r => setTimeout(r, ms));

const APP_KEY = '@alpha-twin/app-settings:v1';
const NOTIF_KEY = '@alpha-twin/notification-settings:v1';

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {}
  return fallback;
}

async function writeJson<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export const settingsService = {
  async getProfile(): Promise<UserProfile> { await delay(); return mockProfile; },
  async getAppSettings(): Promise<AppSettings> {
    await delay();
    return readJson(APP_KEY, defaultAppSettings);
  },
  async saveAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = { ...(await readJson(APP_KEY, defaultAppSettings)), ...patch };
    await writeJson(APP_KEY, next);
    return next;
  },
  async getNotificationSettings(): Promise<NotificationSettings> {
    await delay();
    return readJson(NOTIF_KEY, defaultNotificationSettings);
  },
  async saveNotificationSettings(patch: Partial<NotificationSettings>): Promise<NotificationSettings> {
    const next = { ...(await readJson(NOTIF_KEY, defaultNotificationSettings)), ...patch };
    await writeJson(NOTIF_KEY, next);
    return next;
  },
};
