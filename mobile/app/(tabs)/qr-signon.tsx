import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, Vibration, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/lib/colors';

export default function QRSignOnScreen() {
  const [scannedCode, setScannedCode] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [signedOn, setSignedOn] = useState(false);
  const [scanning, setScanning] = useState(false);

  const handleScan = () => {
    setScanning(true);
    // MOCKED: simulate a barcode scan after 1.5s
    setTimeout(() => {
      const mockCode = 'SITE-' + Math.random().toString(36).substring(2, 8).toUpperCase();
      setScannedCode(mockCode);
      setScanning(false);
      if (Platform.OS !== 'web') Vibration.vibrate(100);
    }, 1500);
  };

  const handleSignOn = () => {
    const code = scannedCode || manualCode;
    if (!code.trim()) { Alert.alert('Error', 'Scan a QR code or enter a site code'); return; }
    // MOCKED: always succeeds
    setSignedOn(true);
    Alert.alert('Signed on', `You have been signed on to site ${code}.`);
  };

  const reset = () => { setScannedCode(''); setManualCode(''); setSignedOn(false); setScanning(false); };

  return (
    <SafeAreaView style={s.safe}>
      <View testID="qr-signon-page" style={s.container}>
        <Text style={s.overline}>QR SIGN-ON</Text>
        <Text style={s.heading}>Site Sign-On</Text>
        <Text style={s.sub}>Scan a site QR code to sign on for the day.</Text>

        {/* Camera viewfinder mock */}
        <View style={s.viewfinder}>
          <View style={s.viewfinderInner}>
            {scanning ? (
              <View style={s.scanningState}>
                <Ionicons name="scan" size={48} color={Colors.blue} />
                <Text style={s.scanText}>Scanning...</Text>
              </View>
            ) : scannedCode ? (
              <View style={s.scannedState}>
                <View style={s.checkCircle}>
                  <Ionicons name="checkmark" size={32} color="#fff" />
                </View>
                <Text style={s.scannedLabel}>Code detected</Text>
                <Text style={s.scannedCode}>{scannedCode}</Text>
              </View>
            ) : (
              <View style={s.idleState}>
                <View style={s.cameraIcon}>
                  <Ionicons name="qr-code" size={40} color={Colors.textTertiary} />
                </View>
                <Text style={s.idleText}>Point camera at site QR code</Text>
                <Text style={s.idleSub}>or enter the code manually below</Text>
              </View>
            )}
          </View>
          {/* Viewfinder corners */}
          <View style={[s.corner, s.tl]} />
          <View style={[s.corner, s.tr]} />
          <View style={[s.corner, s.bl]} />
          <View style={[s.corner, s.br]} />
        </View>

        {!scannedCode && (
          <TouchableOpacity testID="qr-scan-btn" style={s.scanBtn} onPress={handleScan} disabled={scanning} activeOpacity={0.7}>
            <Ionicons name="camera" size={18} color="#fff" />
            <Text style={s.scanBtnText}>{scanning ? 'Scanning...' : 'Tap to Scan'}</Text>
          </TouchableOpacity>
        )}

        {/* Manual entry */}
        {!scannedCode && (
          <View style={s.manualCard}>
            <Text style={s.manualLabel}>Or enter site code manually</Text>
            <TextInput
              testID="qr-manual-input"
              style={s.input}
              value={manualCode}
              onChangeText={setManualCode}
              placeholder="e.g. SITE-ABC123"
              placeholderTextColor={Colors.textTertiary}
              autoCapitalize="characters"
            />
          </View>
        )}

        {/* Sign-on / Reset buttons */}
        {signedOn ? (
          <View style={s.successCard}>
            <View style={s.successIcon}>
              <Ionicons name="checkmark-circle" size={28} color={Colors.emerald} />
            </View>
            <Text style={s.successTitle}>Signed on</Text>
            <Text style={s.successBody}>You are signed on at {scannedCode || manualCode}</Text>
            <TouchableOpacity testID="qr-reset-btn" style={s.resetBtn} onPress={reset}>
              <Text style={s.resetBtnText}>Sign on to a different site</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity testID="qr-signon-submit" style={[s.signOnBtn, !(scannedCode || manualCode) && { opacity: 0.4 }]} onPress={handleSignOn} activeOpacity={0.7}>
            <Ionicons name="log-in" size={18} color="#fff" />
            <Text style={s.signOnBtnText}>Sign On</Text>
          </TouchableOpacity>
        )}

        <View style={s.mockedBadge}>
          <Ionicons name="information-circle" size={14} color={Colors.textTertiary} />
          <Text style={s.mockedText}>Camera scan is simulated in this preview</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  container: { flex: 1, padding: 16, alignItems: 'center' },
  overline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.blue, alignSelf: 'flex-start' },
  heading: { fontSize: 26, fontWeight: '700', color: Colors.ink, alignSelf: 'flex-start', marginTop: 4, letterSpacing: -0.5 },
  sub: { fontSize: 13, color: Colors.textSecondary, alignSelf: 'flex-start', marginTop: 4, marginBottom: 20 },
  viewfinder: {
    width: 260, height: 260, backgroundColor: '#0F172A', borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16, overflow: 'hidden',
  },
  viewfinderInner: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', width: 32, height: 32, borderColor: Colors.blue, borderWidth: 3 },
  tl: { top: 12, left: 12, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 8 },
  tr: { top: 12, right: 12, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 8 },
  bl: { bottom: 12, left: 12, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 8 },
  br: { bottom: 12, right: 12, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 8 },
  scanningState: { alignItems: 'center', gap: 8 },
  scanText: { color: Colors.blue, fontSize: 14, fontWeight: '600' },
  scannedState: { alignItems: 'center', gap: 8 },
  checkCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.emerald, alignItems: 'center', justifyContent: 'center' },
  scannedLabel: { color: '#94A3B8', fontSize: 12, fontWeight: '500' },
  scannedCode: { color: '#fff', fontSize: 20, fontWeight: '700', letterSpacing: 1 },
  idleState: { alignItems: 'center', gap: 8 },
  cameraIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  idleText: { color: '#94A3B8', fontSize: 14, fontWeight: '500' },
  idleSub: { color: '#64748B', fontSize: 12 },
  scanBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.blue, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 24,
    width: 260, marginBottom: 16,
  },
  scanBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  manualCard: { width: '100%', backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, marginBottom: 16 },
  manualLabel: { fontSize: 13, color: Colors.textSecondary, marginBottom: 8 },
  input: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16,
    color: Colors.text, letterSpacing: 1, fontWeight: '600',
  },
  signOnBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.emerald, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32,
    width: '100%', minHeight: 52,
  },
  signOnBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  successCard: {
    width: '100%', backgroundColor: '#F0FDF4', borderWidth: 2, borderColor: '#A7F3D0',
    borderRadius: 16, padding: 20, alignItems: 'center', gap: 4,
  },
  successIcon: { marginBottom: 4 },
  successTitle: { fontSize: 18, fontWeight: '700', color: Colors.emeraldDark },
  successBody: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' },
  resetBtn: { marginTop: 12, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, borderWidth: 1, borderColor: Colors.border },
  resetBtnText: { fontSize: 13, color: Colors.blue, fontWeight: '500' },
  mockedBadge: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 16 },
  mockedText: { fontSize: 11, color: Colors.textTertiary, fontStyle: 'italic' },
});
