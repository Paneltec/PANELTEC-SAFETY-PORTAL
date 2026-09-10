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
import {
  isProvisioned, isPreviewSession, hasValidSession, extractOnboardingToken,
} from '../../src/services/auth';

/**
 * Welcome — first screen on a phone that has never been set up.
 *
 * The worker scans the QR code on their onboarding card (printed from the
 * worker portal). Normally the phone camera opens the web page which hands
 * off to `paneltec://onboard?token=…`; scanning from INSIDE the app here is
 * the shortcut for a phone that already has the app installed. Both paths
 * land on /onboard, which reads the token and sets up the worker's profile
 * and PIN. There is no "device ID" for a worker to know or type.
 */
// expo-camera is loaded lazily so the web preview / static export never
// touches native camera code.
type CamModule = { CameraView: React.ComponentType<any>; useCameraPermissions: () => any };
const Cam: CamModule | null = Platform.OS === 'web' ? null : (() => {
  try { return require('expo-camera') as CamModule; } catch { return null; }
})();
const useCameraPermissionsSafe: () => any = Cam ? Cam.useCameraPermissions : () => [null, async () => {}];

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [scanned, setScanned] = useState(false);
  const [showManual, setShowManual] = useState(Platform.OS === 'web');
  const [permission, requestPermission] = useCameraPermissionsSafe();

  useEffect(() => {
    (async () => {
      if (isPreviewSession()) { router.replace('/(tabs)/home'); return; }
      if (await hasValidSession()) { router.replace('/(tabs)/home'); return; }
      if (await isProvisioned()) { router.replace('/(auth)/pin-entry'); return; }
      setChecking(false);
    })();
  }, []);

  useEffect(() => {
    if (!checking && Platform.OS !== 'web' && permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [checking, permission]);

  const go = (raw: string) => {
    const token = extractOnboardingToken(raw);
    if (!token) {
      setError("That doesn't look like a Paneltec setup code. Scan the QR on your onboarding card, or type the code printed under it.");
      setScanned(false);
      return;
    }
    setError('');
    router.replace({ pathname: '/onboard', params: { token } } as never);
  };

  if (checking) {
    return (
      <View testID="welcome-checking" style={[s.container, { paddingTop: insets.top + 60 }]}>
        <ActivityIndicator size="large" color={Colors.orange} />
        <Text style={s.checkText}>Checking device…</Text>
      </View>
    );
  }

  const cameraOk = !!Cam && !!permission?.granted;
  const CameraView = Cam ? Cam.CameraView : null;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View testID="welcome-screen" style={[s.container, { paddingTop: insets.top + 32 }]}>
        <View style={s.hero}>
          <View style={s.logoCircle}>
            <Ionicons name="qr-code" size={40} color={Colors.orange} />
          </View>
          <Text style={s.title}>Paneltec Group</Text>
          <Text style={s.subtitle}>
            Scan the QR code on your onboarding card to set up this phone.
          </Text>
        </View>

        <View style={s.scanSection}>
          {cameraOk && CameraView ? (
            <View style={s.cameraWrap}>
              <CameraView
                testID="welcome-camera"
                style={s.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={scanned ? undefined : ({ data }: { data: string }) => { setScanned(true); go(data); }}
              />
              <View pointerEvents="none" style={s.reticle} />
            </View>
          ) : (
            <View style={s.scanFrame}>
              <Ionicons name="scan-outline" size={80} color="rgba(255,255,255,0.2)" />
              <Text style={s.scanHint}>
                {Platform.OS === 'web'
                  ? 'Camera is not available in the web preview.\nType the setup code below.'
                  : 'Camera permission is needed to scan.\nOr type the setup code below.'}
              </Text>
              {Platform.OS !== 'web' && (
                <TouchableOpacity testID="welcome-allow-camera" onPress={() => requestPermission()} style={s.smallBtn}>
                  <Text style={s.smallBtnText}>Allow camera</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {showManual ? (
          <View style={s.manualSection}>
            <Text style={s.manualLabel}>Setup code (printed under the QR)</Text>
            <View style={s.inputRow}>
              <TextInput
                testID="setup-code-input"
                style={s.input}
                value={code}
                onChangeText={(t) => { setCode(t); setError(''); }}
                placeholder="Paste link or type code"
                placeholderTextColor="rgba(255,255,255,0.3)"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                testID="setup-code-go"
                style={[s.goBtn, !code.trim() && s.goBtnDisabled]}
                onPress={() => go(code)}
                disabled={!code.trim()}
              >
                <Ionicons name="arrow-forward" size={22} color={Colors.white} />
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity testID="welcome-show-manual" style={s.devBtn} onPress={() => setShowManual(true)}>
            <Ionicons name="keypad-outline" size={16} color={Colors.orange} />
            <Text style={s.devBtnText}>Type the setup code instead</Text>
          </TouchableOpacity>
        )}
        {!!error && <Text testID="welcome-error" style={s.error}>{error}</Text>}

        <Text style={s.footer}>
          Your onboarding card comes from the office.{'\n'}
          No card yet? Ask your supervisor.
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
  cameraWrap: { width: 240, height: 240, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000' },
  camera: { width: '100%', height: '100%' },
  reticle: { position: 'absolute', left: 30, top: 30, right: 30, bottom: 30, borderWidth: 2, borderColor: Colors.orange, borderRadius: 14 },
  smallBtn: { marginTop: 4, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: 'rgba(249,115,22,0.15)', minHeight: 44, justifyContent: 'center' },
  smallBtnText: { color: Colors.orange, fontWeight: '700', fontSize: 13 },
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
