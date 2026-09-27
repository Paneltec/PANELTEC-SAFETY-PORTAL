/**
 * Tab bar — Home · Forms · Fleet · My Work · Settings.
 * QR Scan and Toolbox stay mounted (reachable from Home and Settings)
 * but are hidden from the bar.
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
      {/* Footer order: Home · Forms · Fleet · My Work · Settings */}
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: icon('home', 'home-outline') }} />
      <Tabs.Screen name="forms" options={{ title: 'Forms', tabBarIcon: icon('document-text', 'document-text-outline') }} />
      <Tabs.Screen name="fleet" options={{ title: 'Fleet', tabBarIcon: icon('car', 'car-outline') }} />
      <Tabs.Screen name="my-work" options={{ title: 'My Work', tabBarIcon: icon('briefcase', 'briefcase-outline') }} />
      {/* Route stays "profile" so existing links keep working; shown as Settings. */}
      <Tabs.Screen name="profile" options={{ title: 'Settings', tabBarIcon: icon('settings', 'settings-outline') }} />
      {/* Still reachable, just not in the footer. */}
      <Tabs.Screen name="scan" options={{ href: null, title: 'QR Scan' }} />
      <Tabs.Screen name="toolbox" options={{ href: null, title: 'Toolbox' }} />
      <Tabs.Screen name="sites" options={{ href: null }} />
    </Tabs>
  );
}
