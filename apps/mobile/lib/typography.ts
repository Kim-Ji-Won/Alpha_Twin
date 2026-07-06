// Resolves src/theme/typography tokens into RN TextStyle with the correct
// per-weight font family. Keeps the copied design tokens untouched.
import { TextStyle } from 'react-native';
import { type } from '@/src/theme';
import { font } from '@/lib/fonts';

export type TypeToken = keyof typeof type;

export function text(
  token: TypeToken,
  opts: { mono?: boolean; color?: string } = {},
): TextStyle {
  const t = type[token];
  const style: TextStyle = {
    fontSize: t.size,
    lineHeight: t.lineHeight,
    fontFamily: font(opts.mono ? 'mono' : 'body', t.weight),
    // Keep fontWeight too: applies while custom fonts are still loading
    // (system-font fallback) and is harmless once families are registered.
    fontWeight: t.weight as TextStyle['fontWeight'],
  };
  if ('letterSpacing' in t) style.letterSpacing = t.letterSpacing;
  if (opts.color) style.color = opts.color;
  return style;
}
