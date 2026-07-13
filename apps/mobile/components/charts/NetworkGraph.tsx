// specs/components.md — NetworkGraph
// 중심 기업 + 고객/공급/경쟁/제품/거시 노드, 엣지 굵기=의존도.
// P3-A: 점선 흐름 + 노드 선택 + 전체 화면 핀치/드래그 탐색.
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Circle, G, Line, Text as SvgText, TSpan } from 'react-native-svg';
import { colors } from '@/src/theme';
import { CompanyNetwork, NetworkNode } from '@/src/types';
import { font } from '@/lib/fonts';
import { FlowLine } from '@/components/charts/FlowLine';
import { GraphExplorerModal } from '@/components/charts/GraphExplorerModal';

export interface NetworkGraphProps {
  network: CompanyNetwork;
  style?: ViewStyle;
}

// viewBox 350×180 기준 위성 노드 슬롯 (디자인 프레임 02 배치 확장)
const SLOTS: Array<{ x: number; y: number }> = [
  { x: 80, y: 32 },
  { x: 285, y: 34 },
  { x: 60, y: 127 },
  { x: 300, y: 130 },
  { x: 175, y: 150 },
  { x: 322, y: 84 },
];
const CENTER = { x: 175, y: 84 };
const ZOOM_STEPS = [0.8, 1, 1.25, 1.5];

const GROUP_LABEL: Record<NetworkNode['group'], string> = {
  customer: '고객',
  supplier: '공급',
  competitor: '경쟁',
  product: '제품',
  macro: '거시',
  market: '시장',
};

function splitNodeLabel(label: string, maxChars: number) {
  const normalized = label.trim().replace(/\s+/g, ' ');
  if (Array.from(normalized).length <= maxChars) return [normalized];

  const words = normalized.split(' ');
  if (words.length > 1) {
    const first = words[0];
    const rest = words.slice(1).join(' ');
    if (Array.from(first).length <= maxChars) {
      const restChars = Array.from(rest);
      return [first, restChars.length > maxChars ? `${restChars.slice(0, maxChars - 1).join('')}…` : rest];
    }
  }

  const chars = Array.from(normalized.replace(/\s/g, ''));
  const second = chars.slice(maxChars, maxChars * 2);
  return [
    chars.slice(0, maxChars).join(''),
    chars.length > maxChars * 2 ? `${second.slice(0, maxChars - 1).join('')}…` : second.join(''),
  ];
}

export function NetworkGraph({ network, style }: NetworkGraphProps) {
  const defaultSelected =
    network.edges.find(e => e.emphasized)?.to ?? network.nodes[0]?.id;
  const [selectedId, setSelectedId] = useState<string | undefined>(defaultSelected);
  const [zoomIdx, setZoomIdx] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);

  const placed = useMemo(
    () => network.nodes.slice(0, SLOTS.length).map((node, i) => ({ node, pos: SLOTS[i] })),
    [network.nodes],
  );
  const selectedEdge = network.edges.find(e => e.to === selectedId || e.from === selectedId);
  const selectedNode = network.nodes.find(n => n.id === selectedId);
  const z = ZOOM_STEPS[zoomIdx];
  const centerLabelLines = splitNodeLabel(network.center.label, 6);

  const description = selectedNode
    ? (selectedEdge?.note ??
      `${selectedNode.label} — 의존도 ${Math.round((selectedEdge?.weight ?? 0) * 100)}%`)
    : '노드를 선택하면 영향 경로가 표시됩니다';

  const graph = (zoom = 1) => (
    <View style={styles.graphCanvas}>
    <Svg
      width="100%"
      height="100%"
      viewBox="0 0 350 180"
      accessibilityLabel={`${network.center.label} 관계 지도. ${network.nodes.map(n => n.label).join(', ')}`}>
      <G transform={`translate(${CENTER.x * (1 - zoom)}, ${CENTER.y * (1 - zoom)}) scale(${zoom})`}>
        {placed.map(({ node, pos }) => {
          const edge = network.edges.find(e => e.to === node.id || e.from === node.id);
          const isSelected = node.id === selectedId;
          const strokeWidth = 0.8 + (edge?.weight ?? 0.1) * 2.4;
          return isSelected ? (
            <FlowLine
              key={`edge-${node.id}`}
              x1={CENTER.x}
              y1={CENTER.y}
              x2={pos.x}
              y2={pos.y}
              stroke={colors.accent}
              strokeWidth={Math.max(strokeWidth, 1.6)}
            />
          ) : (
            <Line
              key={`edge-${node.id}`}
              x1={CENTER.x}
              y1={CENTER.y}
              x2={pos.x}
              y2={pos.y}
              stroke="rgba(255,255,255,0.16)"
              strokeWidth={strokeWidth}
            />
          );
        })}
        {placed.map(({ node, pos }) => {
          const isSelected = node.id === selectedId;
          const labelLines = splitNodeLabel(node.label, 5);
          const hasTwoLines = labelLines.length > 1;
          return (
            <G key={`node-${node.id}`}>
              <Circle
                cx={pos.x}
                cy={pos.y}
                r={isSelected ? 24 : 22}
                fill={isSelected ? 'rgba(34,211,238,0.14)' : 'rgba(255,255,255,0.05)'}
                stroke={isSelected ? colors.accent : 'rgba(255,255,255,0.18)'}
                strokeWidth={isSelected ? 1.4 : 1}
              />
              <SvgText
                x={pos.x}
                y={hasTwoLines ? pos.y - 4 : pos.y - 2}
                fill={isSelected ? colors.ink : '#cdd7e8'}
                fontSize={hasTwoLines ? 7.5 : (isSelected ? 9 : 8)}
                fontWeight={isSelected ? '700' : '400'}
                textAnchor="middle">
                {labelLines.map((line, index) => (
                  <TSpan key={`${node.id}-label-${index}`} x={pos.x} dy={index === 0 ? 0 : 9}>
                    {line}
                  </TSpan>
                ))}
              </SvgText>
              {!hasTwoLines && (
                <SvgText x={pos.x} y={pos.y + 8} fill={colors.mut} fontSize={7} textAnchor="middle">
                  {node.sub ?? GROUP_LABEL[node.group]}
                </SvgText>
              )}
            </G>
          );
        })}
        <Circle cx={CENTER.x} cy={CENTER.y} r={30} fill="rgba(34,211,238,0.2)" stroke={colors.accent} strokeWidth={2} />
        <SvgText
          x={CENTER.x}
          y={centerLabelLines.length > 1 ? CENTER.y - 4 : CENTER.y - 3}
          fill="#ffffff"
          fontSize={centerLabelLines.length > 1 ? 8.5 : 10}
          fontWeight="800"
          textAnchor="middle">
          {centerLabelLines.map((line, index) => (
            <TSpan key={`center-label-${index}`} x={CENTER.x} dy={index === 0 ? 0 : 10}>
              {line}
            </TSpan>
          ))}
        </SvgText>
        {centerLabelLines.length === 1 && (
          <SvgText x={CENTER.x} y={CENTER.y + 8} fill={colors.accent} fontSize={7} textAnchor="middle">
            중심 기업
          </SvgText>
        )}
      </G>
    </Svg>
    {placed.map(({ node, pos }) => {
      const x = CENTER.x + (pos.x - CENTER.x) * zoom;
      const y = CENTER.y + (pos.y - CENTER.y) * zoom;
      return (
        <Pressable
          key={`touch-${node.id}`}
          onPress={() => setSelectedId(prev => prev === node.id ? undefined : node.id)}
          accessibilityRole="button"
          accessibilityLabel={`${node.label} 관계 노드 선택`}
          accessibilityState={{ selected: selectedId === node.id }}
          style={[styles.nodeTouch, { left: `${(x / 350) * 100}%`, top: `${(y / 180) * 100}%` }]}
        />
      );
    })}
    </View>
  );

  return (
    <View style={style}>
      <View style={styles.graphWrap}>
        <View style={styles.controls}>
          <Pressable
            onPress={() => setZoomIdx(i => Math.min(i + 1, ZOOM_STEPS.length - 1))}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="관계 지도 확대"
            style={styles.zoomBtn}>
            <Text style={[styles.zoomText, { fontFamily: font('mono', '700') }]}>＋</Text>
          </Pressable>
          <Pressable
            onPress={() => setFullscreen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="관계 지도 전체 화면 보기"
            style={styles.zoomBtn}>
            <Text style={[styles.expandText, { fontFamily: font('body', '700') }]}>⤢</Text>
          </Pressable>
          <Pressable
            onPress={() => setZoomIdx(i => Math.max(i - 1, 0))}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="관계 지도 축소"
            style={styles.zoomBtn}>
            <Text style={[styles.zoomText, { fontFamily: font('mono', '700') }]}>−</Text>
          </Pressable>
        </View>
        <View style={styles.inlineGraph}>{graph(z)}</View>
      </View>
      <View style={styles.hint}>
        <View style={styles.hintDot} />
        <Text style={[styles.hintText, { fontFamily: font('body', '600') }]}>
          노드 선택 시 영향 경로 강조 · ＋/− 확대·축소
        </Text>
      </View>
      <Text
        style={[styles.selection, { fontFamily: font('body', '500') }]}
        accessibilityLiveRegion="polite">
        <Text style={{ color: colors.accent }}>━ </Text>
        {selectedNode ? `선택됨: ${description}` : description}
      </Text>
      <GraphExplorerModal
        visible={fullscreen}
        title={`${network.center.label} 관계 지도`}
        description={selectedNode ? `선택됨: ${description}` : description}
        contentHeight={300}
        onClose={() => setFullscreen(false)}>
        {graph()}
      </GraphExplorerModal>
    </View>
  );
}

const styles = StyleSheet.create({
  graphWrap: {},
  graphCanvas: { flex: 1, position: 'relative' },
  nodeTouch: {
    position: 'absolute',
    width: 48,
    height: 48,
    marginLeft: -24,
    marginTop: -24,
    borderRadius: 24,
  },
  inlineGraph: { height: 200 },
  controls: {
    minHeight: 40,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
    marginBottom: 4,
  },
  zoomBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(8,12,22,0.85)',
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomText: { fontSize: 14, fontWeight: '700', color: colors.mut },
  expandText: { fontSize: 16, fontWeight: '700', color: colors.mut },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 8,
    paddingHorizontal: 2,
  },
  hintDot: { width: 6, height: 6, borderRadius: 99, backgroundColor: colors.accent },
  hintText: { fontSize: 11.5, color: colors.dim, fontWeight: '600' },
  selection: {
    fontSize: 12.5,
    lineHeight: 19,
    color: '#b8c4da',
    marginTop: 6,
    marginHorizontal: 2,
    marginBottom: 4,
  },
});
