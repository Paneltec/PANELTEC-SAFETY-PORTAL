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
  const [queueCount, setQueueCount] = useState(0);

  useEffect(() => {
    api.get('/email/outbox', { params: { status: 'queued', mine: 'true' } })
      .then(({ data }) => setQueueCount(data?.count ?? data?.items?.length ?? 0))
      .catch(() => {});
  }, []);

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
    <View style={{ flex: 1 }}>
      {/* Preview-mode ribbon */}
      {isPreviewing && (
        <View testID="preview-ribbon" style={rs.ribbon}>
          <Ionicons name="eye" size={12} color="#fff" />
          <Text style={rs.ribbonText}>Preview mode · {previewedRole || 'unknown'}</Text>
        </View>
      )}

      {activeSignOn && modules.sign_on && (
        <TouchableOpacity testID="signoff-banner" style={rs.signoffBanner} onPress={handleSignOff} activeOpacity={0.8}>
          <Ionicons name="location" size={14} color="#fff" />
          <Text style={rs.signoffText} numberOfLines={1}>
            On-site: {activeSignOn.site_name}
          </Text>
          <View style={rs.signoffBtn}>
            <Ionicons name="log-out" size={12} color="#fff" />
            <Text style={rs.signoffBtnText}>Sign Off</Text>
          </View>
        </TouchableOpacity>
      )}

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

        {/* Outbox — always visible */}
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

        {/* Profile — always visible */}
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" size={size} color={color} />,
          }}
        />

        {/* Hidden tabs */}
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
    backgroundColor: '#334155', paddingVertical: 5, paddingHorizontal: 12,
  },
  ribbonText: { fontSize: 11, fontWeight: '600', color: '#fff', letterSpacing: 0.5 },
  signoffBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#EA580C', paddingVertical: 8, paddingHorizontal: 16,
  },
  signoffText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#fff' },
  signoffBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.2)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
  },
  signoffBtnText: { fontSize: 11, fontWeight: '700', color: '#fff' },
});
