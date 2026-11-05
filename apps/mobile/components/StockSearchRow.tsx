import { Pressable, StyleSheet, Text, View } from 'react-native';
import { font } from '@/lib/fonts';
import { colors } from '@/src/theme';
import { Stock } from '@/src/types';

export function StockSearchRow({ stock, onPress, divider = false }: {
  stock: Stock; onPress: () => void; divider?: boolean;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      accessibilityLabel={`${stock.name}, ${stock.symbol}, ${stock.sector}, 기업 트윈 열기`}
      style={({ pressed }) => [styles.row, divider && styles.divider, { opacity: pressed ? 0.7 : 1 }]}>
      <View style={styles.body}>
        <Text style={[styles.name, { fontFamily: font('body', '700') }]}>{stock.name}</Text>
        <Text style={[styles.meta, { fontFamily: font('mono', '500') }]}>{stock.symbol} · {stock.sector}</Text>
      </View>
      <Text style={[styles.score, { fontFamily: font('mono', '700') }]}>{stock.healthScore}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, minHeight: 48 },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  body: { flex: 1 },
  name: { fontSize: 14, color: colors.ink },
  meta: { fontSize: 11, color: colors.dim, marginTop: 3 },
  score: { fontSize: 15, color: colors.accent },
});
