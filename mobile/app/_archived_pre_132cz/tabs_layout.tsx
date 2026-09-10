/**
 * Tab layout — v58.13.132ac
 * 3 tabs: Home, Forms, Profile
 * v58.13.132ac — Sites tab REMOVED. The Sites screen concept is
 * superseded by the daily-job SMS flow: a worker's "site" is derived
 * from their accepted `daily_job_assignment`, not from a Sites list.
 * The Toolbox screen stays hidden from the tab bar (opened via home
 * tile only) via `href: null`.
 */
import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.orange,
        tabBarInactiveTintColor: Colors.muted,
        tabBarStyle: {
          backgroundColor: Colors.tabBar,
          borderTopColor: Colors.border,
          paddingBottom: 4,
          height: 56,
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
        name="forms"
        options={{
          title: 'Forms',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'document-text' : 'document-text-outline'} size={24} color={color} />
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
      {/* v58.13.132ab — Toolbox screen; hidden from tab bar, opened via
          home tile only. `href: null` keeps expo-router from mounting a
          tab-bar entry for it. */}
      <Tabs.Screen
        name="toolbox"
        options={{
          href: null,
          title: 'Toolbox',
        }}
      />
      {/* v58.13.132ac — `sites` tab entry deleted. The physical file
          `(tabs)/sites.tsx` is also removed. If a stale route file
          reappears, expo-router will auto-mount it — `href: null`
          below is a defensive muzzle so a resurrection still hides it. */}
      <Tabs.Screen
        name="sites"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
