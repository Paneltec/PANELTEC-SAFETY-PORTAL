import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { Colors } from '../../src/lib/colors';
import { passwordRuleError, passwordStrength, STRENGTH_COLORS } from '../../src/lib/passwordRules';
import { login } from '../../src/lib/auth';
import { useAuth } from '../../src/lib/AuthContext';

const API = (process.env.EXPO_PUBLIC_BACKEND_URL || '') + '/api';

function StrengthMeter({ value }: { value: string }) {
  const { score, label } = passwordStrength(value);
  const color = STRENGTH_COLORS[score] || Colors.imBorder;
  return (
    <View style={{ marginTop: 4 }}>
      <View style={{ height: 5, borderRadius: 3, backgroundColor: Colors.imConcrete, overflow: 'hidden' }}>
        <View style={{ height: 5, borderRadius: 3, backgroundColor: color, width: `${(score + 1) * 20}%` as any }} />
      </View>
      <Text style={{ fontSize: 10, color: Colors.textTertiary, marginTop: 3 }}>
        Strength: <Text style={{ fontWeight: '600', color: Colors.ink }}>{label}</Text> · Min 10 chars, 1 letter + 1 digit + 1 special
      </Text>
    </View>
  );
}

export default function OnboardScreen() {
  const { token, flavour: flavourParam } = useLocalSearchParams<{ token: string; flavour?: string }>();
  const flavour = flavourParam === 'reset' ? 'reset' : 'invite';
  const router = useRouter();
  const { setAuth, refreshModules } = useAuth();

  const [pw, setPw] = useState('');
  const [cf, setCf] = useState('');
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setError('No token supplied.'); return; }
    const url = flavour === 'invite'
      ? `${API}/auth/invite/validate`
      : `${API}/auth/reset/validate`;
    axios.post(url, { token })
      .then(r => setMeta(r.data))
      .catch(e => setError(e?.response?.data?.detail || 'Link invalid or expired.'));
  }, [token, flavour]);

  const submit = async () => {
    const err = passwordRuleError(pw);
    if (err) { Alert.alert('Password too weak', err); return; }
    if (pw !== cf) { Alert.alert('Mismatch', "Passwords don't match."); return; }
    setBusy(true);
    try {
      const url = `${API}/auth/${flavour}/redeem`;
      const { data } = await axios.post(url, { token, password: pw, confirm_password: cf });
      // Auto-login with the returned token
      if (data.access_token) {
        const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
        await AsyncStorage.setItem('paneltec_token', data.access_token);
        if (data.user) await AsyncStorage.setItem('paneltec_user', JSON.stringify(data.user));
        await refreshModules();
        setAuth(true);
      }
      Alert.alert('Success', flavour === 'invite' ? 'Welcome aboard!' : 'Password reset — signed in.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Could not complete request.');
    } finally { setBusy(false); }
  };

  if (error) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <View style={s.errorIcon}><Ionicons name="alert-circle" size={32} color={Colors.imError} /></View>
          <Text style={s.errorTitle}>Link can't be used</Text>
          <Text style={s.errorBody}>{error}</Text>
          <TouchableOpacity testID="onboard-back-login" style={s.backBtn} onPress={() => router.replace('/(auth)/login')}>
            <Text style={s.backBtnText}>Back to sign in</Text>
          </TouchableOpacity>
          <Text style={s.helpText}>Need help? Contact your administrator to issue a fresh link or PIN.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!meta) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}><ActivityIndicator color={Colors.blue} /><Text style={{ marginTop: 8, color: Colors.textSecondary }}>Validating link…</Text></View>
      </SafeAreaView>
    );
  }

  const heading = flavour === 'invite'
    ? `Welcome${meta.user_name ? `, ${meta.user_name}` : ''}`
    : 'Reset password';
  const subHeading = flavour === 'invite'
    ? `Joining ${meta.org_name || 'your organisation'}`
    : `For ${meta.user_email || ''}`;

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.logoWrap}>
            <Ionicons name="shield-checkmark" size={18} color={Colors.imBronze} />
            <Text style={s.logoText}>Paneltec Civil</Text>
          </View>

          <Text testID="onboard-heading" style={s.heading}>{heading}</Text>
          <Text style={s.subHeading}>{subHeading}</Text>
          <Text style={s.desc}>Set a strong password to {flavour === 'invite' ? 'activate your account' : 'reset access'}.</Text>

          <Text style={s.label}>New password</Text>
          <TextInput testID="onboard-pw" style={s.input} value={pw} onChangeText={setPw}
            placeholder="••••••••" placeholderTextColor={Colors.textTertiary} secureTextEntry autoFocus />
          <StrengthMeter value={pw} />

          <Text style={s.label}>Confirm password</Text>
          <TextInput testID="onboard-confirm" style={s.input} value={cf} onChangeText={setCf}
            placeholder="••••••••" placeholderTextColor={Colors.textTertiary} secureTextEntry />

          <TouchableOpacity testID="onboard-submit" style={[s.submitBtn, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator size="small" color={Colors.imSurface} /> : (
              <Text style={s.submitText}>{flavour === 'invite' ? 'Activate my account' : 'Reset password'}</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 48, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  logoWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 24 },
  logoText: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: Colors.imBronze, textTransform: 'uppercase' },
  heading: { fontSize: 28, fontWeight: '700', color: Colors.ink, letterSpacing: -0.5 },
  subHeading: { fontSize: 16, fontWeight: '600', color: Colors.imBronze, marginTop: 4 },
  desc: { fontSize: 13, color: Colors.textSecondary, marginTop: 8, marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: Colors.text },
  submitBtn: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.imBronze, borderRadius: 12, paddingVertical: 14, marginTop: 24, minHeight: 50 },
  submitText: { fontSize: 15, fontWeight: '700', color: Colors.imSurface },
  errorIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: Colors.imConcrete, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  errorTitle: { fontSize: 22, fontWeight: '700', color: Colors.ink },
  errorBody: { fontSize: 13, color: Colors.textSecondary, marginTop: 6, textAlign: 'center', maxWidth: 280 },
  backBtn: { marginTop: 16 },
  backBtnText: { fontSize: 14, fontWeight: '600', color: Colors.imBronze },
  helpText: { fontSize: 11, color: Colors.textTertiary, marginTop: 20, textAlign: 'center', maxWidth: 280, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border },
});
