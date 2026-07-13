import React, { useEffect } from 'react';
import { ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { motionConfig, useShouldAnimate } from '@/lib/motion';

export function ChartReveal({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const shouldAnimate = useShouldAnimate();
  const progress = useSharedValue(shouldAnimate ? 0 : 1);

  useEffect(() => {
    cancelAnimation(progress);
    progress.value = shouldAnimate
      ? withTiming(1, { duration: motionConfig.drawInDuration, easing: Easing.out(Easing.cubic) })
      : 1;
    return () => cancelAnimation(progress);
  }, [progress, shouldAnimate]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + progress.value * 0.65,
    transform: [{ scaleX: 0.02 + progress.value * 0.98 }],
  }));

  return <Animated.View style={[{ transformOrigin: 'left center' }, style, animatedStyle]}>{children}</Animated.View>;
}
