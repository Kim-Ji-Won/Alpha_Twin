// Frames 11–13 — 온보딩 3페이지: 대형 SVG 비주얼 + 도트 + 얇은 CTA(250px, r8)
// SVG art is ported 1:1 from design/Alpha Twin.dc.html (no redesign).
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Polygon,
  Rect,
  Text as SvgText,
} from 'react-native-svg';

import { AppScreen } from '@/components/AppScreen';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAppState } from '@/lib/appState';
import { font } from '@/lib/fonts';
import { colors, radius } from '@/src/theme';

const AnimatedLine = Animated.createAnimatedComponent(Line);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedG = Animated.createAnimatedComponent(G);

function useLoopedValue({
  from,
  to,
  duration,
}: {
  from: number;
  to: number;
  duration: number;
}) {
  const value = useRef(new Animated.Value(from)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(value, {
        toValue: to,
        duration,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [duration, to, value]);

  return value;
}

function usePulseValue() {
  const value = useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 0.4,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(value, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value]);

  return value;
}

function useDelayedFade(delay: number, enabled = true) {
  const value = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!enabled) {
      value.setValue(0);
      return undefined;
    }

    value.setValue(0);
    const fade = Animated.timing(value, {
      toValue: 1,
      duration: 800,
      delay,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    });
    fade.start();
    return () => fade.stop();
  }, [delay, enabled, value]);

  return value;
}

function useDrawIn(enabled = true) {
  const value = useRef(new Animated.Value(240)).current;

  React.useEffect(() => {
    if (!enabled) {
      value.setValue(240);
      return undefined;
    }

    value.setValue(240);
    const draw = Animated.timing(value, {
      toValue: 0,
      duration: 1400,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    });
    draw.start();
    return () => draw.stop();
  }, [enabled, value]);

  return value;
}

// Frame 11 — 데이터 소스 → 기업 트윈 허브
function Art1() {
  const dashOffset = useLoopedValue({ from: 0, to: -24, duration: 1600 });

  return (
    <Svg width={286} height={235} viewBox="0 0 260 214">
      <G stroke="rgba(255,255,255,0.13)">
        <Line x1={130} y1={104} x2={54} y2={40} />
        <Line x1={130} y1={104} x2={206} y2={40} />
        <Line x1={130} y1={104} x2={38} y2={142} />
        <Line x1={130} y1={104} x2={222} y2={142} />
      </G>
      <AnimatedLine
        x1={130}
        y1={104}
        x2={130}
        y2={188}
        stroke={colors.accent}
        strokeDasharray="3 5"
        strokeDashoffset={dashOffset}
      />
      <Circle cx={130} cy={104} r={35} fill="rgba(34,211,238,0.13)" stroke={colors.accent} strokeWidth={2} />
      <SvgText x={130} y={109} fill={colors.ink} fontSize={13.5} fontWeight="800" textAnchor="middle">기업</SvgText>
      <G>
        <Circle cx={54} cy={40} r={22} fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.18)" />
        <SvgText x={54} y={44} fontSize={11} fill="#aab6cc" textAnchor="middle">재무</SvgText>
        <Circle cx={206} cy={40} r={22} fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.18)" />
        <SvgText x={206} y={44} fontSize={11} fill="#aab6cc" textAnchor="middle">뉴스</SvgText>
        <Circle cx={38} cy={142} r={22} fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.18)" />
        <SvgText x={38} y={146} fontSize={11} fill="#aab6cc" textAnchor="middle">공시</SvgText>
        <Circle cx={222} cy={142} r={22} fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.18)" />
        <SvgText x={222} y={146} fontSize={11} fill="#aab6cc" textAnchor="middle">수급</SvgText>
        <Circle cx={130} cy={188} r={20} fill="rgba(34,211,238,0.1)" stroke={colors.accent} />
        <SvgText x={130} y={192} fontSize={11} fill={colors.accent} textAnchor="middle">거시</SvgText>
      </G>
    </Svg>
  );
}

// Frame 12 — 현재 → 낙관/중앙/비관 시나리오 분기
function Art2({ active }: { active: boolean }) {
  const drawOffset = useDrawIn(active);
  const branchOffset = useLoopedValue({ from: 0, to: -27, duration: 1300 });
  const pulse = usePulseValue();
  const coneOpacity = useDelayedFade(900, active);
  const guideOpacity = useDelayedFade(600, active);
  const nowOpacity = useDelayedFade(700, active);
  const optimisticOpacity = useDelayedFade(1200, active);
  const baseOpacity = useDelayedFade(1400, active);
  const pessimisticOpacity = useDelayedFade(1600, active);

  return (
    <Svg width={286} height={220} viewBox="0 0 260 200">
      <AnimatedPath
        d="M118,100 C155,88 200,60 240,36 L240,164 C200,140 155,112 118,100 Z"
        fill="rgba(34,211,238,0.07)"
        opacity={coneOpacity}
      />
      <AnimatedLine
        x1={118}
        y1={22}
        x2={118}
        y2={178}
        stroke="rgba(255,255,255,0.1)"
        strokeDasharray="3 4"
        opacity={guideOpacity}
      />
      <AnimatedPath
        d="M18,124 C56,118 92,108 118,100"
        fill="none"
        stroke="#9fb0cc"
        strokeWidth={2.4}
        strokeDasharray={240}
        strokeDashoffset={drawOffset}
      />
      <AnimatedPath
        d="M118,100 C158,88 200,62 240,40"
        fill="none"
        stroke={colors.pos}
        strokeWidth={2}
        strokeDasharray="5 4"
        strokeDashoffset={branchOffset}
        opacity={optimisticOpacity}
      />
      <AnimatedPath
        d="M118,100 C160,99 202,97 240,95"
        fill="none"
        stroke={colors.accent}
        strokeWidth={2}
        strokeDasharray="5 4"
        strokeDashoffset={branchOffset}
        opacity={baseOpacity}
      />
      <AnimatedPath
        d="M118,100 C158,112 200,136 240,158"
        fill="none"
        stroke={colors.neg}
        strokeWidth={2}
        strokeDasharray="5 4"
        strokeDashoffset={branchOffset}
        opacity={pessimisticOpacity}
      />
      <AnimatedCircle cx={118} cy={100} r={5.5} fill={colors.accent} opacity={pulse} />
      <AnimatedG opacity={nowOpacity}>
        <SvgText x={118} y={192} fill={colors.mut} fontSize={11} textAnchor="middle">현재</SvgText>
      </AnimatedG>
      <G fontSize={11} fontWeight="700" textAnchor="end">
        <AnimatedG opacity={optimisticOpacity}>
          <SvgText x={240} y={28} fill={colors.pos}>낙관 +18%</SvgText>
        </AnimatedG>
        <AnimatedG opacity={baseOpacity}>
          <SvgText x={240} y={86} fill={colors.accent}>중앙</SvgText>
        </AnimatedG>
        <AnimatedG opacity={pessimisticOpacity}>
          <SvgText x={240} y={176} fill={colors.neg}>비관 −14%</SvgText>
        </AnimatedG>
      </G>
    </Svg>
  );
}

// Frame 13 — 논제 건강도 카드 + 충돌 배지
function Art3() {
  const pulse = usePulseValue();

  return (
    <Svg width={272} height={210} viewBox="0 0 260 200">
      <Rect x={32} y={18} width={196} height={164} rx={20} fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.14)" />
      <SvgText x={130} y={70} fill={colors.ink} fontSize={38} fontWeight="800" textAnchor="middle">78</SvgText>
      <SvgText x={130} y={90} fill={colors.mut} fontSize={11} textAnchor="middle">논제 건강도</SvgText>
      <Rect x={62} y={104} width={136} height={6} rx={3} fill="rgba(255,255,255,0.09)" />
      <Rect x={62} y={104} width={106} height={6} rx={3} fill={colors.accent} />
      <G fontSize={11.5}>
        <Circle cx={74} cy={134} r={4.5} fill={colors.pos} />
        <SvgText x={86} y={138} fill="#cdd7e8">긍정 근거 8</SvgText>
        <Circle cx={74} cy={158} r={4.5} fill={colors.neg} />
        <SvgText x={86} y={162} fill="#cdd7e8">부정 근거 5</SvgText>
        <SvgText x={198} y={138} fill={colors.mut} fontSize={10.5} textAnchor="end">▲ 유효</SvgText>
        <SvgText x={198} y={162} fill={colors.mut} fontSize={10.5} textAnchor="end">◆ 확인</SvgText>
      </G>
      <AnimatedCircle cx={222} cy={24} r={13} fill={colors.warn} opacity={pulse} />
      <SvgText x={222} y={29} fill={colors.bg} fontSize={14} fontWeight="800" textAnchor="middle">!</SvgText>
    </Svg>
  );
}

interface Page {
  art: (active: boolean) => React.ReactNode;
  title: string;
  body: string;
  cta: string;
  skip: string;
}

const PAGES: Page[] = [
  {
    art: () => <Art1 />,
    title: '주가를 보는 것을 넘어,\n기업의 상태를 이해하세요',
    body: '재무·뉴스·공시·수급·거시경제를 하나의 디지털 트윈으로 연결합니다.',
    cta: '다음',
    skip: '건너뛰기',
  },
  {
    art: active => <Art2 active={active} />,
    title: '기업의 디지털 트윈으로\n미래 상황을 실험하세요',
    body: '환율, 금리, 업황 변화를 가상으로 적용하고 기업과 포트폴리오의 반응을 확인합니다.',
    cta: '다음',
    skip: '건너뛰기',
  },
  {
    art: () => <Art3 />,
    title: '당신이 매수한 이유가\n아직 유효한지 AI가 확인합니다',
    body: '투자 논리를 기록하면 새로운 뉴스·실적·공시가 나올 때마다 자동으로 검증합니다.',
    cta: '시작하기',
    skip: '로그인',
  },
];

export default function OnboardingRoute() {
  const router = useRouter();
  const { completeOnboarding } = useAppState();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<Page>>(null);
  const [page, setPage] = useState(0);

  const finish = () => {
    completeOnboarding();
    router.replace('/auth/login');
  };

  const next = () => {
    if (page < PAGES.length - 1) {
      listRef.current?.scrollToIndex({ index: page + 1, animated: true });
    } else {
      finish();
    }
  };

  return (
    <AppScreen scroll={false} padded={false}>
      <FlatList
        ref={listRef}
        data={PAGES}
        extraData={page}
        keyExtractor={(_, i) => String(i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={e =>
          setPage(Math.round(e.nativeEvent.contentOffset.x / width))
        }
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
        renderItem={({ item, index }) => (
          <View style={[styles.page, { width }]}>
            <View style={styles.art}>{item.art(index === page)}</View>
            <Text style={[styles.title, { fontFamily: font('body', '800') }]}>{item.title}</Text>
            <Text style={[styles.body, { fontFamily: font('body', '500') }]}>{item.body}</Text>
          </View>
        )}
      />
      <View style={styles.footer}>
        <View style={styles.dots} accessibilityLabel={`${page + 1} / ${PAGES.length} 페이지`}>
          {PAGES.map((_, i) => (
            <View key={i} style={[styles.dot, i === page && styles.dotOn]} />
          ))}
        </View>
        <PrimaryButton
          label={PAGES[page].cta}
          onPress={next}
          borderRadius={radius.control}
          style={styles.cta}
        />
        <Pressable
          onPress={finish}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={PAGES[page].skip}>
          <Text style={[styles.skip, { fontFamily: font('body', '600') }]}>
            {PAGES[page].skip}
          </Text>
        </Pressable>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingTop: 70, paddingHorizontal: 26, alignItems: 'center' },
  art: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 22 },
  title: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 31,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: 10,
  },
  body: {
    fontSize: 14.5,
    lineHeight: 23,
    color: colors.mut,
    textAlign: 'center',
    marginBottom: 4,
  },
  footer: { alignItems: 'center', paddingHorizontal: 26, paddingBottom: 24 },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.18)' },
  dotOn: { width: 18, backgroundColor: colors.accent },
  cta: { maxWidth: 250, width: '100%', marginTop: 22 },
  skip: { fontSize: 12, color: colors.dim, fontWeight: '600', marginTop: 16, minHeight: 20 },
});
