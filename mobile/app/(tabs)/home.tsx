/**
 * Home screen — v58.13.132dc
 * Intelligence Briefing (real /api/mobile/ai/briefing) + Compliance list + Notification + Signed On.
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, Linking, Platform, Alert, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, C } from '../../src/theme/colors';
import { getStoredUser, getStoredRoleLabel, clearSession, isPreviewSession } from '../../src/services/auth';
import { authGet, authPost } from '../../src/services/apiClient';
import { MOCK_COMPLIANCE_LIST, MOCK_AD_HOC_JOB } from '../../src/services/mockData';
import { acceptDailyJob, declineDailyJob } from '../../src/services/dailyJobs';
import { useUpdateCheck } from '../../src/features/updates/useUpdateCheck';
import UpdateBanner from '../../src/features/updates/UpdateBanner';
import PasteJobSmsModal from '../../src/components/PasteJobSmsModal';
import { startSmsListener, stopSmsListener, setOnJobCreated, debugFireTestSms } from '../../src/lib/smsReceiver';
import { requestSmsPermission, hasRequestedSmsPermission, type SmsPermResult } from '../../src/lib/smsPermissions';

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
  const [jobActioning, setJobActioning] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [smsPermDenied, setSmsPermDenied] = useState(false);

  // Accept button pulse animation
  const acceptPulseAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const job = todayJob || MOCK_AD_HOC_JOB;
    const isPendingJob = job && (job.status === 'pending_accept' || job.status === 'pending' || job.status === 'new');
    if (isPendingJob && viewMode === 'job_detail') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(acceptPulseAnim, { toValue: 1, duration: 1000, useNativeDriver: false }),
          Animated.timing(acceptPulseAnim, { toValue: 0, duration: 1000, useNativeDriver: false }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    } else {
      acceptPulseAnim.setValue(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayJob?.status, viewMode, acceptPulseAnim]);

  // Pulse animation for new-job tile
  const pulseAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const isPending = todayJob && (todayJob.status === 'pending_accept' || todayJob.status === 'pending' || todayJob.status === 'new' || todayJob.status === 'issued');
    if (isPending) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: false }),
          Animated.timing(pulseAnim, { toValue: 0, duration: 1000, useNativeDriver: false }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayJob?.status, pulseAnim]);

  // AI Briefing state
  const [briefing, setBriefing] = useState<BriefingResponse | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(true);
  const [briefingError, setBriefingError] = useState('');

  // Update check
  const update = useUpdateCheck();

  // Start Android SMS listener + request permission
  useEffect(() => {
    startSmsListener();
    setOnJobCreated((job: any) => {
      setTodayJob(job);
      setJobLoading(false);
    });
    // Request SMS permission on Android (once per install)
    if (Platform.OS === 'android') {
      hasRequestedSmsPermission().then((requested) => {
        if (!requested) {
          requestSmsPermission().then((result: SmsPermResult) => {
            if (result === 'denied' || result === 'never_ask_again') {
              setSmsPermDenied(true);
            }
          });
        }
      });
    }
    return () => {
      stopSmsListener();
      setOnJobCreated(null);
    };
  }, []);

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

  // ── helpers for job detail ──
  const handleOpenMaps = (address: string) => {
    const encoded = encodeURIComponent(address);
    const url = Platform.select({
      ios: `maps://?daddr=${encoded}&dirflg=d`,
      android: `google.navigation:q=${encoded}&mode=d`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${encoded}`,
    });
    Linking.openURL(url!).catch(() =>
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encoded}`)
    );
  };

  const formatTime = (iso?: string) => {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  };

  const formatJobDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return dateStr; }
  };

  const handleAcceptJob = async (job: any) => {
    if (job._mocked) {
      const updated = { ...job, status: 'accepted', accepted_at: new Date().toISOString() };
      setTodayJob(updated);
      return;
    }
    setJobActioning(true);
    try {
      const updated = await acceptDailyJob(job.id);
      setTodayJob(updated);
    } catch {
      Alert.alert('Error', 'Could not accept job. Try again.');
    }
    setJobActioning(false);
  };

  const handleDeclineJob = async (job: any) => {
    if (job._mocked) {
      const updated = { ...job, status: 'declined', declined_at: new Date().toISOString() };
      setTodayJob(updated);
      return;
    }
    setJobActioning(true);
    try {
      const updated = await declineDailyJob(job.id);
      setTodayJob(updated);
    } catch {
      Alert.alert('Error', 'Could not decline job. Try again.');
    }
    setJobActioning(false);
  };

  // ── Job Detail view — Phase 3 redesign (.132p2) ──
  if (viewMode === 'job_detail') {
    const job = todayJob || MOCK_AD_HOC_JOB;
    const isMocked = !todayJob || job._mocked;
    const isIssued = job.status === 'pending_accept' || job.status === 'pending' || job.status === 'new' || job.status === 'issued';
    const isAccepted = job.status === 'accepted';
    const isDeclined = job.status === 'declined';
    const address = job.address || job.site_address || job.site_name || '';
    const truckFull = job.truck_name
      ? [job.truck_name, job.truck_reg].filter(Boolean).join(' - ')
      : job.truck || '';

    // Filter current user from crew
    const currentName = (user?.name || user?.display_name || user?.full_name || '').trim().toUpperCase();
    const crewRaw: string[] = Array.isArray(job.staff_names) ? job.staff_names
      : Array.isArray(job.staff) ? job.staff
      : (typeof job.staff === 'string' ? job.staff.split(',').map((s: string) => s.trim()) : []);
    const filteredCrew = crewRaw.filter((n: string) => n.trim().toUpperCase() !== currentName);
    const crewLabel = filteredCrew.length > 0 ? filteredCrew.join(', ') : '—';

    const jobDate = job.date || job.job_date || job.issued_at || '';
    const jobNotes = job.notes || '';
    const siteName = job.site_name || job.title || '';

    // Status chip config
    const chipConfig = isIssued
      ? { label: `NEW · issued ${formatTime(job.issued_at || job.assigned_at || job.created_at)}`, color: C.orange.base, bg: C.orange.chipBg, border: C.orange.chipBg }
      : isAccepted
      ? { label: `ACCEPTED · at ${formatTime(job.accepted_at)}`, color: C.green.base, bg: C.green.softBg, border: C.green.softBg }
      : { label: `DECLINED · at ${formatTime(job.declined_at)}`, color: C.grey.declineText, bg: C.card.bg, border: C.card.border };

    // Field table data
    const fieldRows: { label: string; value: string }[] = [
      { label: 'TRUCK', value: truckFull || '—' },
      { label: 'DATE', value: formatJobDate(jobDate) },
      { label: 'SITE', value: siteName || '—' },
      { label: 'CUSTOMER', value: job.customer || '—' },
      { label: 'CREW', value: crewLabel },
    ];

    return (
      <View testID="home-job-detail" style={[s.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={jd.header}>
          <TouchableOpacity testID="job-detail-back" onPress={() => setViewMode('home')} style={jd.backBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.white} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={jd.headerTitle} numberOfLines={2}>{siteName || address || 'Job Assignment'}</Text>
          </View>
          <View style={[jd.chip, { backgroundColor: chipConfig.bg, borderColor: chipConfig.border }]}>
            <Text style={[jd.chipText, { color: chipConfig.color }]}>{chipConfig.label}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={jd.scroll} showsVerticalScrollIndicator={false}>
          {isMocked && (
            <View style={s.mockBadge}>
              <Ionicons name="flask-outline" size={12} color={C.misc.errorText} />
              <Text style={s.mockBadgeText}>Demo data — no live job assigned</Text>
            </View>
          )}

          {/* Map card (fallback — no Google Maps key) */}
          <TouchableOpacity
            testID="job-detail-map-card"
            style={jd.mapCard}
            onPress={() => address && handleOpenMaps(address)}
            activeOpacity={0.7}
          >
            <View style={jd.mapIconRow}>
              <View style={jd.mapPin}>
                <Ionicons name="location" size={24} color={Colors.orange} />
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={jd.mapAddress} numberOfLines={2}>{address || 'No address'}</Text>
                <Text style={jd.mapDistance}>Tap to open in Maps</Text>
              </View>
              <Ionicons name="navigate" size={20} color={Colors.orange} />
            </View>
          </TouchableOpacity>

          {/* Field table */}
          <View style={jd.fieldCard}>
            {fieldRows.map((row, i) => (
              <View key={row.label}>
                {i > 0 && <View style={jd.fieldDivider} />}
                <View style={jd.fieldRow}>
                  <Text style={jd.fieldLabel}>{row.label}</Text>
                  <Text style={jd.fieldValue} numberOfLines={row.label === 'CREW' ? 3 : 1}>{row.value}</Text>
                </View>
              </View>
            ))}
            {/* NOTES — expandable, inside card */}
            {!!jobNotes && (
              <>
                <View style={jd.fieldDivider} />
                <TouchableOpacity
                  testID="job-detail-notes-toggle"
                  onPress={() => setNotesExpanded(!notesExpanded)}
                  activeOpacity={0.7}
                  style={jd.fieldRow}
                >
                  <Text style={jd.fieldLabel}>NOTES</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={jd.fieldValue} numberOfLines={notesExpanded ? undefined : 3}>{jobNotes}</Text>
                    {!notesExpanded && jobNotes.length > 100 && (
                      <Text style={jd.notesMore}>Show more ›</Text>
                    )}
                  </View>
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* ── State 1: BEFORE ACCEPT ── */}
          {isIssued && (
            <>
              {/* Decision row */}
              <View style={jd.decisionRow}>
                <TouchableOpacity
                  testID="job-detail-decline-btn"
                  style={jd.declineBtn}
                  onPress={() => handleDeclineJob(job)}
                  disabled={jobActioning}
                  activeOpacity={0.7}
                >
                  {jobActioning ? <ActivityIndicator size="small" color={Colors.textTertiary} /> : (
                    <Text style={jd.declineBtnText}>DECLINE</Text>
                  )}
                </TouchableOpacity>
                <Animated.View style={[
                  jd.acceptBtnWrap,
                  {
                    shadowColor: C.green.base,
                    shadowOffset: { width: 0, height: 0 },
                    shadowRadius: acceptPulseAnim.interpolate({ inputRange: [0, 1], outputRange: [4, 16] }),
                    shadowOpacity: acceptPulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.5] }),
                    elevation: 4,
                  },
                ]}>
                  <TouchableOpacity
                    testID="job-detail-accept-btn"
                    style={jd.acceptBtn}
                    onPress={() => handleAcceptJob(job)}
                    disabled={jobActioning}
                    activeOpacity={0.7}
                  >
                    {jobActioning ? <ActivityIndicator size="small" color={Colors.white} /> : (
                      <Text style={jd.acceptBtnText}>ACCEPT JOB</Text>
                    )}
                  </TouchableOpacity>
                </Animated.View>
              </View>
              {/* Locked action row */}
              <View style={jd.lockedRow}>
                <View style={jd.lockedBtn}>
                  <Ionicons name="lock-closed" size={13} color={C.grey.lockedIcon} />
                  <Text style={jd.lockedBtnText}>NAVIGATE</Text>
                </View>
                <View style={jd.lockedBtn}>
                  <Ionicons name="lock-closed" size={13} color={C.grey.lockedIcon} />
                  <Text style={jd.lockedBtnText}>SIGN ON AT SITE</Text>
                </View>
              </View>
              <Text style={jd.footerCaption}>
                Accept to unlock Navigate and Sign On.{'\n'}The office is notified straight away.
              </Text>
            </>
          )}

          {/* ── State 2: AFTER ACCEPT ── */}
          {isAccepted && (
            <>
              {/* Accepted pill */}
              <View style={jd.acceptedPill}>
                <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                <Text style={jd.acceptedPillText}>
                  ACCEPTED at {formatTime(job.accepted_at)}
                </Text>
              </View>
              {/* Pre-start truck button */}
              <TouchableOpacity
                testID="job-detail-prestart-btn"
                style={jd.prestartBtn}
                onPress={() => {
                  router.push({ pathname: '/forms', params: { form: 'prestart', truck: truckFull } });
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="clipboard-outline" size={20} color={Colors.white} />
                <Text style={jd.prestartBtnText} numberOfLines={1}>
                  PRE-START MY TRUCK — {truckFull || 'Truck'}
                </Text>
              </TouchableOpacity>
              {/* Navigate + Sign On */}
              <View style={jd.actionRow}>
                <TouchableOpacity
                  testID="job-detail-navigate-btn"
                  style={jd.navBtn}
                  onPress={() => address && handleOpenMaps(address)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="navigate" size={18} color={Colors.white} />
                  <Text style={jd.navBtnText}>NAVIGATE</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="job-detail-signon-btn"
                  style={jd.signOnBtn}
                  onPress={() => {
                    Alert.alert('Sign On', 'Sign-on at site is coming in Phase 4.\nUse the "Sign On" tile on Home for now.');
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="create-outline" size={18} color={Colors.ink} />
                  <Text style={jd.signOnBtnText}>SIGN ON AT SITE</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ── State 3: DECLINED ── */}
          {isDeclined && (
            <View style={jd.declinedBlock}>
              <Ionicons name="close-circle-outline" size={36} color={C.grey.lockedIcon} />
              <Text style={jd.declinedTitle}>You declined this job</Text>
              <Text style={jd.declinedSub}>The office has been notified.</Text>
              <TouchableOpacity
                testID="job-detail-back-home"
                style={jd.backHomeBtn}
                onPress={() => setViewMode('home')}
                activeOpacity={0.7}
              >
                <Ionicons name="arrow-back" size={16} color={Colors.info} />
                <Text style={jd.backHomeBtnText}>Back to Home</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={{ height: 40 }} />
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
            <View style={[s.actionIcon, { backgroundColor: C.orange.softBg }]}>
              <Ionicons name="qr-code-outline" size={24} color={Colors.orange} />
            </View>
            <Text style={s.actionLabel}>Scan Vehicle QR</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="home-action-prestart" style={s.actionTile} onPress={() => router.push({ pathname: '/forms/picker', params: { category: 'pre_start', title: 'Pre-Start' } } as never)}>
            <View style={[s.actionIcon, { backgroundColor: C.green.softBg }]}>
              <Ionicons name="checkbox-outline" size={24} color={Colors.success} />
            </View>
            <Text style={s.actionLabel}>New Pre-Start</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="home-action-incident" style={s.actionTile} onPress={() => router.push({ pathname: '/forms/picker', params: { category: 'incident', title: 'Incident Report' } } as never)}>
            <View style={[s.actionIcon, { backgroundColor: C.misc.errorBg }]}>
              <Ionicons name="warning-outline" size={24} color={Colors.error} />
            </View>
            <Text style={s.actionLabel}>Incident Report</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="home-action-signon" style={s.actionTile} onPress={() => setViewMode('signed_on')}>
            <View style={[s.actionIcon, { backgroundColor: Colors.infoSoft }]}>
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
          <TouchableOpacity key={item.id} testID={`compliance-item-${item.id}`} style={s.complianceRow} onPress={() => {
            if (item.type === 'swms') {
              router.push({ pathname: '/forms/category/[key]', params: { key: 'swms', title: 'SWMS' } } as never);
            } else if (item.type === 'pre_start') {
              router.push({ pathname: '/forms/picker', params: { category: 'pre_start', title: 'Pre-Start' } } as never);
            }
          }}>
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
        ) : todayJob ? (() => {
          const isNewJob = todayJob.status === 'pending_accept' || todayJob.status === 'pending' || todayJob.status === 'new' || todayJob.status === 'issued';
          const isJobAccepted = todayJob.status === 'accepted';
          const borderColor = pulseAnim.interpolate({
            inputRange: [0, 1],
            outputRange: ['rgba(16,185,129,0.0)', 'rgba(16,185,129,0.5)'],
          });
          const shadowOpacity = pulseAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 0.35],
          });
          return (
            <View>
              {isNewJob && (
                <View testID="home-new-job-banner" style={s.newJobBanner}>
                  <Ionicons name="notifications" size={16} color={Colors.success} />
                  <Text style={s.newJobBannerText}>You have a new job</Text>
                </View>
              )}
              {isJobAccepted && todayJob.accepted_at && (
                <View testID="home-accepted-banner" style={s.acceptedBanner}>
                  <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                  <Text style={s.acceptedBannerText}>
                    Accepted at {new Date(todayJob.accepted_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase()}
                  </Text>
                </View>
              )}
              <Animated.View style={[
                s.todayJobCardWrap,
                isNewJob && {
                  borderColor,
                  borderWidth: 2,
                  shadowColor: C.green.base,
                  shadowOffset: { width: 0, height: 0 },
                  shadowRadius: 12,
                  shadowOpacity,
                  elevation: 4,
                },
              ]}>
                <TouchableOpacity testID="home-today-job" style={s.todayJobCardInner} onPress={() => setViewMode('job_detail')}>
                  <Ionicons name="location" size={20} color={Colors.orange} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={s.todayJobTitle} numberOfLines={1}>{todayJob.address || todayJob.site_address || todayJob.site_name || 'Assigned Site'}</Text>
                    <Text style={s.todayJobSub} numberOfLines={1}>
                      {[
                        todayJob.truck_name ? `${todayJob.truck_name}${todayJob.truck_reg ? ` · ${todayJob.truck_reg}` : ''}` : null,
                        todayJob.status === 'accepted' ? 'Accepted' : todayJob.status?.replace('_', ' '),
                      ].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
                </TouchableOpacity>
              </Animated.View>
            </View>
          );
        })() : (
          <View>
            <View testID="home-no-job" style={s.noJobCard}>
              <Ionicons name="time-outline" size={20} color={Colors.textTertiary} />
              <Text style={s.noJobText}>Ready when the office issues today&apos;s job.</Text>
            </View>
            <TouchableOpacity
              testID="home-paste-sms-btn"
              style={s.pasteSmsBtn}
              onPress={() => setShowPasteModal(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="clipboard-outline" size={16} color={Colors.info} />
              <Text style={s.pasteSmsBtnText}>Paste job SMS</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 12 }} />

        {/* SMS permission denied banner (Android only) */}
        {smsPermDenied && Platform.OS === 'android' && (
          <TouchableOpacity
            testID="home-sms-perm-banner"
            style={s.smsPermBanner}
            onPress={() => {
              import('../../src/lib/smsPermissions').then(m => m.openAppSettings());
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="warning" size={16} color={Colors.warning} />
            <Text style={s.smsPermBannerText}>
              SMS reading disabled — enable in Settings {'>'} Apps {'>'} Paneltec {'>'} Permissions to auto-receive jobs.
            </Text>
            <Ionicons name="open-outline" size={14} color={Colors.warning} />
          </TouchableOpacity>
        )}

        {/* DEV: Simulate SMS receipt (debug only) */}
        {__DEV__ && (
          <TouchableOpacity
            testID="home-debug-sms-btn"
            style={s.debugSmsBtn}
            onPress={() => {
              debugFireTestSms();
              Alert.alert('Debug', 'Fired test SMS event — check for notification + job tile update.');
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="bug" size={14} color={C.card.textSecondary} />
            <Text style={s.debugSmsBtnText}>Debug: Fire test SMS</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Paste SMS Modal (iOS / manual flow) */}
      <PasteJobSmsModal
        visible={showPasteModal}
        onClose={() => setShowPasteModal(false)}
        onJobCreated={(job) => {
          setTodayJob(job);
          setShowPasteModal(false);
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.screen.bg },
  header: {
    backgroundColor: C.screen.bar, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20,
  },
  brandName: {
    color: C.textOnNavy.faint, fontSize: 10, fontWeight: '800',
    letterSpacing: 2, marginBottom: 10,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  greeting: { color: C.textOnNavy.main, fontSize: 24, fontWeight: '800' },
  roleLabel: { color: C.textOnNavy.secondary, fontSize: 14, fontWeight: '500', marginTop: 2, textTransform: 'capitalize' },
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
    backgroundColor: C.orange.softBg, borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: C.orange.softBg,
  },
  notifIcon: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: C.orange.softBg,
    alignItems: 'center', justifyContent: 'center',
  },
  notifTitle: { fontSize: 14, fontWeight: '700', color: C.card.textMain },
  notifSub: { fontSize: 12, color: C.textOnNavy.secondary, marginTop: 2 },

  // Signed-on banner
  signedOnBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.green.softBg, borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: C.green.softBg,
  },
  signedOnBannerDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.green.base },
  signedOnBannerTitle: { fontSize: 14, fontWeight: '700', color: C.card.textMain },
  signedOnBannerSub: { fontSize: 12, color: C.green.base, marginTop: 1 },

  // Briefing
  briefingCard: {
    backgroundColor: C.card.bg, borderRadius: 18, padding: 18, marginBottom: 16,
    shadowColor: C.misc.shadow, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  briefingHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  briefingTitle: { fontSize: 16, fontWeight: '800', color: C.card.textMain, flex: 1 },
  briefingSummary: { fontSize: 15, color: C.card.textSecondary, lineHeight: 22 },
  briefingLoadingWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  briefingLoadingText: { fontSize: 12, color: C.textOnNavy.faint, fontStyle: 'italic' },
  briefingRetryWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 4,
  },
  briefingRetryText: { fontSize: 13, color: C.textOnNavy.faint },
  severityPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  severityText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },

  // Quick Actions
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  actionTile: {
    width: '47%', backgroundColor: C.card.bg, borderRadius: 16, padding: 16,
    alignItems: 'center', gap: 10, minHeight: 100,
    shadowColor: C.misc.shadow, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  actionIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 14, fontWeight: '700', color: C.card.textMain, textAlign: 'center' },

  // Section
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: C.textOnNavy.main },

  // Compliance list
  complianceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.card.bg, borderRadius: 14, padding: 16, marginBottom: 8,
    minHeight: 64,
    shadowColor: C.misc.shadow, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03, shadowRadius: 3, elevation: 1,
  },
  complianceDot: { width: 10, height: 10, borderRadius: 5 },
  complianceTitle: { fontSize: 15, fontWeight: '600', color: C.card.textMain },
  complianceSub: { fontSize: 13, color: C.textOnNavy.faint, marginTop: 2 },
  complianceStatusPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  complianceStatusText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },

  // Today job
  // New job banner + pulse
  newJobBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.green.softBg, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8,
  },
  newJobBannerText: { fontSize: 14, fontWeight: '700', color: C.green.base },
  acceptedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.green.softBg, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8, marginBottom: 8,
  },
  acceptedBannerText: { fontSize: 13, fontWeight: '600', color: C.green.base },
  todayJobCardWrap: {
    borderRadius: 14, overflow: 'hidden',
  },
  todayJobCardInner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card.bg, borderRadius: 14, padding: 16,
    minHeight: 64,
  },
  todayJobCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card.bg, borderRadius: 14, padding: 16,
    minHeight: 64,
    shadowColor: C.misc.shadow, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  todayJobTitle: { fontSize: 16, fontWeight: '700', color: C.card.textMain },
  todayJobSub: { fontSize: 13, color: C.textOnNavy.faint, marginTop: 2, textTransform: 'capitalize' },
  noJobCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.screen.faintPanel, borderRadius: 14, padding: 16,
  },
  noJobText: { fontSize: 14, fontWeight: '500', color: C.textOnNavy.faint },
  pasteSmsBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderColor: `${Colors.info}40`, borderRadius: 12,
    paddingVertical: 12, marginTop: 10, backgroundColor: 'rgba(59,130,246,0.06)',
    minHeight: 44,
  },
  pasteSmsBtnText: { fontSize: 13, fontWeight: '700', color: Colors.info },

  // SMS permission denied banner
  smsPermBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.warningSoft, borderRadius: 12, padding: 12, marginHorizontal: 16, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.warning,
  },
  smsPermBannerText: { fontSize: 12, color: Colors.warning, flex: 1, lineHeight: 16 },

  // Debug SMS button
  debugSmsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 16,
    borderRadius: 8, borderWidth: 1, borderColor: C.card.border, backgroundColor: C.card.bg,
    marginTop: 8,
  },
  debugSmsBtnText: { fontSize: 12, fontWeight: '600', color: C.card.textSecondary },

  // Signed on
  backBtn: { padding: 4, marginRight: 8 },
  headerTitle: { color: C.textOnNavy.main, fontSize: 18, fontWeight: '700' },
  signedOnCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.green.softBg, borderRadius: 14, padding: 16, marginBottom: 12,
  },
  signedOnDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.green.base },
  signedOnLabel: { fontSize: 15, fontWeight: '700', color: C.green.base },
  siteCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card.bg, borderRadius: 14, padding: 16, marginBottom: 12,
    shadowColor: C.misc.shadow, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  siteCardTitle: { fontSize: 15, fontWeight: '700', color: C.card.textMain },
  timeCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card.bg, borderRadius: 14, padding: 16, marginBottom: 16,
    shadowColor: C.misc.shadow, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  timeRow: { flex: 1, alignItems: 'center' },
  timeLabel: { fontSize: 11, color: C.textOnNavy.faint, fontWeight: '600' },
  timeValue: { fontSize: 18, fontWeight: '800', color: C.card.textMain, marginTop: 4 },
  timeDivider: { width: 1, height: 32, backgroundColor: C.card.border },
  signOffBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1.5, borderColor: C.misc.errorRed, borderRadius: 14,
    paddingVertical: 14, backgroundColor: C.card.bg, marginTop: 8,
  },
  signOffText: { fontSize: 15, fontWeight: '600', color: C.misc.errorRed },
  signOnPrompt: {
    color: C.textOnNavy.secondary, fontSize: 14, fontWeight: '600', marginBottom: 12,
  },
  siteOptionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.card.bg, borderRadius: 14, padding: 16, marginBottom: 8,
    shadowColor: C.misc.shadow, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  siteOptionText: { fontSize: 15, fontWeight: '600', color: C.card.textMain, flex: 1 },

  // Job detail — Phase 3 redesign (.132p2)
  // Styles now in separate `jd` stylesheet below
  jdHeader: {}, // unused — kept to avoid references breaking
  mockBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.misc.errorBg, borderRadius: 10, padding: 10, marginVertical: 12,
    borderWidth: 1, borderColor: C.misc.errorBorder,
  },
  mockBadgeText: { fontSize: 11, fontWeight: '700', color: C.misc.errorText },
});

// ── Job Detail stylesheet — Phase 3 (.132p2) ──
const jd = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.screen.bar, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14,
  },
  backBtn: { padding: 4, marginRight: 8 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: C.textOnNavy.main, lineHeight: 26 },
  chip: {
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1.5, marginLeft: 8, flexShrink: 0, maxWidth: 180,
  },
  chipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  scroll: { padding: 16, paddingBottom: 40 },
  // Map card (fallback)
  mapCard: {
    backgroundColor: C.card.bg, borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: C.card.border, marginBottom: 14,
  },
  mapIconRow: { flexDirection: 'row', alignItems: 'center' },
  mapPin: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: C.orange.softBg, alignItems: 'center', justifyContent: 'center',
  },
  mapAddress: { fontSize: 15, fontWeight: '700', color: C.card.textMain, lineHeight: 20 },
  mapDistance: { fontSize: 12, color: C.card.textLabel, marginTop: 3 },
  // Field table
  fieldCard: {
    backgroundColor: C.card.bg, borderRadius: 16, paddingHorizontal: 18,
    paddingVertical: 4, marginBottom: 20,
    borderWidth: 1, borderColor: C.card.border,
  },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, minHeight: 48,
  },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: C.card.textLabel, letterSpacing: 0.5, width: 80 },
  fieldValue: { fontSize: 14, fontWeight: '600', color: C.card.textMain, flex: 1, textAlign: 'right' },
  fieldDivider: { height: 1, backgroundColor: C.card.divider },
  notesMore: { fontSize: 12, fontWeight: '700', color: Colors.info, marginTop: 4, textAlign: 'right' },
  // Decision row (issued)
  decisionRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  declineBtn: {
    flex: 1, borderWidth: 1.5, borderColor: C.grey.declineBorder, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.grey.declineBg, minHeight: 56,
  },
  declineBtnText: { fontSize: 15, fontWeight: '800', color: C.grey.declineText, letterSpacing: 0.5 },
  acceptBtnWrap: { flex: 1.6, borderRadius: 14 },
  acceptBtn: {
    backgroundColor: C.green.base, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
    minHeight: 56,
  },
  acceptBtnText: { fontSize: 15, fontWeight: '800', color: C.green.buttonText, letterSpacing: 0.5 },
  // Locked row (issued)
  lockedRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  lockedBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderColor: C.card.border, borderRadius: 14,
    paddingVertical: 14, backgroundColor: C.card.bg, minHeight: 50, opacity: C.grey.disabledOpacity,
  },
  lockedBtnText: { fontSize: 12, fontWeight: '700', color: C.grey.lockedIcon, letterSpacing: 0.3 },
  footerCaption: {
    fontSize: 12, color: C.textOnNavy.faint, textAlign: 'center',
    lineHeight: 18, marginTop: 4,
  },
  // Accepted state
  acceptedPill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.green.softBg, borderRadius: 14, paddingVertical: 14, marginBottom: 14,
  },
  acceptedPillText: { fontSize: 14, fontWeight: '800', color: C.green.base },
  prestartBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: C.green.base, borderRadius: 14, paddingVertical: 16, marginBottom: 12,
    minHeight: 56,
  },
  prestartBtnText: { fontSize: 14, fontWeight: '800', color: C.green.buttonText, letterSpacing: 0.3 },
  actionRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  navBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.orange.base, borderRadius: 14, paddingVertical: 16, minHeight: 56,
  },
  navBtnText: { fontSize: 14, fontWeight: '800', color: C.orange.buttonText, letterSpacing: 0.3 },
  signOnBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderColor: C.grey.declineBorder, borderRadius: 14,
    paddingVertical: 16, backgroundColor: C.card.bg, minHeight: 56,
  },
  signOnBtnText: { fontSize: 13, fontWeight: '800', color: C.card.textMain, letterSpacing: 0.3 },
  // Declined state
  declinedBlock: {
    alignItems: 'center', paddingVertical: 24, gap: 8,
  },
  declinedTitle: { fontSize: 16, fontWeight: '700', color: C.grey.lockedIcon },
  declinedSub: { fontSize: 13, color: C.grey.lockedIcon, marginBottom: 8 },
  backHomeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: `${Colors.info}40`, borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 20, marginTop: 8,
  },
  backHomeBtnText: { fontSize: 14, fontWeight: '700', color: Colors.info },
});

