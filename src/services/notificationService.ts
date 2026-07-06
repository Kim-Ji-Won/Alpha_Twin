import { AppNotification } from '../types';
import { mockNotifications } from '../mocks';
const delay = (ms = 350) => new Promise(r => setTimeout(r, ms));
export const notificationService = {
  async list(): Promise<AppNotification[]> { await delay(); return mockNotifications; },
};
