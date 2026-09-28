/**
 * Phase 4 — QR Sign-On tab.
 * Opens camera barcode scanner. MOCKED sign-on submit (no backend endpoint).
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { getStoredCivilUser } from '../../src/services/civilApi';

const BLUE = '#2C6BFF';
const GREEN = '#10B981';
const BG = '#F8FAFC';
const INK = '#0F172A';

type ScanState = 'scanning' | 'confirming' | 'done';

export default function QRScanScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanState, setScanState] = useState<ScanState>('scanning');
  const [scannedData, setScannedData] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getStoredCivilUser().then(setUser);
  }, []);

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanState !== 'scanning') return;
    let parsed: any = {};
    try {
      parsed = JSON.parse(data);
    } catch {
      // Try URL params
      try {
        const url = new URL(data);
        parsed = {
          swms_id: url.searchParams.get('swms_id') || undefined,
          site: url.searchParams.get('site') || data,
        };
      } catch {
        parsed = { raw: data, site: 'Unknown Site' };
      }
    }
    setScannedData(parsed);
    setScanState('confirming');
  };

  const handleSignOn = async () => {
    // MOCKED: Store locally since no backend endpoint exists
    setSaving(true);
    const signOnRecord = {
      swms_id: scannedData?.swms_id || 'unknown',
      site: scannedData?.site || 'Unknown',
      worker_name: user?.name || 'Unknown Worker',
      worker_id: user?.id || 'unknown',
      signed_on_at: new Date().toISOString(),
    };
    // Store in local sign-ons list
    const existing = await AsyncStorage.getItem('paneltec_local_signons');
    const list = existing ? JSON.parse(existing) : [];
    list.push(signOnRecord);
    await AsyncStorage.setItem('paneltec_local_signons', JSON.stringify(list));
    setSaving(false);
    setScanState('done');
  };

  const resetScanner = () => {
    setScannedData(null);
    setScanState('scanning');
  };

  if (!permission) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <ActivityIndicator color={BLUE} size="large" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View testID="qr-permission-screen" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.permWrap}>
          <Ionicons name="camera-outline" size={48} color={BLUE} />
          <Text style={s.permTitle}>Camera Permission Required</Text>
          <Text style={s.permSub}>
            Allow camera access to scan QR codes for site sign-on.
          </Text>
          <TouchableOpacity
            testID="qr-grant-permission-btn"
            style={s.permBtn}
            onPress={requestPermission}
          >
            <Text style={s.permBtnText}>Grant Camera Access</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Done state — confirmation screen
  if (scanState === 'done') {
    return (
      <View testID="qr-done-screen" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.doneWrap}>
          <View style={s.doneCheck}>
            <Ionicons name="checkmark-circle" size={64} color={GREEN} />
          </View>
          <Text style={s.doneTitle}>Signed On</Text>
          <Text style={s.doneSite}>{scannedData?.site || 'Site'}</Text>
          <Text style={s.doneTime}>
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
          {/* MOCKED banner */}
          <View testID="qr-mocked-banner" style={s.mockedBanner}>
            <Ionicons name="information-circle" size={16} color="#F59E0B" />
            <Text style={s.mockedText}>Sync pending — sign-ons stored locally</Text>
          </View>
          <TouchableOpacity
            testID="qr-scan-again-btn"
            style={s.scanAgainBtn}
            onPress={resetScanner}
          >
            <Text style={s.scanAgainText}>Scan Another</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Confirm state
  if (scanState === 'confirming' && scannedData) {
    return (
      <View testID="qr-confirm-screen" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity testID="qr-back-btn" onPress={resetScanner} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={INK} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Confirm Sign-On</Text>
        </View>
        <View style={s.confirmWrap}>
          <View style={s.confirmCard}>
            <Ionicons name="qr-code" size={32} color={BLUE} />
            <Text style={s.confirmSite}>{scannedData.site || 'Site'}</Text>
            {scannedData.swms_id && (
              <Text style={s.confirmSwms}>SWMS: {scannedData.swms_id}</Text>
            )}
          </View>
          <View style={s.workerCard}>
            <Text style={s.workerLabel}>Signing on as</Text>
            <Text style={s.workerName}>{user?.name || 'Worker'}</Text>
          </View>
          <TouchableOpacity
            testID="qr-signon-btn"
            style={s.signOnBtn}
            onPress={handleSignOn}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={22} color="#FFF" />
                <Text style={s.signOnBtnText}>Sign On</Text>
              </>
            )}
          </TouchableOpacity>
          {/* MOCKED banner */}
          <View testID="qr-mocked-info" style={s.mockedBanner}>
            <Ionicons name="information-circle" size={16} color="#F59E0B" />
            <Text style={s.mockedText}>Sync pending — sign-ons stored locally</Text>
          </View>
        </View>
      </View>
    );
  }

  // Scanning state
  return (
    <View testID="qr-scan-screen" style={[s.scanContainer, { paddingTop: insets.top }]}>
      <View style={s.scanHeader}>
        <Ionicons name="qr-code-outline" size={20} color="#FFF" />
        <Text style={s.scanHeaderText}>Scan site QR code</Text>
      </View>
      <CameraView
        style={s.camera}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handleBarCodeScanned}
      >
        <View style={s.overlay}>
          <View style={s.reticle} />
          <Text style={s.scanHint}>Point at the site QR code</Text>
        </View>
      </CameraView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  scanContainer: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#E5E7EB', gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: INK },
  scanHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 12, backgroundColor: 'rgba(0,0,0,0.7)',
  },
  scanHeaderText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  camera: { flex: 1 },
  overlay: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  reticle: {
    width: 240, height: 240, borderWidth: 3, borderColor: BLUE,
    borderRadius: 20, backgroundColor: 'transparent',
  },
  scanHint: { color: '#FFF', fontSize: 14, fontWeight: '600', marginTop: 20 },

  permWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  permTitle: { fontSize: 20, fontWeight: '700', color: INK, marginTop: 16 },
  permSub: { fontSize: 14, color: '#64748B', textAlign: 'center', marginTop: 8, lineHeight: 22 },
  permBtn: {
    backgroundColor: BLUE, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 32, marginTop: 24,
  },
  permBtnText: { fontSize: 16, fontWeight: '700', color: '#FFF' },

  confirmWrap: { flex: 1, padding: 20 },
  confirmCard: {
    alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16,
    padding: 24, marginBottom: 16, gap: 8,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  confirmSite: { fontSize: 20, fontWeight: '700', color: INK },
  confirmSwms: { fontSize: 13, color: '#64748B' },
  workerCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 18, marginBottom: 24,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  workerLabel: { fontSize: 12, fontWeight: '600', color: '#64748B', marginBottom: 4 },
  workerName: { fontSize: 18, fontWeight: '700', color: INK },
  signOnBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: GREEN, borderRadius: 14, paddingVertical: 18, minHeight: 60,
  },
  signOnBtnText: { fontSize: 18, fontWeight: '700', color: '#FFF' },

  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  doneCheck: { marginBottom: 16 },
  doneTitle: { fontSize: 28, fontWeight: '800', color: GREEN },
  doneSite: { fontSize: 16, fontWeight: '600', color: INK, marginTop: 8 },
  doneTime: { fontSize: 14, color: '#64748B', marginTop: 4 },

  mockedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FEF3C7', borderRadius: 12, padding: 14, marginTop: 20,
    borderWidth: 1, borderColor: '#FDE68A',
  },
  mockedText: { fontSize: 13, color: '#92400E', fontWeight: '500', flex: 1 },
  scanAgainBtn: {
    backgroundColor: BLUE, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 32, marginTop: 20,
  },
  scanAgainText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
});
