// Brand diamond mark — ported 1:1 from assets/logo.svg (root handoff package)
import React from 'react';
import Svg, { Circle, Polygon } from 'react-native-svg';
import { colors } from '@/src/theme';

export function BrandMark({ size = 52 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 80 80" accessibilityLabel="ALPHA TWIN 로고">
      <Polygon
        points="40,8 70,38 40,68 10,38"
        fill="none"
        stroke={colors.accent}
        strokeWidth={2.6}
      />
      <Polygon points="40,18 60,40 40,64 20,40" fill={colors.accent2} opacity={0.45} />
      <Circle cx={40} cy={38} r={4.5} fill={colors.accent} />
    </Svg>
  );
}
