import React, { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/lib/colors';
import { useAuth } from '../../src/lib/AuthContext';
import { hasAnyCaptureOpen, canDo } from '../../src/lib/permissions';
import api from '../../src/lib/api';

export default function TabLayout() {
  const { perms } = useAuth();
  const showCapture = hasAnyCaptureOpen(perms);
  const [queueCount, setQueueCount] = useState(0);

  useEffect(() => {
    api.get('/email/outbox', { params: { status: 'queued', mine: 'true' } })
      .then(({ data }) => setQueueCount(data?.count ?? data?.items?.length ?? 0))
      .catch(() => {});
  }, []);

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
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
          tabBarBadge: queueCount > 0 ? queueCount : undefined,
          tabBarBadgeStyle: queueCount > 0 ? { backgroundColor: Colors.violet, fontSize: 10, minWidth: 18, height: 18, lineHeight: 18 } : undefined,
        }}
      />
      <Tabs.Screen
        name="capture"
        options={{
          title: 'Capture',
          tabBarIcon: ({ color, size }) => <Ionicons name="add-circle" size={size} color={color} />,
          href: showCapture ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="qr-signon"
        options={{
          title: 'QR Sign-On',
          tabBarIcon: ({ color, size }) => <Ionicons name="qr-code" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="outbox"
        options={{
          title: 'Outbox',
          tabBarIcon: ({ color, size }) => <Ionicons name="mail" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="vehicles"
        options={{
          title: 'Vehicles',
          tabBarIcon: ({ color, size }) => <Ionicons name="car" size={size} color={color} />,
          href: canDo(perms, 'vehicles', 'open') ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="my-work"
        options={{
          title: 'My Work',
          tabBarIcon: ({ color, size }) => <Ionicons name="briefcase" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" size={size} color={color} />,
        }}
      />
      {/* Hidden tabs — still accessible via routes but not shown in tab bar */}
      <Tabs.Screen name="compliance" options={{ href: null }} />
      <Tabs.Screen name="ask" options={{ href: null }} />
    </Tabs>
  );
}
