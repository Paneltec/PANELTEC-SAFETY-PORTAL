import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getUser, signOut, initials } from '../../src/lib/auth';
import { Colors } from '../../src/lib/colors';
import { useAuth } from '../../src/lib/AuthContext';
import { useRouter } from 'expo-router';

const WORKSPACES = [
  { id: '751d9aeb-60ca-476f-b8db-c387144c59b7', name: 'Sydney Metro' },
  { id: 'c3d19584a94', name: 'Newcastle Depot' },
];

export default function ProfileScreen() {
  const { setAuth } = useAuth();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [activeWs, setActiveWs] = useState(WORKSPACES[0].id);

  useEffect(() => { getUser().then(setUser); }, []);

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out', style: 'destructive',
        onPress: async () => {
          await signOut();
          setAuth(false);
        },
      },
    ]);
  };

  const switchWorkspace = (wsId: string) => {
    setActiveWs(wsId);
    Alert.alert('Workspace switched', `Now viewing: ${WORKSPACES.find(w => w.id === wsId)?.name}`);
  };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView testID="profile-page" style={s.scroll} contentContainerStyle={s.content}>
        <Text style={s.overline}>PROFILE</Text>
        <Text style={s.heading}>My Profile</Text>

        {user && (
          <View testID="profile-card" style={s.profileCard}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{initials(user)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.profileName}>{user.name || 'User'}</Text>
              <Text style={s.profileEmail}>{user.email}</Text>
              <Text style={s.profileRole}>{(user.role || '').toUpperCase()}</Text>
            </View>
          </View>
        )}

        {/* Workspace switcher */}
        <Text style={s.sectionLabel}>WORKSPACE</Text>
        <View style={s.wsCard}>
          {WORKSPACES.map(ws => (
            <TouchableOpacity
              key={ws.id}
              testID={`ws-${ws.id}`}
              style={[s.wsRow, activeWs === ws.id && s.wsRowActive]}
              onPress={() => switchWorkspace(ws.id)}
              activeOpacity={0.7}
            >
              <View style={[s.wsRadio, activeWs === ws.id && s.wsRadioActive]}>
                {activeWs === ws.id && <View style={s.wsRadioInner} />}
              </View>
              <Text style={[s.wsName, activeWs === ws.id && s.wsNameActive]}>{ws.name}</Text>
              {activeWs === ws.id && (
                <View style={s.wsActiveBadge}>
                  <Text style={s.wsActiveText}>Active</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Settings links */}
        <Text style={s.sectionLabel}>SETTINGS</Text>
        <View style={s.section}>
          {[
            { label: 'Workers', icon: 'people' as const, route: '/workers' },
            { label: 'Certifications', icon: 'ribbon' as const, route: '/certifications' },
            { label: 'Organisation', icon: 'business' as const },
            { label: 'Integrations', icon: 'extension-puzzle' as const },
            { label: 'Users', icon: 'people-circle' as const, route: '/users' },
            { label: 'Compliance Hub', icon: 'shield-checkmark' as const, route: '/(tabs)/compliance' },
            { label: 'Ask Intelligence', icon: 'sparkles' as const, route: '/(tabs)/ask' },
          ].map((item) => (
            <TouchableOpacity key={item.label} testID={`settings-${item.label.toLowerCase().replace(/\s/g, '-')}`} style={s.row} activeOpacity={0.7}
              onPress={() => item.route ? router.push(item.route as any) : undefined}>
              <Ionicons name={item.icon} size={20} color={Colors.textSecondary} />
              <Text style={s.rowText}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity testID="sign-out-btn" style={s.signOutBtn} onPress={handleSignOut} activeOpacity={0.7}>
          <Ionicons name="log-out" size={20} color={Colors.red} />
          <Text style={s.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  overline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.blue },
  heading: { fontSize: 26, fontWeight: '700', color: Colors.ink, marginTop: 4, letterSpacing: -0.5, marginBottom: 20 },
  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 16, padding: 16, marginBottom: 20,
  },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.blue, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  profileName: { fontSize: 18, fontWeight: '600', color: Colors.ink },
  profileEmail: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  profileRole: { fontSize: 10, fontWeight: '700', color: Colors.blue, letterSpacing: 0.8, marginTop: 4 },
  sectionLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: Colors.textTertiary,
    marginBottom: 8, marginTop: 4,
  },
  wsCard: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 16, overflow: 'hidden', marginBottom: 20,
  },
  wsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  wsRowActive: { backgroundColor: Colors.blueSoft },
  wsRadio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  wsRadioActive: { borderColor: Colors.blue },
  wsRadioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.blue },
  wsName: { flex: 1, fontSize: 15, color: Colors.text },
  wsNameActive: { fontWeight: '600', color: Colors.blue },
  wsActiveBadge: { backgroundColor: Colors.mint, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  wsActiveText: { fontSize: 10, fontWeight: '700', color: Colors.emeraldDark },
  section: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 16, overflow: 'hidden', marginBottom: 20,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  rowText: { flex: 1, fontSize: 15, color: Colors.text },
  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#FFF5F5',
  },
  signOutText: { fontSize: 15, fontWeight: '600', color: Colors.red },
});
