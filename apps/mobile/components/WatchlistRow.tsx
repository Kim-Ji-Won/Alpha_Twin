// 프레임 24 — 관심 종목 행: 저장 identity + 실제 최근 확정 시세 + 분석 준비 상태.
import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '@/src/theme';
import { font } from '@/lib/fonts';
import { formatKRW, formatPct } from '@/lib/format';
import { StatusBadge } from '@/components/StatusBadge';
import type { WatchlistEntry } from '@/lib/hooks';

export interface WatchlistRowProps {
  entry: WatchlistEntry;
  onPress?: () => void;
  onLongPress?: () => void;
  first?: boolean;
  style?: ViewStyle;
}

function marketDate(asOf: string): string {
  const date = asOf.match(/^\d{4}-(\d{2})-(\d{2})/);
  return date ? `${date[1]}/${date[2]}` : asOf;
}

function signedPriceChange(change: number, currency: string): string {
  const sign = change > 0 ? '+' : change < 0 ? '−' : '';
  const absolute = Math.abs(change);
  const amount = currency === 'KRW'
    ? formatKRW(absolute)
    : `${absolute.toLocaleString('ko-KR')} ${currency}`;
  return `${sign}${amount}`;
}

export function WatchlistRow({ entry, onPress, onLongPress, first, style }: WatchlistRowProps) {
  const quote = entry.market.quote;
  const changeColor = quote
    ? quote.changePercent > 0
      ? colors.pos
      : quote.changePercent < 0
        ? colors.neg
        : colors.mut
    : colors.dim;
  const priceText = quote
    ? quote.currency === 'KRW'
      ? formatKRW(quote.price)
      : `${quote.price.toLocaleString('ko-KR')} ${quote.currency}`
    : null;
  const thesisText = entry.thesisExists ? '논제 있음' : '논제 없음';
  const marketDescription = quote
    ? `${priceText}, ${signedPriceChange(quote.change, quote.currency)}, ${formatPct(quote.changePercent)}, 최근 확정 시세 기준 ${marketDate(quote.asOf)}`
    : entry.market.status === 'loading'
      ? '최근 시세 불러오는 중'
      : '시세 확인 불가';

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${entry.name}, ${marketDescription}, 분석 준비 중, ${thesisText}`}
      style={({ pressed }) => [
        styles.row,
        first ? null : styles.divider,
        { opacity: pressed ? 0.75 : 1 },
        style,
      ]}>
      <View style={styles.logo}>
        <Text style={[styles.logoText, { fontFamily: font('mono', '700') }]}>
          {entry.name.slice(0, 2)}
        </Text>
      </View>
      <View style={styles.body}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { fontFamily: font('body', '700') }]}>{entry.name}</Text>
          {quote?.fallback ? <StatusBadge label="대체 시세" tone="neutral" size="sm" /> : null}
          {quote?.stale && !quote.fallback ? (
            <StatusBadge label="이전 시세" tone="warn" size="sm" />
          ) : null}
        </View>
        {quote && priceText ? (
          <>
            <Text style={[styles.price, { fontFamily: font('mono', '600') }]}>{priceText}</Text>
            <Text style={[styles.marketMeta, { color: changeColor, fontFamily: font('mono', '500') }]}>
              {signedPriceChange(quote.change, quote.currency)} · {formatPct(quote.changePercent)}
              <Text style={styles.asOf}> · 최근 확정 {marketDate(quote.asOf)}</Text>
            </Text>
          </>
        ) : (
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.marketState, { fontFamily: font('body', '500') }]}>
            {entry.market.status === 'loading' ? '최근 시세 불러오는 중' : '시세 확인 불가'}
          </Text>
        )}
      </View>
      <View style={styles.score}>
        <Text style={[styles.pending, { fontFamily: font('body', '600') }]}>분석</Text>
        <Text style={[styles.scoreLabel, { fontFamily: font('body', '500') }]}>준비 중</Text>
        <Text style={[styles.thesis, { fontFamily: font('body', '600') }]}>
          {thesisText}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 2,
    minHeight: 68,
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#111a2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { fontSize: 11, fontWeight: '700', color: colors.accent },
  body: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  price: { fontSize: 12, color: colors.ink, marginTop: 3 },
  marketMeta: { fontSize: 10.5, marginTop: 2 },
  asOf: { color: colors.dim },
  marketState: { fontSize: 11.5, color: colors.dim, marginTop: 7 },
  score: { alignItems: 'flex-end' },
  pending: { fontSize: 11.5, color: colors.mut },
  scoreLabel: { fontSize: 10.5, color: colors.dim, marginTop: 2 },
  thesis: { fontSize: 10.5, color: colors.dim, marginTop: 4 },
});
