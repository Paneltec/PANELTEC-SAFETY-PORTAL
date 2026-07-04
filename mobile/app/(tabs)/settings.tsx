import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, RefreshControl, Switch, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getUser, signOut, initials, getToken } from '../../src/lib/auth';
import { Colors } from '../../src/lib/colors';
import { useAuth } from '../../src/lib/AuthContext';
import { useRouter } from 'expo-router';
import ChangePasswordModal from '../../src/components/auth/ChangePasswordModal';
import { isBiometricAvailable, isBiometricEnabled, getBiometricType, storeBiometricToken, clearBiometric } from '../../src/lib/biometric';
import api from '../../src/lib/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TIMEOUT_OPTIONS = [
  { label: '15 MIN', value: 15 },
  { label: '30 MIN', value: 30 },
  { label: '1 HR', value: 60 },
  { label: '8 HR', value: 480 },
  { label: 'OFF', value: 0 },
];

const ALERT_OPTIONS = ['both', 'email', 'sms', 'off'] as const;

export default function ProfileScreen() {
  const { setAuth, refreshModules, modules } = useAuth();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [bioType, setBioType] = useState('Biometric');
  const [sessionTimeout, setSessionTimeout] = useState(30);
  const [suspAlert, setSuspAlert] = useState<string>('both');
  const [sessionsOpen, setSessionsOpen] = useState(false);

  useEffect(() => { getUser().then(setUser); }, []);

  useEffect(() => {
    (async () => {
      const avail = await isBiometricAvailable();
      setBioAvailable(avail);
      if (avail) { setBioEnabled(await isBiometricEnabled()); setBioType(await getBiometricType()); }
    })();
  }, []);

  useEffect(() => {
    api.get('/settings/session-timeout/me').then(({ data }) => {
      if (data?.timeout_minutes != null) setSessionTimeout(data.timeout_minutes);
    }).catch(() => {});
    api.get('/me/suspicious-alerts').then(({ data }) => {
      if (data?.mode) setSuspAlert(data.mode);
    }).catch(() => {});
  }, []);

  const toggleBiometric = async (val: boolean) => {
    if (val) { const tok = await getToken(); if (tok) { await storeBiometricToken(tok); setBioEnabled(true); } }
    else { await clearBiometric(); setBioEnabled(false); }
  };

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => { await signOut(); setAuth(false); }},
    ]);
  };

  const setTimeoutVal = async (val: number) => {
    setSessionTimeout(val);
    try { await api.patch('/settings/session-timeout/me', { timeout_minutes: val }); } catch {}
  };

  const setSuspAlertVal = async (mode: string) => {
    setSuspAlert(mode);
    try { await api.patch('/me/suspicious-alerts', { mode }); } catch {}
  };

  const clearCache = async () => {
    await AsyncStorage.clear();
    Alert.alert('Cache cleared', 'All local data has been cleared. The app will now reload.');
    setAuth(false);
  };

  const onPullRefresh = async () => {
    setRefreshing(true);
    await refreshModules();
    const u = await getUser();
    setUser(u);
    setRefreshing(false);
  };

  const relLogin = () => {
    if (!user?.last_login) return '—';
    const mins = Math.round((Date.now() - new Date(user.last_login).getTime()) / 60000);
    if (mins < 1) return 'JUST NOW';
    if (mins < 60) return `${mins} MIN AGO`;
    if (mins < 1440) return `${Math.round(mins / 60)} HR AGO`;
    return `${Math.round(mins / 1440)} DAYS AGO`;
  };

  const rolePill = () => {
    const r = (user?.role || '').toLowerCase();
    if (r === 'admin') return { label: 'ADMIN', bg: Colors.goldSoft, color: Colors.gold, border: 'rgba(234,179,8,0.3)' };
    if (r === 'hseq_lead') return { label: 'HSEQ LEAD', bg: Colors.orangeSoft, color: Colors.orange, border: 'rgba(249,115,22,0.3)' };
    return { label: (user?.role || 'USER').toUpperCase(), bg: Colors.surfaceLight, color: Colors.textSecondary, border: Colors.border };
  };

  const rp = rolePill();

  return (
    <SafeAreaView style={st.safe}>
      <ScrollView testID="profile-page" style={st.scroll} contentContainerStyle={st.content}
        refreshControl={<RefreshControl testID="profile-pull-refresh" refreshing={refreshing} onRefresh={onPullRefresh} tintColor={Colors.orange} />}>

        {/* Profile header */}
        {user && (
          <View testID="profile-card" style={st.profileHeader}>
            <View style={st.avatar}>
              <Text style={st.avatarText}>{initials(user)}</Text>
            </View>
            <Text style={st.profileName}>{(user.name || 'User').toUpperCase()}</Text>
            <Text style={st.profileEmail}>{user.email}</Text>
            <View style={[st.rolePill, { backgroundColor: rp.bg, borderColor: rp.border }]}>
              <View style={[st.ledDot, { backgroundColor: rp.color }]} />
              <Text style={[st.roleText, { color: rp.color }]}>{rp.label}</Text>
            </View>
            <Text style={st.lastLogin}>LAST LOGIN · {relLogin()}</Text>
          </View>
        )}

        {/* Session timeout */}
        <Text style={st.sectionLabel}>SESSION TIMEOUT</Text>
        <View style={st.segmentedRow}>
          {TIMEOUT_OPTIONS.map(opt => (
            <TouchableOpacity key={opt.value} testID={`timeout-${opt.value}`}
              style={[st.segBtn, sessionTimeout === opt.value && st.segBtnActive]}
              onPress={() => setTimeoutVal(opt.value)} activeOpacity={0.7}>
              <Text style={[st.segText, sessionTimeout === opt.value && st.segTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Suspicious login alerts */}
        <Text style={st.sectionLabel}>SUSPICIOUS LOGIN ALERTS</Text>
        <View style={st.segmentedRow}>
          {ALERT_OPTIONS.map(opt => (
            <TouchableOpacity key={opt} testID={`susp-alert-${opt}`}
              style={[st.segBtn, suspAlert === opt && st.segBtnActive]}
              onPress={() => setSuspAlertVal(opt)} activeOpacity={0.7}>
              <Text style={[st.segText, suspAlert === opt && st.segTextActive]}>{opt.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Active sessions */}
        <TouchableOpacity testID="sessions-toggle" style={st.card} onPress={() => setSessionsOpen(!sessionsOpen)} activeOpacity={0.7}>
          <Ionicons name="layers" size={18} color={Colors.orange} />
          <Text style={st.cardText}>ACTIVE SESSIONS</Text>
          <Ionicons name={sessionsOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textTertiary} />
        </TouchableOpacity>
        {sessionsOpen && (
          <View style={st.sessionInfo}>
            <Text style={st.sessionText}>Current session active. Additional session management available on the web dashboard.</Text>
          </View>
        )}

        {/* Security */}
        <Text style={st.sectionLabel}>SECURITY</Text>
        <View style={st.section}>
          <TouchableOpacity testID="settings-change-password" style={st.row} activeOpacity={0.7} onPress={() => setShowChangePw(true)}>
            <Ionicons name="lock-closed" size={18} color={Colors.orange} />
            <Text style={st.rowText}>CHANGE PASSWORD</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
          </TouchableOpacity>
          {bioAvailable && (
            <View style={st.row}>
              <Ionicons name="finger-print" size={18} color={Colors.orange} />
              <Text style={[st.rowText, { flex: 1 }]}>{bioType.toUpperCase()} SIGN-IN</Text>
              <Switch testID="settings-biometric-toggle" value={bioEnabled} onValueChange={toggleBiometric}
                trackColor={{ false: Colors.surfaceLight, true: 'rgba(249,115,22,0.4)' }}
                thumbColor={bioEnabled ? Colors.orange : Colors.textTertiary} />
            </View>
          )}
        </View>

        {/* Quick links — v160.0: admin-only links hidden for workers. */}
        <Text style={st.sectionLabel}>SETTINGS</Text>
        <View style={st.section}>
          {(() => {
            const role = (user?.role || '').toLowerCase();
            const isPrivileged = role === 'admin' || role === 'hseq_lead' || role === 'supervisor';
            const items: any[] = [
              { label: 'Workers', icon: 'people', route: '/workers', moduleKey: 'inductions', adminOnly: false },
              { label: 'Certifications', icon: 'ribbon', route: '/certifications', moduleKey: 'certifications', adminOnly: false },
              { label: 'Organisation', icon: 'business', route: undefined, moduleKey: undefined, adminOnly: true },
              { label: 'Users', icon: 'people-circle', route: '/users', moduleKey: 'users_directory', adminOnly: true },
              { label: 'Compliance Hub', icon: 'shield-checkmark', route: '/(tabs)/compliance', moduleKey: undefined, adminOnly: true },
            ];
            return items
              .filter((item) => !item.adminOnly || isPrivileged)
              .filter((item) => !item.moduleKey || (modules as any)[item.moduleKey])
              .map((item) => (
                <TouchableOpacity key={item.label} testID={`settings-${item.label.toLowerCase().replace(/\s/g, '-')}`}
                  style={st.row} activeOpacity={0.7} onPress={() => item.route ? router.push(item.route as any) : undefined}>
                  <Ionicons name={item.icon} size={18} color={Colors.textSecondary} />
                  <Text style={st.rowText}>{item.label.toUpperCase()}</Text>
                  <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
                </TouchableOpacity>
              ));
          })()}
        </View>

        {/* Actions */}
        <TouchableOpacity testID="clear-cache-btn" style={st.actionRow} onPress={clearCache} activeOpacity={0.7}>
          <Ionicons name="trash" size={18} color={Colors.textSecondary} />
          <Text style={st.actionText}>CLEAR CACHE & RELOAD</Text>
        </TouchableOpacity>

        <TouchableOpacity testID="sign-out-btn" style={st.signOutBtn} onPress={handleSignOut} activeOpacity={0.7}>
          <Ionicons name="log-out" size={18} color="#fff" />
          <Text style={st.signOutText}>SIGN OUT</Text>
        </TouchableOpacity>

        <ChangePasswordModal visible={showChangePw} onClose={() => setShowChangePw(false)} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  profileHeader: { alignItems: 'center', paddingVertical: 28, marginBottom: 24 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  avatarText: { color: '#fff', fontSize: 24, fontWeight: '800' },
  profileName: { fontSize: 20, fontWeight: '800', color: Colors.ink, letterSpacing: 1.5 },
  profileEmail: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  rolePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1, marginTop: 10 },
  ledDot: { width: 6, height: 6, borderRadius: 3 },
  roleText: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  lastLogin: { fontSize: 10, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 1.2, marginTop: 10 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: Colors.textTertiary, marginBottom: 8, marginTop: 8 },
  segmentedRow: { flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', marginBottom: 16 },
  segBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  segBtnActive: { backgroundColor: Colors.orange },
  segText: { fontSize: 10, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 0.5 },
  segTextActive: { color: '#fff' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 4 },
  cardText: { flex: 1, fontSize: 12, fontWeight: '700', color: Colors.ink, letterSpacing: 0.8 },
  sessionInfo: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 14, marginBottom: 16, marginTop: 4 },
  sessionText: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },
  section: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, overflow: 'hidden', marginBottom: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  rowText: { flex: 1, fontSize: 12, fontWeight: '700', color: Colors.ink, letterSpacing: 0.5 },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, marginBottom: 12 },
  actionText: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.8 },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 12, backgroundColor: Colors.orange },
  signOutText: { fontSize: 13, fontWeight: '800', color: '#fff', letterSpacing: 1 },
});
