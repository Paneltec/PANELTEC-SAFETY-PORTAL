import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Platform, Vibration,
  KeyboardAvoidingView, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/lib/colors';
import SiteScanResult from '../../src/components/scan/SiteScanResult';
import WorkerScanResult from '../../src/components/scan/WorkerScanResult';
import SupplierScanResult from '../../src/components/scan/SupplierScanResult';

type ScanType = 'site' | 'worker' | 'supplier' | null;

/** Parse a QR URL/token to determine scan type and token */
function parseQR(raw: string): { type: ScanType; token: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // URL-based patterns: /scan/site/{token}, /scan/worker/{token}, /scan/supplier/{token}
  const siteMatch = trimmed.match(/\/scan\/site\/([^/?#]+)/);
  if (siteMatch) return { type: 'site', token: siteMatch[1] };

  const workerMatch = trimmed.match(/\/scan\/worker\/([^/?#]+)/);
  if (workerMatch) return { type: 'worker', token: workerMatch[1] };

  const supplierMatch = trimmed.match(/\/scan\/supplier\/([^/?#]+)/);
  if (supplierMatch) return { type: 'supplier', token: supplierMatch[1] };

  // Raw token — no type detected. Default to site scan.
  return { type: 'site', token: trimmed };
}

export default function QRSignOnScreen() {
  const [manualUrl, setManualUrl] = useState('');
  const [resolvedType, setResolvedType] = useState<ScanType>(null);
  const [resolvedToken, setResolvedToken] = useState('');
  const [scanning, setScanning] = useState(false);

  const handleResolve = useCallback(() => {
    const result = parseQR(manualUrl);
    if (!result) return;
    setResolvedType(result.type);
    setResolvedToken(result.token);
    if (Platform.OS !== 'web') Vibration.vibrate(100);
  }, [manualUrl]);

  const handleQuickType = useCallback((type: ScanType, token: string) => {
    setResolvedType(type);
    setResolvedToken(token);
    setManualUrl('');
  }, []);

  const handleReset = useCallback(() => {
    setResolvedType(null);
    setResolvedToken('');
    setManualUrl('');
    setScanning(false);
  }, []);

  // Show result component based on resolved type
  if (resolvedType === 'site' && resolvedToken) {
    return (
      <SafeAreaView style={s.safe}>
        <SiteScanResult token={resolvedToken} onReset={handleReset} />
      </SafeAreaView>
    );
  }
  if (resolvedType === 'worker' && resolvedToken) {
    return (
      <SafeAreaView style={s.safe}>
        <WorkerScanResult token={resolvedToken} onReset={handleReset} />
      </SafeAreaView>
    );
  }
  if (resolvedType === 'supplier' && resolvedToken) {
    return (
      <SafeAreaView style={s.safe}>
        <SupplierScanResult token={resolvedToken} onReset={handleReset} />
      </SafeAreaView>
    );
  }

  // Scanner view
  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
          <Text style={s.overline}>QR SCANNER</Text>
          <Text style={s.heading}>Scan & Sign-On</Text>
          <Text style={s.sub}>Scan a site, worker, or supplier QR code to begin.</Text>

          {/* Camera viewfinder area */}
          <View testID="qr-viewfinder" style={s.viewfinder}>
            <View style={s.viewfinderInner}>
              {scanning ? (
                <View style={s.scanningState}>
                  <Ionicons name="scan" size={48} color={Colors.blue} />
                  <Text style={s.scanText}>Scanning...</Text>
                </View>
              ) : (
                <View style={s.idleState}>
                  <View style={s.cameraIcon}>
                    <Ionicons name="qr-code" size={40} color={Colors.textTertiary} />
                  </View>
                  <Text style={s.idleText}>Point camera at QR code</Text>
                  <Text style={s.idleSub}>or paste a scan URL below</Text>
                </View>
              )}
            </View>
            {/* Viewfinder corners */}
            <View style={[s.corner, s.tl]} />
            <View style={[s.corner, s.tr]} />
            <View style={[s.corner, s.bl]} />
            <View style={[s.corner, s.br]} />
          </View>

          {/* URL / Token input */}
          <View style={s.inputCard}>
            <Text style={s.inputLabel}>Paste QR URL or enter token</Text>
            <View style={s.inputRow}>
              <TextInput
                testID="qr-url-input"
                style={s.input}
                value={manualUrl}
                onChangeText={setManualUrl}
                placeholder="e.g. https://.../scan/site/ziwkVY2..."
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={handleResolve}
              />
              <TouchableOpacity
                testID="qr-resolve-btn"
                style={[s.goBtn, !manualUrl.trim() && { opacity: 0.4 }]}
                onPress={handleResolve}
                disabled={!manualUrl.trim()}
                activeOpacity={0.7}
              >
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Quick scan type buttons */}
          <View style={s.quickSection}>
            <Text style={s.quickLabel}>OR TAP A SCAN TYPE</Text>
            <View style={s.quickRow}>
              <TouchableOpacity
                testID="quick-site-scan"
                style={[s.quickBtn, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}
                onPress={() => {
                  setManualUrl('');
                  setResolvedType(null);
                  // prompt for token
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="business" size={20} color="#2563EB" />
                <Text style={[s.quickBtnText, { color: '#2563EB' }]}>Site{'\n'}Sign-On</Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="quick-worker-scan"
                style={[s.quickBtn, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}
                onPress={() => {
                  setManualUrl('');
                  setResolvedType(null);
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="person" size={20} color="#15803D" />
                <Text style={[s.quickBtnText, { color: '#15803D' }]}>Worker{'\n'}Check</Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="quick-supplier-scan"
                style={[s.quickBtn, { backgroundColor: '#FAF5FF', borderColor: '#DDD6FE' }]}
                onPress={() => {
                  setManualUrl('');
                  setResolvedType(null);
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="briefcase" size={20} color="#7C3AED" />
                <Text style={[s.quickBtnText, { color: '#7C3AED' }]}>Supplier{'\n'}Induction</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.infoBadge}>
            <Ionicons name="information-circle" size={14} color={Colors.textTertiary} />
            <Text style={s.infoText}>
              {Platform.OS === 'web'
                ? 'Camera scanning is available on native devices. Use the URL field above to test.'
                : 'Point your camera at any Paneltec QR code to begin.'}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  container: { padding: 16, paddingBottom: 40 },
  overline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.blue },
  heading: { fontSize: 26, fontWeight: '700', color: Colors.ink, marginTop: 4, letterSpacing: -0.5 },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 4, marginBottom: 20 },
  // Viewfinder
  viewfinder: {
    width: '100%', maxWidth: 320, aspectRatio: 1, backgroundColor: '#0F172A', borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 20, overflow: 'hidden',
  },
  viewfinderInner: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', width: 32, height: 32, borderColor: Colors.blue, borderWidth: 3 },
  tl: { top: 12, left: 12, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 8 },
  tr: { top: 12, right: 12, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 8 },
  bl: { bottom: 12, left: 12, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 8 },
  br: { bottom: 12, right: 12, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 8 },
  scanningState: { alignItems: 'center', gap: 8 },
  scanText: { color: Colors.blue, fontSize: 14, fontWeight: '600' },
  idleState: { alignItems: 'center', gap: 8 },
  cameraIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  idleText: { color: '#94A3B8', fontSize: 14, fontWeight: '500' },
  idleSub: { color: '#64748B', fontSize: 12 },
  // Input
  inputCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 14, marginBottom: 16 },
  inputLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8 },
  inputRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 14,
    color: Colors.text,
  },
  goBtn: {
    width: 48, height: 48, borderRadius: 12, backgroundColor: Colors.blue,
    alignItems: 'center', justifyContent: 'center',
  },
  // Quick type buttons
  quickSection: { marginBottom: 16 },
  quickLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.textTertiary, textAlign: 'center', marginBottom: 10 },
  quickRow: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  quickBtn: {
    flex: 1, maxWidth: 110, alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 16, borderRadius: 16, borderWidth: 1.5,
  },
  quickBtnText: { fontSize: 12, fontWeight: '700', textAlign: 'center', lineHeight: 16 },
  // Info
  infoBadge: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', paddingHorizontal: 4 },
  infoText: { fontSize: 11, color: Colors.textTertiary, flex: 1, lineHeight: 16 },
});
