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

  // v160.3.0-adjust — REMOVED the Outbox tab entirely. It surfaced
  // admin email-comms records (cert expiry reminders, licence
  // warnings, worker-certification blockers) which is admin/comms
  // territory and violates the "workers fill / admins review"
  // architectural rule. All email affordances have been stripped
  // from mobile in the same cycle (see EmailButton removals across
  // incident/hazard/inspection/pre-start/site-diary detail
  // screens). Backend `/email/*` endpoints are unchanged — the web
  // admin still owns email review.
  //
  // v160.0.22 — (superseded) REMOVED the "queueCount" badge from the
  // Home tab which fetched `/email/outbox?status=queued&mine=true`.
  // Kept the comment for historical context; the removal above
  // makes the outbox concept irrelevant on mobile.

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
          <Ionicons name="eye" size={12} color={Colors.imSurface} />
          <Text style={rs.ribbonText}>PREVIEW MODE · {(previewedRole || 'unknown').toUpperCase()}</Text>
        </View>
      )}

      {activeSignOn && modules.sign_on && (
        <TouchableOpacity testID="signoff-banner" style={rs.signoffBanner} onPress={handleSignOff} activeOpacity={0.8}>
          <Ionicons name="location" size={14} color={Colors.imSurface} />
          <Text style={rs.signoffText} numberOfLines={1}>
            ON-SITE: {activeSignOn.site_name.toUpperCase()}
          </Text>
          <View style={rs.signoffBtn}>
            <Ionicons name="log-out" size={12} color={Colors.imSurface} />
            <Text style={rs.signoffBtnText}>SIGN OFF</Text>
          </View>
        </TouchableOpacity>
      )}

      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: Colors.brandTabActive,
          tabBarInactiveTintColor: Colors.brandTabInactive,
          tabBarStyle: {
            backgroundColor: Colors.brandTabBar,
            borderTopColor: Colors.borderLight,
            borderTopWidth: 1,
            height: 60,
            paddingBottom: 8,
            paddingTop: 6,
            elevation: 8,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -2 },
            shadowOpacity: 0.06,
            shadowRadius: 8,
          },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
        }}
      >
        <Tabs.Screen
          name="dashboard"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="qr-signon"
          options={{
            title: 'QR Scan',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="qr-code" size={size} color={color} />
            ),
            href: modules.sign_on ? undefined : null,
          }}
        />
        {/* v160.3.0-adjust — Outbox tab removed. `(tabs)/outbox.tsx`
            deleted in the same cycle. Any future accidental deep-link
            to `/outbox` will hit the expo-router 404 which is the
            desired behaviour. */}
        <Tabs.Screen
          name="vehicles"
          options={{
            title: 'Fleet',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="car" size={size} color={color} />
            ),
            href: modules.plant_vehicles ? undefined : null,
          }}
        />
        {/* v160.3.0-adjust — "My Work" tab removed. It exposed lists
            of SUBMITTED incidents/inspections which is admin-review
            territory (web admin), violating the "workers fill /
            admins review" architectural rule. Drafts already live in
            Outbox — nothing needed migrating. Referenced screen
            (`(tabs)/my-work.tsx`) deleted in the same cycle. */}
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="person-circle" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen name="compliance" options={{ href: null }} />
        <Tabs.Screen
          name="ask"
          options={{
            href: modules.ask_intel ? undefined : null,
            title: 'Ask AI',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="sparkles" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}

const rs = StyleSheet.create({
  ribbon: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#EFF6FF', paddingVertical: 5, paddingHorizontal: 12,
  },
  ribbonText: { fontSize: 10, fontWeight: '700', color: Colors.orange, letterSpacing: 1 },
  signoffBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.orange, paddingVertical: 10, paddingHorizontal: 16,
  },
  signoffText: { flex: 1, fontSize: 11, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.8 },
  signoffBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.15)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
  },
  signoffBtnText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 },
});
