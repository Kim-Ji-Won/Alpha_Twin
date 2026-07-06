import { ManagementRecord } from '../types';
import { mockManagement } from '../mocks';
const delay = (ms = 350) => new Promise(r => setTimeout(r, ms));
export const managementService = {
  async get(symbol: string): Promise<ManagementRecord> { await delay(); return { ...mockManagement, symbol }; },
};
