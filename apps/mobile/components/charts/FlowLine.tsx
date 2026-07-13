// P3-A — 점선 흐름 연결선 (dash offset 1.4s 루프).
// 모션 정책 OFF면 정적 점선. 언마운트 시 cancelAnimation으로 정리.
import React, { useEffect } from 'react';
import { Line } from 'react-native-svg';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { motionConfig, useShouldAnimate } from '@/lib/motion';

const AnimatedLine = Animated.createAnimatedComponent(Line);

export interface FlowLineProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth?: number;
  /** dash 패턴 (기본 '3 5') */
  dash?: string;
  /** 흐름 애니메이션 여부 (선택 강조 등) — 정책과 AND */
  flowing?: boolean;
}

export function FlowLine({
  x1,
  y1,
  x2,
  y2,
  stroke,
  strokeWidth = 1.4,
  dash = '3 5',
  flowing = true,
}: FlowLineProps) {
  const shouldAnimate = useShouldAnimate();
  const offset = useSharedValue(0);
  const active = flowing && shouldAnimate;

  useEffect(() => {
    if (active) {
      offset.value = withRepeat(
        withTiming(-24, { duration: motionConfig.dashDuration, easing: Easing.linear }),
        -1,
        false,
      );
    } else {
      cancelAnimation(offset);
      offset.value = 0;
    }
    return () => {
      cancelAnimation(offset);
    };
  }, [active, offset]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: offset.value,
  }));

  return (
    <AnimatedLine
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeDasharray={dash}
      animatedProps={animatedProps}
    />
  );
}
