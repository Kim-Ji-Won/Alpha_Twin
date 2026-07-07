// specs/components.md — NetworkGraph
// 중심 기업 + 고객/공급/경쟁/제품/거시 노드, 엣지 굵기=의존도.
// P1: 고정 좌표 기반 + 노드 선택(경로 강조/설명) + 확대·축소 버튼.
// (핀치 줌·전체 화면 모달·경로 애니메이션은 P3)
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg';
import { colors } from '@/src/theme';
import { CompanyNetwork, NetworkNode } from '@/src/types';
import { font } from '@/lib/fonts';

export interface NetworkGraphProps {
  network: CompanyNetwork;
  style?: ViewStyle;
}

// viewBox 350×180 기준 위성 노드 슬롯 (디자인 프레임 02 배치 확장)
const SLOTS: Array<{ x: number; y: number }> = [
  { x: 80, y: 40 },
  { x: 285, y: 42 },
  { x: 60, y: 135 },
  { x: 300, y: 138 },
  { x: 175, y: 158 },
  { x: 322, y: 92 },
];
const CENTER = { x: 175, y: 92 };
const ZOOM_STEPS = [0.8, 1, 1.25, 1.5];

const GROUP_LABEL: Record<NetworkNode['group'], string> = {
  customer: '고객',
  supplier: '공급',
  competitor: '경쟁',
  product: '제품',
  macro: '거시',
  market: '시장',
};

export function NetworkGraph({ network, style }: NetworkGraphProps) {
  const defaultSelected =
    network.edges.find(e => e.emphasized)?.to ?? network.nodes[0]?.id;
  const [selectedId, setSelectedId] = useState<string | undefined>(defaultSelected);
  const [zoomIdx, setZoomIdx] = useState(1);

  const placed = useMemo(
    () => network.nodes.slice(0, SLOTS.length).map((node, i) => ({ node, pos: SLOTS[i] })),
    [network.nodes],
  );
  const selectedEdge = network.edges.find(e => e.to === selectedId || e.from === selectedId);
  const selectedNode = network.nodes.find(n => n.id === selectedId);
  const z = ZOOM_STEPS[zoomIdx];

  const description = selectedNode
    ? (selectedEdge?.note ??
      `${selectedNode.label} — 의존도 ${Math.round((selectedEdge?.weight ?? 0) * 100)}%`)
    : '노드를 선택하면 영향 경로가 표시됩니다';

  return (
    <View style={style}>
      <View style={styles.graphWrap}>
        <Svg
          width="100%"
          height={200}
          viewBox="0 0 350 180"
          accessibilityLabel={`${network.center.label} 관계 지도. ${network.nodes.map(n => n.label).join(', ')}`}>
          <G
            transform={`translate(${CENTER.x * (1 - z)}, ${CENTER.y * (1 - z)}) scale(${z})`}>
            {placed.map(({ node, pos }) => {
              const edge = network.edges.find(e => e.to === node.id || e.from === node.id);
              const isSelected = node.id === selectedId;
              const strokeWidth = 0.8 + (edge?.weight ?? 0.1) * 2.4;
              return (
                <Line
                  key={`edge-${node.id}`}
                  x1={CENTER.x}
                  y1={CENTER.y}
                  x2={pos.x}
                  y2={pos.y}
                  stroke={isSelected ? colors.accent : 'rgba(255,255,255,0.16)'}
                  strokeWidth={isSelected ? Math.max(strokeWidth, 1.4) : strokeWidth}
                  strokeDasharray={isSelected ? '3 5' : undefined}
                />
              );
            })}
            {placed.map(({ node, pos }) => {
              const isSelected = node.id === selectedId;
              return (
                <G
                  key={`node-${node.id}`}
                  onPress={() => setSelectedId(prev => (prev === node.id ? undefined : node.id))}>
                  {/* 44pt 터치 영역 확보용 투명 히트 서클 */}
                  <Circle cx={pos.x} cy={pos.y} r={26} fill="rgba(0,0,0,0.01)" />
                  <Circle
                    cx={pos.x}
                    cy={pos.y}
                    r={isSelected ? 22 : 19}
                    fill={isSelected ? 'rgba(34,211,238,0.14)' : 'rgba(255,255,255,0.05)'}
                    stroke={isSelected ? colors.accent : 'rgba(255,255,255,0.18)'}
                    strokeWidth={isSelected ? 1.4 : 1}
                  />
                  <SvgText
                    x={pos.x}
                    y={pos.y - 2}
                    fill={isSelected ? colors.ink : '#cdd7e8'}
                    fontSize={isSelected ? 9 : 8}
                    fontWeight={isSelected ? '700' : '400'}
                    textAnchor="middle">
                    {node.label}
                  </SvgText>
                  <SvgText
                    x={pos.x}
                    y={pos.y + 8}
                    fill={colors.mut}
                    fontSize={7}
                    textAnchor="middle">
                    {node.sub ?? GROUP_LABEL[node.group]}
                  </SvgText>
                </G>
              );
            })}
            <Circle
              cx={CENTER.x}
              cy={CENTER.y}
              r={30}
              fill="rgba(34,211,238,0.2)"
              stroke={colors.accent}
              strokeWidth={2}
            />
            <SvgText x={CENTER.x} y={CENTER.y - 3} fill="#ffffff" fontSize={10} fontWeight="800" textAnchor="middle">
              {network.center.label}
            </SvgText>
            <SvgText x={CENTER.x} y={CENTER.y + 8} fill={colors.accent} fontSize={7} textAnchor="middle">
              중심 기업
            </SvgText>
          </G>
        </Svg>
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
            onPress={() => setZoomIdx(i => Math.max(i - 1, 0))}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="관계 지도 축소"
            style={styles.zoomBtn}>
            <Text style={[styles.zoomText, { fontFamily: font('mono', '700') }]}>−</Text>
          </Pressable>
        </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  graphWrap: { position: 'relative' },
  controls: { position: 'absolute', right: 6, top: 6, gap: 6 },
  zoomBtn: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: 'rgba(8,12,22,0.85)',
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomText: { fontSize: 14, fontWeight: '700', color: colors.mut },
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
