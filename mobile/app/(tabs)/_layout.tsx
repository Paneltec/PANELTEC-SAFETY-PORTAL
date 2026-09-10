/**
 * Tab bar — Option B design: Home · QR Scan · My Work · Profile.
 * Forms and Toolbox stay mounted (reachable from Home tiles) but are
 * hidden from the bar.
 */
import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';

type IconName = keyof typeof Ionicons.glyphMap;
const icon = (on: IconName, off: IconName) =>
  ({ color, focused }: { color: string; focused: boolean }) => (
    <Ionicons name={focused ? on : off} size={24} color={color} />
  );

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.tabActive,
        tabBarInactiveTintColor: Colors.tabInactive,
        tabBarStyle: {
          backgroundColor: Colors.tabBar,
          borderTopColor: '#2E5384',
          borderTopWidth: 1,
          height: 64,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: icon('home', 'home-outline') }} />
      <Tabs.Screen name="scan" options={{ title: 'QR Scan', tabBarIcon: icon('qr-code', 'qr-code-outline') }} />
      <Tabs.Screen name="my-work" options={{ title: 'My Work', tabBarIcon: icon('briefcase', 'briefcase-outline') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person-circle', 'person-circle-outline') }} />
      <Tabs.Screen name="forms" options={{ href: null, title: 'Forms' }} />
      <Tabs.Screen name="toolbox" options={{ href: null, title: 'Toolbox' }} />
      <Tabs.Screen name="sites" options={{ href: null }} />
    </Tabs>
  );
}
