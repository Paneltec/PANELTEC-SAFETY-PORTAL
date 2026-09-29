/**
 * QR SWMS Sign-On — Phase 4.
 * MOCKED: Backend sign-on endpoint not implemented.
 * Scan QR → decode SWMS payload → confirm sign-on → save locally.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, C } from '../../src/theme/colors';
import { getStoredUser } from '../../src/services/auth';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const RETICLE_SIZE = Math.round(SCREEN_W * 0.65);

interface SignOnPayload {
  swms_id?: string;
  site?: string;
  title?: string;
}

function parseQRPayload(data: string): SignOnPayload {
  // Try JSON parse first
  try {
    const parsed = JSON.parse(data);
    if (parsed.swms_id || parsed.site) return parsed;
  } catch { /* not JSON */ }

  // Try URL with query params
  try {
    const url = new URL(data);
    const swms_id = url.searchParams.get('swms_id') || undefined;
    const site = url.searchParams.get('site') || undefined;
    const title = url.searchParams.get('title') || undefined;
    if (swms_id || site) return { swms_id, site, title };
  } catch { /* not URL */ }

  // Fallback — treat as plain text
  return { swms_id: data, site: undefined, title: data };
}

type ScreenState = 'scan' | 'confirm' | 'success';

export default function SignOnScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [camPermission, requestCamPermission] = useCameraPermissions();
  const [screen, setScreen] = useState<ScreenState>('scan');
  const [payload, setPayload] = useState<SignOnPayload | null>(null);
  const [userName, setUserName] = useState('');
  const [signedAt, setSignedAt] = useState<Date | null>(null);
  const [scanned, setScanned] = useState(false);
  const cooldownRef = useRef(false);

  useEffect(() => {
    if (camPermission && !camPermission.granted && camPermission.canAskAgain) {
      requestCamPermission();
    }
    getStoredUser().then((u) => {
      if (u?.name) setUserName(u.name);
    });
  }, [camPermission, requestCamPermission]);

  const handleBarcodeScan = useCallback(({ data }: { data: string }) => {
    if (scanned || cooldownRef.current) return;
    cooldownRef.current = true;
    setScanned(true);

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    const parsed = parseQRPayload(data);
    setPayload(parsed);
    setScreen('confirm');

    setTimeout(() => {
      cooldownRef.current = false;
      setScanned(false);
    }, 3000);
  }, [scanned]);

  const handleSignOn = async () => {
    // MOCKED: Save sign-on locally since backend endpoint doesn't exist
    const signOn = {
      swms_id: payload?.swms_id || 'unknown',
      site: payload?.site || 'Unknown Site',
      title: payload?.title || 'SWMS Sign-On',
      signed_by: userName,
      signed_at: new Date().toISOString(),
      synced: false, // MOCKED: not synced to backend
    };

    try {
      const existing = await AsyncStorage.getItem('@paneltec:signons');
      const signons = existing ? JSON.parse(existing) : [];
      signons.push(signOn);
      await AsyncStorage.setItem('@paneltec:signons', JSON.stringify(signons));
    } catch { /* ignore */ }

    setSignedAt(new Date());
    setScreen('success');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  // Success screen
  if (screen === 'success') {
    return (
      <View testID="signon-success" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.successWrap}>
          <View style={s.successIconWrap}>
            <Ionicons name="checkmark-circle" size={80} color={C.green.base} />
          </View>
          <Text style={s.successTitle}>Signed On!</Text>
          <Text style={s.successSub}>
            {payload?.title || payload?.swms_id || 'SWMS'}
          </Text>
          {signedAt && (
            <Text style={s.successTime}>
              {signedAt.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true })}
            </Text>
          )}
          <View testID="signon-mocked-banner" style={s.mockedBanner}>
            <Ionicons name="information-circle" size={16} color="#F59E0B" />
            <Text style={s.mockedText}>
              Sync pending — sign-ons stored locally
            </Text>
          </View>
          <TouchableOpacity
            testID="signon-done"
            style={s.doneBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Text style={s.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Confirm screen
  if (screen === 'confirm' && payload) {
    return (
      <View testID="signon-confirm" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => { setScreen('scan'); setPayload(null); }} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.white} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Confirm Sign-On</Text>
        </View>
        <View style={s.confirmWrap}>
          <View style={s.confirmCard}>
            <Ionicons name="shield-checkmark" size={36} color="#2563EB" />
            <Text style={s.confirmTitle}>{payload.title || 'SWMS Sign-On'}</Text>
            {payload.site && (
              <Text style={s.confirmSite}>Site: {payload.site}</Text>
            )}
            {payload.swms_id && (
              <Text style={s.confirmId}>ID: {payload.swms_id}</Text>
            )}
          </View>

          <View style={s.workerCard}>
            <Text style={s.workerLabel}>Signing on as:</Text>
            <Text style={s.workerName}>{userName || 'Unknown Worker'}</Text>
          </View>

          <View testID="signon-mocked-confirm-banner" style={s.mockedBanner}>
            <Ionicons name="information-circle" size={16} color="#F59E0B" />
            <Text style={s.mockedText}>
              MOCKED — Sign-on will be stored locally only
            </Text>
          </View>

          <TouchableOpacity
            testID="signon-confirm-btn"
            style={s.signOnBtn}
            onPress={handleSignOn}
            activeOpacity={0.7}
          >
            <Ionicons name="checkmark-circle" size={22} color={Colors.white} />
            <Text style={s.signOnBtnText}>Sign On</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Permission denied
  if (camPermission && !camPermission.granted && !camPermission.canAskAgain) {
    return (
      <View testID="signon-perm-denied" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.permCard}>
          <Ionicons name="camera-outline" size={48} color={Colors.textTertiary} />
          <Text style={s.permTitle}>Camera Access Required</Text>
          <Text style={s.permText}>
            Grant camera access to scan SWMS QR codes.
          </Text>
          <TouchableOpacity style={s.doneBtn} onPress={() => router.back()}>
            <Text style={s.doneBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Scanner screen
  return (
    <View testID="signon-scan" style={s.scanContainer}>
      {camPermission?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanned ? undefined : handleBarcodeScan}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, s.camLoading]}>
          <ActivityIndicator size="large" color={Colors.white} />
          <Text style={s.camLoadingText}>Requesting camera…</Text>
        </View>
      )}

      {/* Overlay */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={s.dimTop} />
        <View style={s.midRow}>
          <View style={s.dimSide} />
          <View style={s.reticle}>
            <View style={[s.corner, s.cornerTL]} />
            <View style={[s.corner, s.cornerTR]} />
            <View style={[s.corner, s.cornerBL]} />
            <View style={[s.corner, s.cornerBR]} />
          </View>
          <View style={s.dimSide} />
        </View>
        <View style={s.dimBottom} />
      </View>

      {/* Close */}
      <TouchableOpacity
        testID="signon-close"
        style={[s.closeBtn, { top: insets.top + 12 }]}
        onPress={() => router.back()}
      >
        <Ionicons name="close" size={28} color={Colors.white} />
      </TouchableOpacity>

      {/* Bottom hint */}
      <View style={[s.bottomBar, { paddingBottom: insets.bottom + 20 }]}>
        <Text style={s.hintText}>Scan the SWMS QR code to sign on</Text>
      </View>
    </View>
  );
}

const RETICLE_TOP = Math.round((SCREEN_H - RETICLE_SIZE) / 2) - 40;
const DIM_BG = 'rgba(0,0,0,0.55)';

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.screen.bg },
  scanContainer: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.screen.bar, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14,
  },
  backBtn: { padding: 4, marginRight: 8 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: C.textOnNavy.main },

  // Camera
  camLoading: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.navy, gap: 12 },
  camLoadingText: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
  dimTop: { width: '100%', height: RETICLE_TOP, backgroundColor: DIM_BG },
  midRow: { flexDirection: 'row', height: RETICLE_SIZE },
  dimSide: { flex: 1, backgroundColor: DIM_BG },
  dimBottom: { flex: 1, backgroundColor: DIM_BG },
  reticle: { width: RETICLE_SIZE, height: RETICLE_SIZE, position: 'relative' },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: Colors.orange, borderWidth: 3 },
  cornerTL: { top: 0, left: 0, borderBottomWidth: 0, borderRightWidth: 0, borderTopLeftRadius: 6 },
  cornerTR: { top: 0, right: 0, borderBottomWidth: 0, borderLeftWidth: 0, borderTopRightRadius: 6 },
  cornerBL: { bottom: 0, left: 0, borderTopWidth: 0, borderRightWidth: 0, borderBottomLeftRadius: 6 },
  cornerBR: { bottom: 0, right: 0, borderTopWidth: 0, borderLeftWidth: 0, borderBottomRightRadius: 6 },
  closeBtn: {
    position: 'absolute', left: 16, zIndex: 10,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    alignItems: 'center', paddingTop: 20, backgroundColor: 'rgba(0,0,0,0.55)',
  },
  hintText: { color: 'rgba(255,255,255,0.8)', fontSize: 15, fontWeight: '600', textAlign: 'center' },

  // Confirm
  confirmWrap: { flex: 1, padding: 20, justifyContent: 'center' },
  confirmCard: {
    backgroundColor: C.card.bg, borderRadius: 20, padding: 24, alignItems: 'center',
    marginBottom: 16, gap: 8,
  },
  confirmTitle: { fontSize: 20, fontWeight: '800', color: C.card.textMain, textAlign: 'center' },
  confirmSite: { fontSize: 14, color: C.card.textSecondary },
  confirmId: { fontSize: 12, color: C.card.textLabel, fontFamily: 'monospace' },

  workerCard: {
    backgroundColor: C.card.bg, borderRadius: 14, padding: 16, marginBottom: 16, alignItems: 'center',
  },
  workerLabel: { fontSize: 12, color: C.card.textLabel, marginBottom: 4 },
  workerName: { fontSize: 18, fontWeight: '700', color: C.card.textMain },

  mockedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FEF3C7', borderRadius: 12, padding: 12, marginBottom: 16,
    borderWidth: 1, borderColor: '#F59E0B',
  },
  mockedText: { fontSize: 12, fontWeight: '600', color: '#92400E', flex: 1 },

  signOnBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: C.green.base, borderRadius: 16, paddingVertical: 18, minHeight: 60,
  },
  signOnBtnText: { color: C.green.buttonText, fontSize: 18, fontWeight: '800' },

  // Success
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  successIconWrap: { marginBottom: 16 },
  successTitle: { fontSize: 28, fontWeight: '800', color: C.textOnNavy.main, marginBottom: 8 },
  successSub: { fontSize: 16, color: C.textOnNavy.secondary, textAlign: 'center', marginBottom: 4 },
  successTime: { fontSize: 14, color: C.textOnNavy.faint, marginBottom: 24 },
  doneBtn: {
    backgroundColor: Colors.orange, borderRadius: 16,
    paddingHorizontal: 40, paddingVertical: 16, minHeight: 56, alignItems: 'center',
  },
  doneBtnText: { color: Colors.white, fontSize: 16, fontWeight: '700' },

  // Permission
  permCard: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 16 },
  permTitle: { color: Colors.white, fontSize: 20, fontWeight: '800' },
  permText: { color: 'rgba(255,255,255,0.6)', fontSize: 15, textAlign: 'center', lineHeight: 22 },
});
