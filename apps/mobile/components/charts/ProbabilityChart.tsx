// specs/components.md — ProbabilityChart (미래 확률 팬)
// 현재 기준선 · 68%/95% 콘 · 중앙값 점선 · 이벤트 마커 · disclaimer 필수 렌더.
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { chartColors, colors } from '@/src/theme';
import { ProbabilityDistribution } from '@/src/types';
import { ChartLegend } from '@/components/ChartLegend';
import { font } from '@/lib/fonts';
import { signed } from '@/lib/direction';
import { ChartReveal } from '@/components/charts/ChartReveal';

export interface ProbabilityChartProps {
  dist: ProbabilityDistribution;
  style?: ViewStyle;
}

// 디자인 프레임(330×130) 고정 좌표 기반 — 값에 따라 y만 스케일.
const W = 330;
const H = 130;
const X0 = 130; // 현재 시점
const XR = 324; // 우측 끝
const YMID = 60;

export function ProbabilityChart({ dist, style }: ProbabilityChartProps) {
  const band95 = dist.bands.find(b => b.p === 95) ?? dist.bands[dist.bands.length - 1];
  const band68 = dist.bands.find(b => b.p === 68) ?? dist.bands[0];
  const maxAbs = Math.max(
    Math.abs(band95?.high ?? 0.18),
    Math.abs(band95?.low ?? -0.14),
    0.01,
  );
  const scale = 48 / maxAbs;
  const yOf = (v: number) => YMID - v * scale;

  const cone = (low: number, high: number) => {
    const yh = yOf(high);
    const yl = yOf(low);
    const cx1 = X0 + (XR - X0) * 0.35;
    const cx2 = X0 + (XR - X0) * 0.7;
    const mix = (a: number, b: number, t: number) => a + (b - a) * t;
    return (
      `M${X0},${YMID} C${cx1},${mix(YMID, yh, 0.45)} ${cx2},${mix(YMID, yh, 0.8)} ${XR},${yh} ` +
      `L${XR},${yl} C${cx2},${mix(YMID, yl, 0.8)} ${cx1},${mix(YMID, yl, 0.45)} ${X0},${YMID} Z`
    );
  };

  // 중앙값 경로 — 초과수익 확률만큼 완만하게 기울임 (단일 목표가 아님)
  const medianEnd = yOf((dist.outperformProb - 0.5) * maxAbs * 0.35);
  const marker = dist.eventMarkers[0];
  const markerX = X0 + (XR - X0) * 0.5;

  const a11y = `${dist.horizonDays}일 확률 분포: 시장 초과수익 확률 ${Math.round(dist.outperformProb * 100)}%, 95% 구간 ${signed((band95?.low ?? 0) * 100, '%')}부터 ${signed((band95?.high ?? 0) * 100, '%')}까지`;

  return (
    <View style={style} accessibilityLabel={a11y}>
      <ChartReveal style={styles.svgWrap}>
        <Svg width="100%" height={150} viewBox={`0 0 ${W} ${H + 20}`}>
          {/* 현재 시점 기준선 */}
          <Line x1={X0} y1={8} x2={X0} y2={112} stroke="rgba(255,255,255,0.14)" strokeDasharray="3 4" />
          {/* 95% / 68% 콘 */}
          {band95 ? <Path d={cone(band95.low, band95.high)} fill={chartColors.coneOuter} /> : null}
          {band68 ? <Path d={cone(band68.low, band68.high)} fill={chartColors.coneInner} /> : null}
          {/* 과거 경로 */}
          <Path d={`M8,80 C50,76 96,68 ${X0},${YMID}`} fill="none" stroke={chartColors.history} strokeWidth={2} />
          {/* 중앙값 점선 */}
          <Path
            d={`M${X0},${YMID} C190,${YMID - (YMID - medianEnd) * 0.3} 260,${YMID - (YMID - medianEnd) * 0.7} ${XR},${medianEnd}`}
            fill="none"
            stroke={chartColors.median}
            strokeWidth={2}
            strokeDasharray="4 3"
          />
          <Circle cx={X0} cy={YMID} r={3.5} fill={colors.accent} />
          {/* 이벤트 마커 */}
          {marker ? (
            <>
              <Circle cx={markerX} cy={YMID - 5} r={4} fill="none" stroke={colors.warn} strokeWidth={1.6} />
              <SvgText x={markerX} y={YMID - 16} fill={colors.warn} fontSize={9} textAnchor="middle" fontFamily="JetBrainsMono">
                {marker.label}
              </SvgText>
            </>
          ) : null}
          {/* 상·하단 시나리오 값 */}
          {band95 ? (
            <>
              <SvgText x={XR} y={yOf(band95.high) + 4} fill={colors.pos} fontSize={9} textAnchor="end" fontFamily="JetBrainsMono">
                {signed(Math.round(band95.high * 100), '%')}
              </SvgText>
              <SvgText x={XR} y={yOf(band95.low) + 10} fill={colors.neg} fontSize={9} textAnchor="end" fontFamily="JetBrainsMono">
                {signed(Math.round(band95.low * 100), '%')}
              </SvgText>
            </>
          ) : null}
          {/* 축 라벨 */}
          <SvgText x={8} y={H + 12} fill={colors.dim} fontSize={9} fontFamily="JetBrainsMono">과거</SvgText>
          <SvgText x={X0} y={H + 12} fill={colors.mut} fontSize={9} textAnchor="middle" fontFamily="JetBrainsMono">현재</SvgText>
          <SvgText x={XR} y={H + 12} fill={colors.dim} fontSize={9} textAnchor="end" fontFamily="JetBrainsMono">
            {`+${dist.horizonDays}D`}
          </SvgText>
        </Svg>
      </ChartReveal>
      <ChartLegend
        items={[
          { color: chartColors.coneInner, label: '68% 구간' },
          { color: chartColors.coneOuter, label: '95% 구간' },
          { color: chartColors.median, label: '중앙값' },
          { color: colors.warn, label: '이벤트', kind: 'dot' },
        ]}
      />
      {/* 확률 분포 안내 문구 — 항상 렌더 (HANDOFF 규칙) */}
      <Text style={[styles.disclaimer, { fontFamily: font('mono', '500') }]}>
        {dist.disclaimer}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  svgWrap: { width: '100%' },
  disclaimer: { fontSize: 10.5, lineHeight: 16, color: colors.dim, marginTop: 8 },
});
