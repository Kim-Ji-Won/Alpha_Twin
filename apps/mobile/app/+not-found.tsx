import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/src/theme';
import { font } from '@/lib/fonts';

export default function NotFoundScreen() {
  return (
    <View style={styles.container}>
      <Text style={[styles.title, { fontFamily: font('body', '800') }]}>
        존재하지 않는 화면입니다
      </Text>
      <Link href="/" style={styles.link} accessibilityLabel="홈으로 이동">
        <Text style={[styles.linkText, { fontFamily: font('body', '600') }]}>홈으로 이동</Text>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: colors.bg,
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.ink },
  link: { marginTop: 15, paddingVertical: 15 },
  linkText: { fontSize: 14, color: colors.accent, fontWeight: '600' },
});
