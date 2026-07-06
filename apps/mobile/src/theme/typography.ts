// ALPHA TWIN design tokens — typography
// Body/UI: Pretendard. Numbers & data labels: JetBrains Mono (tabular figures).
export const fonts = {
  body: 'Pretendard',        // expo-font: pretendard (or system fallback)
  mono: 'JetBrainsMono',     // ALL numerals, tickers, timestamps, scores
} as const;

export const type = {
  caption:   { size: 11,   lineHeight: 16, weight: '600' },
  footnote:  { size: 12,   lineHeight: 18, weight: '500' },
  bodySm:    { size: 13.5, lineHeight: 20, weight: '500' },
  body:      { size: 14,   lineHeight: 22, weight: '500' },
  emphasis:  { size: 14.5, lineHeight: 22, weight: '700' },
  // section headers: uppercase, letterSpacing +1.2, color dim
  section:   { size: 11.5, lineHeight: 14, weight: '700', letterSpacing: 1.2 },
  screenTitle:{ size: 22,  lineHeight: 28, weight: '800', letterSpacing: -0.4 },
  heroTitle: { size: 21,   lineHeight: 28, weight: '800' },
  heroScore: { size: 44,   lineHeight: 46, weight: '800', letterSpacing: -2 }, // mono
  statValue: { size: 19,   lineHeight: 24, weight: '700' },                     // mono
} as const;
