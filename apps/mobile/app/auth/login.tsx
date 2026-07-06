// Frame 18 — 로그인/회원가입: 소셜 3종 + 이메일. P0에서는 모두 로컬 signIn 처리 (실인증 P3).
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { AppScreen } from '@/components/AppScreen';
import { BrandMark } from '@/components/BrandMark';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAppState } from '@/lib/appState';
import { font } from '@/lib/fonts';
import { colors } from '@/src/theme';

function AppleIcon() {
  return (
    <Svg width={15} height={15} viewBox="0 0 16 16">
      <Path
        fill={colors.ink}
        d="M11.5 8.3c0-1.6 1.3-2.4 1.4-2.4-.8-1.1-2-1.3-2.4-1.3-1-.1-2 .6-2.5.6s-1.3-.6-2.2-.6c-1.1 0-2.2.7-2.8 1.7-1.2 2-.3 5.1.9 6.8.6.8 1.2 1.7 2.1 1.7.9 0 1.2-.5 2.2-.5s1.3.5 2.2.5 1.5-.8 2-1.6c.6-.9.9-1.8.9-1.9 0 0-1.8-.7-1.8-3zM9.9 3.5c.5-.6.8-1.4.7-2.2-.7 0-1.5.5-2 1.1-.4.5-.8 1.3-.7 2.1.8.1 1.5-.4 2-1z"
      />
    </Svg>
  );
}

function KakaoIcon() {
  return (
    <Svg width={15} height={15} viewBox="0 0 16 16">
      <Path
        fill="#1a1a1a"
        d="M8 2C4.5 2 1.8 4.2 1.8 6.9c0 1.7 1.1 3.2 2.8 4.1l-.7 2.6c-.1.2.2.4.4.3l3.1-2.1c.2 0 .4 0 .6 0 3.5 0 6.2-2.2 6.2-4.9S11.5 2 8 2z"
      />
    </Svg>
  );
}

function MailIcon() {
  return (
    <Svg width={15} height={15} viewBox="0 0 16 16">
      <Rect x={2} y={3.5} width={12} height={9} rx={2} fill="none" stroke={colors.dim} strokeWidth={1.5} />
      <Path d="M2.5 5l5.5 4 5.5-4" fill="none" stroke={colors.dim} strokeWidth={1.5} />
    </Svg>
  );
}

interface SocialButtonProps {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  kakao?: boolean;
}

function SocialButton({ icon, label, onPress, kakao }: SocialButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.sbtn, kakao && styles.sbtnKakao, { opacity: pressed ? 0.8 : 1 }]}>
      {icon}
      <Text
        style={[
          styles.sbtnLabel,
          kakao && { color: '#1a1a1a' },
          { fontFamily: font('body', '700') },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function LoginRoute() {
  const router = useRouter();
  const { signIn } = useAppState();
  const [email, setEmail] = useState('');

  // P0: 모든 로그인 수단이 로컬 플래그만 세팅하고 관심 선택으로 이동
  const proceed = () => {
    signIn();
    router.replace('/auth/interests');
  };

  return (
    <AppScreen keyboardAvoid contentStyle={styles.content}>
      <BrandMark size={52} />
      <Text style={[styles.title, { fontFamily: font('body', '800') }]}>
        기업의 또 다른 모습을{'\n'}만나보세요
      </Text>
      <Text style={[styles.sub, { fontFamily: font('body', '500') }]}>
        계정 하나로 디지털 트윈, 투자 논제, 포트폴리오 분석이 동기화됩니다.
      </Text>

      <SocialButton icon={<AppleIcon />} label="Apple로 계속하기" onPress={proceed} />
      <SocialButton
        icon={<Text style={[styles.gMark, { fontFamily: font('body', '800') }]}>G</Text>}
        label="Google로 계속하기"
        onPress={proceed}
      />
      <SocialButton icon={<KakaoIcon />} label="카카오로 계속하기" onPress={proceed} kakao />

      <View style={styles.orsep}>
        <View style={styles.orline} />
        <Text style={[styles.orText, { fontFamily: font('body', '600') }]}>또는 이메일로</Text>
        <View style={styles.orline} />
      </View>

      <View style={styles.field}>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="name@email.com"
          placeholderTextColor={colors.dim}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="이메일 주소 입력"
          style={[styles.fieldInput, { fontFamily: font('body', '500') }]}
        />
        <MailIcon />
      </View>

      <PrimaryButton label="이메일로 시작하기" onPress={proceed} borderRadius={13} />

      <Text style={[styles.foot, { fontFamily: font('mono', '400') }]}>
        가입하면 이용약관과 개인정보 처리방침에 동의하게 됩니다.{'\n'}투자 자문이 아닌 분석 보조
        도구입니다.
      </Text>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 96, paddingHorizontal: 26 },
  title: {
    marginTop: 24,
    fontSize: 24,
    lineHeight: 31,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: colors.ink,
  },
  sub: { marginTop: 10, marginBottom: 30, fontSize: 14.5, lineHeight: 23, color: colors.mut },
  sbtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 48,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginBottom: 10,
  },
  sbtnKakao: { backgroundColor: 'rgba(250,225,0,0.9)', borderColor: 'transparent' },
  sbtnLabel: { fontSize: 14, fontWeight: '700', color: '#e2e9f5' },
  gMark: { fontSize: 15, fontWeight: '800', color: colors.ink },
  orsep: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16 },
  orline: { flex: 1, height: 1, backgroundColor: colors.line },
  orText: { fontSize: 11.5, color: colors.dim, fontWeight: '600' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 13,
    paddingHorizontal: 15,
    marginBottom: 10,
    minHeight: 48,
  },
  fieldInput: { flex: 1, fontSize: 14, color: colors.ink, paddingVertical: 13 },
  foot: {
    textAlign: 'center',
    marginTop: 18,
    fontSize: 11,
    lineHeight: 19,
    color: colors.dim,
  },
});
