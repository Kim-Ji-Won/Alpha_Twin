import React, { useEffect } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { motionConfig, useShouldAnimate } from '@/lib/motion';

export interface AnimatedBarProps {
  progress?: number;
  color: string;
  style?: ViewStyle;
  fillStyle?: ViewStyle;
  accessibilityLabel?: string;
}

export function AnimatedBar({
  progress = 1,
  color,
  style,
  fillStyle,
  accessibilityLabel,
}: AnimatedBarProps) {
  const shouldAnimate = useShouldAnimate();
  const target = Math.max(0, Math.min(1, progress));
  const width = useSharedValue(shouldAnimate ? 0 : target);

  useEffect(() => {
    cancelAnimation(width);
    width.value = shouldAnimate
      ? withTiming(target, {
          duration: motionConfig.drawInDuration,
          easing: Easing.out(Easing.cubic),
        })
      : target;
    return () => cancelAnimation(width);
  }, [shouldAnimate, target, width]);

  const animatedStyle = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));

  return (
    <View style={[styles.track, style]} accessibilityLabel={accessibilityLabel}>
      <Animated.View style={[styles.fill, fillStyle, { backgroundColor: color }, animatedStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { overflow: 'hidden' },
  fill: { height: '100%' },
});
