/**
 * Home screen — v58.13.132cz
 * Intelligence Briefing + Compliance list + Notification state + Signed On state.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import { getStoredUser, getStoredRoleLabel, getStoredJwt } from '../../src/services/auth';
import { MOCK_AI_BRIEFING, MOCK_COMPLIANCE_LIST, MOCK_AD_HOC_JOB } from '../../src/services/mockData';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

type ViewMode = 'home' | 'notification' | 'signed_on' | 'job_detail';

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState<any>(null);
  const [roleLabel, setRoleLabel] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('home');
  const [todayJob, setTodayJob] = useState<any>(null);
  const [jobLoading, setJobLoading] = useState(true);
  const [hasNotification, setHasNotification] = useState(false);

  const loadData = useCallback(async () => {
    const [u, rl] = await Promise.all([
      getStoredUser(),
      getStoredRoleLabel(),
    ]);
    setUser(u);
    setRoleLabel(rl || '');

    // Try real daily-jobs endpoint
    try {
      const jwt = await getStoredJwt();
      if (jwt) {
        const resp = await fetch(`${API}/api/mobile/daily-jobs/today`, {
          headers: { Authorization: `Bearer ${jwt}` },
        });
        if (resp.ok) {
          const data = await resp.json();
          setTodayJob(data.assignment);
        }
      }
    } catch {
      // silent — will show mock
    }
    setJobLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const greeting = user?.name ? `Hi, ${user.name.split(' ')[0]}` : 'Welcome';

  // ── Signed On view ──
  if (viewMode === 'signed_on') {
    return (
      <View testID="home-signed-on" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity testID="signed-on-back" onPress={() => setViewMode('home')} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.white} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Signed On</Text>
        </View>
        <ScrollView contentContainerStyle={s.scrollContent}>
          <View style={s.signedOnCard}>
            <View style={s.signedOnDot} />
            <Text style={s.signedOnLabel}>Currently signed on</Text>
          </View>
          <View style={s.siteCard}>
            <Ionicons name="location" size={20} color={Colors.orange} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.siteCardTitle}>Connector Park Drive</Text>
              <Text style={s.siteCardAddress}>19 Connector Park Drive, Kings Park NSW</Text>
            </View>
          </View>
          <View style={s.timeCard}>
            <View style={s.timeRow}>
              <Text style={s.timeLabel}>Signed on at</Text>
              <Text style={s.timeValue}>06:45 AM</Text>
            </View>
            <View style={s.timeDivider} />
            <View style={s.timeRow}>
              <Text style={s.timeLabel}>Duration</Text>
              <Text style={s.timeValue}>3h 22m</Text>
            </View>
          </View>
          <MockBadge />
          <TouchableOpacity testID="sign-off-btn" style={s.signOffBtn} onPress={() => setViewMode('home')}>
            <Ionicons name="log-out-outline" size={20} color={Colors.error} />
            <Text style={s.signOffText}>Sign Off Site</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ── Ad-hoc Job Detail view ──
  if (viewMode === 'job_detail') {
    const job = todayJob || MOCK_AD_HOC_JOB;
    return (
      <View testID="home-job-detail" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity testID="job-detail-back" onPress={() => setViewMode('home')} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.white} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Job Detail</Text>
        </View>
        <ScrollView contentContainerStyle={s.scrollContent}>
          <View style={s.jobCard}>
            <View style={[s.jobStatusPill, { backgroundColor: Colors.successSoft }]}>
              <Text style={[s.jobStatusText, { color: Colors.success }]}>
                {job.status === 'accepted' ? 'Accepted' : job.status || 'Pending'}
              </Text>
            </View>
            <Text style={s.jobTitle}>{job.title || job.site_name || 'Ad-hoc Assignment'}</Text>
            {job.site_name && (
              <View style={s.jobRow}>
                <Ionicons name="location-outline" size={16} color={Colors.textTertiary} />
                <Text style={s.jobRowText}>{job.site_name}</Text>
              </View>
            )}
            {job.site_address && (
              <View style={s.jobRow}>
                <Ionicons name="map-outline" size={16} color={Colors.textTertiary} />
                <Text style={s.jobRowText}>{job.site_address}</Text>
              </View>
            )}
            {(job.start_time || job.assigned_at) && (
              <View style={s.jobRow}>
                <Ionicons name="time-outline" size={16} color={Colors.textTertiary} />
                <Text style={s.jobRowText}>{job.start_time || new Date(job.assigned_at).toLocaleTimeString()}</Text>
              </View>
            )}
            {job.contact_name && (
              <View style={s.jobRow}>
                <Ionicons name="person-outline" size={16} color={Colors.textTertiary} />
                <Text style={s.jobRowText}>{job.contact_name} · {job.contact_phone}</Text>
              </View>
            )}
          </View>
          {job.notes && (
            <View style={s.notesCard}>
              <Text style={s.notesLabel}>Notes</Text>
              <Text style={s.notesText}>{job.notes}</Text>
            </View>
          )}
          {job._mocked && <MockBadge />}
        </ScrollView>
      </View>
    );
  }

  // ── Main Home view (with optional notification banner) ──
  return (
    <View testID="home-screen" style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.brandName}>PANELTEC GROUP</Text>
        <View style={s.headerTop}>
          <View style={{ flex: 1 }}>
            <Text testID="home-greeting" style={s.greeting}>{greeting}</Text>
            <Text testID="home-role-label" style={s.roleLabel}>{roleLabel || 'Field Worker'}</Text>
          </View>
          <TouchableOpacity
            testID="home-notification-btn"
            style={s.bellBtn}
            onPress={() => setHasNotification(!hasNotification)}
          >
            <Ionicons name={hasNotification ? 'notifications' : 'notifications-outline'} size={22} color={Colors.white} />
            {hasNotification && <View style={s.bellDot} />}
          </TouchableOpacity>
          <TouchableOpacity testID="home-avatar-btn" style={s.avatarBtn} onPress={() => router.push('/(tabs)/profile')}>
            <Text style={s.avatarText}>
              {user?.name ? user.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() : '?'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        testID="home-scroll"
        contentContainerStyle={s.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.orange]} />}
      >
        {/* Notification banner */}
        {hasNotification && (
          <TouchableOpacity testID="home-notification-banner" style={s.notifBanner} onPress={() => setViewMode('job_detail')}>
            <View style={s.notifIcon}>
              <Ionicons name="megaphone" size={18} color={Colors.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.notifTitle}>New job assigned</Text>
              <Text style={s.notifSub}>Emergency Drain Repair — Connector Park</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
          </TouchableOpacity>
        )}

        {/* AI Intelligence Briefing */}
        <View testID="home-briefing-card" style={s.briefingCard}>
          <View style={s.briefingHeader}>
            <Ionicons name="sparkles" size={18} color={Colors.orange} />
            <Text style={s.briefingTitle}>Intelligence Briefing</Text>
            <MockBadgeInline />
          </View>
          <Text style={s.briefingSummary}>{MOCK_AI_BRIEFING.summary}</Text>
          <View style={s.briefingItems}>
            {MOCK_AI_BRIEFING.items.map((item, i) => (
              <View key={i} style={s.briefingItem}>
                <View style={[s.briefingDot, {
                  backgroundColor: item.severity === 'warning' ? Colors.warning
                    : item.severity === 'success' ? Colors.success
                    : Colors.info,
                }]} />
                <Text style={s.briefingItemText}>{item.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Quick Actions */}
        <View style={s.quickActions}>
          <TouchableOpacity testID="home-action-prestart" style={s.actionTile} onPress={() => router.push('/(tabs)/qr-scan')}>
            <View style={[s.actionIcon, { backgroundColor: '#D1FAE5' }]}>
              <Ionicons name="checkbox-outline" size={24} color={Colors.success} />
            </View>
            <Text style={s.actionLabel}>New Pre-Start</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="home-action-signon" style={s.actionTile} onPress={() => setViewMode('signed_on')}>
            <View style={[s.actionIcon, { backgroundColor: '#DBEAFE' }]}>
              <Ionicons name="log-in-outline" size={24} color={Colors.info} />
            </View>
            <Text style={s.actionLabel}>Sign On</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="home-action-hazard" style={s.actionTile} onPress={() => {}}>
            <View style={[s.actionIcon, { backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="warning-outline" size={24} color={Colors.warning} />
            </View>
            <Text style={s.actionLabel}>Hazard</Text>
          </TouchableOpacity>
        </View>

        {/* Compliance List */}
        <View style={s.sectionHeader}>
          <Text testID="home-compliance-title" style={s.sectionTitle}>{"Today's Compliance"}</Text>
          <MockBadgeInline />
        </View>
        {MOCK_COMPLIANCE_LIST.map((item) => (
          <TouchableOpacity key={item.id} testID={`compliance-item-${item.id}`} style={s.complianceRow} onPress={() => {}}>
            <View style={[s.complianceDot, {
              backgroundColor: item.status === 'overdue' ? Colors.error
                : item.status === 'due' ? Colors.warning
                : Colors.info,
            }]} />
            <View style={{ flex: 1 }}>
              <Text style={s.complianceTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={s.complianceSub}>{item.site} · {item.type.replace('_', ' ')}</Text>
            </View>
            <View style={[s.complianceStatusPill, {
              backgroundColor: item.status === 'overdue' ? Colors.errorSoft
                : item.status === 'due' ? Colors.warningSoft
                : Colors.infoSoft,
            }]}>
              <Text style={[s.complianceStatusText, {
                color: item.status === 'overdue' ? Colors.error
                  : item.status === 'due' ? Colors.warning
                  : Colors.info,
              }]}>{item.status}</Text>
            </View>
          </TouchableOpacity>
        ))}

        {/* Today's Job card */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>{"Today's Assignment"}</Text>
        </View>
        {jobLoading ? (
          <ActivityIndicator color={Colors.orange} style={{ marginVertical: 20 }} />
        ) : todayJob ? (
          <TouchableOpacity testID="home-today-job" style={s.todayJobCard} onPress={() => setViewMode('job_detail')}>
            <Ionicons name="location" size={20} color={Colors.orange} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.todayJobTitle}>{todayJob.site_name || 'Assigned Site'}</Text>
                <Text style={s.todayJobSub}>{todayJob.status === 'accepted' ? 'Accepted' : todayJob.status}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity testID="home-today-job-mock" style={s.todayJobCard} onPress={() => setViewMode('job_detail')}>
            <Ionicons name="location" size={20} color={Colors.orange} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.todayJobTitle}>No job assigned today</Text>
              <Text style={s.todayJobSub}>Tap to see ad-hoc job detail</Text>
            </View>
            <MockBadgeInline />
            <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ── Mock badges ──
function MockBadge() {
  return (
    <View testID="mock-badge" style={s.mockBadge}>
      <Ionicons name="flask-outline" size={12} color="#DC2626" />
      <Text style={s.mockBadgeText}>MOCKED — Endpoint not available</Text>
    </View>
  );
}

function MockBadgeInline() {
  return (
    <View testID="mock-badge-inline" style={s.mockInline}>
      <Text style={s.mockInlineText}>MOCK</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    backgroundColor: Colors.navy, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20,
  },
  brandName: {
    color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: '800',
    letterSpacing: 2, marginBottom: 10,
  },
  headerTop: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  greeting: { color: Colors.white, fontSize: 22, fontWeight: '800' },
  roleLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '500', marginTop: 2 },
  bellBtn: { position: 'relative', padding: 6 },
  bellDot: {
    position: 'absolute', top: 4, right: 4, width: 8, height: 8,
    borderRadius: 4, backgroundColor: Colors.error,
  },
  avatarBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: Colors.white, fontSize: 14, fontWeight: '800' },

  scrollContent: { padding: 16, paddingBottom: 32 },

  // Notification banner
  notifBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.orangeSoft, borderRadius: 14, padding: 14, marginBottom: 16,
    borderWidth: 1, borderColor: '#FDBA7440',
  },
  notifIcon: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: '#FFF7ED',
    alignItems: 'center', justifyContent: 'center',
  },
  notifTitle: { fontSize: 14, fontWeight: '700', color: Colors.ink },
  notifSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },

  // Briefing
  briefingCard: {
    backgroundColor: Colors.surface, borderRadius: 18, padding: 18, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  briefingHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  briefingTitle: { fontSize: 15, fontWeight: '800', color: Colors.ink, flex: 1 },
  briefingSummary: { fontSize: 13, color: Colors.textSecondary, lineHeight: 20, marginBottom: 14 },
  briefingItems: { gap: 8 },
  briefingItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  briefingDot: { width: 8, height: 8, borderRadius: 4 },
  briefingItemText: { fontSize: 13, color: Colors.ink, fontWeight: '500' },

  // Quick Actions
  quickActions: {
    flexDirection: 'row', gap: 10, marginBottom: 20,
  },
  actionTile: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: 16, padding: 14,
    alignItems: 'center', gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  actionIcon: {
    width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
  },
  actionLabel: { fontSize: 12, fontWeight: '700', color: Colors.ink, textAlign: 'center' },

  // Section
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, marginTop: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: Colors.ink },

  // Compliance list
  complianceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03, shadowRadius: 3, elevation: 1,
  },
  complianceDot: { width: 10, height: 10, borderRadius: 5 },
  complianceTitle: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  complianceSub: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  complianceStatusPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  complianceStatusText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },

  // Today job
  todayJobCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  todayJobTitle: { fontSize: 14, fontWeight: '700', color: Colors.ink },
  todayJobSub: { fontSize: 12, color: Colors.textTertiary, marginTop: 2, textTransform: 'capitalize' },

  // Signed on
  backBtn: { padding: 4, marginRight: 8 },
  headerTitle: { color: Colors.white, fontSize: 18, fontWeight: '700' },
  signedOnCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.successSoft, borderRadius: 14, padding: 16, marginBottom: 12,
  },
  signedOnDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: Colors.success },
  signedOnLabel: { fontSize: 15, fontWeight: '700', color: Colors.success },
  siteCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  siteCardTitle: { fontSize: 15, fontWeight: '700', color: Colors.ink },
  siteCardAddress: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  timeCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  timeRow: { flex: 1, alignItems: 'center' },
  timeLabel: { fontSize: 11, color: Colors.textTertiary, fontWeight: '600' },
  timeValue: { fontSize: 18, fontWeight: '800', color: Colors.ink, marginTop: 4 },
  timeDivider: { width: 1, height: 32, backgroundColor: Colors.border },
  signOffBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1.5, borderColor: Colors.errorSoft, borderRadius: 14,
    paddingVertical: 14, backgroundColor: Colors.surface, marginTop: 8,
  },
  signOffText: { fontSize: 15, fontWeight: '600', color: Colors.error },

  // Job detail
  jobCard: {
    backgroundColor: Colors.surface, borderRadius: 18, padding: 18, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  jobStatusPill: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 10 },
  jobStatusText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  jobTitle: { fontSize: 18, fontWeight: '800', color: Colors.ink, marginBottom: 12 },
  jobRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  jobRowText: { fontSize: 13, color: Colors.textSecondary },
  notesCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16,
    borderLeftWidth: 3, borderLeftColor: Colors.orange,
  },
  notesLabel: { fontSize: 11, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' },
  notesText: { fontSize: 13, color: Colors.textSecondary, lineHeight: 20 },

  // Mock badges
  mockBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FEE2E2', borderRadius: 10, padding: 10, marginVertical: 12,
    borderWidth: 1, borderColor: '#FECACA',
  },
  mockBadgeText: { fontSize: 11, fontWeight: '700', color: '#DC2626' },
  mockInline: {
    backgroundColor: '#FEE2E2', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  mockInlineText: { fontSize: 8, fontWeight: '800', color: '#DC2626', letterSpacing: 0.5 },
});
