// P2 — 관심 종목 (프레임 24). 저장은 AsyncStorage, 기본값은 Mock 전체 종목.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stock } from '../types';
import { mockStocks } from '../mocks';
const delay = (ms = 300) => new Promise(r => setTimeout(r, ms));

const KEY = '@alpha-twin/watchlist:v1';

async function readSymbols(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch {}
  return mockStocks.map(s => s.symbol); // 기본: 전체 Mock 종목 (디자인 '저장한 트윈 6')
}

async function writeSymbols(symbols: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(symbols));
  } catch {}
}

export const watchlistService = {
  async list(): Promise<Stock[]> {
    await delay();
    const symbols = await readSymbols();
    return symbols
      .map(sym => mockStocks.find(s => s.symbol === sym))
      .filter((s): s is Stock => s != null);
  },
  async symbols(): Promise<string[]> {
    return readSymbols();
  },
  async add(symbol: string): Promise<void> {
    const cur = await readSymbols();
    if (!cur.includes(symbol)) await writeSymbols([...cur, symbol]);
  },
  async remove(symbol: string): Promise<void> {
    const cur = await readSymbols();
    await writeSymbols(cur.filter(s => s !== symbol));
  },
  async toggle(symbol: string): Promise<boolean> {
    const cur = await readSymbols();
    if (cur.includes(symbol)) {
      await writeSymbols(cur.filter(s => s !== symbol));
      return false;
    }
    await writeSymbols([...cur, symbol]);
    return true;
  },
};
