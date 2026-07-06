// ALPHA TWIN font registry.
// Body/UI: Pretendard (OFL-1.1, official npm package — static OTF).
// Numbers/data: JetBrains Mono (OFL-1.1, official @expo-google-fonts package).
// Design rule (src/theme/typography.ts): ALL numerals/tickers/timestamps use mono.
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';

// Map registered per weight — RN static fonts cannot resolve fontWeight
// against a single family name on Android.
export const fontAssets = {
  Pretendard: require('pretendard/dist/public/static/Pretendard-Regular.otf'),
  'Pretendard-Medium': require('pretendard/dist/public/static/Pretendard-Medium.otf'),
  'Pretendard-SemiBold': require('pretendard/dist/public/static/Pretendard-SemiBold.otf'),
  'Pretendard-Bold': require('pretendard/dist/public/static/Pretendard-Bold.otf'),
  'Pretendard-ExtraBold': require('pretendard/dist/public/static/Pretendard-ExtraBold.otf'),
  JetBrainsMono: JetBrainsMono_400Regular,
  'JetBrainsMono-Medium': JetBrainsMono_500Medium,
  'JetBrainsMono-SemiBold': JetBrainsMono_600SemiBold,
  'JetBrainsMono-Bold': JetBrainsMono_700Bold,
} as const;

type Family = 'body' | 'mono';
type Weight = '400' | '500' | '600' | '700' | '800';

const FAMILY_BY_WEIGHT: Record<Family, Record<Weight, string>> = {
  body: {
    '400': 'Pretendard',
    '500': 'Pretendard-Medium',
    '600': 'Pretendard-SemiBold',
    '700': 'Pretendard-Bold',
    '800': 'Pretendard-ExtraBold',
  },
  mono: {
    '400': 'JetBrainsMono',
    '500': 'JetBrainsMono-Medium',
    '600': 'JetBrainsMono-SemiBold',
    '700': 'JetBrainsMono-Bold',
    '800': 'JetBrainsMono-Bold', // mono ships up to 700 — clamp
  },
};

// Set once by the root layout after useFonts resolves. When loading failed
// we return undefined so RN falls back to the system font instead of
// crashing on an unregistered family (iOS).
let fontsReady = false;
export function markFontsReady(ready: boolean) {
  fontsReady = ready;
}

export function font(family: Family, weight: Weight | string = '500'): string | undefined {
  if (!fontsReady) return undefined;
  const w = (['400', '500', '600', '700', '800'].includes(weight) ? weight : '500') as Weight;
  return FAMILY_BY_WEIGHT[family][w];
}
