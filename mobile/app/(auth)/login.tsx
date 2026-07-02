import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { login, loginWithSimpro, getToken } from '../../src/lib/auth';
import api, { apiError, TOKEN_KEY, USER_KEY } from '../../src/lib/api';
import { Colors } from '../../src/lib/colors';
import { useAuth } from '../../src/lib/AuthContext';
import ForgotPasswordModal from '../../src/components/auth/ForgotPasswordModal';
import { isBiometricAvailable, isBiometricEnabled, getBiometricType, storeBiometricToken, authenticateWithBiometric, clearBiometric } from '../../src/lib/biometric';
import { setPermissions } from '../../src/lib/permissions';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function LoginScreen() {
  const router = useRouter();
  const { setAuth, refreshModules, setMustChangePassword } = useAuth();
  const [email, setEmail] = useState('demo@paneltec.com');
  const [password, setPassword] = useState('demo123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [busySimpro, setBusySimpro] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [bioReady, setBioReady] = useState(false);
  const [bioType, setBioType] = useState('Biometric');

  React.useEffect(() => {
    (async () => {
      const avail = await isBiometricAvailable();
      const enabled = await isBiometricEnabled();
      if (avail && enabled) { setBioReady(true); setBioType(await getBiometricType()); }
    })();
  }, []);

  const handleBiometricLogin = async () => {
    setError(''); setBusy(true);
    try {
      const result = await authenticateWithBiometric();
      if (result.success && result.token) {
        await AsyncStorage.setItem(TOKEN_KEY, result.token);
        const { data: me } = await api.get('/auth/me');
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(me));
        if (me.effective_permissions) await setPermissions(me.effective_permissions);
        await refreshModules();
        if (me.must_change_password) setMustChangePassword(true);
        setAuth(true);
      }
    } catch { await clearBiometric(); setBioReady(false); setError('Session expired — please sign in with your password.'); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    setError('');
    if (!email || !password) { setError('Enter an email and password to continue.'); return; }
    setBusy(true);
    try {
      const user = await login(email, password);
      await refreshModules();
      if (user?.must_change_password) setMustChangePassword(true);
      const bioAvail = await isBiometricAvailable();
      const bioEnrolled = await isBiometricEnabled();
      if (bioAvail && !bioEnrolled) {
        const t = await getBiometricType();
        Alert.alert(`Enable ${t}?`, `Sign in faster next time with ${t}.`, [
          { text: 'Not now', onPress: () => setAuth(true) },
          { text: 'Enable', onPress: async () => { const tok = await getToken(); if (tok) await storeBiometricToken(tok); setAuth(true); }},
        ]);
      } else { setAuth(true); }
    } catch (err: any) {
      const msg = apiError(err) || 'Invalid email or password.';
      const detail = err?.response?.data?.detail;
      if (typeof detail === 'string' && detail.toLowerCase().includes('disabled')) {
        setError('Account disabled — contact your organisation administrator.');
      } else { setError(msg); }
    } finally { setBusy(false); }
  };

  const submitSimpro = async () => {
    setError('');
    if (!email) { setError('Enter your work email to sign in with Simpro.'); return; }
    setBusySimpro(true);
    try { await loginWithSimpro(email); await refreshModules(); setAuth(true); }
    catch (err: any) { setError(apiError(err) || 'Could not sign in with Simpro.'); }
    finally { setBusySimpro(false); }
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.logoRow}>
            <View style={s.logoIcon}>
              <Ionicons name="shield-checkmark" size={22} color={Colors.orange} />
            </View>
            <Text style={s.logoText}>PANELTEC <Text style={{ color: Colors.orange }}>CIVIL</Text></Text>
          </View>

          <Text style={s.h1}>Build Safer.</Text>
          <Text style={s.h1}>Build Smarter.</Text>
          <Text style={[s.h1, { color: Colors.orange }]}>Build Together.</Text>
          <Text style={s.sub}>All your civil construction safety forms, inspections, certifications and analytics — in one powerful portal.</Text>

          <View style={s.chipRow}>
            {[
              { icon: 'shield-checkmark', label: 'REAL-TIME COMPLIANCE' },
              { icon: 'sparkles', label: 'AI-POWERED INSIGHTS' },
              { icon: 'ribbon', label: 'CERT TRACKING' },
              { icon: 'bar-chart', label: 'LIVE ANALYTICS' },
            ].map((c) => (
              <View key={c.label} style={s.chip}>
                <Ionicons name={c.icon as any} size={12} color={Colors.orange} />
                <Text style={s.chipText}>{c.label}</Text>
              </View>
            ))}
          </View>

          <View testID="demo-banner" style={s.demoBanner}>
            <Ionicons name="information-circle" size={16} color={Colors.orange} />
            <View style={{ flex: 1 }}>
              <Text style={s.demoTitle}>DEMO CREDENTIALS</Text>
              <Text style={s.demoBody}>Email demo@paneltec.com · Password demo123</Text>
            </View>
          </View>

          <View testID="login-form" style={s.form}>
            <Text style={s.label}>EMAIL</Text>
            <TextInput testID="login-email" style={s.input} value={email} onChangeText={setEmail}
              placeholder="you@company.com" placeholderTextColor={Colors.textTertiary}
              keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />

            <Text style={s.label}>PASSWORD</Text>
            <TextInput testID="login-password" style={s.input} value={password} onChangeText={setPassword}
              placeholder="••••••••" placeholderTextColor={Colors.textTertiary} secureTextEntry />

            {error ? <Text testID="login-error" style={s.error}>{error}</Text> : null}

            <TouchableOpacity testID="forgot-password-link" onPress={() => setShowForgot(true)} style={{ marginTop: 8 }}>
              <Text style={s.link}>Forgot password?</Text>
            </TouchableOpacity>

            <TouchableOpacity testID="login-submit" style={s.btn} onPress={submit} disabled={busy} activeOpacity={0.7}>
              {busy ? <ActivityIndicator color="#fff" size="small" /> : (
                <><Text style={s.btnText}>SIGN IN</Text><Ionicons name="arrow-forward" size={16} color="#fff" /></>
              )}
            </TouchableOpacity>
          </View>

          <View style={s.divider}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>OR</Text>
            <View style={s.dividerLine} />
          </View>

          <TouchableOpacity testID="login-with-simpro" style={[s.secBtn, (busySimpro || !email) && { opacity: 0.5 }]}
            onPress={submitSimpro} disabled={busySimpro || !email} activeOpacity={0.7}>
            {busySimpro ? <ActivityIndicator color={Colors.textSecondary} size="small" /> :
              <Ionicons name="briefcase" size={14} color={Colors.textSecondary} />}
            <Text style={s.secBtnText}>SIGN IN WITH SIMPRO</Text>
          </TouchableOpacity>
          <Text style={s.hint}>For staff imported from Simpro — enter your work email above, then tap Sign in with Simpro.</Text>

          <View style={s.footer}>
            <Text style={s.footerText}>No account yet? </Text>
            <TouchableOpacity testID="login-to-signup" onPress={() => router.push('/(auth)/signup')}>
              <Text style={s.link}>Start your free trial</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity testID="login-pin-redeem" onPress={() => router.push('/(auth)/pin-redeem')} style={{ marginTop: 12, alignItems: 'center' }}>
            <Text style={s.link}>Have a PIN?</Text>
          </TouchableOpacity>

          {bioReady && (
            <TouchableOpacity testID="login-biometric" style={s.bioBtn} onPress={handleBiometricLogin} disabled={busy} activeOpacity={0.7}>
              <Ionicons name={bioType === 'Face ID' ? 'scan' : 'finger-print'} size={20} color={Colors.orange} />
              <Text style={s.bioBtnText}>Sign in with {bioType}</Text>
            </TouchableOpacity>
          )}

          <ForgotPasswordModal visible={showForgot} onClose={() => setShowForgot(false)} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 40, paddingBottom: 32 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 32 },
  logoIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.orangeSoft, alignItems: 'center', justifyContent: 'center' },
  logoText: { fontSize: 18, fontWeight: '800', color: Colors.ink, letterSpacing: 1.5 },
  h1: { fontSize: 28, fontWeight: '800', color: Colors.ink, letterSpacing: -0.5, lineHeight: 34 },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 8, lineHeight: 19 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(249,115,22,0.3)', backgroundColor: Colors.orangeSoft },
  chipText: { fontSize: 9, fontWeight: '700', color: Colors.orange, letterSpacing: 0.8 },
  demoBanner: { flexDirection: 'row', gap: 10, marginTop: 20, padding: 12, borderRadius: 12, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: 'flex-start' },
  demoTitle: { fontSize: 10, fontWeight: '700', color: Colors.orange, letterSpacing: 1 },
  demoBody: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  form: { marginTop: 24 },
  label: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 1.2, marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, color: Colors.text },
  error: { color: Colors.red, fontSize: 12, marginTop: 8 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.orange, borderRadius: 12, paddingVertical: 15, marginTop: 20, minHeight: 52 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  footer: { flexDirection: 'row', marginTop: 24, justifyContent: 'center' },
  footerText: { fontSize: 14, color: Colors.textSecondary },
  link: { fontSize: 14, fontWeight: '600', color: Colors.orange },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20, marginBottom: 4 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.textTertiary },
  secBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingVertical: 14, marginTop: 12, backgroundColor: Colors.surface, minHeight: 52 },
  secBtnText: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.5 },
  hint: { fontSize: 11, color: Colors.textTertiary, marginTop: 6, textAlign: 'center' },
  bioBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: 'rgba(249,115,22,0.3)', borderRadius: 12, paddingVertical: 14, marginTop: 12, backgroundColor: Colors.orangeSoft, minHeight: 52 },
  bioBtnText: { fontSize: 14, fontWeight: '700', color: Colors.orange },
});
