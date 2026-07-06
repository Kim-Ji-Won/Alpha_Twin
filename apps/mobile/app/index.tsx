// Frame 10 — 스플래시: 트윈 동기화 로딩 → 온보딩/로그인/홈 분기
import { useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polygon } from 'react-native-svg';

import { AppScreen } from '@/components/AppScreen';
import { useAppState } from '@/lib/appState';
import { font } from '@/lib/fonts';
import { colors } from '@/src/theme';

const SPLASH_MS = 1600;

function SplashArt() {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View accessibilityLabel="ALPHA TWIN 로고 — 디지털 트윈 동기화 중">
      <Animated.View style={{ opacity: pulse }}>
        <Svg width={216} height={216} viewBox="0 0 240 240">
          <Circle cx={120} cy={120} r={106} fill="none" stroke="rgba(34,211,238,0.09)" />
          <Circle cx={120} cy={120} r={74} fill="none" stroke="rgba(255,255,255,0.06)" />
          <Circle cx={120} cy={14} r={3} fill={colors.accent} />
          <Circle cx={226} cy={120} r={2.5} fill="rgba(34,211,238,0.55)" />
          <Circle cx={46} cy={194} r={2.5} fill="rgba(59,130,246,0.65)" />
          <Polygon
            points="120,58 182,120 120,182 58,120"
            fill="none"
            stroke={colors.accent}
            strokeWidth={2.6}
          />
          <Polygon points="120,80 160,120 120,164 80,120" fill={colors.accent2} opacity={0.4} />
          <Circle cx={120} cy={120} r={6} fill={colors.accent} />
        </Svg>
      </Animated.View>
    </View>
  );
}

function LoadBar() {
  const x = useRef(new Animated.Value(-0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(x, {
        toValue: 1,
        duration: 1500,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [x]);
  const translateX = x.interpolate({ inputRange: [-0.45, 1], outputRange: [-67, 148] });
  return (
    <View style={styles.loadbar} accessibilityRole="progressbar" accessibilityLabel="로딩 중">
      <Animated.View style={[styles.loadbarFill, { transform: [{ translateX }] }]} />
    </View>
  );
}

export default function SplashRoute() {
  const router = useRouter();
  const { ready, onboardingDone, loggedIn } = useAppState();

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      if (!onboardingDone) router.replace('/onboarding');
      else if (!loggedIn) router.replace('/auth/login');
      else router.replace('/(tabs)/home');
    }, SPLASH_MS);
    return () => clearTimeout(t);
  }, [ready, onboardingDone, loggedIn, router]);

  return (
    <AppScreen scroll={false} contentStyle={styles.center}>
      <SplashArt />
      <View style={styles.wordmark}>
        <Text style={[styles.wm, { fontFamily: font('body', '800') }]}>
          ALPHA <Text style={{ color: colors.accent }}>TWIN</Text>
        </Text>
      </View>
      <Text style={[styles.tagEn, { fontFamily: font('mono', '500') }]}>
        AI INVESTMENT INTELLIGENCE
      </Text>
      <Text style={[styles.tagKo, { fontFamily: font('body', '500') }]}>
        미래를 예측하지 않고, 시뮬레이션합니다
      </Text>
      <View style={styles.bottom}>
        <LoadBar />
        <Text style={[styles.loadText, { fontFamily: font('mono', '500') }]}>
          디지털 트윈 동기화 중 · 3/5
        </Text>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  wordmark: { marginTop: 30 },
  wm: { fontSize: 30, fontWeight: '800', letterSpacing: 0.6, color: colors.ink },
  tagEn: { fontSize: 10.5, color: colors.dim, letterSpacing: 2.5, marginTop: 10 },
  tagKo: { fontSize: 13.5, color: colors.mut, marginTop: 20, fontWeight: '500' },
  bottom: {
    position: 'absolute',
    bottom: 54,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 13,
  },
  loadbar: {
    width: 148,
    height: 5,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.07)',
    overflow: 'hidden',
  },
  loadbarFill: {
    width: 67, // 45% of 148
    height: 5,
    borderRadius: 99,
    backgroundColor: colors.accent,
    opacity: 0.85,
  },
  loadText: { fontSize: 10.5, color: colors.dim },
});
