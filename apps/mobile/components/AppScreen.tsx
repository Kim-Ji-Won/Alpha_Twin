// Screen shell — dark navy background with the design's radial top glow,
// safe area, optional scroll + keyboard avoidance.
// Design ref: .screen { radial-gradient(130% 80% at 50% -10%, #101a30 → #0a0f1c → #060912) }
import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { Edges, SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { colors, spacing } from '@/src/theme';

export interface AppScreenProps {
  children: React.ReactNode;
  /** wrap children in a vertical ScrollView (default true) */
  scroll?: boolean;
  /** enable KeyboardAvoidingView (screens with text input) */
  keyboardAvoid?: boolean;
  /** horizontal screen padding (default spacing.screenX = 18) */
  padded?: boolean;
  /** safe area edges — tab screens exclude 'bottom' (tab bar owns it) */
  edges?: Edges;
  /** 하단 상주 탭 바 (상세 화면용 StaticTabBar) — 전달 시 edges에서 'bottom' 제외할 것 */
  tabBar?: React.ReactNode;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
}

function TopGlow() {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient id="glow" cx="50%" cy="-10%" rx="130%" ry="80%">
          <Stop offset="0" stopColor={colors.screenGradTop} stopOpacity="1" />
          <Stop offset="0.45" stopColor={colors.bg} stopOpacity="1" />
          <Stop offset="1" stopColor="#060912" stopOpacity="1" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#glow)" />
    </Svg>
  );
}

export function AppScreen({
  children,
  scroll = true,
  keyboardAvoid = false,
  padded = true,
  edges = ['top', 'left', 'right', 'bottom'],
  tabBar,
  style,
  contentStyle,
}: AppScreenProps) {
  const pad = padded ? { paddingHorizontal: spacing.screenX } : null;

  let body: React.ReactNode = scroll ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[styles.scrollContent, pad, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, pad, contentStyle]}>{children}</View>
  );

  if (keyboardAvoid) {
    body = (
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {body}
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={[styles.root, style]}>
      <TopGlow />
      <SafeAreaView style={styles.fill} edges={edges}>
        {body}
      </SafeAreaView>
      {tabBar}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 28 },
});
