// specs/components.md — AIComposer (.input .send)
// 자연어 입력 + 'AI가 변환 중' 상태 라벨 슬롯 + 전송 버튼.
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { colors } from '@/src/theme';
import { font } from '@/lib/fonts';
import { Pulse } from '@/components/Pulse';

export interface AIComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /** 'AI가 조건을 인식하는 중' 등 — busy=true일 때 펄스 점과 함께 표시 */
  statusLabel: string;
  busy?: boolean;
  onSend: () => void;
  sendDisabled?: boolean;
  sendAccessibilityLabel?: string;
  style?: ViewStyle;
}

function PulseDot({ active }: { active: boolean }) {
  const dot = <View style={styles.dot} />;
  return active ? <Pulse minOpacity={0.3}>{dot}</Pulse> : dot;
}

export function AIComposer({
  value,
  onChangeText,
  placeholder,
  statusLabel,
  busy = false,
  onSend,
  sendDisabled = false,
  sendAccessibilityLabel = '분석 요청 보내기',
  style,
}: AIComposerProps) {
  return (
    <View style={[styles.box, style]}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.dim}
        multiline
        editable={!busy}
        accessibilityLabel={placeholder ?? '자연어 입력'}
        style={[styles.inputText, { fontFamily: font('body', '500') }]}
      />
      <View style={styles.row}>
        <View style={styles.status}>
          <PulseDot active={busy} />
          <Text style={[styles.statusText, { fontFamily: font('body', '600') }]}>
            {statusLabel}
          </Text>
        </View>
        <Pressable
          onPress={onSend}
          disabled={sendDisabled || busy}
          accessibilityRole="button"
          accessibilityLabel={sendAccessibilityLabel}
          accessibilityState={{ disabled: sendDisabled || busy }}
          style={({ pressed }) => [
            styles.send,
            { opacity: sendDisabled || busy ? 0.45 : pressed ? 0.8 : 1 },
          ]}>
          <Svg style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="sendGrad" x1="0" y1="0" x2="1" y2="0.4">
                <Stop offset="0" stopColor={colors.accent} />
                <Stop offset="1" stopColor={colors.accent2} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" rx={22} fill="url(#sendGrad)" />
          </Svg>
          <Svg width={16} height={16} viewBox="0 0 16 16">
            <Path
              d="M3 8h9M8 4l4 4-4 4"
              stroke="#03121b"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </Svg>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.25)',
    borderRadius: 18,
    padding: 16,
  },
  inputText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#cdd7e8',
    fontWeight: '500',
    minHeight: 44,
    maxHeight: 120,
    textAlignVertical: 'top',
    padding: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    gap: 10,
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  dot: { width: 6, height: 6, borderRadius: 99, backgroundColor: colors.accent },
  statusText: { fontSize: 10.5, color: colors.accent, fontWeight: '600' },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
