// P0 app flags — onboarding/login state persisted locally via AsyncStorage.
// No real authentication yet: signIn() just flips a local flag (HANDOFF: 인증은 P3).
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = '@alpha-twin/app-flags-v1';

interface AppFlags {
  onboardingDone: boolean;
  loggedIn: boolean;
}

interface AppState extends AppFlags {
  /** true once the persisted flags have been read from disk */
  ready: boolean;
  completeOnboarding: () => void;
  signIn: () => void;
  signOut: () => void;
}

const DEFAULT_FLAGS: AppFlags = { onboardingDone: false, loggedIn: false };

const AppStateContext = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [flags, setFlags] = useState<AppFlags>(DEFAULT_FLAGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => {
        if (alive && raw) setFlags({ ...DEFAULT_FLAGS, ...JSON.parse(raw) });
      })
      .catch(() => {}) // storage failure → in-memory defaults (onboarding shows again)
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback((patch: Partial<AppFlags>) => {
    setFlags(prev => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo<AppState>(
    () => ({
      ...flags,
      ready,
      completeOnboarding: () => update({ onboardingDone: true }),
      signIn: () => update({ loggedIn: true }),
      signOut: () => update({ loggedIn: false }),
    }),
    [flags, ready, update],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used inside <AppStateProvider>');
  return ctx;
}
