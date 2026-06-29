import React, { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/lib/colors';
import { useAuth } from '../../src/lib/AuthContext';
import { hasAnyCaptureModule } from '../../src/lib/modules';
import api from '../../src/lib/api';

export default function TabLayout() {
  const { modules } = useAuth();
  const [queueCount, setQueueCount] = useState(0);

  useEffect(() => {
    api.get('/email/outbox', { params: { status: 'queued', mine: 'true' } })
      .then(({ data }) => setQueueCount(data?.count ?? data?.items?.length ?? 0))
      .catch(() => {});
  }, []);

  const showCapture = hasAnyCaptureModule(modules);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.blue,
        tabBarInactiveTintColor: Colors.textTertiary,
        tabBarStyle: {
          backgroundColor: Colors.white,
          borderTopColor: Colors.border,
          height: 60,
          paddingBottom: 8,
          paddingTop: 4,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      {/* Home — always visible */}
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
          tabBarBadge: queueCount > 0 ? queueCount : undefined,
          tabBarBadgeStyle: queueCount > 0 ? { backgroundColor: Colors.violet, fontSize: 10, minWidth: 18, height: 18, lineHeight: 18 } : undefined,
        }}
      />

      {/* Capture — show if any capture module is on */}
      <Tabs.Screen
        name="capture"
        options={{
          title: 'Capture',
          tabBarIcon: ({ color, size }) => <Ionicons name="add-circle" size={size} color={color} />,
          href: showCapture ? undefined : null,
        }}
      />

      {/* QR Sign-On — gated by sign_on module */}
      <Tabs.Screen
        name="qr-signon"
        options={{
          title: 'QR Sign-On',
          tabBarIcon: ({ color, size }) => <Ionicons name="qr-code" size={size} color={color} />,
          href: modules.sign_on ? undefined : null,
        }}
      />

      {/* Outbox — always visible (not module-gated, it's infra) */}
      <Tabs.Screen
        name="outbox"
        options={{
          title: 'Outbox',
          tabBarIcon: ({ color, size }) => <Ionicons name="mail" size={size} color={color} />,
        }}
      />

      {/* Vehicles — gated by plant_vehicles */}
      <Tabs.Screen
        name="vehicles"
        options={{
          title: 'Vehicles',
          tabBarIcon: ({ color, size }) => <Ionicons name="car" size={size} color={color} />,
          href: modules.plant_vehicles ? undefined : null,
        }}
      />

      {/* My Work — always visible */}
      <Tabs.Screen
        name="my-work"
        options={{
          title: 'My Work',
          tabBarIcon: ({ color, size }) => <Ionicons name="briefcase" size={size} color={color} />,
        }}
      />

      {/* Profile — always visible (never hide) */}
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" size={size} color={color} />,
        }}
      />

      {/* Hidden tabs — accessible via routes but not shown in tab bar */}
      <Tabs.Screen name="compliance" options={{ href: null }} />
      <Tabs.Screen
        name="ask"
        options={{
          href: modules.ask_intel ? undefined : null,
          title: 'Ask AI',
          tabBarIcon: ({ color, size }) => <Ionicons name="sparkles" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
