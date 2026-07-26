// 디자인 .cohead — 종목 이니셜 타일 + 기업명/코드 + 우측 현재가·등락.
import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '@/src/theme';
import { Stock } from '@/src/types';
import { font } from '@/lib/fonts';
import { signed } from '@/lib/direction';

// 디자인 프레임 19/24의 종목 이니셜 표기
const INITIALS: Record<string, string> = {
  '000660': 'SK',
  '005930': 'SS',
  '042700': 'HM',
  '010120': 'LS',
  '035420': 'NA',
  '005380': 'HD',
  '006400': 'SD',
};

export interface StockHeaderProps {
  stock: Stock;
  onBack?: () => void;
  priceState?: 'ready' | 'loading' | 'unavailable';
  style?: ViewStyle;
}

export function StockHeader({
  stock,
  onBack,
  priceState = 'ready',
  style,
}: StockHeaderProps) {
  const changeAmount = stock.change ?? Math.round(stock.price - stock.price / (1 + stock.changePct / 100));
  const up = stock.changePct >= 0;
  const priceLabel = stock.dataMode === 'eod' || stock.source === 'public-data-fsc' ? '최근 확정가' : '현재가';
  const changeColor = up ? colors.pos : colors.neg;
  const changeText = `${up ? '▲' : '▼'} ${Math.abs(changeAmount).toLocaleString()} ${signed(stock.changePct, '%')}`;
  const metadataText = [stock.symbol, stock.market ?? 'KOSPI', stock.sector].filter(Boolean).join(' · ');
  return (
    <View style={[styles.row, style]}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="뒤로 가기"
          style={styles.back}>
          <Svg width={20} height={20} viewBox="0 0 24 24">
            <Path
              d="M15 5l-7 7 7 7"
              stroke={colors.mut}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </Svg>
        </Pressable>
      ) : null}
      <View style={styles.tile}>
        <Text style={[styles.tileText, { fontFamily: font('mono', '700') }]}>
          {INITIALS[stock.symbol] ?? stock.name.slice(0, 2)}
        </Text>
      </View>
      <View style={styles.names}>
        <Text
          style={[styles.name, { fontFamily: font('body', '800') }]}
          accessibilityRole="header"
          numberOfLines={1}>
          {stock.name}
        </Text>
        <Text style={[styles.code, { fontFamily: font('mono', '500') }]} numberOfLines={1}>
          {metadataText}
        </Text>
      </View>
      {priceState === 'ready' ? (
        <View
          style={styles.price}
          accessibilityLabel={`${priceLabel} ${stock.price.toLocaleString()}원, ${up ? '상승' : '하락'} ${Math.abs(changeAmount).toLocaleString()}원, ${signed(stock.changePct, '%')}`}>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            style={[styles.priceValue, { fontFamily: font('mono', '700') }]}>
            {stock.price.toLocaleString()}
          </Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} style={[styles.change, { color: changeColor, fontFamily: font('mono', '600') }]}>
            {changeText}
          </Text>
        </View>
      ) : (
        <View
          style={styles.price}
          accessibilityLabel={priceState === 'loading' ? '시세 불러오는 중' : '시세를 불러오지 못함'}>
          <Text style={[styles.pricePending, { fontFamily: font('body', '600') }]}>
            {priceState === 'loading' ? '시세 확인 중' : '시세 확인 불가'}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 10,
    paddingBottom: 14,
    paddingHorizontal: 2,
  },
  back: {
    width: 34,
    height: 44,
    marginLeft: -6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tile: {
    width: 46,
    height: 46,
    borderRadius: 13,
    backgroundColor: '#111c31',
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileText: { fontSize: 15, fontWeight: '700', color: colors.accent },
  names: { flex: 1, minWidth: 0 },
  name: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  code: { fontSize: 11, color: colors.dim, marginTop: 2 },
  price: { alignItems: 'flex-end', maxWidth: '42%', minWidth: 74 },
  priceValue: { fontSize: 20, fontWeight: '700', letterSpacing: -0.6, color: colors.ink },
  pricePending: { fontSize: 11.5, color: colors.mut, textAlign: 'right' },
  change: { fontSize: 12, fontWeight: '600', marginTop: 2 },
});
