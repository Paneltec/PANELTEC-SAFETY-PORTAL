/**
 * Profile — v58.13.132cz
 * ⚠️ MOCKED: /api/users/me returns 401. Uses stored session + mock fallback.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import Wordmark from '../../src/components/Wordmark';
import { getStoredUser, getStoredRoleLabel, clearSession } from '../../src/services/auth';
import { MOCK_USER_PROFILE } from '../../src/services/mockData';
import { MOBILE_BUNDLE_VERSION } from '../../src/lib/version';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [roleLabel, setRoleLabel] = useState('');
  const [usingMock, setUsingMock] = useState(false);

  const loadProfile = useCallback(async () => {
    const storedUser = await getStoredUser();
    const rl = await getStoredRoleLabel();
    if (storedUser?.name) {
      setUser(storedUser);
      setUsingMock(false);
    } else {
      setUser(MOCK_USER_PROFILE);
      setUsingMock(true);
    }
    setRoleLabel(rl || '');
  }, []);

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
            <Text testID="profile-role" style={s.headerRole}>{roleLabel || user?.position || 'Worker'}</Text>
            {user?.email && <Text style={s.headerEmail}>{user.email}</Text>}
          </View>
        </View>
        {usingMock && (
          <View style={s.mockBanner}>
            <Ionicons name="flask-outline" size={12} color="#DC2626" />
            <Text style={s.mockBannerText}>/api/users/me → 401. Using stored session data.</Text>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={s.scrollContent}>
        {/* Profile sections */}
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
          testID="profile-nav-fleet"
          icon="car-outline"
          iconColor={Colors.orange}
          iconBg={Colors.orangeSoft}
          title="My Fleet"
          subtitle="Assigned vehicles & equipment"
          onPress={() => {}}
        />
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
  headerRole: { color: Colors.orange, fontSize: 13, fontWeight: '600', marginTop: 2 },
  headerEmail: { color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 4 },
  mockBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FEE2E2', borderRadius: 10, padding: 8, marginTop: 12,
    borderWidth: 1, borderColor: '#FECACA',
  },
  mockBannerText: { fontSize: 10, fontWeight: '600', color: '#DC2626', flex: 1 },

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
