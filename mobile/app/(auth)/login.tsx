/**
 * Phase 4 — Email/password login screen.
 * POST /api/auth/login → save JWT → navigate to tabs.
 */
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { civilLogin } from '../../src/services/civilApi';

const BRAND_BLUE = '#2C6BFF';
const BRAND_BG = '#F8FAFC';
const BRAND_INK = '#0F172A';

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    setError('');
    if (!email.trim() || !password.trim()) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    const result = await civilLogin(email.trim(), password);
    setBusy(false);
    if (result.ok) {
      router.replace('/(tabs)/home');
    } else {
      setError(result.error || 'Login failed');
    }
  };

  const fillDemo = () => {
    setEmail('demo@paneltec.com');
    setPassword('demo123');
    setError('');
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[s.container, { paddingTop: insets.top + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Brand header */}
        <View style={s.brandWrap}>
          <View style={s.logoRow}>
            <View style={s.chevron}>
              <Ionicons name="shield-checkmark" size={28} color="#FFF" />
            </View>
            <View>
              <Text style={s.brandName}>Paneltec Civil</Text>
              <Text style={s.brandSub}>WHS Compliance Platform</Text>
            </View>
          </View>
        </View>

        <Text style={s.title}>Sign in</Text>
        <Text style={s.subtitle}>Access your field safety tools.</Text>

        {/* Demo banner */}
        <TouchableOpacity
          testID="login-demo-banner"
          style={s.demoBanner}
          onPress={fillDemo}
          activeOpacity={0.7}
        >
          <Ionicons name="flask-outline" size={16} color={BRAND_BLUE} />
          <Text style={s.demoText}>
            Demo: demo@paneltec.com / demo123
          </Text>
        </TouchableOpacity>

        {/* Email */}
        <View style={s.fieldWrap}>
          <Text style={s.label}>Email</Text>
          <View style={s.inputWrap}>
            <Ionicons name="mail-outline" size={18} color="#94A3B8" style={s.inputIcon} />
            <TextInput
              testID="login-email-input"
              style={s.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@company.com"
              placeholderTextColor="#94A3B8"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              returnKeyType="next"
            />
          </View>
        </View>

        {/* Password */}
        <View style={s.fieldWrap}>
          <Text style={s.label}>Password</Text>
          <View style={s.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color="#94A3B8" style={s.inputIcon} />
            <TextInput
              testID="login-password-input"
              style={[s.input, { flex: 1 }]}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor="#94A3B8"
              secureTextEntry={!showPassword}
              autoComplete="current-password"
              returnKeyType="go"
              onSubmitEditing={handleLogin}
            />
            <TouchableOpacity
              testID="login-toggle-password"
              onPress={() => setShowPassword(!showPassword)}
              style={s.eyeBtn}
            >
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#94A3B8" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Error */}
        {!!error && (
          <View testID="login-error" style={s.errorWrap}>
            <Ionicons name="alert-circle" size={16} color="#EF4444" />
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {/* Submit */}
        <TouchableOpacity
          testID="login-submit-button"
          style={[s.submitBtn, busy && s.submitBtnDisabled]}
          onPress={handleLogin}
          disabled={busy}
          activeOpacity={0.8}
        >
          {busy ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : (
            <>
              <Text style={s.submitText}>Sign in</Text>
              <Ionicons name="arrow-forward" size={18} color="#FFF" />
            </>
          )}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: BRAND_BG,
    paddingHorizontal: 24,
  },
  brandWrap: {
    marginBottom: 32,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  chevron: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: BRAND_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontSize: 22,
    fontWeight: '800',
    color: BRAND_INK,
    letterSpacing: -0.3,
  },
  brandSub: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
    marginTop: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: BRAND_INK,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: '#64748B',
    marginTop: 6,
    marginBottom: 24,
  },
  demoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  demoText: {
    fontSize: 13,
    color: BRAND_BLUE,
    fontWeight: '600',
    flex: 1,
  },
  fieldWrap: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    minHeight: 52,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: BRAND_INK,
    paddingVertical: 14,
  },
  eyeBtn: {
    padding: 8,
  },
  errorWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorText: {
    fontSize: 13,
    color: '#DC2626',
    fontWeight: '500',
    flex: 1,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: BRAND_BLUE,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 8,
    minHeight: 56,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
