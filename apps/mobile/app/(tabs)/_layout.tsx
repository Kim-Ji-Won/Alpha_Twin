import { Tabs } from 'expo-router';
import React from 'react';

import { BottomTabBar } from '@/components/BottomTabBar';
import { colors } from '@/src/theme';

// 하단 탭 5개 — src/constants/navigation.ts TABS와 1:1 (Home/Discover/Twin/Portfolio/AI)
export default function TabLayout() {
  return (
    <Tabs
      tabBar={props => <BottomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="discover" options={{ title: 'Discover' }} />
      <Tabs.Screen name="twin" options={{ title: 'Twin' }} />
      <Tabs.Screen name="portfolio" options={{ title: 'Portfolio' }} />
      <Tabs.Screen name="ai" options={{ title: 'AI' }} />
    </Tabs>
  );
}
