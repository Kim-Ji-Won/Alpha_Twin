import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppNotification } from '../types';
import { mockNotifications } from '../mocks';
const delay = (ms = 350) => new Promise(r => setTimeout(r, ms));

// P2: 읽음 상태는 로컬(AsyncStorage)에 저장하고 목록에 병합한다.
const READ_KEY = '@alpha-twin/notifications-read:v1';

async function readIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(READ_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {}
  return new Set();
}

async function writeIds(ids: Set<string>): Promise<void> {
  try {
    await AsyncStorage.setItem(READ_KEY, JSON.stringify([...ids]));
  } catch {}
}

export const notificationService = {
  async list(): Promise<AppNotification[]> {
    await delay();
    const read = await readIds();
    return [...mockNotifications]
      .sort((a, b) => b.time.localeCompare(a.time))
      .map(n => ({ ...n, read: read.has(n.id) }));
  },
  async unreadCount(): Promise<number> {
    const read = await readIds();
    return mockNotifications.filter(n => !read.has(n.id)).length;
  },
  async markRead(id: string): Promise<void> {
    const read = await readIds();
    read.add(id);
    await writeIds(read);
  },
  async markAllRead(): Promise<void> {
    await writeIds(new Set(mockNotifications.map(n => n.id)));
  },
};
