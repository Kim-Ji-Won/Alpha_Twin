// ALPHA TWIN design tokens — colors
// Source of truth: design/Alpha Twin.dc.html helmet CSS variables
export const colors = {
  // surfaces
  bg: '#0a0f1c',            // app background (Deep Navy)
  bgDeep: '#04060d',        // device frame / darkest
  screenGradTop: '#101a30', // radial gradient top of every screen
  panel: 'rgba(255,255,255,0.035)',
  panelSolid: '#080c16',    // system cards
  line: 'rgba(255,255,255,0.09)',
  lineSoft: 'rgba(255,255,255,0.06)',
  // text
  ink: '#eaf0fa',
  mut: '#8b99b4',
  dim: '#5c6a88',
  // brand
  accent: '#22d3ee',        // Electric Cyan — primary point, AI
  accent2: '#3b82f6',       // Cool Blue — gradient pair
  violet: '#818cf8',        // tertiary chart color
  // status (NEVER color-only: pair with symbol ▲▼◆ and text)
  pos: '#34d399',           // positive / up (emerald)
  neg: '#f87171',           // negative / down (red)
  warn: '#fbbf24',          // caution (amber)
  neutral: '#475a7d',       // blue gray
} as const;

// translucent fills used across chips/badges/hero panels
export const alpha = {
  accent08: 'rgba(34,211,238,0.08)',
  accent12: 'rgba(34,211,238,0.12)',
  accent18: 'rgba(34,211,238,0.18)',
  accentBorder: 'rgba(34,211,238,0.30)',
  pos15: 'rgba(52,211,153,0.15)',
  neg15: 'rgba(248,113,113,0.15)',
  warn15: 'rgba(251,191,36,0.15)',
  warnBorder: 'rgba(251,191,36,0.30)',
  white05: 'rgba(255,255,255,0.05)',
  white08: 'rgba(255,255,255,0.08)',
} as const;

export const chartColors = {
  candleUp: colors.pos,          // filled body
  candleDown: colors.neg,        // OUTLINED body (pattern + color rule)
  volume: 'rgba(139,153,180,0.35)',
  volumeAnomaly: 'rgba(34,211,238,0.5)',
  coneInner: 'rgba(34,211,238,0.22)', // 68% band
  coneOuter: 'rgba(59,130,246,0.10)', // 95% band
  median: colors.accent,
  history: '#9fb0cc',
  gradient: [colors.accent, colors.accent2] as const,
  allocation: [colors.accent, colors.accent2, colors.violet, colors.neutral, '#2c3a55'] as const,
} as const;
