// specs/components.md — SparkLine: 논제 건강도 추이 + 변화 이벤트 도트.
// 빈 데이터/단일 값 안전 처리 포함.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { colors } from '@/src/theme';
import { font } from '@/lib/fonts';
import { ChartReveal } from '@/components/charts/ChartReveal';
import { selectSparklineRange, SPARKLINE_PAD_X, SparklineRange } from './sparklineRange';

export interface SparklineMarker {
  /** points 배열 내 인덱스 */
  index: number;
  color: string;
}

export interface SparklineProps {
  points: { date: string; score: number }[];
  height?: number;
  markers?: SparklineMarker[];
  /** 마지막 점 강조 (기본 true) */
  endDot?: boolean;
  /** 좌/우 하단 축 라벨 ('3월' / '오늘') */
  axisLeft?: string;
  axisRight?: string;
  stroke?: string;
  accessibilityLabel?: string;
  style?: ViewStyle;
  rangeSelectionEnabled?: boolean;
  onRangeSelected?: (range: SparklineRange | null) => void;
}

export function Sparkline({
  points,
  height = 54,
  markers = [],
  endDot = true,
  axisLeft,
  axisRight,
  stroke = colors.accent,
  accessibilityLabel,
  style,
  rangeSelectionEnabled = false,
  onRangeSelected,
}: SparklineProps) {
  const [width, setWidth] = useState(0);
  const [selection, setSelection] = useState<SparklineRange | null>(null);
  const startX = useRef(0);
  const pointsKey = JSON.stringify(points);
  useEffect(() => { setSelection(null); }, [pointsKey, width, rangeSelectionEnabled]);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: event => {
      startX.current = event.nativeEvent.locationX;
      return false;
    },
    onMoveShouldSetPanResponder: (_, gesture) => rangeSelectionEnabled
      && points.length > 1 && Math.abs(gesture.dx) >= 8
      && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
    onPanResponderGrant: () => { setSelection(null); onRangeSelected?.(null); },
    onPanResponderMove: (_, gesture) => {
      setSelection(selectSparklineRange(points, width, startX.current, startX.current + gesture.dx));
    },
    onPanResponderRelease: (_, gesture) => {
      const range = selectSparklineRange(points, width, startX.current, startX.current + gesture.dx);
      setSelection(range);
      onRangeSelected?.(range);
    },
    onPanResponderTerminate: () => { setSelection(null); onRangeSelected?.(null); },
    onPanResponderTerminationRequest: () => true,
  }), [points, width, rangeSelectionEnabled, onRangeSelected]);
  const labelSpace = axisLeft || axisRight ? 16 : 0;

  const defaultAccessibilityLabel =
    points.length > 0
      ? `건강도 추이: ${points[0].score}점에서 ${points[points.length - 1].score}점`
      : '건강도 추이 데이터 없음';

  return (
    <View
      style={[{ height: height + labelSpace }, style]}
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      accessibilityLabel={accessibilityLabel ?? defaultAccessibilityLabel}>
      {width > 0 ? (
        points.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={[styles.emptyText, { fontFamily: font('mono', '500') }]}>
              추이 데이터 없음
            </Text>
          </View>
        ) : (
          <ChartReveal><SparklineSvg
            width={width}
            height={height}
            labelSpace={labelSpace}
            points={points}
            markers={markers}
            endDot={endDot}
            axisLeft={axisLeft}
            axisRight={axisRight}
            stroke={stroke}
            selection={selection}
          /></ChartReveal>
        )
      ) : null}
      {rangeSelectionEnabled && points.length > 1 ? (
        <View style={[StyleSheet.absoluteFill, { bottom: labelSpace }]}
          accessible={false} {...responder.panHandlers} />
      ) : null}
    </View>
  );
}

function SparklineSvg({
  width,
  height,
  labelSpace,
  points,
  markers,
  endDot,
  axisLeft,
  axisRight,
  stroke,
  selection,
}: Required<Omit<SparklineProps, 'style' | 'axisLeft' | 'axisRight' | 'accessibilityLabel' | 'rangeSelectionEnabled' | 'onRangeSelected'>> & {
  width: number;
  labelSpace: number;
  axisLeft?: string;
  axisRight?: string;
  selection: SparklineRange | null;
}) {
  const padX = SPARKLINE_PAD_X;
  const padY = 8;
  const scores = points.map(p => p.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min;
  const xOf = (i: number) =>
    points.length === 1 ? width / 2 : padX + (i / (points.length - 1)) * (width - padX * 2);
  const yOf = (score: number) =>
    range === 0 ? height / 2 : padY + (1 - (score - min) / range) * (height - padY * 2);

  const coords = points.map((p, i) => `${xOf(i)},${yOf(p.score)}`).join(' ');
  const last = points[points.length - 1];

  return (
    <Svg width={width} height={height + labelSpace}>
      {selection ? (
        <>
          <Rect x={xOf(selection.startIndex)} y={0}
            width={xOf(selection.endIndex) - xOf(selection.startIndex)} height={height}
            fill={colors.accent} fillOpacity={0.12} />
          {[selection.startIndex, selection.endIndex].map(index => (
            <Line key={index} x1={xOf(index)} x2={xOf(index)} y1={0} y2={height}
              stroke={colors.accent} strokeWidth={1} />
          ))}
        </>
      ) : null}
      {points.length === 1 ? (
        <Circle cx={xOf(0)} cy={yOf(points[0].score)} r={3.5} fill={stroke} />
      ) : (
        <Polyline points={coords} fill="none" stroke={stroke} strokeWidth={2} />
      )}
      {markers
        .filter(m => m.index >= 0 && m.index < points.length)
        .map(m => (
          <Circle
            key={`mk-${m.index}`}
            cx={xOf(m.index)}
            cy={yOf(points[m.index].score)}
            r={3.5}
            fill={m.color}
          />
        ))}
      {endDot && points.length > 1 ? (
        <Circle cx={xOf(points.length - 1)} cy={yOf(last.score)} r={3.5} fill={stroke} />
      ) : null}
      {axisLeft ? (
        <SvgText x={padX} y={height + 12} fill={colors.dim} fontSize={9} fontFamily="JetBrainsMono">
          {axisLeft}
        </SvgText>
      ) : null}
      {axisRight ? (
        <SvgText
          x={width - padX}
          y={height + 12}
          fill={colors.mut}
          fontSize={9}
          textAnchor="end"
          fontFamily="JetBrainsMono">
          {axisRight}
        </SvgText>
      ) : null}
    </Svg>
  );
}

const styles = StyleSheet.create({
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 10.5, color: colors.dim },
});
