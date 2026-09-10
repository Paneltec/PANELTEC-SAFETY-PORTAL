/**
 * Tab layout — v58.13.132di
 * 8 tabs: HOME · FORMS · QR SCAN · OUTBOX · FLEET · MY WORK · PROFILE · ASK AI
 */
import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';

function TabIcon({ name, focused, color, size }: {
  name: keyof typeof Ionicons.glyphMap;
  focused: boolean;
  color: string;
  size: number;
}) {
  return <Ionicons name={name} size={size} color={color} />;
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.orange,
        tabBarInactiveTintColor: Colors.slate400,
        tabBarStyle: {
          backgroundColor: Colors.white,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          paddingBottom: 6,
          paddingTop: 6,
          height: 64,
        },
        tabBarLabelStyle: {
          fontSize: 9,
          fontWeight: '700',
          letterSpacing: 0.3,
          textTransform: 'uppercase',
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon name={focused ? 'home' : 'home-outline'} focused={focused} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="forms"
        options={{
          title: 'Forms',
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon name={focused ? 'document-text' : 'document-text-outline'} focused={focused} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="qr-scan"
        options={{
          title: 'QR Scan',
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon name={focused ? 'qr-code' : 'qr-code-outline'} focused={focused} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="outbox"
        options={{
          title: 'Outbox',
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon name={focused ? 'cloud-upload' : 'cloud-upload-outline'} focused={focused} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="fleet"
        options={{
          title: 'Fleet',
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon name={focused ? 'car' : 'car-outline'} focused={focused} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="my-work"
        options={{
          title: 'My Work',
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon name={focused ? 'briefcase' : 'briefcase-outline'} focused={focused} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon name={focused ? 'person' : 'person-outline'} focused={focused} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="ask-ai"
        options={{
          title: 'Ask AI',
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon name={focused ? 'sparkles' : 'sparkles-outline'} focused={focused} color={color} size={22} />
          ),
        }}
      />
    </Tabs>
  );
}
