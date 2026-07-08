import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '../../src/lib/colors';
import { passwordRuleError, passwordStrength, STRENGTH_COLORS } from '../../src/lib/passwordRules';
import { useAuth } from '../../src/lib/AuthContext';

const API = (process.env.EXPO_PUBLIC_BACKEND_URL || '') + '/api';

function StrengthMeter({ value }: { value: string }) {
  const { score, label } = passwordStrength(value);
  const color = STRENGTH_COLORS[score] || '#CBD5E1';
  return (
    <View style={{ marginTop: 4 }}>
      <View style={{ height: 5, borderRadius: 3, backgroundColor: '#F1F5F9', overflow: 'hidden' }}>
        <View style={{ height: 5, borderRadius: 3, backgroundColor: color, width: `${(score + 1) * 20}%` as any }} />
      </View>
      <Text style={{ fontSize: 10, color: Colors.textTertiary, marginTop: 3 }}>
        Strength: <Text style={{ fontWeight: '600', color: Colors.ink }}>{label}</Text>
      </Text>
    </View>
  );
}

export default function PinRedeemScreen() {
  const router = useRouter();
  const { setAuth, refreshModules } = useAuth();

  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [pw, setPw] = useState('');
  const [cf, setCf] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim()) { Alert.alert('Email required'); return; }
    if (pin.length !== 6) { Alert.alert('Enter the 6-digit PIN'); return; }
    const err = passwordRuleError(pw);
    if (err) { Alert.alert('Password too weak', err); return; }
    if (pw !== cf) { Alert.alert('Mismatch', "Passwords don't match."); return; }
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/auth/pin/redeem`, {
        email: email.trim(),
        pin: pin.trim(),
        password: pw,
        confirm_password: cf,
      });
      if (data.access_token) {
        await AsyncStorage.setItem('paneltec_token', data.access_token);
        if (data.user) await AsyncStorage.setItem('paneltec_user', JSON.stringify(data.user));
        await refreshModules();
        setAuth(true);
      }
      Alert.alert('Welcome', 'Account activated — you\'re signed in.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Invalid or expired PIN.');
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity testID="pin-back" style={s.backRow} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={16} color={Colors.blue} />
            <Text style={s.backText}>Back to sign in</Text>
          </TouchableOpacity>

          <View style={s.logoWrap}>
            <Ionicons name="keypad" size={18} color="#F97316" />
            <Text style={s.logoText}>Paneltec Civil</Text>
          </View>

          <Text style={s.heading}>Redeem a PIN</Text>
          <Text style={s.desc}>Your admin gave you a 6-digit PIN — enter it below with a new password to activate your account.</Text>

          <Text style={s.label}>Work email</Text>
          <TextInput testID="pin-email" style={s.input} value={email} onChangeText={setEmail}
            placeholder="you@company.com" placeholderTextColor={Colors.textTertiary}
            keyboardType="email-address" autoCapitalize="none" />

          <Text style={s.label}>6-digit PIN</Text>
          <TextInput testID="pin-code" style={[s.input, s.pinInput]} value={pin}
            onChangeText={t => setPin(t.replace(/[^0-9]/g, '').slice(0, 6))}
            placeholder="000000" placeholderTextColor={Colors.textTertiary}
            keyboardType="number-pad" maxLength={6} />

          <Text style={s.label}>New password</Text>
          <TextInput testID="pin-pw" style={s.input} value={pw} onChangeText={setPw}
            placeholder="••••••••" placeholderTextColor={Colors.textTertiary} secureTextEntry />
          <StrengthMeter value={pw} />

          <Text style={s.label}>Confirm password</Text>
          <TextInput testID="pin-confirm" style={s.input} value={cf} onChangeText={setCf}
            placeholder="••••••••" placeholderTextColor={Colors.textTertiary} secureTextEntry />

          <TouchableOpacity testID="pin-submit" style={[s.submitBtn, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator size="small" color="#fff" /> : (
              <Text style={s.submitText}>Activate account</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 32 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 24 },
  backText: { fontSize: 13, fontWeight: '600', color: Colors.blue },
  logoWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  logoText: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: '#F97316', textTransform: 'uppercase' },
  heading: { fontSize: 28, fontWeight: '700', color: Colors.ink, letterSpacing: -0.5 },
  desc: { fontSize: 13, color: Colors.textSecondary, marginTop: 6, lineHeight: 19, marginBottom: 8 },
  label: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: Colors.text },
  pinInput: { fontSize: 28, fontWeight: '700', letterSpacing: 8, textAlign: 'center', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: '#F97316' },
  submitBtn: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#F97316', borderRadius: 12, paddingVertical: 14, marginTop: 24, minHeight: 50 },
  submitText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
