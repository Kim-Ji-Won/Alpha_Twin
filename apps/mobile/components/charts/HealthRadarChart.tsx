// 디자인 프레임 02 — 기업 상태 6각 레이더: 축 + 그리드 + 데이터 영역 + 꼭짓점 도트.
// 항목별 점수(0..100)와 연동, 크기는 컨테이너에 맞춰 반응형.
import React from 'react';
import { ViewStyle } from 'react-native';
import Svg, { Circle, Line, Polygon } from 'react-native-svg';
import { colors } from '@/src/theme';

export interface RadarArea {
  label: string;
  score: number; // 0..100
}

export interface HealthRadarChartProps {
  /** 6개 항목 권장 (성장성·수익성·재무 안정성·밸류에이션·수급·모멘텀) */
  areas: RadarArea[];
  size?: number;
  style?: ViewStyle;
}

export function HealthRadarChart({ areas, size = 158, style }: HealthRadarChartProps) {
  const n = Math.max(areas.length, 3);
  const c = 90; // viewBox 중심 (180x180)
  const R = 74;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const point = (i: number, r: number) =>
    `${c + r * Math.cos(angle(i))},${c + r * Math.sin(angle(i))}`;
  const ring = (r: number) =>
    Array.from({ length: n }, (_, i) => point(i, r)).join(' ');
  const dataPoints = areas.map((a, i) => {
    const r = (Math.max(0, Math.min(100, a.score)) / 100) * R;
    return { x: c + r * Math.cos(angle(i)), y: c + r * Math.sin(angle(i)) };
  });
  const dataPolygon = dataPoints.map(p => `${p.x},${p.y}`).join(' ');
  const a11y = `기업 상태 레이더: ${areas.map(a => `${a.label} ${a.score}점`).join(', ')}`;

  return (
    <Svg width={size} height={size} viewBox="0 0 180 180" style={style} accessibilityLabel={a11y}>
      <Polygon points={ring(R)} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
      <Polygon points={ring(R / 2)} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
      {Array.from({ length: n }, (_, i) => {
        const [x, y] = point(i, R).split(',').map(Number);
        return <Line key={`sp-${i}`} x1={c} y1={c} x2={x} y2={y} stroke="rgba(255,255,255,0.07)" />;
      })}
      {areas.length >= 3 ? (
        <>
          <Polygon
            points={dataPolygon}
            fill="rgba(34,211,238,0.18)"
            stroke={colors.accent}
            strokeWidth={1.8}
          />
          {dataPoints.map((p, i) => (
            <Circle key={`dp-${i}`} cx={p.x} cy={p.y} r={2.6} fill={colors.accent} />
          ))}
        </>
      ) : null}
    </Svg>
  );
}
