import React, { useEffect } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { font } from '@/lib/fonts';
import { useShouldAnimate } from '@/lib/motion';
import { colors } from '@/src/theme';

export interface GraphExplorerModalProps {
  visible: boolean;
  title: string;
  description: string;
  contentHeight: number;
  onClose: () => void;
  children: React.ReactNode;
}

const MIN_SCALE = 0.8;
const MAX_SCALE = 3;

export function GraphExplorerModal({
  visible,
  title,
  description,
  contentHeight,
  onClose,
  children,
}: GraphExplorerModalProps) {
  const shouldAnimate = useShouldAnimate();
  const insets = useSafeAreaInsets();
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const reset = () => {
    const duration = shouldAnimate ? 180 : 0;
    scale.value = withTiming(1, { duration });
    savedScale.value = 1;
    translateX.value = withTiming(0, { duration });
    translateY.value = withTiming(0, { duration });
    savedX.value = 0;
    savedY.value = 0;
  };

  useEffect(() => {
    if (visible) reset();
    return () => {
      cancelAnimation(scale);
      cancelAnimation(translateX);
      cancelAnimation(translateY);
    };
    // Reset only when modal visibility changes; motion preference affects the next reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pinch = Gesture.Pinch()
    .onUpdate(event => {
      scale.value = Math.max(MIN_SCALE, Math.min(MAX_SCALE, savedScale.value * event.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const pan = Gesture.Pan()
    .minDistance(2)
    .onUpdate(event => {
      translateX.value = savedX.value + event.translationX;
      translateY.value = savedY.value + event.translationY;
    })
    .onEnd(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    });

  const gesture = Gesture.Simultaneous(pinch, pan);
  const graphStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <Modal
      visible={visible}
      animationType={shouldAnimate ? 'fade' : 'none'}
      presentationStyle="fullScreen"
      onRequestClose={onClose}>
      <SafeAreaView
        style={[
          styles.safe,
          { paddingTop: Math.max(insets.top, Platform.OS === 'ios' ? 54 : 0) },
        ]}
        edges={['bottom', 'left', 'right']}>
        <View style={styles.header}>
          <View style={styles.titleWrap}>
            <Text style={[styles.eyebrow, { fontFamily: font('mono', '600') }]}>GRAPH EXPLORER</Text>
            <Text style={[styles.title, { fontFamily: font('body', '800') }]}>{title}</Text>
          </View>
          <View style={styles.actions}>
            <Pressable
              onPress={reset}
              accessibilityRole="button"
              accessibilityLabel="그래프 확대와 위치 초기화"
              style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.65 : 1 }]}>
              <Text style={[styles.actionText, { fontFamily: font('mono', '700') }]}>1:1</Text>
            </Pressable>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="전체 화면 그래프 닫기"
              style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.65 : 1 }]}>
              <Text style={[styles.closeText, { fontFamily: font('body', '500') }]}>×</Text>
            </Pressable>
          </View>
        </View>

        <GestureDetector gesture={gesture}>
          <View style={styles.stage} accessibilityLabel="두 손가락으로 확대하고 드래그하여 이동">
            <Animated.View
              style={[
                styles.graph,
                { height: Math.max(220, Math.min(contentHeight, 520)) },
                graphStyle,
              ]}>
              {children}
            </Animated.View>
          </View>
        </GestureDetector>

        <View style={styles.footer}>
          <Text
            style={[styles.description, { fontFamily: font('body', '600') }]}
            accessibilityLiveRegion="polite">
            {description}
          </Text>
          <Text style={[styles.help, { fontFamily: font('mono', '500') }]}>
            핀치 확대 · 드래그 이동 · 노드 선택
          </Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    minHeight: 72,
    paddingHorizontal: 18,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  titleWrap: { flex: 1 },
  eyebrow: { fontSize: 9.5, color: colors.accent, letterSpacing: 1 },
  title: { marginTop: 3, fontSize: 18, color: colors.ink, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 8 },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { fontSize: 11, color: colors.mut, fontWeight: '700' },
  closeText: { fontSize: 27, lineHeight: 28, color: colors.ink },
  stage: { flex: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  graph: { width: '100%', maxWidth: 520, justifyContent: 'center' },
  footer: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.panel,
  },
  description: { fontSize: 13, lineHeight: 20, color: '#cdd7e8', fontWeight: '600' },
  help: { marginTop: 5, fontSize: 10.5, color: colors.dim },
});
