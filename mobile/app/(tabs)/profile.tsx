/**
 * Profile tab — M6 native shell over existing backend modules.
 * v58.13.132g — Header + Certifications + SWMS + Fleet + Payroll stub.
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
import { logout } from '../../src/services/auth';
import { MOBILE_BUNDLE_VERSION } from '../../src/lib/version';
import {
  fetchWorkerProfile, fetchMySwms, fetchFleetRegister,
  type WorkerProfileResponse, type Certification, type SwmsDoc, type FleetAsset,
} from '../../src/services/profile';

// ── Status pill colors ──
function certStatusColor(key: string): { bg: string; fg: string } {
  switch (key) {
    case 'valid':         return { bg: Colors.successSoft, fg: Colors.success };
    case 'expiring_soon': return { bg: Colors.warningSoft, fg: Colors.warning };
    case 'expired':       return { bg: Colors.errorSoft, fg: Colors.error };
    case 'missing_file':  return { bg: Colors.errorSoft, fg: Colors.error };
    default:              return { bg: Colors.borderLight, fg: Colors.textTertiary };
  }
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  // Fetch worker profile
  const { data: profileData, isLoading: profileLoading, refetch: refetchProfile } =
    useQuery<WorkerProfileResponse>({
      queryKey: ['worker-profile'],
      queryFn: fetchWorkerProfile,
      staleTime: 60_000,
      retry: 2,
    });

  const workerId = profileData?.worker?.id;

  // Fetch SWMS assigned to this worker
  const { data: swmsData, refetch: refetchSwms } = useQuery<SwmsDoc[]>({
    queryKey: ['my-swms', workerId],
    queryFn: () => fetchMySwms(workerId || ''),
    enabled: !!workerId,
    staleTime: 60_000,
  });

  // Fetch fleet register
  const { data: fleetData, refetch: refetchFleet } = useQuery<FleetAsset[]>({
    queryKey: ['my-fleet'],
    queryFn: fetchFleetRegister,
    staleTime: 60_000,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchProfile(), refetchSwms(), refetchFleet()]);
    setRefreshing(false);
  }, [refetchProfile, refetchSwms, refetchFleet]);

  const handleLogout = useCallback(async () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive',
        onPress: async () => { await logout(); router.replace('/'); },
      },
    ]);
  }, [router]);

  const worker = profileData?.worker;
  const certs = profileData?.certifications || [];
  const swms = swmsData || [];
  const fleet = fleetData || [];

  // Loading state
  if (profileLoading && !profileData) {
    return (
      <View testID="profile-loading" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.orange} />
          <Text style={s.loadingText}>Loading profile…</Text>
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
      {/* ── Navy header ── */}
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
        {/* ── Contact card ── */}
        {worker && (
          <View testID="profile-contact-card" style={s.card}>
            <Text style={s.cardTitle}>Contact Details</Text>
            {worker.email ? <InfoRow icon="mail-outline" label="Email" value={worker.email} /> : null}
            {worker.mobile ? <InfoRow icon="call-outline" label="Mobile" value={worker.mobile} /> : null}
            {worker.phone ? <InfoRow icon="call-outline" label="Phone" value={worker.phone} /> : null}
          </View>
        )}

        {/* ── My Certifications ── */}
        <SectionHeader
          testID="profile-certs-header"
          icon="ribbon-outline"
          title="My Certifications"
          count={certs.length}
        />
        {certs.length === 0 ? (
          <EmptyCard testID="profile-certs-empty" message="No certifications found" />
        ) : (
          certs.slice(0, 5).map((cert) => (
            <CertCard
              key={cert.id}
              cert={cert}
              onPress={() => router.push({ pathname: '/profile/certifications/[id]', params: { id: cert.id, workerId: workerId || '' } } as any)}
            />
          ))
        )}
        {certs.length > 5 && (
          <TouchableOpacity testID="profile-certs-see-all" style={s.seeAllBtn} onPress={() => {}}>
            <Text style={s.seeAllText}>See all {certs.length} certifications</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.orange} />
          </TouchableOpacity>
        )}

        {/* ── My SWMS ── */}
        <SectionHeader
          testID="profile-swms-header"
          icon="document-text-outline"
          title="My SWMS"
          count={swms.length}
        />
        {swms.length === 0 ? (
          <EmptyCard testID="profile-swms-empty" message="No SWMS assigned to you" />
        ) : (
          swms.slice(0, 5).map((doc) => (
            <SwmsCard
              key={doc.id}
              doc={doc}
              onPress={() => router.push({ pathname: '/profile/swms/[id]', params: { id: doc.id } } as any)}
            />
          ))
        )}

        {/* ── My Fleet ── */}
        <SectionHeader
          testID="profile-fleet-header"
          icon="car-outline"
          title="My Fleet"
          count={fleet.length}
        />
        {fleet.length === 0 ? (
          <EmptyCard testID="profile-fleet-empty" message="No fleet assets available" />
        ) : (
          fleet.slice(0, 5).map((asset) => (
            <FleetCard
              key={asset.id}
              asset={asset}
              onPress={() => router.push({ pathname: '/profile/fleet/[id]', params: { id: asset.id } } as any)}
            />
          ))
        )}
        {fleet.length > 5 && (
          <TouchableOpacity testID="profile-fleet-see-all" style={s.seeAllBtn} onPress={() => {}}>
            <Text style={s.seeAllText}>See all {fleet.length} assets</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.orange} />
          </TouchableOpacity>
        )}

        {/* ── Payroll Stub (MOCKED) ── */}
        <SectionHeader
          testID="profile-payroll-header"
          icon="wallet-outline"
          title="Payroll"
          count={0}
          badge="Coming Soon"
        />
        <View testID="profile-payroll-stub" style={s.card}>
          <PayrollRow icon="document-outline" label="Latest Payslip" value="—" />
          <PayrollRow icon="calendar-outline" label="Leave Balance" value="—" />
          <PayrollRow icon="time-outline" label="Book Time Off" value="—" />
          <View style={s.mockedBanner}>
            <Ionicons name="information-circle-outline" size={14} color={Colors.info} />
            <Text style={s.mockedText}>Payroll integration coming in a future release</Text>
          </View>
        </View>

        {/* ── Sign Out ── */}
        <TouchableOpacity testID="profile-logout-btn" style={s.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color={Colors.error} />
          <Text style={s.logoutText}>Sign Out</Text>
        </TouchableOpacity>

        {/* ── Footer ── */}
        <View style={s.footer}>
          <Wordmark size="sm" color={Colors.border} showSubtitle={false} />
          <Text style={s.version}>{MOBILE_BUNDLE_VERSION}</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ── Sub-components ──

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={s.infoRow}>
      <Ionicons name={icon as any} size={16} color={Colors.textTertiary} />
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function SectionHeader({ testID, icon, title, count, badge }: {
  testID: string; icon: string; title: string; count: number; badge?: string;
}) {
  return (
    <View testID={testID} style={s.sectionRow}>
      <Ionicons name={icon as any} size={18} color={Colors.orange} />
      <Text style={s.sectionTitle}>{title}</Text>
      {badge ? (
        <View style={s.comingSoonBadge}>
          <Text style={s.comingSoonText}>{badge}</Text>
        </View>
      ) : (
        <View style={s.countBadge}>
          <Text style={s.countText}>{count}</Text>
        </View>
      )}
    </View>
  );
}

function EmptyCard({ testID, message }: { testID: string; message: string }) {
  return (
    <View testID={testID} style={s.emptyCard}>
      <Ionicons name="folder-open-outline" size={24} color={Colors.textTertiary} />
      <Text style={s.emptyText}>{message}</Text>
    </View>
  );
}

function CertCard({ cert, onPress }: { cert: Certification; onPress: () => void }) {
  const color = certStatusColor(cert.status.key);
  return (
    <TouchableOpacity testID={`cert-card-${cert.id}`} style={s.listCard} onPress={onPress} activeOpacity={0.7}>
      <View style={s.listCardLeft}>
        <View style={[s.statusDot, { backgroundColor: color.fg }]} />
        <View style={s.listCardInfo}>
          <Text style={s.listCardTitle} numberOfLines={1}>{cert.name}</Text>
          {cert.issuer ? <Text style={s.listCardSub} numberOfLines={1}>{cert.issuer}</Text> : null}
        </View>
      </View>
      <View style={s.listCardRight}>
        <View style={[s.statusPill, { backgroundColor: color.bg }]}>
          <Text style={[s.statusPillText, { color: color.fg }]}>{cert.status.label}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
      </View>
    </TouchableOpacity>
  );
}

function SwmsCard({ doc, onPress }: { doc: SwmsDoc; onPress: () => void }) {
  return (
    <TouchableOpacity testID={`swms-card-${doc.id}`} style={s.listCard} onPress={onPress} activeOpacity={0.7}>
      <View style={s.listCardLeft}>
        <View style={[s.iconCircle, { backgroundColor: Colors.infoSoft }]}>
          <Ionicons name="document-text" size={16} color={Colors.info} />
        </View>
        <View style={s.listCardInfo}>
          <Text style={s.listCardTitle} numberOfLines={1}>{doc.title}</Text>
          {doc.code ? <Text style={s.listCardSub} numberOfLines={1}>{doc.code} {doc.version || ''}</Text> : null}
        </View>
      </View>
      <View style={s.listCardRight}>
        <View style={[s.statusPill, { backgroundColor: doc.status === 'approved' ? Colors.successSoft : Colors.warningSoft }]}>
          <Text style={[s.statusPillText, { color: doc.status === 'approved' ? Colors.success : Colors.warning }]}>
            {(doc.status || 'draft').charAt(0).toUpperCase() + (doc.status || 'draft').slice(1)}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
      </View>
    </TouchableOpacity>
  );
}

function FleetCard({ asset, onPress }: { asset: FleetAsset; onPress: () => void }) {
  const label = asset.name || asset.rego_serial || asset.id.slice(0, 8);
  const detail = [asset.make, asset.model].filter(Boolean).join(' ') || asset.kind || '';
  return (
    <TouchableOpacity testID={`fleet-card-${asset.id}`} style={s.listCard} onPress={onPress} activeOpacity={0.7}>
      <View style={s.listCardLeft}>
        <View style={[s.iconCircle, { backgroundColor: Colors.orangeSoft }]}>
          <Ionicons name="car" size={16} color={Colors.orange} />
        </View>
        <View style={s.listCardInfo}>
          <Text style={s.listCardTitle} numberOfLines={1}>{label}</Text>
          <Text style={s.listCardSub} numberOfLines={1}>{detail}</Text>
        </View>
      </View>
      <View style={s.listCardRight}>
        {asset.odo_km != null && (
          <Text style={s.meterText}>{Math.round(asset.odo_km).toLocaleString()} km</Text>
        )}
        {asset.hours_meter != null && (
          <Text style={s.meterText}>{Math.round(asset.hours_meter).toLocaleString()} hrs</Text>
        )}
        <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
      </View>
    </TouchableOpacity>
  );
}

function PayrollRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={s.payrollRow}>
      <Ionicons name={icon as any} size={18} color={Colors.textTertiary} />
      <Text style={s.payrollLabel}>{label}</Text>
      <Text style={s.payrollValue}>{value}</Text>
    </View>
  );
}

// ── Styles ──
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  scroll: { paddingBottom: 32 },

  // ── Navy header ──
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
  companyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(249,115,22,0.15)', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6, marginTop: 12, alignSelf: 'flex-start',
  },
  companyChipText: { fontSize: 12, fontWeight: '700', color: Colors.orange },

  // ── Cards ──
  card: {
    backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginHorizontal: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: Colors.ink, marginBottom: 12 },

  // ── Info rows ──
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  infoLabel: { fontSize: 12, color: Colors.textTertiary, width: 60 },
  infoValue: { fontSize: 14, color: Colors.ink, fontWeight: '500', flex: 1 },

  // ── Section headers ──
  sectionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, marginTop: 20, marginBottom: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.ink, flex: 1 },
  countBadge: {
    backgroundColor: Colors.border, borderRadius: 10,
    minWidth: 24, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  countText: { fontSize: 11, fontWeight: '700', color: Colors.textTertiary },
  comingSoonBadge: {
    backgroundColor: Colors.orangeSoft, borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  comingSoonText: { fontSize: 10, fontWeight: '700', color: Colors.orange },

  // ── List cards ──
  listCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14,
    marginHorizontal: 16, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  listCardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 },
  listCardInfo: { flex: 1 },
  listCardTitle: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  listCardSub: { fontSize: 12, color: Colors.textTertiary, marginTop: 2 },
  listCardRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusPillText: { fontSize: 11, fontWeight: '600' },
  iconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  meterText: { fontSize: 11, color: Colors.textTertiary, fontWeight: '500' },

  // ── Empty ──
  emptyCard: {
    alignItems: 'center', padding: 24, gap: 8, marginHorizontal: 16,
    backgroundColor: Colors.surface, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed',
  },
  emptyText: { fontSize: 13, color: Colors.textTertiary },

  // ── See all ──
  seeAllBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 10, marginHorizontal: 16,
  },
  seeAllText: { fontSize: 13, fontWeight: '600', color: Colors.orange },

  // ── Payroll stub ──
  payrollRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  payrollLabel: { fontSize: 14, color: Colors.ink, flex: 1 },
  payrollValue: { fontSize: 14, fontWeight: '600', color: Colors.textTertiary },
  mockedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.infoSoft, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, marginTop: 12,
  },
  mockedText: { fontSize: 12, color: Colors.info, fontWeight: '500' },

  // ── Logout ──
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 24, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: Colors.errorSoft, backgroundColor: Colors.surface,
  },
  logoutText: { fontSize: 15, fontWeight: '600', color: Colors.error },

  // ── Footer ──
  footer: { alignItems: 'center', marginTop: 24, gap: 6, opacity: 0.3 },
  version: { fontSize: 10, color: Colors.textTertiary },
});
