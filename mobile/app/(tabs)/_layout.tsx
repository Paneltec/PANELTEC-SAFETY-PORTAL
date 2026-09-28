/**
 * Phase 4 — Tab layout.
 * 5 tabs: Home · Capture · QR Sign-On · My Work · Profile
 */
import React from 'react';
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TAB_ACTIVE = '#2C6BFF';
const TAB_INACTIVE = '#94A3B8';
const TAB_BAR_BG = '#FFFFFF';
const TAB_BAR_BORDER = '#E5E7EB';

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
      sceneContainerStyle={{ backgroundColor: '#F8FAFC' }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: TAB_ACTIVE,
        tabBarInactiveTintColor: TAB_INACTIVE,
        tabBarStyle: {
          backgroundColor: TAB_BAR_BG,
          borderTopColor: TAB_BAR_BORDER,
          borderTopWidth: 1,
          paddingBottom: bottomPad,
          paddingTop: 6,
          height: 60 + bottomPad,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name={focused ? 'home' : 'home-outline'} color={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="capture"
        options={{
          title: 'Capture',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name={focused ? 'add-circle' : 'add-circle-outline'} color={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="qr-scan"
        options={{
          title: 'QR Sign-On',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name={focused ? 'qr-code' : 'qr-code-outline'} color={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="my-work"
        options={{
          title: 'My Work',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name={focused ? 'briefcase' : 'briefcase-outline'} color={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name={focused ? 'person' : 'person-outline'} color={color} size={24} />
          ),
        }}
      />
      {/* Hide old tabs from nav */}
      <Tabs.Screen name="forms" options={{ href: null }} />
      <Tabs.Screen name="fleet" options={{ href: null }} />
      <Tabs.Screen name="docs" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  );
}
