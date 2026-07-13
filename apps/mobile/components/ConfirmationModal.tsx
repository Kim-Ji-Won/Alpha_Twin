// P2 — 확인 모달 (삭제 등 되돌리기 어려운 동작 전 확인).
// Android 뒤로 가기(onRequestClose)로 닫힘 처리.
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '@/src/theme';
import { font } from '@/lib/fonts';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SecondaryButton } from '@/components/SecondaryButton';

export interface ConfirmationModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 삭제류 — 확인 버튼을 레드 보더 SecondaryButton으로 렌더 */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmationModal({
  visible,
  title,
  message,
  confirmLabel = '확인',
  cancelLabel = '취소',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmationModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.overlay} onPress={onCancel} accessibilityLabel="모달 닫기">
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={[styles.title, { fontFamily: font('body', '800') }]} accessibilityRole="header">
            {title}
          </Text>
          <Text style={[styles.message, { fontFamily: font('body', '500') }]}>{message}</Text>
          <View style={styles.actions}>
            <SecondaryButton label={cancelLabel} onPress={onCancel} style={styles.cancel} />
            {destructive ? (
              <Pressable
                onPress={onConfirm}
                accessibilityRole="button"
                accessibilityLabel={confirmLabel}
                style={({ pressed }) => [styles.destructive, { opacity: pressed ? 0.75 : 1 }]}>
                <Text style={[styles.destructiveText, { fontFamily: font('body', '700') }]}>
                  {confirmLabel}
                </Text>
              </Pressable>
            ) : (
              <PrimaryButton label={confirmLabel} onPress={onConfirm} style={styles.confirm} />
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(4,6,13,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    borderRadius: radius.hero,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#0c1322',
    padding: 20,
  },
  title: { fontSize: 17, fontWeight: '800', color: colors.ink },
  message: { fontSize: 13.5, lineHeight: 21, color: colors.mut, marginTop: 9 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  cancel: { flex: 1 },
  confirm: { flex: 1 },
  destructive: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.45)',
    backgroundColor: 'rgba(248,113,113,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  destructiveText: { fontSize: 13.5, fontWeight: '700', color: colors.neg },
});
