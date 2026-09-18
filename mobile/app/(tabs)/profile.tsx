/**
 * Profile — v58.13.132dc
 * Wired to GET /api/auth/me (real endpoint). Falls back to stored session.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import Wordmark from '../../src/components/Wordmark';
import { getStoredUser, getStoredRoleLabel, clearSession, isPreviewSession } from '../../src/services/auth';
import { authGet } from '../../src/services/apiClient';
import { MOBILE_BUNDLE_VERSION } from '../../src/lib/version';

interface MeResponse {
  id: string;
  name: string;
  email: string;
  role: string;
  role_id: string;
  org_id: string;
  activation_status: string;
  company_id?: string;
  created_at?: string;
  effective_permissions?: Record<string, Record<string, boolean>>;
  [key: string]: unknown;
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [roleLabel, setRoleLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [dataSource, setDataSource] = useState<'api' | 'stored' | 'none'>('none');

  const loadProfile = useCallback(async () => {
    setLoading(true);

    // Try real /api/auth/me first
    const res = await authGet<MeResponse>('/api/auth/me');
    if (res.ok) {
      setUser(res.data);
      setDataSource('api');
      // In preview mode the stored role label is stale (belongs to the admin,
      // not the previewed worker) — always use the API response instead.
      if (isPreviewSession()) {
        setRoleLabel(res.data.role_label || res.data.role_id || res.data.role || '');
      } else {
        const rl = await getStoredRoleLabel();
        setRoleLabel(rl || res.data.role_label || res.data.role_id || res.data.role || '');
      }
    } else if ('expired' in res && res.expired) {
      await clearSession();
      router.replace('/(auth)/pin-entry');
      return;
    } else {
      // Fall back to stored session data
      const storedUser = await getStoredUser();
      if (storedUser?.name) {
        setUser(storedUser);
        setDataSource('stored');
      } else {
        setDataSource('none');
      }
      if (isPreviewSession()) {
        setRoleLabel(storedUser?.role_label || storedUser?.role_id || storedUser?.role || '');
      } else {
        const rl = await getStoredRoleLabel();
        setRoleLabel(rl || storedUser?.role_label || storedUser?.role_id || storedUser?.role || '');
      }
    }
    setLoading(false);
  }, [router]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const handleLogout = useCallback(() => {
    Alert.alert('Sign Out', 'Your device stays provisioned — only your session is cleared.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await clearSession();
          router.replace('/(auth)/pin-entry');
        },
      },
    ]);
  }, [router]);

  const initials = user?.name
    ? user.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?';
  const fullName = user?.name || 'Unknown User';
  const userRole = roleLabel || user?.role_id || user?.role || user?.position || 'Worker';

  if (loading) {
    return (
      <View testID="profile-loading" style={[s.container, { paddingTop: insets.top, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={Colors.orange} />
      </View>
    );
  }

  return (
    <View testID="profile-screen" style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerRow}>
          <View style={s.avatarCircle}>
            <Text style={s.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text testID="profile-name" style={s.headerName} numberOfLines={1}>{fullName}</Text>
            <Text testID="profile-role" style={s.headerRole}>{userRole}</Text>
            {user?.email && <Text testID="profile-email" style={s.headerEmail}>{user.email}</Text>}
          </View>
        </View>
        {dataSource === 'api' && (
          <View style={s.liveBanner}>
            <Ionicons name="checkmark-circle" size={12} color={Colors.success} />
            <Text style={s.liveBannerText}>Live from /api/auth/me</Text>
          </View>
        )}
        {dataSource === 'stored' && (
          <View style={s.storedBanner}>
            <Ionicons name="phone-portrait-outline" size={12} color={Colors.warning} />
            <Text style={s.storedBannerText}>Showing cached session data</Text>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={s.scrollContent}>
        <ProfileRow
          testID="profile-nav-personal"
          icon="person-outline"
          iconColor="#3B82F6"
          iconBg="#DBEAFE"
          title="Personal Information"
          subtitle="Contact, address, emergency contacts"
          onPress={() => {}}
        />
        <ProfileRow
          testID="profile-nav-certs"
          icon="ribbon-outline"
          iconColor="#059669"
          iconBg="#D1FAE5"
          title="My Certifications"
          subtitle="Licences and competency cards"
          onPress={() => {}}
        />
        <ProfileRow
          testID="profile-nav-inductions"
          icon="checkmark-circle-outline"
          iconColor="#7C3AED"
          iconBg="#EDE9FE"
          title="My Inductions"
          subtitle="Site inductions & training records"
          onPress={() => {}}
        />
        <ProfileRow
          testID="profile-nav-idcard"
          icon="card-outline"
          iconColor="#0891B2"
          iconBg="#CFFAFE"
          title="Digital ID Card"
          subtitle="Worker ID with QR code"
          onPress={() => {}}
        />

        <View style={s.divider} />

        <ProfileRow
          testID="profile-nav-swms"
          icon="shield-checkmark-outline"
          iconColor="#2563EB"
          iconBg="#DBEAFE"
          title="My SWMS"
          subtitle="Safe Work Method Statements"
          onPress={() => {}}
        />
        <ProfileRow
          testID="profile-nav-settings"
          icon="settings-outline"
          iconColor="#64748B"
          iconBg="#E2E8F0"
          title="App Settings"
          subtitle="Notifications, language, theme"
          onPress={() => {}}
          badge="Soon"
        />

        <View style={s.divider} />

        {/* Sign Out */}
        <TouchableOpacity testID="profile-logout-btn" style={s.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color={Colors.error} />
          <Text style={s.logoutText}>Sign Out</Text>
        </TouchableOpacity>

        {/* Footer */}
        <View style={s.footer}>
          <Wordmark size="sm" color={Colors.border} showSubtitle={false} />
          <Text style={s.versionText}>{MOBILE_BUNDLE_VERSION}</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function ProfileRow({
  testID, icon, iconColor, iconBg, title, subtitle, onPress, badge,
}: {
  testID: string; icon: string; iconColor: string; iconBg: string;
  title: string; subtitle: string; onPress: () => void; badge?: string;
}) {
  return (
    <TouchableOpacity testID={testID} style={s.navRow} onPress={onPress} activeOpacity={0.7}>
      <View style={[s.navIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={20} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.navTitle}>{title}</Text>
        <Text style={s.navSub}>{subtitle}</Text>
      </View>
      {badge && (
        <View style={s.badgePill}>
          <Text style={s.badgeText}>{badge}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.navy },
  header: {
    backgroundColor: Colors.navy, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  avatarCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: Colors.white, fontSize: 22, fontWeight: '800' },
  headerName: { color: Colors.white, fontSize: 20, fontWeight: '700' },
  headerRole: { color: Colors.orange, fontSize: 13, fontWeight: '600', marginTop: 2, textTransform: 'capitalize' },
  headerEmail: { color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 4 },
  liveBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.successSoft, borderRadius: 10, padding: 8, marginTop: 12,
    borderWidth: 1, borderColor: '#10B98130',
  },
  liveBannerText: { fontSize: 10, fontWeight: '600', color: Colors.success, flex: 1 },
  storedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.warningSoft, borderRadius: 10, padding: 8, marginTop: 12,
    borderWidth: 1, borderColor: '#F59E0B30',
  },
  storedBannerText: { fontSize: 10, fontWeight: '600', color: Colors.warning, flex: 1 },

  scrollContent: { paddingBottom: 32 },

  navRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  navIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  navTitle: { fontSize: 15, fontWeight: '700', color: Colors.ink },
  navSub: { fontSize: 12, color: Colors.textTertiary, marginTop: 2 },
  badgePill: {
    backgroundColor: Colors.warningSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  badgeText: { fontSize: 10, fontWeight: '700', color: Colors.warning },

  divider: { height: 8, backgroundColor: Colors.navy },

  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 16, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: Colors.errorSoft, backgroundColor: Colors.surface,
  },
  logoutText: { fontSize: 15, fontWeight: '600', color: Colors.error },

  footer: { alignItems: 'center', marginTop: 24, gap: 6, opacity: 0.3 },
  versionText: { fontSize: 10, color: Colors.textTertiary },
});
