import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { login } from '../../src/lib/auth';
import { apiError } from '../../src/lib/api';
import { Colors } from '../../src/lib/colors';
import { useAuth } from '../../src/lib/AuthContext';

export default function LoginScreen() {
  const router = useRouter();
  const { setAuth } = useAuth();
  const [email, setEmail] = useState('demo@paneltec.com');
  const [password, setPassword] = useState('demo123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    if (!email || !password) { setError('Enter an email and password to continue.'); return; }
    setBusy(true);
    try {
      await login(email, password);
      setAuth(true);
    } catch (err) {
      setError(apiError(err) || 'Invalid email or password.');
    } finally {
      setBusy(false);
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

          <Text style={styles.heading}>Welcome back</Text>
          <Text style={styles.sub}>Sign in to your Paneltec Civil workspace.</Text>

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

          <View style={styles.footer}>
            <Text style={styles.footerText}>No account yet? </Text>
            <TouchableOpacity testID="login-to-signup" onPress={() => router.push('/(auth)/signup')}>
              <Text style={styles.link}>Start your free trial</Text>
            </TouchableOpacity>
          </View>
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
  heading: { fontSize: 28, fontWeight: '700', color: Colors.ink, letterSpacing: -0.5 },
  sub: { fontSize: 14, color: Colors.textSecondary, marginTop: 6 },
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
});
