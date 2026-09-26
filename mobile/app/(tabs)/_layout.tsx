/**
 * Tab layout — v58.13.132n5m3
 * 5 tabs: HOME · FORMS · FLEET · MY WORK · SETTINGS
 * .132n5m3 — Added MY WORK tab (light scaffold).
 * .132mc — Documents tab hidden (doc-library now web-only per admin cutover).
 * Haptic feedback on tab switch.
 * profile.tsx and docs.tsx kept in (tabs) but hidden via href: null.
 */
import React from 'react';
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../src/theme/colors';
import { lightHaptic } from '../../src/services/haptics';

function TabIcon({ name, color, size }: {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  size: number;
}) {
  return <Ionicons name={name} size={size} color={color} />;
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === 'android' ? Math.max(insets.bottom, 8) : insets.bottom + 4;

  return (
    <Tabs
      sceneContainerStyle={{ backgroundColor: Colors.navyLight }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.orange,
        tabBarInactiveTintColor: Colors.slate400,
        tabBarStyle: {
          backgroundColor: Colors.white,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          paddingBottom: bottomPad,
          paddingTop: 6,
          height: 56 + bottomPad,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 0.1,
        },
        tabBarItemStyle: {
          flex: 1,
          minWidth: 0,
        },
      }}
      screenListeners={{
        tabPress: () => { lightHaptic(); },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name={focused ? 'home' : 'home-outline'} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="forms"
        options={{
          title: 'Forms',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name={focused ? 'document-text' : 'document-text-outline'} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="fleet"
        options={{
          title: 'Fleet',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name={focused ? 'car' : 'car-outline'} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="my-work"
        options={{
          title: 'My Work',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name={focused ? 'briefcase' : 'briefcase-outline'} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="docs"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name={focused ? 'settings' : 'settings-outline'} color={color} size={22} />
          ),
        }}
      />
      {/* Profile kept as hidden route for deep links from Settings */}
      <Tabs.Screen name="profile" options={{ href: null }} />
    </Tabs>
  );
}
