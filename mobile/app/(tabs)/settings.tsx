/**
 * Settings tab — v58.13.132mo
 * Profile info, app version, updates, admin tools, sign out.
 * Help & Support section with manual links.
 * App / Admin Manual gated to admin-qualifying roles (.132ku).
 * About section with version details + clipboard copy (.132mo).
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  ActivityIndicator, Modal, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Colors, C } from '../../src/theme/colors';
import Wordmark from '../../src/components/Wordmark';
import { getStoredUser, getStoredRoleLabel, clearSession, isPreviewSession } from '../../src/services/auth';
import { authGet } from '../../src/services/apiClient';
import { MOBILE_BUNDLE_VERSION, SHIP_LABEL } from '../../src/lib/version';
import {
  getSimulateRole, setSimulateRole, ROLE_OPTIONS,
  type SimulateRoleId,
} from '../../src/services/simulateRole';
import { useUpdateCheck, type CheckResult } from '../../src/features/updates/useUpdateCheck';
import { warningHaptic, mediumHaptic } from '../../src/services/haptics';
import * as Application from 'expo-application';

interface MeResponse {
  id: string;
  name: string;
  email: string;
  role: string;
  role_id: string;
  role_label?: string;
  org_id: string;
  activation_status: string;
  [key: string]: unknown;
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [roleLabel, setRoleLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [dataSource, setDataSource] = useState<'api' | 'stored' | 'none'>('none');
  const [simRole, setSimRole] = useState<SimulateRoleId>('');
  const [showSignOut, setShowSignOut] = useState(false);
  const [debugTaps, setDebugTaps] = useState(0);
  const [showAbout, setShowAbout] = useState(false);
  const [backendVersion, setBackendVersion] = useState<string | null>(null);
  const [copiedToast, setCopiedToast] = useState(false);

  const update = useUpdateCheck();

  const loadProfile = useCallback(async () => {
    setLoading(true);
    const sr = await getSimulateRole();
    setSimRole(sr);

    const res = await authGet<MeResponse>('/api/auth/me');
    if (res.ok) {
      setUser(res.data);
      setDataSource('api');
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
      const storedUser = await getStoredUser();
      if (storedUser?.name) {
        setUser(storedUser);
        setDataSource('stored');
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

  const handleLogout = useCallback(async () => {
    warningHaptic();
    await clearSession();
    router.replace('/(auth)/pin-entry');
    setShowSignOut(false);
  }, [router]);

  const initials = user?.name
    ? user.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  const ADMIN_QUALIFYING_ROLES = [
    'admin', 'hseq_lead', 'hseq_manager', 'hseq_manager_2',
    'responsible_manager', 'report_emailing_admin', 'supervisor', 'manager',
  ];
  const userRole = (user?.role_id || user?.role || '').toLowerCase();
  const isAdmin = ADMIN_QUALIFYING_ROLES.includes(userRole);

  if (loading) {
    return (
      <View testID="settings-loading" style={[s.container, { paddingTop: insets.top, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={Colors.orange} />
      </View>
    );
  }

  return (
    <View testID="settings-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={s.scrollContent}>
        {/* Profile card */}
        <View style={s.profileCard}>
          <View style={s.avatarCircle}>
            <Text style={s.avatarText}>{initials}</Text>
          </View>
          <View style={s.profileInfo}>
            <Text testID="settings-name" style={s.profileName} numberOfLines={1}>{user?.name || 'Unknown'}</Text>
            <Text testID="settings-role" style={s.profileRole}>{roleLabel || user?.role_id || 'Worker'}</Text>
            {user?.email && <Text style={s.profileEmail}>{user.email}</Text>}
          </View>
          {dataSource === 'api' && (
            <View style={s.liveDot}>
              <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
            </View>
          )}
        </View>

        {/* Profile sub-screens */}
        <Text style={s.sectionLabel}>PROFILE</Text>
        <SettingsRow
          testID="settings-nav-personal"
          icon="person-outline" iconColor="#3B82F6" iconBg="#DBEAFE"
          title="Personal Information"
          onPress={() => router.push('/profile/personal')}
        />
        <SettingsRow
          testID="settings-nav-certs"
          icon="ribbon-outline" iconColor="#059669" iconBg="#D1FAE5"
          title="My Certifications"
          onPress={() => router.push('/profile/certifications')}
        />
        <SettingsRow
          testID="settings-nav-inductions"
          icon="checkmark-circle-outline" iconColor="#7C3AED" iconBg="#EDE9FE"
          title="My Inductions"
          onPress={() => router.push('/profile/inductions')}
        />
        <SettingsRow
          testID="settings-nav-idcard"
          icon="card-outline" iconColor="#0891B2" iconBg="#CFFAFE"
          title="Digital ID Card"
          onPress={() => router.push('/profile/id-card')}
        />

        {/* App section */}
        <Text style={s.sectionLabel}>APP</Text>
        <SettingsRow
          testID="settings-nav-mywork"
          icon="briefcase-outline" iconColor={Colors.orange} iconBg={Colors.orangeSoft}
          title="My Records"
          onPress={() => router.push('/(screens)/my-work')}
        />
        <SettingsRow
          testID="settings-nav-swms"
          icon="shield-checkmark-outline" iconColor="#8B5CF6" iconBg="#F5F3FF"
          title="My SWMS"
          onPress={() => router.push({ pathname: '/forms/category/[key]', params: { key: 'swms', title: 'SWMS' } } as never)}
        />
        <SettingsRow
          testID="settings-nav-askai"
          icon="sparkles-outline" iconColor="#7C3AED" iconBg="#F5F3FF"
          title="Ask AI"
          onPress={() => router.push('/(screens)/ask-ai')}
        />

        {/* v58.13.132jp — Legal links required for Google Play + Apple
            TestFlight submission. Both open in system browser. */}
        <Text style={s.sectionLabel}>LEGAL</Text>
        <SettingsRow
          testID="settings-privacy-policy"
          icon="shield-checkmark-outline" iconColor="#0EA5E9" iconBg="#E0F2FE"
          title="Privacy Policy"
          onPress={() => Linking.openURL('https://whs-compliance.preview.emergentagent.com/legal/privacy-policy.html')}
        />
        <SettingsRow
          testID="settings-terms-of-service"
          icon="document-text-outline" iconColor="#64748B" iconBg="#F1F5F9"
          title="Terms of Service"
          onPress={() => Linking.openURL('https://whs-compliance.preview.emergentagent.com/legal/terms-of-service.html')}
        />

        {/* Help & Support */}
        <Text style={s.sectionLabel}>HELP & SUPPORT</Text>
        <SettingsRow
          testID="settings-user-manual"
          icon="book-outline" iconColor="#0891B2" iconBg="#CFFAFE"
          title="User Manual (Phone)"
          onPress={() => Linking.openURL('https://whs-compliance.preview.emergentagent.com/manuals/user')}
        />
        {isAdmin && (
          <SettingsRow
            testID="settings-admin-manual"
            icon="desktop-outline" iconColor="#3B82F6" iconBg="#DBEAFE"
            title="App / Admin Manual"
            onPress={() => Linking.openURL('https://whs-compliance.preview.emergentagent.com/manuals/admin')}
          />
        )}

        {/* Updates */}
        <TouchableOpacity
          testID="settings-check-updates"
          style={s.row}
          onPress={async () => {
            if (update.checking) return;
            mediumHaptic();
            const result: CheckResult = await update.manualCheck();
            if (result.error) {
              Alert.alert('Check Failed', result.error);
            } else if (result.available) {
              mediumHaptic();
              Alert.alert(
                'Update Available',
                `You are on v${result.installedVersion} (build ${result.installedBuildCode}).\n\nLatest available: v${result.serverVersion} (build ${result.serverBuildCode}).\n\nInstall now?`,
                [
                  { text: 'Later', style: 'cancel' },
                  { text: 'Install', onPress: update.install },
                ],
              );
            } else {
              Alert.alert(
                'Up to Date',
                `You are on v${result.installedVersion} (build ${result.installedBuildCode}).\n\nLatest available: v${result.serverVersion} (build ${result.serverBuildCode}).\n\nYou are up to date.`,
              );
            }
          }}
          activeOpacity={0.7}
        >
          <View style={[s.rowIcon, { backgroundColor: '#DBEAFE' }]}>
            <Ionicons name="cloud-download-outline" size={20} color="#2C6BFF" />
          </View>
          <View style={s.rowContent}>
            <Text style={s.rowTitle}>Check for Updates</Text>
            <Text style={s.rowSub}>
              v{Application.nativeApplicationVersion || require('../../app.json').expo.version} · build {Application.nativeBuildVersion || require('../../app.json').expo.android.versionCode}
            </Text>
          </View>
          {update.checking ? (
            <ActivityIndicator size="small" color={Colors.orange} />
          ) : update.available ? (
            <View style={s.updateDot} />
          ) : (
            <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
          )}
        </TouchableOpacity>

        {/* About — expanded inline */}
        <TouchableOpacity
          testID="settings-about-toggle"
          style={s.row}
          onPress={async () => {
            mediumHaptic();
            const next = !showAbout;
            setShowAbout(next);
            if (next && backendVersion === null) {
              try {
                const res = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/`);
                if (res.ok) {
                  const data = await res.json();
                  setBackendVersion(data.version || 'unknown');
                } else {
                  setBackendVersion('unavailable');
                }
              } catch {
                setBackendVersion('unavailable');
              }
            }
          }}
          activeOpacity={0.7}
        >
          <View style={[s.rowIcon, { backgroundColor: '#F3E8FF' }]}>
            <Ionicons name="information-circle-outline" size={20} color="#7C3AED" />
          </View>
          <View style={s.rowContent}>
            <Text style={s.rowTitle}>About</Text>
            <Text style={s.rowSub}>Version info & diagnostics</Text>
          </View>
          <Ionicons name={showAbout ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textTertiary} />
        </TouchableOpacity>

        {showAbout && (
          <View testID="settings-about-panel" style={s.aboutPanel}>
            <View style={s.aboutRow}>
              <Text style={s.aboutLabel}>Client version</Text>
              <Text testID="about-client-version" style={s.aboutValue}>
                v{Application.nativeApplicationVersion || require('../../app.json').expo.version}
              </Text>
            </View>
            <View style={s.aboutRow}>
              <Text style={s.aboutLabel}>Build number</Text>
              <Text testID="about-build-number" style={s.aboutValue}>
                {Application.nativeBuildVersion || require('../../app.json').expo.android.versionCode}
              </Text>
            </View>
            <View style={s.aboutRow}>
              <Text style={s.aboutLabel}>Ship label</Text>
              <Text testID="about-ship-label" style={s.aboutValue}>{SHIP_LABEL}</Text>
            </View>
            <View style={s.aboutRow}>
              <Text style={s.aboutLabel}>Bundle tag</Text>
              <Text testID="about-bundle-tag" style={[s.aboutValue, { fontSize: 11 }]}>{MOBILE_BUNDLE_VERSION}</Text>
            </View>
            <View style={[s.aboutRow, { borderBottomWidth: 0 }]}>
              <Text style={s.aboutLabel}>Backend version</Text>
              {backendVersion === null ? (
                <ActivityIndicator size="small" color={Colors.orange} />
              ) : (
                <Text testID="about-backend-version" style={s.aboutValue}>{backendVersion}</Text>
              )}
            </View>

            <TouchableOpacity
              testID="about-copy-btn"
              style={s.aboutCopyBtn}
              onPress={async () => {
                const clientVer = Application.nativeApplicationVersion || require('../../app.json').expo.version;
                const buildNum = Application.nativeBuildVersion || require('../../app.json').expo.android.versionCode;
                const info = [
                  `Paneltec Civil Mobile`,
                  `Client: v${clientVer}`,
                  `Build: ${buildNum}`,
                  `Ship: ${SHIP_LABEL}`,
                  `Bundle: ${MOBILE_BUNDLE_VERSION}`,
                  `Backend: ${backendVersion || 'unknown'}`,
                ].join('\n');
                await Clipboard.setStringAsync(info);
                setCopiedToast(true);
                mediumHaptic();
                setTimeout(() => setCopiedToast(false), 2000);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name={copiedToast ? 'checkmark-circle' : 'copy-outline'} size={18} color={copiedToast ? Colors.success : '#7C3AED'} />
              <Text style={[s.aboutCopyText, copiedToast && { color: Colors.success }]}>
                {copiedToast ? 'Copied to clipboard!' : 'Copy version info'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Admin Tools */}
        {isAdmin && (
          <>
            <Text style={s.sectionLabel}>ADMIN TOOLS</Text>
            <View testID="role-simulator" style={s.simCard}>
              <Text style={s.simLabel}>Role Simulator</Text>
              <Text style={s.simHint}>Test worker flows without leaving your admin account</Text>
              <View style={s.simPills}>
                {ROLE_OPTIONS.map((opt) => {
                  const active = simRole === opt.id;
                  return (
                    <TouchableOpacity
                      key={opt.id || 'off'}
                      testID={`sim-role-${opt.id || 'off'}`}
                      style={[s.simPill, active && s.simPillActive]}
                      onPress={async () => {
                        await setSimulateRole(opt.id);
                        setSimRole(opt.id);
                        mediumHaptic();
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.simPillText, active && s.simPillTextActive]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {simRole !== '' && (
                <View style={s.simActiveBanner}>
                  <Ionicons name="flash" size={12} color="#7C3AED" />
                  <Text style={s.simActiveText}>
                    Active — API calls include X-Simulate-Role: {simRole}
                  </Text>
                </View>
              )}
            </View>
          </>
        )}

        {/* Sign Out */}
        <View style={{ marginTop: 16 }}>
          <TouchableOpacity
            testID="settings-signout-btn"
            style={s.signoutBtn}
            onPress={() => setShowSignOut(true)}
          >
            <Ionicons name="log-out-outline" size={20} color={Colors.error} />
            <Text style={s.signoutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        {/* Footer — triple-tap clears dismissed flag and rechecks */}
        <TouchableOpacity
          testID="settings-version-debug"
          activeOpacity={1}
          onPress={() => {
            const next = debugTaps + 1;
            setDebugTaps(next);
            if (next >= 3) {
              setDebugTaps(0);
              mediumHaptic();
              update.clearDismissedAndRecheck().then((result: CheckResult) => {
                Alert.alert(
                  'Debug: Update Check',
                  `Dismissed flag cleared.\n\nInstalled: v${result.installedVersion} (build ${result.installedBuildCode})\nServer: v${result.serverVersion} (build ${result.serverBuildCode})\nHas update: ${result.available}\nError: ${result.error || 'none'}`,
                );
              });
            }
          }}
        >
          <View style={s.footer}>
            <Wordmark size="sm" color={Colors.border} showSubtitle={false} />
            <Text style={s.versionText}>{MOBILE_BUNDLE_VERSION}</Text>
          </View>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Sign Out Confirmation Modal */}
      <Modal
        visible={showSignOut}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSignOut(false)}
      >
        <View testID="signout-modal" style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Ionicons name="log-out-outline" size={32} color={Colors.error} style={{ marginBottom: 12 }} />
            <Text style={s.modalTitle}>Sign Out?</Text>
            <Text style={s.modalBody}>Your device stays provisioned — only your session is cleared.</Text>
            <View style={s.modalActions}>
              <TouchableOpacity
                testID="signout-cancel"
                style={s.modalCancelBtn}
                onPress={() => setShowSignOut(false)}
              >
                <Text style={s.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="signout-confirm"
                style={s.modalConfirmBtn}
                onPress={handleLogout}
              >
                <Text style={s.modalConfirmText}>Sign Out</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SettingsRow({
  testID, icon, iconColor, iconBg, title, onPress,
}: {
  testID: string; icon: string; iconColor: string; iconBg: string;
  title: string; onPress: () => void;
}) {
  return (
    <TouchableOpacity testID={testID} style={s.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[s.rowIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={20} color={iconColor} />
      </View>
      <View style={s.rowContent}>
        <Text style={s.rowTitle}>{title}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.screen.bg },
  header: { backgroundColor: C.screen.bg, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 18 },
  headerTitle: { color: C.textOnNavy.main, fontSize: 26, fontWeight: '800' },
  scrollContent: { paddingBottom: 32 },

  // Profile card
  profileCard: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginTop: 16, marginBottom: 8,
    backgroundColor: C.card.bg, borderRadius: 16, padding: 16,
    shadowColor: C.misc.shadow, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  avatarCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: C.textOnNavy.main, fontSize: 22, fontWeight: '800' },
  profileInfo: { flex: 1, marginLeft: 14 },
  profileName: { fontSize: 18, fontWeight: '800', color: C.card.textMain },
  profileRole: { fontSize: 14, fontWeight: '600', color: Colors.orange, marginTop: 2, textTransform: 'capitalize' },
  profileEmail: { fontSize: 13, color: C.textOnNavy.faint, marginTop: 2 },
  liveDot: { position: 'absolute', top: 12, right: 12 },

  // Section labels
  sectionLabel: {
    fontSize: 12, fontWeight: '800', color: 'rgba(255,255,255,0.45)',
    letterSpacing: 1, marginTop: 20, marginBottom: 8,
    paddingHorizontal: 20,
  },

  // Rows
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 16,
    backgroundColor: C.card.bg, minHeight: 60,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  rowIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowContent: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: C.card.textMain },
  rowSub: { fontSize: 13, color: C.textOnNavy.faint, marginTop: 2 },
  updateDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2C6BFF' },

  // Admin
  simCard: { backgroundColor: C.card.bg, paddingHorizontal: 16, paddingVertical: 14 },
  simLabel: { fontSize: 16, fontWeight: '700', color: C.card.textMain },
  simHint: { fontSize: 13, color: C.textOnNavy.faint, marginTop: 2, marginBottom: 12 },
  simPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  simPill: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1.5, borderColor: C.card.border, backgroundColor: Colors.bg,
    minHeight: 44, justifyContent: 'center',
  },
  simPillActive: { borderColor: '#7C3AED', backgroundColor: '#F5F3FF' },
  simPillText: { fontSize: 14, fontWeight: '600', color: C.textOnNavy.faint },
  simPillTextActive: { color: Colors.viatec },
  simActiveBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#F5F3FF', borderRadius: 10, padding: 10, marginTop: 10,
    borderWidth: 1, borderColor: '#7C3AED20',
  },
  simActiveText: { fontSize: 12, fontWeight: '600', color: Colors.viatec, flex: 1 },

  // Sign out
  signoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    marginHorizontal: 16, paddingVertical: 16, borderRadius: 14,
    borderWidth: 1.5, borderColor: Colors.errorSoft, backgroundColor: C.card.bg,
    minHeight: 56,
  },
  signoutText: { fontSize: 16, fontWeight: '600', color: Colors.error },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32,
  },
  modalCard: {
    backgroundColor: C.card.bg, borderRadius: 20, padding: 28,
    alignItems: 'center', width: '100%', maxWidth: 340,
    shadowColor: C.misc.shadow, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15, shadowRadius: 24, elevation: 10,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: C.card.textMain, marginBottom: 6 },
  modalBody: { fontSize: 14, color: C.textOnNavy.secondary, textAlign: 'center', lineHeight: 20 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 20, width: '100%' },
  modalCancelBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    borderWidth: 1.5, borderColor: C.card.border,
    alignItems: 'center', minHeight: 48,
  },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: C.card.textMain },
  modalConfirmBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    backgroundColor: Colors.error, alignItems: 'center', minHeight: 48,
  },
  modalConfirmText: { fontSize: 15, fontWeight: '700', color: C.textOnNavy.main },

  // Footer
  footer: { alignItems: 'center', marginTop: 24, gap: 6, opacity: 0.3 },
  versionText: { fontSize: 11, color: 'rgba(255,255,255,0.7)' },

  // About panel (.132mo)
  aboutPanel: {
    backgroundColor: C.card.bg, paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  aboutRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  aboutLabel: { fontSize: 13, fontWeight: '600', color: C.textOnNavy.faint },
  aboutValue: { fontSize: 13, fontWeight: '700', color: C.card.textMain, fontFamily: 'monospace' },
  aboutCopyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 12, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#7C3AED30', backgroundColor: '#F5F3FF',
    minHeight: 48,
  },
  aboutCopyText: { fontSize: 14, fontWeight: '700', color: Colors.viatec },
});
