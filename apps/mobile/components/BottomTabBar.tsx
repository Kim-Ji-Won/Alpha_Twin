// specs/components.md — BottomTabBar (.nav/.nb/.navon)
// Height 62 + safe area · active tab: accent color + 2px top indicator
// Labels/route names come from src/constants/navigation.ts TABS.
// SDK 57: react-navigation is vendored inside expo-router — types come from 'expo-router/tabs'
import type { BottomTabBarProps } from 'expo-router/tabs';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Polygon, Rect } from 'react-native-svg';
import { colors, spacing } from '@/src/theme';
import { TABS } from '@/src/constants/navigation';
import { font } from '@/lib/fonts';

type TabName = (typeof TABS)[number]['name'];

function TabIcon({ name, color }: { name: TabName; color: string }) {
  const common = {
    stroke: color,
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };
  switch (name) {
    case 'home':
      return (
        <Svg width={21} height={21} viewBox="0 0 24 24">
          <Path d="M4 11l8-7 8 7v9a1 1 0 01-1 1h-5v-6h-4v6H5a1 1 0 01-1-1z" {...common} />
        </Svg>
      );
    case 'discover':
      return (
        <Svg width={21} height={21} viewBox="0 0 24 24">
          <Circle cx={11} cy={11} r={6.5} {...common} />
          <Path d="M16 16l4.5 4.5" {...common} />
        </Svg>
      );
    case 'twin':
      return (
        <Svg width={21} height={21} viewBox="0 0 24 24">
          <Polygon points="12,3 21,12 12,21 3,12" {...common} />
          <Circle cx={12} cy={12} r={1.6} fill={color} stroke="none" />
        </Svg>
      );
    case 'portfolio':
      return (
        <Svg width={21} height={21} viewBox="0 0 24 24">
          <Rect x={4} y={12} width={3.6} height={8} rx={1} {...common} />
          <Rect x={10.2} y={7} width={3.6} height={13} rx={1} {...common} />
          <Rect x={16.4} y={4} width={3.6} height={16} rx={1} {...common} />
        </Svg>
      );
    case 'ai':
      return (
        <Svg width={21} height={21} viewBox="0 0 24 24">
          <Path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" {...common} />
          <Circle cx={18.5} cy={17.5} r={2.2} {...common} />
        </Svg>
      );
  }
}

export function BottomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {TABS.map(tab => {
        const routeIndex = state.routes.findIndex(r => r.name === tab.name);
        if (routeIndex === -1) return null;
        const active = state.index === routeIndex;
        const color = active ? colors.accent : colors.dim;
        return (
          <Pressable
            key={tab.name}
            onPress={() => {
              if (!active) navigation.navigate(tab.name);
            }}
            accessibilityRole="tab"
            accessibilityLabel={`${tab.label} 탭`}
            accessibilityState={{ selected: active }}
            style={styles.item}>
            {active ? <View style={styles.indicator} /> : null}
            <TabIcon name={tab.name} color={color} />
            <Text style={[styles.label, { color, fontFamily: font('body', '600') }]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: spacing.tabBarHeight,
    paddingTop: 10,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: 'rgba(8,12,22,0.96)',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 5,
    minHeight: 44,
  },
  indicator: {
    position: 'absolute',
    top: -11,
    width: 28,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.accent,
  },
  label: { fontSize: 10, fontWeight: '600' },
});
