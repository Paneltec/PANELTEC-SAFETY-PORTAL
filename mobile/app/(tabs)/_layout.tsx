/**
 * Tabs layout — 5-tab bottom nav.
 * Home / Sites / Report / Pre-Start / Profile
 */
import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';

type TabIcon = {
  name: keyof typeof Ionicons.glyphMap;
  focused: boolean;
};

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.tabActive,
        tabBarInactiveTintColor: Colors.tabInactive,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopWidth: 1,
          borderTopColor: Colors.border,
          height: 88,
          paddingBottom: 28,
          paddingTop: 8,
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
            <Ionicons name={focused ? 'home' : 'home-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="sites"
        options={{
          title: 'Sites',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'location' : 'location-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="report"
        options={{
          title: 'Report',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'warning' : 'warning-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="prestart"
        options={{
          title: 'Pre-Start',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'clipboard' : 'clipboard-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
