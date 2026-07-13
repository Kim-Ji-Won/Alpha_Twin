// 프레임 07 — 사용자 질문 말풍선 (.bub .bubu).
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '@/src/theme';
import { font } from '@/lib/fonts';

export interface ChatBubbleProps {
  text: string;
  style?: ViewStyle;
}

export function ChatBubble({ text, style }: ChatBubbleProps) {
  return (
    <View style={[styles.bubble, style]} accessibilityLabel={`내 질문: ${text}`}>
      <Text style={[styles.text, { fontFamily: font('body', '500') }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    alignSelf: 'flex-end',
    maxWidth: '86%',
    borderRadius: 18,
    borderBottomRightRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.25)',
    backgroundColor: 'rgba(34,211,238,0.14)',
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  text: { fontSize: 14, lineHeight: 22, color: colors.ink },
});
