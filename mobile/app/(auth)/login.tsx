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
      if (avail && enabled) {
        setBioReady(true);
        const t = await getBiometricType();
        setBioType(t);
      }
    })();
  }, []);

  const handleBiometricLogin = async () => {
    setError('');
    setBusy(true);
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
    } catch {
      await clearBiometric();
      setBioReady(false);
      setError('Session expired — please sign in with your password.');
    } finally {
      setBusy(false);
    }
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
          { text: 'Enable', onPress: async () => {
            const tok = await getToken();
            if (tok) await storeBiometricToken(tok);
            setAuth(true);
          }},
        ]);
      } else {
        setAuth(true);
      }
    } catch (err: any) {
      const msg = apiError(err) || 'Invalid email or password.';
      const detail = err?.response?.data?.detail;
      if (typeof detail === 'string' && detail.toLowerCase().includes('disabled')) {
        setError('Account disabled — contact your organisation administrator to re-enable your account.');
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitSimpro = async () => {
    setError('');
    if (!email) { setError('Enter your work email to sign in with Simpro.'); return; }
    setBusySimpro(true);
    try {
      await loginWithSimpro(email);
      await refreshModules();
      setAuth(true);
    } catch (err: any) {
      const msg = apiError(err) || 'Could not sign in with Simpro.';
      setError(msg);
    } finally {
      setBusySimpro(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.logoWrap}>
            <View style={styles.logoIcon}>
              <Ionicons name="shield-checkmark" size={24} color={Colors.blue} />
            </View>
            <Text style={styles.logoText}>Paneltec <Text style={{ color: Colors.blue }}>Civil</Text></Text>
          </View>

          <Text style={styles.heading}>Build Safer.</Text>
          <Text style={styles.heading}>Build Smarter.</Text>
          <Text style={[styles.heading, { color: '#F4C430' }]}>Build Together.</Text>
          <Text style={styles.sub}>All your civil construction safety forms, inspections, certifications and analytics — in one powerful portal.</Text>

          <View style={styles.valueGrid}>
            <View style={[styles.valueChip, { borderColor: '#F4C43060' }]}>
              <Ionicons name="shield-checkmark" size={14} color="#F4C430" />
              <Text style={[styles.valueText, { color: '#F4C430' }]}>Real-time Compliance</Text>
            </View>
            <View style={[styles.valueChip, { borderColor: '#F4C43060' }]}>
              <Ionicons name="sparkles" size={14} color="#F4C430" />
              <Text style={[styles.valueText, { color: '#F4C430' }]}>AI-Powered Insights</Text>
            </View>
            <View style={[styles.valueChip, { borderColor: '#F4C43060' }]}>
              <Ionicons name="ribbon" size={14} color="#F4C430" />
              <Text style={[styles.valueText, { color: '#F4C430' }]}>Cert Tracking</Text>
            </View>
            <View style={[styles.valueChip, { borderColor: '#F4C43060' }]}>
              <Ionicons name="bar-chart" size={14} color="#F4C430" />
              <Text style={[styles.valueText, { color: '#F4C430' }]}>Live Analytics</Text>
            </View>
          </View>

          <View testID="demo-banner" style={styles.demoBanner}>
            <Ionicons name="information-circle" size={16} color={Colors.blue} />
            <View style={{ flex: 1 }}>
              <Text style={styles.demoTitle}>Demo credentials</Text>
              <Text style={styles.demoBody}>Email demo@paneltec.com · Password demo123</Text>
            </View>
          </View>

          <View testID="login-form" style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              testID="login-email"
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@company.com"
              placeholderTextColor={Colors.textTertiary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              testID="login-password"
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={Colors.textTertiary}
              secureTextEntry
            />

            {error ? <Text testID="login-error" style={styles.error}>{error}</Text> : null}

            <TouchableOpacity testID="forgot-password-link" onPress={() => setShowForgot(true)} style={{ marginTop: 6 }}>
              <Text style={styles.link}>Forgot password?</Text>
            </TouchableOpacity>

            <TouchableOpacity testID="login-submit" style={styles.btn} onPress={submit} disabled={busy} activeOpacity={0.7}>
              {busy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Text style={styles.btnText}>Sign in</Text>
                  <Ionicons name="arrow-forward" size={16} color="#fff" />
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            testID="login-with-simpro"
            style={[styles.simproBtn, (busySimpro || !email) && { opacity: 0.6 }]}
            onPress={submitSimpro}
            disabled={busySimpro || !email}
            activeOpacity={0.7}
          >
            {busySimpro ? (
              <ActivityIndicator color={Colors.text} size="small" />
            ) : (
              <Ionicons name="briefcase" size={14} color={Colors.text} />
            )}
            <Text style={styles.simproBtnText}>Sign in with Simpro</Text>
          </TouchableOpacity>
          <Text style={styles.simproHint}>For staff imported from Simpro — enter your work email above, then tap Sign in with Simpro.</Text>

          <View style={styles.footer}>
            <Text style={styles.footerText}>No account yet? </Text>
            <TouchableOpacity testID="login-to-signup" onPress={() => router.push('/(auth)/signup')}>
              <Text style={styles.link}>Start your free trial</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity testID="login-pin-redeem" onPress={() => router.push('/(auth)/pin-redeem')} style={{ marginTop: 12, alignItems: 'center' }}>
            <Text style={styles.link}>Have a PIN?</Text>
          </TouchableOpacity>

          {bioReady && (
            <TouchableOpacity testID="login-biometric" style={styles.bioBtn} onPress={handleBiometricLogin} disabled={busy} activeOpacity={0.7}>
              <Ionicons name={bioType === 'Face ID' ? 'scan' : 'finger-print'} size={20} color={Colors.blue} />
              <Text style={styles.bioBtnText}>Sign in with {bioType}</Text>
            </TouchableOpacity>
          )}

          <ForgotPasswordModal visible={showForgot} onClose={() => setShowForgot(false)} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 40, paddingBottom: 32 },
  logoWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 32 },
  logoIcon: { width: 36, height: 36, borderRadius: 8, backgroundColor: Colors.blueSoft, alignItems: 'center', justifyContent: 'center' },
  logoText: { fontSize: 20, fontWeight: '700', color: Colors.ink },
  heading: { fontSize: 28, fontWeight: '700', color: Colors.ink, letterSpacing: -0.5, lineHeight: 34 },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 8, lineHeight: 19 },
  valueGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  valueChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.05)',
  },
  valueText: { fontSize: 11, fontWeight: '600', color: '#fff' },
  demoBanner: {
    flexDirection: 'row', gap: 10, marginTop: 20, padding: 12, borderRadius: 12,
    backgroundColor: Colors.blueSoft, borderWidth: 1, borderColor: '#BFDBFE', alignItems: 'flex-start',
  },
  demoTitle: { fontSize: 12, fontWeight: '600', color: Colors.blue },
  demoBody: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  form: { marginTop: 24 },
  label: { fontSize: 14, fontWeight: '500', color: '#334155', marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: Colors.text,
  },
  error: { color: Colors.red, fontSize: 12, marginTop: 8 },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.blue, borderRadius: 10, paddingVertical: 14, marginTop: 20, minHeight: 50,
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  footer: { flexDirection: 'row', marginTop: 24, justifyContent: 'center' },
  footerText: { fontSize: 14, color: Colors.textSecondary },
  link: { fontSize: 14, fontWeight: '600', color: Colors.blue },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, marginBottom: 4 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { fontSize: 10, fontWeight: '600', letterSpacing: 1, color: Colors.textTertiary },
  simproBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingVertical: 14, marginTop: 12, backgroundColor: Colors.white, minHeight: 50,
  },
  simproBtnText: { fontSize: 15, fontWeight: '500', color: Colors.text },
  simproHint: { fontSize: 11, color: Colors.textTertiary, marginTop: 6, textAlign: 'center' },
  bioBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingVertical: 14, marginTop: 12, backgroundColor: Colors.blueSoft, minHeight: 50,
  },
  bioBtnText: { fontSize: 15, fontWeight: '600', color: Colors.blue },
});
