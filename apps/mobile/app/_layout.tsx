import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { fontAssets, markFontsReady } from '@/lib/fonts';
import { AppStateProvider } from '@/lib/appState';
import { colors } from '@/src/theme';

export { ErrorBoundary } from 'expo-router';

// Keep the native splash visible until fonts are ready
// (avoids a flash of system fonts / white background).
SplashScreen.preventAutoHideAsync();

// Dark navy theme everywhere — prevents white flashes during transitions.
const AlphaTwinTheme: typeof DarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.bg,
    card: colors.panelSolid,
    text: colors.ink,
    border: colors.line,
    notification: colors.accent,
  },
};

export default function RootLayout() {
  const [loaded, error] = useFonts(fontAssets);

  useEffect(() => {
    if (loaded) markFontsReady(true);
    if (error) {
      // Font load failure → keep going with system fonts (font() returns undefined).
      console.warn('[alpha-twin] custom fonts failed to load, using system fallback:', error);
    }
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <AppStateProvider>
      <ThemeProvider value={AlphaTwinTheme}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: 'fade',
          }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="auth/login" />
          <Stack.Screen name="auth/interests" />
          <Stack.Screen name="(tabs)" />
        </Stack>
      </ThemeProvider>
    </AppStateProvider>
  );
}
