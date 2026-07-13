// P2 — 보유 종목 수정: 수량·평균단가·매수 이유 수정 + 삭제(확인 모달).
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { DataMetadata } from '@/components/DataMetadata';
import { Panel } from '@/components/Panel';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SecondaryButton } from '@/components/SecondaryButton';
import { StaticTabBar } from '@/components/StaticTabBar';
import { EmptyState, LoadingState } from '@/components/States';
import { font } from '@/lib/fonts';
import { useSafeBack } from '@/lib/useSafeBack';
import { portfolioService } from '@/src/services';
import { colors } from '@/src/theme';
import { PortfolioHolding } from '@/src/types';

export default function HoldingEditRoute() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const goBack = useSafeBack('/portfolio/holdings');

  const [holding, setHolding] = useState<PortfolioHolding | null>(null);
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState('');
  const [avgPrice, setAvgPrice] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    portfolioService
      .getHolding(symbol ?? '')
      .then(h => {
        if (!alive.current) return;
        setHolding(h);
        if (h) {
          setQty(String(h.qty));
          setAvgPrice(String(h.avgPrice));
          setNote(h.note ?? '');
        }
      })
      .finally(() => alive.current && setLoading(false));
    return () => {
      alive.current = false;
    };
  }, [symbol]);

  const qtyNum = parseInt(qty, 10);
  const priceNum = parseInt(avgPrice.replaceAll(',', ''), 10);
  const valid = holding != null && qtyNum > 0 && priceNum > 0;

  const save = async () => {
    if (!valid || !holding || saving) return;
    setSaving(true);
    try {
      await portfolioService.updateHolding({
        ...holding,
        qty: qtyNum,
        avgPrice: priceNum,
        note: note.trim() || undefined,
      });
      if (alive.current) goBack();
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="portfolio" />}>
        <LoadingState stage="보유 정보 불러오는 중" />
      </AppScreen>
    );
  }
  if (!holding) {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="portfolio" />}>
        <AppHeader onBack={goBack} subtitle="Portfolio" title="종목 수정" />
        <EmptyState
          title="보유 종목이 아니에요"
          message={`'${symbol}'은(는) 현재 포트폴리오에 없습니다.`}
          actionLabel="목록으로"
          onAction={goBack}
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen keyboardAvoid edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="portfolio" />}>
      <AppHeader
        onBack={goBack}
        subtitle={`${holding.name} · ${holding.symbol}`}
        title="종목 수정"
      />

      <View style={styles.g2}>
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { fontFamily: font('body', '700') }]}>수량</Text>
          <View style={styles.fieldRow}>
            <TextInput
              value={qty}
              onChangeText={setQty}
              keyboardType="number-pad"
              accessibilityLabel="보유 수량 수정"
              style={[styles.fieldInput, { fontFamily: font('mono', '600') }]}
            />
            <Text style={[styles.unit, { fontFamily: font('mono', '500') }]}>주</Text>
          </View>
        </View>
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { fontFamily: font('body', '700') }]}>평균단가</Text>
          <View style={styles.fieldRow}>
            <TextInput
              value={avgPrice}
              onChangeText={setAvgPrice}
              keyboardType="number-pad"
              accessibilityLabel="평균 매입가 수정"
              style={[styles.fieldInput, { fontFamily: font('mono', '600') }]}
            />
            <Text style={[styles.unit, { fontFamily: font('mono', '500') }]}>원</Text>
          </View>
        </View>
      </View>

      <Panel>
        <Text style={[styles.noteLabel, { fontFamily: font('body', '700') }]}>매수 이유 (선택)</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="이 종목을 산 이유를 한 문장으로"
          placeholderTextColor={colors.dim}
          multiline
          accessibilityLabel="매수 이유 수정"
          style={[styles.noteInput, { fontFamily: font('body', '500') }]}
        />
      </Panel>

      <PrimaryButton
        label={saving ? '저장 중…' : '저장'}
        onPress={save}
        disabled={!valid || saving}
      />
      <SecondaryButton
        label="이 종목 삭제"
        onPress={() => setConfirmDelete(true)}
        style={styles.delete}
        accessibilityLabel={`${holding.name} 삭제`}
      />

      <DataMetadata
        items={['잔고·매매 기능이 없는 분석 전용 기록입니다']}
        style={styles.meta}
      />

      <ConfirmationModal
        visible={confirmDelete}
        title="보유 종목 삭제"
        message={`${holding.name}(${holding.symbol})을(를) 포트폴리오에서 삭제할까요? 기록만 삭제되며 실제 계좌에는 영향이 없습니다.`}
        confirmLabel="삭제"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false);
          await portfolioService.removeHolding(holding.symbol);
          if (alive.current) goBack();
        }}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  g2: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  field: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 13,
    paddingHorizontal: 15,
    paddingVertical: 10,
    minHeight: 56,
  },
  fieldLabel: {
    fontSize: 10.5,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.dim,
    fontWeight: '700',
    marginBottom: 2,
  },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldInput: { flex: 1, fontSize: 15, color: colors.ink, paddingVertical: 4, padding: 0 },
  unit: { fontSize: 12, color: colors.dim },
  noteLabel: {
    fontSize: 10.5,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.dim,
    fontWeight: '700',
  },
  noteInput: {
    marginTop: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13.5,
    color: colors.ink,
    minHeight: 48,
  },
  delete: {
    marginTop: 10,
    borderColor: 'rgba(248,113,113,0.35)',
    backgroundColor: 'rgba(248,113,113,0.08)',
  },
  meta: { marginTop: 14, textAlign: 'center' },
});
