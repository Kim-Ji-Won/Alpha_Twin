// 프레임 06 — 위험 중첩 지도. P3-A: 경로 흐름 + 전체 화면 핀치/드래그 탐색.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { G, Rect, Text as SvgText } from 'react-native-svg';

import { FlowLine } from '@/components/charts/FlowLine';
import { GraphExplorerModal } from '@/components/charts/GraphExplorerModal';
import { font } from '@/lib/fonts';
import { colors } from '@/src/theme';
import { RiskFactor } from '@/src/types';

export interface RiskOverlapGraphProps {
  stocks: { symbol: string; name: string }[];
  factors: RiskFactor[];
  style?: ViewStyle;
}

const VIEW_W = 350;
const STOCK_W = 104;
const STOCK_H = 22;
const FACTOR_W = 120;
const FACTOR_H = 28;
const ROW_GAP_S = 36;
const ROW_GAP_F = 52;
const PAD_Y = 18;

const SEVERITY_COLOR: Record<RiskFactor['severity'], { stroke: string; fill: string; text: string }> = {
  high: { stroke: 'rgba(251,191,36,0.65)', fill: 'rgba(251,191,36,0.14)', text: colors.warn },
  medium: { stroke: 'rgba(34,211,238,0.55)', fill: 'rgba(34,211,238,0.10)', text: colors.accent },
  low: { stroke: 'rgba(255,255,255,0.3)', fill: 'rgba(255,255,255,0.05)', text: '#cdd7e8' },
};

export function RiskOverlapGraph({ stocks, factors, style }: RiskOverlapGraphProps) {
  const defaultFactor = factors.find(f => f.severity === 'high') ?? factors[0];
  const [selection, setSelection] = useState<string | undefined>(
    defaultFactor ? `factor:${defaultFactor.label}` : undefined,
  );
  const [fullscreen, setFullscreen] = useState(false);
  const shown = stocks.slice(0, 6);
  const stockContentHeight = Math.max(shown.length - 1, 0) * ROW_GAP_S + STOCK_H;
  const factorContentHeight = Math.max(factors.length - 1, 0) * ROW_GAP_F + FACTOR_H;
  const height = PAD_Y * 2 + Math.max(stockContentHeight, factorContentHeight, 100);
  const stockY = (i: number) => PAD_Y + i * ROW_GAP_S + STOCK_H / 2;
  const factorY = (i: number) => PAD_Y + i * ROW_GAP_F + FACTOR_H / 2;

  const selectedFactor = selection?.startsWith('factor:')
    ? factors.find(f => `factor:${f.label}` === selection)
    : undefined;
  const selectedStock = selection?.startsWith('stock:')
    ? shown.find(s => `stock:${s.symbol}` === selection)
    : undefined;
  const linkedSet = new Set(selectedFactor?.linkedSymbols ?? []);

  const description = selectedFactor
    ? `선택됨: ${selectedFactor.label} — 노출 ${Math.round(selectedFactor.exposure * 100)}% · 연결 종목 ${selectedFactor.linkedSymbols.length}개`
    : selectedStock
      ? `선택됨: ${selectedStock.name} — 연결 위험 ${factors.filter(f => f.linkedSymbols.includes(selectedStock.symbol)).map(f => f.label).join(', ') || '없음'}`
      : '종목 또는 위험 요인을 선택하세요';

  const graph = (
    <View style={styles.graphCanvas}>
    <Svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${VIEW_W} ${height}`}
      accessibilityLabel={`위험 중첩 지도: 종목 ${shown.length}개, 위험 요인 ${factors.length}개`}>
      {factors.map((factor, fi) =>
        factor.linkedSymbols.map(symbol => {
          const si = shown.findIndex(stock => stock.symbol === symbol);
          if (si < 0) return null;
          const emphasized = selectedFactor?.label === factor.label || selectedStock?.symbol === symbol;
          const color = SEVERITY_COLOR[factor.severity];
          return emphasized ? (
            <FlowLine
              key={`${factor.label}-${symbol}`}
              x1={8 + STOCK_W}
              y1={stockY(si)}
              x2={VIEW_W - 12 - FACTOR_W}
              y2={factorY(fi)}
              stroke={color.stroke}
              strokeWidth={1.8}
            />
          ) : (
            <FlowLine
              key={`${factor.label}-${symbol}`}
              x1={8 + STOCK_W}
              y1={stockY(si)}
              x2={VIEW_W - 12 - FACTOR_W}
              y2={factorY(fi)}
              stroke="rgba(255,255,255,0.14)"
              strokeWidth={1}
              flowing={false}
            />
          );
        }),
      )}
      {shown.map((stock, i) => {
        const on = selectedStock?.symbol === stock.symbol;
        const highlighted = on || linkedSet.has(stock.symbol);
        return (
          <G key={stock.symbol}>
            <Rect
              x={8}
              y={stockY(i) - STOCK_H / 2}
              width={STOCK_W}
              height={STOCK_H}
              rx={7}
              fill={highlighted ? 'rgba(251,191,36,0.08)' : 'rgba(255,255,255,0.05)'}
              stroke={highlighted ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.14)'}
            />
            <SvgText x={8 + STOCK_W / 2} y={stockY(i) + 3} fill={highlighted ? colors.ink : '#cdd7e8'} fontSize={9} fontWeight="700" textAnchor="middle">
              {stock.name}
            </SvgText>
          </G>
        );
      })}
      {factors.map((factor, i) => {
        const color = SEVERITY_COLOR[factor.severity];
        const on = selectedFactor?.label === factor.label;
        return (
          <G key={factor.label}>
            <Rect
              x={VIEW_W - 12 - FACTOR_W}
              y={factorY(i) - FACTOR_H / 2}
              width={FACTOR_W}
              height={FACTOR_H}
              rx={9}
              fill={on ? color.fill : 'rgba(255,255,255,0.05)'}
              stroke={on ? color.stroke : 'rgba(255,255,255,0.18)'}
              strokeWidth={on ? 1.4 : 1}
            />
            <SvgText x={VIEW_W - 12 - FACTOR_W / 2} y={factorY(i) + 3} fill={on ? color.text : '#cdd7e8'} fontSize={9} fontWeight="700" textAnchor="middle">
              {factor.label}
            </SvgText>
          </G>
        );
      })}
    </Svg>
    {shown.map((stock, i) => (
      <Pressable
        key={`touch-stock-${stock.symbol}`}
        onPress={() => setSelection(prev => prev === `stock:${stock.symbol}` ? undefined : `stock:${stock.symbol}`)}
        accessibilityRole="button"
        accessibilityLabel={`${stock.name} 위험 노드 선택`}
        accessibilityState={{ selected: selectedStock?.symbol === stock.symbol }}
        style={[styles.stockTouch, { top: `${(stockY(i) / height) * 100}%` }]}
      />
    ))}
    {factors.map((factor, i) => (
      <Pressable
        key={`touch-factor-${factor.label}`}
        onPress={() => setSelection(prev => prev === `factor:${factor.label}` ? undefined : `factor:${factor.label}`)}
        accessibilityRole="button"
        accessibilityLabel={`${factor.label} 위험 요인 선택`}
        accessibilityState={{ selected: selectedFactor?.label === factor.label }}
        style={[styles.factorTouch, { top: `${(factorY(i) / height) * 100}%` }]}
      />
    ))}
    </View>
  );

  return (
    <View style={style}>
      <View style={styles.toolbar}>
        <Pressable
          onPress={() => setFullscreen(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="위험 중첩 지도 전체 화면 보기"
          style={({ pressed }) => [styles.expandButton, { opacity: pressed ? 0.65 : 1 }]}>
          <Text style={[styles.expandText, { fontFamily: font('body', '700') }]}>⤢</Text>
        </Pressable>
      </View>
      <View style={[styles.graphWrap, { height }]}>
        {graph}
      </View>
      <View style={styles.hint}>
        <View style={[styles.dot, { backgroundColor: colors.warn }]} />
        <Text style={[styles.hintText, { fontFamily: font('body', '600') }]}>노드 선택 시 연결 경로가 강조됩니다</Text>
      </View>
      <Text style={[styles.selection, { fontFamily: font('body', '500') }]} accessibilityLiveRegion="polite">
        {description}
      </Text>
      <GraphExplorerModal
        visible={fullscreen}
        title="포트폴리오 위험 중첩 지도"
        description={description}
        contentHeight={height}
        onClose={() => setFullscreen(false)}>
        {graph}
      </GraphExplorerModal>
    </View>
  );
}

const styles = StyleSheet.create({
  graphWrap: { position: 'relative' },
  graphCanvas: { flex: 1, position: 'relative' },
  stockTouch: {
    position: 'absolute',
    left: '2%',
    width: '34%',
    height: 44,
    marginTop: -22,
    borderRadius: 9,
  },
  factorTouch: {
    position: 'absolute',
    right: '2%',
    width: '38%',
    height: 44,
    marginTop: -22,
    borderRadius: 9,
  },
  toolbar: {
    minHeight: 48,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: 2,
    marginBottom: 4,
  },
  expandButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(8,12,22,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandText: { fontSize: 16, color: colors.mut, fontWeight: '700' },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8, paddingHorizontal: 2 },
  dot: { width: 6, height: 6, borderRadius: 99 },
  hintText: { fontSize: 11.5, color: colors.dim, fontWeight: '600' },
  selection: { fontSize: 12.5, lineHeight: 19, color: '#b8c4da', marginTop: 6, marginHorizontal: 2 },
});
