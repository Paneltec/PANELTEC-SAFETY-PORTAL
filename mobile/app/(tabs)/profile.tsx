/**
 * Phase 4 — Profile tab.
 * User info, role, workspace switcher, sign out.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { civilLogout, getStoredCivilUser } from '../../src/services/civilApi';

const BLUE = '#2C6BFF';
const RED = '#EF4444';
const BG = '#F8FAFC';
const INK = '#0F172A';
const MUTED = '#64748B';

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getStoredCivilUser().then(u => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const handleSignOut = useCallback(() => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await civilLogout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  }, [router]);

  const initials = user?.name
    ? user.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  if (loading) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <ActivityIndicator color={BLUE} size="large" style={{ marginTop: 80 }} />
      </View>
    );
  }

  return (
    <View testID="profile-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Profile</Text>
      </View>

      <ScrollView contentContainerStyle={s.scrollContent}>
        {/* User card */}
        <View testID="profile-user-card" style={s.userCard}>
          <View style={s.avatarBig}>
            <Text style={s.avatarBigText}>{initials}</Text>
          </View>
          <Text style={s.userName}>{user?.name || 'User'}</Text>
          <Text style={s.userEmail}>{user?.email || ''}</Text>
          <View style={s.rolePill}>
            <Text style={s.roleText}>{user?.role || user?.role_id || 'Worker'}</Text>
          </View>
        </View>

        {/* Info rows */}
        <View style={s.infoCard}>
          <View style={s.infoRow}>
            <Ionicons name="business-outline" size={18} color={MUTED} />
            <Text style={s.infoLabel}>Organization</Text>
            <Text style={s.infoValue}>{user?.org_id || 'Paneltec'}</Text>
          </View>
          <View style={s.divider} />
          <View style={s.infoRow}>
            <Ionicons name="id-card-outline" size={18} color={MUTED} />
            <Text style={s.infoLabel}>User ID</Text>
            <Text style={s.infoValue} numberOfLines={1}>{user?.id ? user.id.slice(0, 12) + '...' : '—'}</Text>
          </View>
          <View style={s.divider} />
          <View style={s.infoRow}>
            <Ionicons name="shield-checkmark-outline" size={18} color={MUTED} />
            <Text style={s.infoLabel}>Status</Text>
            <Text style={[s.infoValue, { color: '#10B981' }]}>
              {user?.activation_status || 'Active'}
            </Text>
          </View>
        </View>

        {/* Workspace switcher */}
        {user?.workspace_ids && user.workspace_ids.length > 0 && (
          <View style={s.wsCard}>
            <Text style={s.wsTitle}>Workspaces</Text>
            {user.workspace_ids.map((wsId: string, idx: number) => (
              <View key={wsId} testID={`profile-workspace-${idx}`} style={s.wsRow}>
                <Ionicons name="layers-outline" size={16} color={BLUE} />
                <Text style={s.wsText} numberOfLines={1}>{wsId}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Sign out */}
        <TouchableOpacity
          testID="profile-signout-btn"
          style={s.signOutBtn}
          onPress={handleSignOut}
          activeOpacity={0.7}
        >
          <Ionicons name="log-out-outline" size={20} color={RED} />
          <Text style={s.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    backgroundColor: '#FFFFFF', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: INK, letterSpacing: -0.5 },
  scrollContent: { padding: 16, paddingBottom: 32 },

  userCard: {
    alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16,
    padding: 24, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  avatarBig: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  avatarBigText: { fontSize: 24, fontWeight: '800', color: '#FFF' },
  userName: { fontSize: 20, fontWeight: '700', color: INK },
  userEmail: { fontSize: 14, color: MUTED, marginTop: 4 },
  rolePill: {
    backgroundColor: '#DBEAFE', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 5, marginTop: 10,
  },
  roleText: { fontSize: 12, fontWeight: '700', color: BLUE, textTransform: 'capitalize' },

  infoCard: {
    backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 18, marginBottom: 16,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16,
  },
  infoLabel: { fontSize: 14, fontWeight: '500', color: MUTED, flex: 1 },
  infoValue: { fontSize: 14, fontWeight: '600', color: INK },
  divider: { height: 1, backgroundColor: '#E5E7EB' },

  wsCard: {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18, marginBottom: 16,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  wsTitle: { fontSize: 14, fontWeight: '700', color: INK, marginBottom: 12 },
  wsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  wsText: { fontSize: 13, color: MUTED, flex: 1 },

  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1.5, borderColor: RED, borderRadius: 14,
    paddingVertical: 16, backgroundColor: '#FFF', marginTop: 8,
    minHeight: 56,
  },
  signOutText: { fontSize: 16, fontWeight: '600', color: RED },
});
