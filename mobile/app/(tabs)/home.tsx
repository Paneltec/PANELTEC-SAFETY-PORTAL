/**
 * Home screen — v58.13.132dc
 * Intelligence Briefing (real /api/mobile/ai/briefing) + Compliance list + Notification + Signed On.
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
import { getStoredUser, getStoredRoleLabel, clearSession, isPreviewSession } from '../../src/services/auth';
import { authGet, authPost } from '../../src/services/apiClient';
import { MOCK_COMPLIANCE_LIST, MOCK_AD_HOC_JOB } from '../../src/services/mockData';
import { useUpdateCheck } from '../../src/features/updates/useUpdateCheck';
import UpdateBanner from '../../src/features/updates/UpdateBanner';

type ViewMode = 'home' | 'signed_on' | 'job_detail';

interface BriefingResponse {
  briefing: string;
  severity: string;
  generated_at: string;
}

interface DailyJobResponse {
  assignment?: any;
}

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

  // AI Briefing state
  const [briefing, setBriefing] = useState<BriefingResponse | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(true);
  const [briefingError, setBriefingError] = useState('');

  // Update check
  const update = useUpdateCheck();

  // Sign-on state
  const [signedOnSite, setSignedOnSite] = useState<string | null>(null);
  const [signOnTime, setSignOnTime] = useState<Date | null>(null);
  const [signOnLoading, setSignOnLoading] = useState(false);

  const handleExpired = useCallback(async () => {
    await clearSession();
    router.replace('/(auth)/pin-entry');
  }, [router]);

  const loadData = useCallback(async () => {
    const [u, rl] = await Promise.all([
      getStoredUser(),
      getStoredRoleLabel(),
    ]);
    setUser(u);
    // In preview mode the stored role label is stale (admin's label) — use
    // the user object's role_label instead (populated from the preview JWT).
    if (isPreviewSession()) {
      setRoleLabel(u?.role_label || u?.role_id || u?.role || '');
    } else {
      setRoleLabel(rl || u?.role_label || u?.role_id || u?.role || '');
    }

    // Fetch AI briefing (45s timeout — LLM-backed, can be slow)
    setBriefingLoading(true);
    const briefRes = await authGet<BriefingResponse>('/api/mobile/ai/briefing', { timeoutMs: 45_000 });
    if (briefRes.ok) {
      setBriefing(briefRes.data);
      setBriefingError('');
    } else if ('expired' in briefRes && briefRes.expired) {
      handleExpired();
      return;
    } else {
      const errMsg = 'error' in briefRes ? briefRes.error : 'Failed to load';
      const isTimeout = 'timeout' in briefRes && briefRes.timeout;
      console.warn(`[briefing] ${isTimeout ? 'TIMEOUT' : 'ERROR'}: ${errMsg}`);
      setBriefingError(isTimeout ? 'Briefing timed out' : errMsg);
    }
    setBriefingLoading(false);

    // Fetch daily job
    const jobRes = await authGet<DailyJobResponse>('/api/mobile/daily-jobs/today');
    if (jobRes.ok) {
      setTodayJob(jobRes.data.assignment);
    }
    setJobLoading(false);
  }, [handleExpired]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setBriefingLoading(true);
    setJobLoading(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const greeting = user?.name ? `Hi, ${user.name.split(' ')[0]}` : 'Welcome';
  const userRole = user?.role_id || user?.role || '';

  // ── Sign On handler ──
  const handleSignOn = useCallback(async (siteId: string, siteName: string) => {
    setSignOnLoading(true);
    const res = await authPost('/api/mobile/sites/' + encodeURIComponent(siteId) + '/sign-on', {
      lat: -33.86,
      lng: 151.21,
      timestamp: new Date().toISOString(),
    });
    if (res.ok) {
      setSignedOnSite(siteName);
      setSignOnTime(new Date());
    } else if ('expired' in res && res.expired) {
      handleExpired();
    }
    // site_not_found is expected for demo — still show visual
    if (!res.ok && !('expired' in res)) {
      setSignedOnSite(siteName);
      setSignOnTime(new Date());
    }
    setSignOnLoading(false);
  }, [handleExpired]);

  const handleSignOff = useCallback(async () => {
    if (signedOnSite) {
      await authPost('/api/mobile/sites/demo-site/sign-off', {
        lat: -33.86,
        lng: 151.21,
        timestamp: new Date().toISOString(),
      });
    }
    setSignedOnSite(null);
    setSignOnTime(null);
    setViewMode('home');
  }, [signedOnSite]);

  const getElapsed = () => {
    if (!signOnTime) return '0m';
    const mins = Math.floor((Date.now() - signOnTime.getTime()) / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

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
          {signedOnSite ? (
            <>
              <View style={s.signedOnCard}>
                <View style={s.signedOnDot} />
                <Text style={s.signedOnLabel}>Currently signed on</Text>
              </View>
              <View style={s.siteCard}>
                <Ionicons name="location" size={20} color={Colors.orange} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.siteCardTitle}>{signedOnSite}</Text>
                </View>
              </View>
              <View style={s.timeCard}>
                <View style={s.timeRow}>
                  <Text style={s.timeLabel}>Signed on at</Text>
                  <Text style={s.timeValue}>{signOnTime ? signOnTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--'}</Text>
                </View>
                <View style={s.timeDivider} />
                <View style={s.timeRow}>
                  <Text style={s.timeLabel}>Duration</Text>
                  <Text style={s.timeValue}>{getElapsed()}</Text>
                </View>
              </View>
              <TouchableOpacity testID="sign-off-btn" style={s.signOffBtn} onPress={handleSignOff}>
                <Ionicons name="log-out-outline" size={20} color={Colors.error} />
                <Text style={s.signOffText}>Sign Off Site</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={s.signOnPrompt}>Select a site to sign on</Text>
              {['Connector Park Drive', 'Moorebank Depot', 'Rosehill Yard'].map((site, i) => (
                <TouchableOpacity
                  key={i}
                  testID={`sign-on-site-${i}`}
                  style={s.siteOptionCard}
                  onPress={() => handleSignOn(`site-${i}`, site)}
                  disabled={signOnLoading}
                >
                  <Ionicons name="location-outline" size={20} color={Colors.orange} />
                  <Text style={s.siteOptionText}>{site}</Text>
                  {signOnLoading ? (
                    <ActivityIndicator size="small" color={Colors.orange} />
                  ) : (
                    <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
                  )}
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
      </View>
    );
  }

  // ── Ad-hoc Job Detail view ──
  if (viewMode === 'job_detail') {
    const job = todayJob || MOCK_AD_HOC_JOB;
    const isMocked = !todayJob;
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
          {isMocked && (
            <View style={s.mockBadge}>
              <Ionicons name="flask-outline" size={12} color="#DC2626" />
              <Text style={s.mockBadgeText}>Demo data — no live job assigned</Text>
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  // ── Main Home view ──
  return (
    <View testID="home-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.brandName}>PANELTEC GROUP</Text>
        <View style={s.headerTop}>
          <View style={{ flex: 1 }}>
            <Text testID="home-greeting" style={s.greeting}>{greeting}</Text>
            <Text testID="home-role-label" style={s.roleLabel}>{roleLabel || userRole || 'Field Worker'}</Text>
          </View>
          {/* .132jt — QR scan icon in top bar */}
          <TouchableOpacity
            testID="home-qr-scan-btn"
            style={s.bellBtn}
            onPress={() => router.push('/(screens)/qr-scan')}
          >
            <Ionicons name="qr-code-outline" size={22} color={Colors.orange} />
          </TouchableOpacity>
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
        {/* Update banner */}
        {update.available && !update.dismissed && (
          <UpdateBanner
            serverVersion={update.serverVersion}
            onInstall={update.install}
            onDismiss={update.dismiss}
          />
        )}

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

        {/* Signed-on banner if active */}
        {signedOnSite && (
          <TouchableOpacity testID="home-signed-on-banner" style={s.signedOnBanner} onPress={() => setViewMode('signed_on')}>
            <View style={s.signedOnBannerDot} />
            <View style={{ flex: 1 }}>
              <Text style={s.signedOnBannerTitle}>{signedOnSite}</Text>
              <Text style={s.signedOnBannerSub}>Signed on · {getElapsed()}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.success} />
          </TouchableOpacity>
        )}

        {/* AI Intelligence Briefing — REAL */}
        <View testID="home-briefing-card" style={s.briefingCard}>
          <View style={s.briefingHeader}>
            <Ionicons name="sparkles" size={18} color={Colors.orange} />
            <Text style={s.briefingTitle}>Intelligence Briefing</Text>
            {briefing && (
              <View style={[s.severityPill, {
                backgroundColor: briefing.severity === 'warning' ? Colors.warningSoft
                  : briefing.severity === 'critical' ? Colors.errorSoft
                  : Colors.successSoft,
              }]}>
                <Text style={[s.severityText, {
                  color: briefing.severity === 'warning' ? Colors.warning
                    : briefing.severity === 'critical' ? Colors.error
                    : Colors.success,
                }]}>{briefing.severity}</Text>
              </View>
            )}
          </View>
          {briefingLoading ? (
            <View style={s.briefingLoadingWrap}>
              <ActivityIndicator color={Colors.orange} />
              <Text style={s.briefingLoadingText}>Generating briefing…</Text>
            </View>
          ) : briefingError ? (
            <TouchableOpacity testID="briefing-retry-btn" style={s.briefingRetryWrap} onPress={() => { setBriefingError(''); loadData(); }}>
              <Ionicons name="cloud-offline-outline" size={18} color={Colors.textTertiary} />
              <Text style={s.briefingRetryText}>Briefing unavailable — tap to retry</Text>
            </TouchableOpacity>
          ) : briefing ? (
            <Text style={s.briefingSummary}>{briefing.briefing}</Text>
          ) : null}
        </View>

        {/* Quick Actions — .132kf: added Incident Report, 2×2 grid */}
        <View style={s.quickActions}>
          <TouchableOpacity testID="home-action-scan-qr" style={s.actionTile} onPress={() => router.push('/(screens)/qr-scan')}>
            <View style={[s.actionIcon, { backgroundColor: '#FFF7ED' }]}>
              <Ionicons name="qr-code-outline" size={24} color={Colors.orange} />
            </View>
            <Text style={s.actionLabel}>Scan Vehicle QR</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="home-action-prestart" style={s.actionTile} onPress={() => router.push({ pathname: '/forms/picker', params: { category: 'pre_start', title: 'Pre-Start' } } as never)}>
            <View style={[s.actionIcon, { backgroundColor: '#D1FAE5' }]}>
              <Ionicons name="checkbox-outline" size={24} color={Colors.success} />
            </View>
            <Text style={s.actionLabel}>New Pre-Start</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="home-action-incident" style={s.actionTile} onPress={() => router.push({ pathname: '/forms/picker', params: { category: 'incident', title: 'Incident Report' } } as never)}>
            <View style={[s.actionIcon, { backgroundColor: '#FEE2E2' }]}>
              <Ionicons name="warning-outline" size={24} color={Colors.error} />
            </View>
            <Text style={s.actionLabel}>Incident Report</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="home-action-signon" style={s.actionTile} onPress={() => setViewMode('signed_on')}>
            <View style={[s.actionIcon, { backgroundColor: '#DBEAFE' }]}>
              <Ionicons name="log-in-outline" size={24} color={Colors.info} />
            </View>
            <Text style={s.actionLabel}>Sign On</Text>
          </TouchableOpacity>
        </View>

        {/* Compliance List — still static for now */}
        <View style={s.sectionHeader}>
          <Text testID="home-compliance-title" style={s.sectionTitle}>{"Today's Compliance"}</Text>
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
          <View testID="home-no-job" style={s.noJobCard}>
            <Ionicons name="checkmark-circle-outline" size={20} color={Colors.success} />
            <Text style={s.noJobText}>No assignments today</Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.navyLight },
  header: {
    backgroundColor: Colors.navy, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20,
  },
  brandName: {
    color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: '800',
    letterSpacing: 2, marginBottom: 10,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  greeting: { color: Colors.white, fontSize: 24, fontWeight: '800' },
  roleLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: '500', marginTop: 2, textTransform: 'capitalize' },
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
    backgroundColor: Colors.orangeSoft, borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: '#FDBA7440',
  },
  notifIcon: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: '#FFF7ED',
    alignItems: 'center', justifyContent: 'center',
  },
  notifTitle: { fontSize: 14, fontWeight: '700', color: Colors.ink },
  notifSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },

  // Signed-on banner
  signedOnBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.successSoft, borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: '#10B98130',
  },
  signedOnBannerDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.success },
  signedOnBannerTitle: { fontSize: 14, fontWeight: '700', color: Colors.ink },
  signedOnBannerSub: { fontSize: 12, color: Colors.success, marginTop: 1 },

  // Briefing
  briefingCard: {
    backgroundColor: Colors.surface, borderRadius: 18, padding: 18, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  briefingHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  briefingTitle: { fontSize: 16, fontWeight: '800', color: Colors.ink, flex: 1 },
  briefingSummary: { fontSize: 15, color: Colors.textSecondary, lineHeight: 22 },
  briefingLoadingWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  briefingLoadingText: { fontSize: 12, color: Colors.textTertiary, fontStyle: 'italic' },
  briefingRetryWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 4,
  },
  briefingRetryText: { fontSize: 13, color: Colors.textTertiary },
  severityPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  severityText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },

  // Quick Actions
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  actionTile: {
    width: '47%', backgroundColor: Colors.surface, borderRadius: 16, padding: 16,
    alignItems: 'center', gap: 10, minHeight: 100,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  actionIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 14, fontWeight: '700', color: Colors.ink, textAlign: 'center' },

  // Section
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: Colors.white },

  // Compliance list
  complianceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 8,
    minHeight: 64,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03, shadowRadius: 3, elevation: 1,
  },
  complianceDot: { width: 10, height: 10, borderRadius: 5 },
  complianceTitle: { fontSize: 15, fontWeight: '600', color: Colors.ink },
  complianceSub: { fontSize: 13, color: Colors.textTertiary, marginTop: 2 },
  complianceStatusPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  complianceStatusText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },

  // Today job
  todayJobCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16,
    minHeight: 64,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  todayJobTitle: { fontSize: 16, fontWeight: '700', color: Colors.ink },
  todayJobSub: { fontSize: 13, color: Colors.textTertiary, marginTop: 2, textTransform: 'capitalize' },
  noJobCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.successSoft, borderRadius: 14, padding: 16,
  },
  noJobText: { fontSize: 14, fontWeight: '600', color: Colors.success },

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
  signOnPrompt: {
    color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600', marginBottom: 12,
  },
  siteOptionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  siteOptionText: { fontSize: 15, fontWeight: '600', color: Colors.ink, flex: 1 },

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
  mockBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FEE2E2', borderRadius: 10, padding: 10, marginVertical: 12,
    borderWidth: 1, borderColor: '#FECACA',
  },
  mockBadgeText: { fontSize: 11, fontWeight: '700', color: '#DC2626' },
});
