/**
 * QR-Scan Device Provisioning — v58.13.132cj.
 *
 * First-launch only: scan a QR code from the web install landing page
 * to provision the device_id. If already provisioned, skip to PIN.
 * On web preview: manual text input fallback (camera not available).
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import { isProvisioned, setDeviceId, isPreviewSession, hasValidSession } from '../../src/services/auth';

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [manualId, setManualId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      // Preview bypass
      if (isPreviewSession()) {
        router.replace('/(tabs)/home');
        return;
      }
      // Already has a valid session? Go straight to home
      if (await hasValidSession()) {
        router.replace('/(tabs)/home');
        return;
      }
      // Already provisioned? Go to PIN
      if (await isProvisioned()) {
        router.replace('/(auth)/pin-entry');
        return;
      }
      setChecking(false);
    })();
  }, []);

  const handleProvision = async (deviceId: string) => {
    const cleaned = deviceId.trim();
    if (!cleaned) {
      setError('Please enter or scan a valid device ID');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await setDeviceId(cleaned);
      router.replace('/(auth)/pin-entry');
    } catch {
      setError('Failed to save device ID');
    }
    setSaving(false);
  };

  if (checking) {
    return (
      <View testID="welcome-checking" style={[s.container, { paddingTop: insets.top + 60 }]}>
        <ActivityIndicator size="large" color={Colors.orange} />
        <Text style={s.checkText}>Checking device…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <View testID="welcome-screen" style={[s.container, { paddingTop: insets.top + 32 }]}>
        {/* Header */}
        <View style={s.hero}>
          <View style={s.logoCircle}>
            <Ionicons name="qr-code" size={40} color={Colors.orange} />
          </View>
          <Text style={s.title}>Device Setup</Text>
          <Text style={s.subtitle}>
            Scan the QR code from your admin install page to provision this device.
          </Text>
        </View>

        {/* QR Scanner placeholder — on web we show manual input */}
        <View style={s.scanSection}>
          <View style={s.scanFrame}>
            <Ionicons name="scan-outline" size={80} color="rgba(255,255,255,0.2)" />
            <Text style={s.scanHint}>
              {Platform.OS === 'web'
                ? 'Camera not available on web preview.\nEnter device ID manually below.'
                : 'Point camera at the QR code'}
            </Text>
          </View>
        </View>

        {/* Manual entry fallback */}
        <View style={s.manualSection}>
          <Text style={s.manualLabel}>Or enter device ID manually:</Text>
          <View style={s.inputRow}>
            <TextInput
              testID="device-id-input"
              style={s.input}
              value={manualId}
              onChangeText={(t) => { setManualId(t); setError(''); }}
              placeholder="e.g. dev_abc123xyz"
              placeholderTextColor="rgba(255,255,255,0.3)"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              testID="provision-btn"
              style={[s.goBtn, (!manualId.trim() || saving) && s.goBtnDisabled]}
              onPress={() => handleProvision(manualId)}
              disabled={!manualId.trim() || saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Ionicons name="arrow-forward" size={22} color={Colors.white} />
              )}
            </TouchableOpacity>
          </View>
          {!!error && (
            <Text testID="provision-error" style={s.error}>{error}</Text>
          )}
        </View>

        {/* Dev shortcut: auto-provision with a generated ID */}
        <TouchableOpacity
          testID="auto-provision-btn"
          style={s.devBtn}
          onPress={() => {
            const autoId = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
            handleProvision(autoId);
          }}
        >
          <Ionicons name="flash-outline" size={16} color={Colors.orange} />
          <Text style={s.devBtnText}>Quick setup (generate device ID)</Text>
        </TouchableOpacity>

        <Text style={s.footer}>
          Your device ID links this phone to your worker account.{'\n'}
          Contact your supervisor if you don&apos;t have a QR code.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: Colors.navy,
    paddingHorizontal: 24,
  },
  checkText: { color: 'rgba(255,255,255,0.6)', fontSize: 14, marginTop: 12, textAlign: 'center' },

  hero: { alignItems: 'center', marginBottom: 28, gap: 10 },
  logoCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(249,115,22,0.12)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    color: Colors.white, fontSize: 26, fontWeight: '800', textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.55)', fontSize: 14, textAlign: 'center',
    lineHeight: 20, maxWidth: 300,
  },

  scanSection: { alignItems: 'center', marginBottom: 24 },
  scanFrame: {
    width: 200, height: 200, borderRadius: 20,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.12)', borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  scanHint: {
    color: 'rgba(255,255,255,0.35)', fontSize: 12, textAlign: 'center',
    lineHeight: 18, paddingHorizontal: 16,
  },

  manualSection: { marginBottom: 16, gap: 8 },
  manualLabel: {
    color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '600',
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  inputRow: { flexDirection: 'row', gap: 10 },
  input: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
    color: Colors.white, fontSize: 15,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  goBtn: {
    width: 52, height: 52, borderRadius: 14,
    backgroundColor: Colors.orange,
    alignItems: 'center', justifyContent: 'center',
  },
  goBtnDisabled: { opacity: 0.4 },
  error: { color: Colors.error, fontSize: 12, fontWeight: '600', marginTop: 4 },

  devBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: 'rgba(249,115,22,0.3)',
    backgroundColor: 'rgba(249,115,22,0.06)',
    marginBottom: 20,
  },
  devBtnText: { color: Colors.orange, fontSize: 14, fontWeight: '700' },

  footer: {
    color: 'rgba(255,255,255,0.3)', fontSize: 11, textAlign: 'center',
    lineHeight: 16, marginTop: 'auto', paddingBottom: 24,
  },
});
