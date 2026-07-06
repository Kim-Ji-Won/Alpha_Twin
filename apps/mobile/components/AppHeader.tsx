// specs/components.md — AppHeader (.hd)
// subtitle: dim 12.5px uppercase · title: 22px/800 · live=true → accent pulse dot
// NOTE: fontFamily is resolved at render time (not in StyleSheet.create) so it
// picks up the registered custom fonts after the root layout finishes loading them.
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '@/src/theme';
import { text } from '@/lib/typography';
import { font } from '@/lib/fonts';

export interface AppHeaderProps {
  subtitle?: string;
  title: string;
  live?: boolean;
  right?: React.ReactNode;
  onBack?: () => void;
}

function LiveDot() {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[styles.liveDot, { opacity: pulse }]} accessibilityLabel="실시간" />;
}

export function AppHeader({ subtitle, title, live, right, onBack }: AppHeaderProps) {
  return (
    <View style={styles.row}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="뒤로 가기"
          style={styles.back}>
          <Svg width={22} height={22} viewBox="0 0 24 24">
            <Path
              d="M15 5l-7 7 7 7"
              stroke={colors.ink}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </Svg>
        </Pressable>
      ) : null}
      <View style={styles.titles}>
        {subtitle ? (
          <Text
            style={[
              styles.subtitle,
              { fontFamily: font('body', '600') },
            ]}>
            {subtitle}
          </Text>
        ) : null}
        <View style={styles.titleRow}>
          <Text style={text('screenTitle', { color: colors.ink })} accessibilityRole="header">
            {title}
          </Text>
          {live ? <LiveDot /> : null}
        </View>
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 10,
    paddingBottom: 16,
    paddingHorizontal: 2,
  },
  back: {
    width: 44,
    height: 44,
    marginLeft: -10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titles: { flex: 1 },
  subtitle: {
    fontSize: 12.5,
    color: colors.dim,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 3 },
  liveDot: { width: 7, height: 7, borderRadius: 99, backgroundColor: colors.accent },
  right: { marginLeft: 12 },
});
