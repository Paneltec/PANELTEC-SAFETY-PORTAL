import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { signup } from '../../src/lib/auth';
import { apiError } from '../../src/lib/api';
import { Colors } from '../../src/lib/colors';
import { useAuth } from '../../src/lib/AuthContext';

export default function SignupScreen() {
  const router = useRouter();
  const { setAuth } = useAuth();
  const [form, setForm] = useState({ name: '', org_name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (k: string, v: string) => setForm({ ...form, [k]: v });

  const submit = async () => {
    setError('');
    if (!form.name || !form.email || !form.password) { setError('Please fill in name, email and password.'); return; }
    if (form.password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setBusy(true);
    try {
      await signup(form);
      setAuth(true);
    } catch (err) {
      setError(apiError(err) || 'Could not create account.');
    } finally {
      setBusy(false);
    }
  };

  const fields = [
    { key: 'name', label: 'Full name', placeholder: 'Jordan Smith', secure: false, kb: 'default' as const },
    { key: 'org_name', label: 'Organisation', placeholder: 'Acme Civil Pty Ltd', secure: false, kb: 'default' as const },
    { key: 'email', label: 'Work email', placeholder: 'jordan@acme.com.au', secure: false, kb: 'email-address' as const },
    { key: 'password', label: 'Password', placeholder: 'At least 6 characters', secure: true, kb: 'default' as const },
  ];

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

          <Text style={styles.heading}>Start your 7-day free trial</Text>
          <Text style={styles.sub}>No credit card required. Cancel anytime.</Text>

          <View testID="signup-form" style={styles.form}>
            {fields.map((f) => (
              <View key={f.key}>
                <Text style={styles.label}>{f.label}</Text>
                <TextInput
                  testID={`signup-${f.key}`}
                  style={styles.input}
                  value={(form as any)[f.key]}
                  onChangeText={(v) => update(f.key, v)}
                  placeholder={f.placeholder}
                  placeholderTextColor={Colors.textTertiary}
                  secureTextEntry={f.secure}
                  keyboardType={f.kb}
                  autoCapitalize={f.key === 'email' ? 'none' : 'words'}
                />
              </View>
            ))}

            {error ? <Text testID="signup-error" style={styles.error}>{error}</Text> : null}

            <TouchableOpacity testID="signup-submit" style={styles.btn} onPress={submit} disabled={busy} activeOpacity={0.7}>
              {busy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Text style={styles.btnText}>Create my workspace</Text>
                  <Ionicons name="arrow-forward" size={16} color="#fff" />
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <TouchableOpacity testID="signup-to-login" onPress={() => router.push('/(auth)/login')}>
              <Text style={styles.link}>Sign in</Text>
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
  form: { marginTop: 24 },
  label: { fontSize: 14, fontWeight: '500', color: Colors.textSecondary, marginBottom: 6, marginTop: 12 },
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
