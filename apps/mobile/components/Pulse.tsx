// P3-A — 공통 펄스 (2.2s 부드러운 opacity 루프, 네온 금지).
// 모션 정책 OFF면 정적으로 렌더. 언마운트 시 애니메이션 정리.
import React, { useEffect } from 'react';
import { ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { motionConfig, useShouldAnimate } from '@/lib/motion';

export interface PulseProps {
  children: React.ReactNode;
  /** 최소 opacity (기본 0.35) */
  minOpacity?: number;
  style?: ViewStyle;
}

export function Pulse({ children, minOpacity = 0.35, style }: PulseProps) {
  const shouldAnimate = useShouldAnimate();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (shouldAnimate) {
      opacity.value = withRepeat(
        withTiming(minOpacity, {
          duration: motionConfig.pulseDuration / 2,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true,
      );
    } else {
      cancelAnimation(opacity);
      opacity.value = 1;
    }
    return () => {
      cancelAnimation(opacity);
    };
  }, [shouldAnimate, minOpacity, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
}
