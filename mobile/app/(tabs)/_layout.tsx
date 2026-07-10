import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/lib/colors';
import { useAuth } from '../../src/lib/AuthContext';
import { hasAnyCaptureModule } from '../../src/lib/modules';
import api from '../../src/lib/api';
import { getActiveSignOn, clearActiveSignOn, onSignOnChange, ActiveSignOn } from '../../src/lib/signon';

export default function TabLayout() {
  const { modules, isPreviewing, previewedRole } = useAuth();

  // v160.0.22 — REMOVED the "queueCount" badge from the Home tab.
  // Previous behaviour: on mount we fetched `/email/outbox?status=queued&mine=true`
  // and stamped that number as a red badge on the HOME tab icon. That was
  // wrong for two reasons:
  //   (1) The count represents queued OUTBOX items — not anything a worker
  //       needs to action from Home. The Outbox tab is the correct surface.
  //   (2) Workers reported the "2" as confusing: nothing on Home relates to it.
  // Removing the badge entirely. If we need per-tab unread indicators in future,
  // Outbox will get its own count-derived badge.

  const showCapture = hasAnyCaptureModule(modules);

  const [activeSignOn, setActiveSignOnState] = useState<ActiveSignOn | null>(null);

  useEffect(() => {
    const check = async () => setActiveSignOnState(await getActiveSignOn());
    check();
    return onSignOnChange(check);
  }, []);

  const handleSignOff = () => {
    Alert.alert('Sign off?', `Sign off from ${activeSignOn?.site_name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign off', style: 'destructive', onPress: async () => {
          try {
            await api.post('/me/signoff-active');
            await clearActiveSignOn();
          } catch (e: any) {
            Alert.alert('Error', e?.response?.data?.detail || e.message);
          }
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {isPreviewing && (
        <View testID="preview-ribbon" style={rs.ribbon}>
          <Ionicons name="eye" size={12} color="#fff" />
          <Text style={rs.ribbonText}>PREVIEW MODE · {(previewedRole || 'unknown').toUpperCase()}</Text>
        </View>
      )}

      {activeSignOn && modules.sign_on && (
        <TouchableOpacity testID="signoff-banner" style={rs.signoffBanner} onPress={handleSignOff} activeOpacity={0.8}>
          <Ionicons name="location" size={14} color="#fff" />
          <Text style={rs.signoffText} numberOfLines={1}>
            ON-SITE: {activeSignOn.site_name.toUpperCase()}
          </Text>
          <View style={rs.signoffBtn}>
            <Ionicons name="log-out" size={12} color="#fff" />
            <Text style={rs.signoffBtnText}>SIGN OFF</Text>
          </View>
        </TouchableOpacity>
      )}

      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: Colors.orange,
          tabBarInactiveTintColor: Colors.textSecondary,
          tabBarStyle: {
            // v160.0.21 — Distinct darker shade + subtle top border so tab
            // icons pop against screen content.
            backgroundColor: Colors.surfaceDark,
            borderTopColor: Colors.borderMuted,
            borderTopWidth: 1,
            height: 64,
            paddingBottom: 8,
            paddingTop: 6,
          },
          tabBarLabelStyle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
        }}
      >
        <Tabs.Screen
          name="dashboard"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="qr-signon"
          options={{
            title: 'QR Scan',
            tabBarIcon: ({ color, size }) => <Ionicons name="qr-code" size={size} color={color} />,
            href: modules.sign_on ? undefined : null,
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
            title: 'Fleet',
            tabBarIcon: ({ color, size }) => <Ionicons name="car" size={size} color={color} />,
            href: modules.plant_vehicles ? undefined : null,
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
    </View>
  );
}

const rs = StyleSheet.create({
  ribbon: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.surfaceLight, paddingVertical: 5, paddingHorizontal: 12,
  },
  ribbonText: { fontSize: 10, fontWeight: '700', color: Colors.orange, letterSpacing: 1 },
  signoffBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.orange, paddingVertical: 10, paddingHorizontal: 16,
  },
  signoffText: { flex: 1, fontSize: 11, fontWeight: '700', color: '#fff', letterSpacing: 0.8 },
  signoffBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.25)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
  },
  signoffBtnText: { fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
});
