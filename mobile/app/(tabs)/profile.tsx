/**
 * Profile hub — navigation to 8 sections.
 * v58.13.132i — Restructured as nav hub with Personal Info, Certs, Inductions, ID Card.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '../../src/theme/colors';
import Wordmark from '../../src/components/Wordmark';
import { clearSession, getStoredRole, type RoleId } from '../../src/services/auth';
import { MOBILE_BUNDLE_VERSION } from '../../src/lib/version';
import {
  fetchWorkerProfile,
  type WorkerProfileResponse,
} from '../../src/services/profile';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const { data: profileData, isLoading, refetch } =
    useQuery<WorkerProfileResponse>({
      queryKey: ['worker-profile'],
      queryFn: fetchWorkerProfile,
      staleTime: 60_000,
      retry: 2,
    });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleLogout = useCallback(async () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out? Your device stays provisioned — only your session is cleared.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive',
        onPress: async () => {
          await clearSession();
          router.replace('/(auth)/pin-entry');
        },
      },
    ]);
  }, [router]);

  const worker = profileData?.worker;
  const certs = profileData?.certifications || [];
  const expiringCerts = certs.filter(c => c.status.key === 'expiring_soon' || c.status.key === 'expired');

  if (isLoading && !profileData) {
    return (
      <View testID="profile-loading" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.orange} />
          <Text style={s.loadingText}>Loading profile...</Text>
        </View>
      </View>
    );
  }

  const initials = worker
    ? `${(worker.first_name || '')[0] || ''}${(worker.last_name || '')[0] || ''}`.toUpperCase()
    : '?';
  const fullName = worker
    ? `${worker.first_name || ''} ${worker.last_name || ''}`.trim()
    : 'Unknown Worker';

  return (
    <View testID="profile-screen" style={[s.container, { paddingTop: insets.top }]}>
      {/* Navy header */}
      <View style={s.navyHeader}>
        <View style={s.headerRow}>
          <View style={s.avatarCircle}>
            <Text style={s.avatarText}>{initials}</Text>
          </View>
          <View style={s.headerInfo}>
            <Text testID="profile-name" style={s.headerName} numberOfLines={1}>{fullName}</Text>
            {worker?.position ? (
              <Text testID="profile-position" style={s.headerPosition} numberOfLines={1}>{worker.position}</Text>
            ) : null}
            {worker?.simpro_employee_id ? (
              <Text style={s.employeeId}>EMP #{worker.simpro_employee_id}</Text>
            ) : null}
          </View>
        </View>
        {worker?.company_label ? (
          <View testID="profile-company-chip" style={s.companyChip}>
            <Ionicons name="business-outline" size={12} color={Colors.orange} />
            <Text style={s.companyChipText}>{worker.company_label}</Text>
          </View>
        ) : null}
      </View>

      <ScrollView
        testID="profile-scroll"
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.orange} />}
      >
        {/* Nav rows */}
        <NavRow
          testID="profile-nav-personal"
          icon="person-outline"
          iconColor="#3B82F6"
          iconBg="#DBEAFE"
          title="Personal Information"
          subtitle="Contact, address, emergency contacts"
          onPress={() => router.push('/profile/personal' as never)}
        />
        <NavRow
          testID="profile-nav-certs"
          icon="ribbon-outline"
          iconColor="#059669"
          iconBg="#D1FAE5"
          title="My Certifications"
          subtitle={`${certs.length} certificates`}
          badge={expiringCerts.length > 0 ? String(expiringCerts.length) : undefined}
          badgeColor={Colors.error}
          onPress={() => router.push('/profile/certifications' as never)}
        />
        <NavRow
          testID="profile-nav-inductions"
          icon="checkmark-circle-outline"
          iconColor="#7C3AED"
          iconBg="#EDE9FE"
          title="My Inductions"
          subtitle="Site inductions & competencies"
          onPress={() => router.push('/profile/inductions' as never)}
        />
        <NavRow
          testID="profile-nav-idcard"
          icon="card-outline"
          iconColor="#0891B2"
          iconBg="#CFFAFE"
          title="My ID Card"
          subtitle="Digital worker ID with QR code"
          onPress={() => router.push('/profile/id-card' as never)}
        />

        <View style={s.divider} />

        <NavRow
          testID="profile-nav-fleet"
          icon="car-outline"
          iconColor={Colors.orange}
          iconBg={Colors.orangeSoft}
          title="My Fleet"
          subtitle="Assigned vehicles & equipment"
          onPress={() => router.push({ pathname: '/profile/fleet/[id]', params: { id: 'list' } } as never)}
        />
        <NavRow
          testID="profile-nav-swms"
          icon="document-text-outline"
          iconColor="#2563EB"
          iconBg="#DBEAFE"
          title="My SWMS"
          subtitle="Safe Work Method Statements"
          onPress={() => router.push({ pathname: '/profile/swms/[id]', params: { id: 'list' } } as never)}
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
          <Text style={s.version}>{MOBILE_BUNDLE_VERSION}</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ── Nav Row ──

function NavRow({
  testID, icon, iconColor, iconBg, title, subtitle, badge, badgeColor, onPress, disabled,
}: {
  testID: string; icon: string; iconColor: string; iconBg: string;
  title: string; subtitle: string;
  badge?: string; badgeColor?: string;
  onPress: () => void; disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      style={[s.navRow, disabled && s.navRowDisabled]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={disabled}
    >
      <View style={[s.navIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={20} color={iconColor} />
      </View>
      <View style={s.navInfo}>
        <Text style={s.navTitle}>{title}</Text>
        <Text style={s.navSubtitle}>{subtitle}</Text>
      </View>
      {badge && (
        <View style={[s.badge, { backgroundColor: (badgeColor || Colors.error) + '20' }]}>
          <Text style={[s.badgeText, { color: badgeColor || Colors.error }]}>{badge}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.navy },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: 'rgba(255,255,255,0.7)' },
  scroll: { paddingBottom: 32, paddingTop: 8 },

  navyHeader: {
    backgroundColor: Colors.navy,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  avatarCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.orange,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: Colors.white, fontSize: 22, fontWeight: '800' },
  headerInfo: { flex: 1, marginLeft: 14 },
  headerName: { color: Colors.white, fontSize: 22, fontWeight: '700' },
  headerPosition: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '500', marginTop: 2 },
  employeeId: { color: 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: '600', marginTop: 4, letterSpacing: 0.5 },
  companyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(249,115,22,0.15)', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6, marginTop: 12, alignSelf: 'flex-start',
  },
  companyChipText: { fontSize: 12, fontWeight: '700', color: Colors.orange },

  // Nav rows
  navRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 12, minHeight: 66,
    marginHorizontal: 16, marginBottom: 8, borderRadius: 14,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  navRowDisabled: { opacity: 0.5 },
  navIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  navInfo: { flex: 1 },
  navTitle: { fontSize: 15, fontWeight: '700', color: Colors.onCard },
  navSubtitle: { fontSize: 12, color: Colors.onCardMuted, marginTop: 2 },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  divider: { height: 8 },

  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 16, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: Colors.card, minHeight: 52,
  },
  logoutText: { fontSize: 15, fontWeight: '700', color: '#F87171' },

  footer: { alignItems: 'center', marginTop: 24, gap: 6, opacity: 0.3 },
  version: { fontSize: 10, color: Colors.textTertiary },
});
