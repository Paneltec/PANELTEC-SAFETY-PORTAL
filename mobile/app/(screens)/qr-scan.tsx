/**
 * QR Scanner — In-cabin vehicle workflow — v58.13.132jt
 *
 * Flow: Scan QR sticker → extract identifier → lookup in fleet register →
 *       navigate to Asset Detail (multi-action tiles from .132jr).
 *
 * Supported QR formats:
 *   paneltec-mobile://asset/XT96AZ   (preferred — readable rego)
 *   paneltec-mobile://asset/{uuid}   (UUID variant)
 *   https://whs-compliance.preview.emergentagent.com/asset/XT96AZ
 *   XT96AZ                           (plain rego string)
 *   {uuid}                           (plain UUID)
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Modal, ActivityIndicator, Linking, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Colors } from '../../src/theme/colors';
import { authGet } from '../../src/services/apiClient';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const RETICLE_SIZE = Math.round(SCREEN_W * 0.68);

// ── Types ──

interface FleetAsset {
  id: string;
  name: string;
  rego?: string;
  rego_serial?: string;
  status?: string;
  tag?: string;
  [key: string]: unknown;
}

// ── QR payload parser ──

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONGO_OID_RE = /^[0-9a-f]{24}$/i;

function extractIdentifier(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // 1. paneltec-mobile://asset/{id}
  const schemeMatch = trimmed.match(/^paneltec-mobile:\/\/asset\/(.+)$/i);
  if (schemeMatch) return schemeMatch[1];

  // 2. Full URL — take last path segment
  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length > 0) return segments[segments.length - 1];
  } catch { /* not a URL */ }

  // 3. Plain UUID
  if (UUID_RE.test(trimmed) || MONGO_OID_RE.test(trimmed)) return trimmed;

  // 4. Plain rego string (letters, digits, spaces, hyphens — 2-20 chars)
  if (/^[A-Za-z0-9 \-]{2,20}$/.test(trimmed)) return trimmed;

  return null;
}

// ── Fleet lookup ──

async function lookupInFleet(identifier: string): Promise<FleetAsset | null> {
  // Fetch fleet register and search by rego (case-insensitive), then by id
  const res = await authGet<{ items?: FleetAsset[]; assets?: FleetAsset[] } | FleetAsset[]>(
    '/api/fleet/register?limit=500&page=1',
  );
  if (!res.ok) return null;

  const d = res.data;
  const list: FleetAsset[] = Array.isArray(d)
    ? d
    : (d as any).items || (d as any).assets || [];

  const idLower = identifier.toLowerCase();

  // Try rego match first (case-insensitive, trimmed)
  const byRego = list.find(
    (a) =>
      (a.rego || '').toLowerCase().trim() === idLower ||
      (a.rego_serial || '').toLowerCase().trim() === idLower,
  );
  if (byRego) return byRego;

  // Try ID match
  const byId = list.find((a) => a.id === identifier || (a as any).asset_id === identifier);
  if (byId) return byId;

  // Try name partial match (last resort, exact)
  const byName = list.find((a) => (a.name || '').toLowerCase() === idLower);
  return byName || null;
}

// ── Screen ──

export default function QRScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [camPermission, requestCamPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showNoMatchModal, setShowNoMatchModal] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [showManual, setShowManual] = useState(false);
  const cooldownRef = useRef(false);

  // Request permission on mount
  useEffect(() => {
    if (camPermission && !camPermission.granted && camPermission.canAskAgain) {
      requestCamPermission();
    }
  }, [camPermission, requestCamPermission]);

  const handleScanResult = useCallback(async (identifier: string) => {
    if (cooldownRef.current || resolving) return;
    cooldownRef.current = true;
    setScanned(true);
    setResolving(true);
    setErrorMsg('');

    try {
      // Haptic feedback on scan
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

      const asset = await lookupInFleet(identifier);

      if (asset) {
        // Navigate to fleet tab with asset detail
        // Close scanner and push to fleet screen — we'll open the asset detail modal
        router.replace({
          pathname: '/(tabs)/fleet',
          params: { openAssetId: asset.id },
        } as never);
      } else {
        setShowNoMatchModal(true);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
    } catch (e: any) {
      setErrorMsg(e?.message || 'Lookup failed');
    } finally {
      setResolving(false);
      // Cooldown to prevent rapid re-scans
      setTimeout(() => {
        cooldownRef.current = false;
        setScanned(false);
      }, 2500);
    }
  }, [resolving, router]);

  const handleBarcodeScan = useCallback(({ data }: { data: string }) => {
    if (scanned || resolving || cooldownRef.current) return;
    const identifier = extractIdentifier(data);
    if (!identifier) {
      setErrorMsg('Unrecognised QR format');
      setTimeout(() => setErrorMsg(''), 2000);
      return;
    }
    handleScanResult(identifier);
  }, [scanned, resolving, handleScanResult]);

  const handleManualSubmit = useCallback(() => {
    const id = manualInput.trim();
    if (!id) return;
    setShowManual(false);
    handleScanResult(id);
  }, [manualInput, handleScanResult]);

  const handleRetry = () => {
    setShowNoMatchModal(false);
    setScanned(false);
    setErrorMsg('');
    cooldownRef.current = false;
  };

  // ── Permission denied screen ──
  if (camPermission && !camPermission.granted && !camPermission.canAskAgain) {
    return (
      <View testID="qr-scan-perm-denied" style={[st.container, { paddingTop: insets.top }]}>
        <View style={st.permCard}>
          <View style={st.permIconWrap}>
            <Ionicons name="camera-outline" size={48} color={Colors.textTertiary} />
          </View>
          <Text style={st.permTitle}>Camera Access Required</Text>
          <Text style={st.permText}>
            Grant camera access to scan vehicle QR stickers. Open Settings and enable Camera for Paneltec.
          </Text>
          <TouchableOpacity
            testID="qr-scan-open-settings"
            style={st.permBtn}
            onPress={() => Linking.openSettings()}
          >
            <Ionicons name="settings-outline" size={18} color={Colors.white} />
            <Text style={st.permBtnText}>Open Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="qr-scan-close-perm"
            style={st.closeTextBtn}
            onPress={() => router.back()}
          >
            <Text style={st.closeTextBtnLabel}>Go back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Main scanner ──
  return (
    <View testID="qr-scan-screen" style={st.container}>
      {/* Camera fills entire screen */}
      {camPermission?.granted ? (
        <CameraView
          testID="qr-scan-camera"
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanned ? undefined : handleBarcodeScan}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, st.camLoading]}>
          <ActivityIndicator size="large" color={Colors.white} />
          <Text style={st.camLoadingText}>Requesting camera…</Text>
        </View>
      )}

      {/* Dimmed overlay with transparent reticle */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* Top dim */}
        <View style={st.dimTop} />
        {/* Middle row: left dim + reticle + right dim */}
        <View style={st.midRow}>
          <View style={st.dimSide} />
          <View style={st.reticle}>
            <View style={[st.corner, st.cornerTL]} />
            <View style={[st.corner, st.cornerTR]} />
            <View style={[st.corner, st.cornerBL]} />
            <View style={[st.corner, st.cornerBR]} />
          </View>
          <View style={st.dimSide} />
        </View>
        {/* Bottom dim */}
        <View style={st.dimBottom} />
      </View>

      {/* Close button (top-left) */}
      <TouchableOpacity
        testID="qr-scan-close"
        style={[st.closeBtn, { top: insets.top + 12 }]}
        onPress={() => router.back()}
      >
        <Ionicons name="close" size={28} color={Colors.white} />
      </TouchableOpacity>

      {/* Manual entry button (top-right) */}
      <TouchableOpacity
        testID="qr-scan-manual-btn"
        style={[st.manualBtn, { top: insets.top + 12 }]}
        onPress={() => setShowManual(true)}
      >
        <Ionicons name="keypad-outline" size={20} color={Colors.white} />
        <Text style={st.manualBtnText}>Manual</Text>
      </TouchableOpacity>

      {/* Bottom hint + resolving indicator */}
      <View style={[st.bottomBar, { paddingBottom: insets.bottom + 20 }]}>
        {resolving ? (
          <View style={st.resolvingRow}>
            <ActivityIndicator size="small" color={Colors.orange} />
            <Text style={st.resolvingText}>Looking up vehicle…</Text>
          </View>
        ) : errorMsg ? (
          <View style={st.errorRow}>
            <Ionicons name="alert-circle" size={16} color={Colors.warning} />
            <Text style={st.errorText}>{errorMsg}</Text>
          </View>
        ) : (
          <Text style={st.hintText}>Point at the QR sticker inside the vehicle door</Text>
        )}
      </View>

      {/* No-match modal */}
      <Modal visible={showNoMatchModal} transparent animationType="fade" onRequestClose={handleRetry}>
        <View style={st.modalBackdrop}>
          <View style={st.modalCard}>
            <View style={st.modalIconWrap}>
              <Ionicons name="help-circle-outline" size={48} color={Colors.warning} />
            </View>
            <Text style={st.modalTitle}>Unknown Vehicle</Text>
            <Text style={st.modalBody}>
              {"QR code doesn't match any asset in your fleet register. Please contact admin."}
            </Text>
            <TouchableOpacity testID="qr-scan-retry" style={st.modalRetryBtn} onPress={handleRetry}>
              <Ionicons name="scan-outline" size={18} color={Colors.white} />
              <Text style={st.modalRetryText}>Scan Again</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="qr-scan-modal-close" style={st.modalCloseBtn} onPress={() => { setShowNoMatchModal(false); router.back(); }}>
              <Text style={st.modalCloseText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Manual input modal */}
      <Modal visible={showManual} transparent animationType="slide" onRequestClose={() => setShowManual(false)}>
        <View style={st.modalBackdrop}>
          <View style={st.manualCard}>
            <Text style={st.manualTitle}>Enter Rego or Asset ID</Text>
            <TextInput
              testID="qr-scan-manual-input"
              style={st.manualInput}
              value={manualInput}
              onChangeText={setManualInput}
              placeholder="e.g. XT96AZ"
              placeholderTextColor={Colors.textTertiary}
              autoCapitalize="characters"
              autoFocus
              returnKeyType="go"
              onSubmitEditing={handleManualSubmit}
            />
            <View style={st.manualActions}>
              <TouchableOpacity style={st.manualCancelBtn} onPress={() => setShowManual(false)}>
                <Text style={st.manualCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="qr-scan-manual-go"
                style={[st.manualGoBtn, !manualInput.trim() && { opacity: 0.4 }]}
                onPress={handleManualSubmit}
                disabled={!manualInput.trim()}
              >
                <Ionicons name="search" size={18} color={Colors.white} />
                <Text style={st.manualGoText}>Look Up</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ──

const RETICLE_TOP = Math.round((SCREEN_H - RETICLE_SIZE) / 2) - 40;
const DIM_BG = 'rgba(0,0,0,0.55)';

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  // Camera loading
  camLoading: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.navy, gap: 12 },
  camLoadingText: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },

  // Overlay dims
  dimTop: { width: '100%', height: RETICLE_TOP, backgroundColor: DIM_BG },
  midRow: { flexDirection: 'row', height: RETICLE_SIZE },
  dimSide: { flex: 1, backgroundColor: DIM_BG },
  dimBottom: { flex: 1, backgroundColor: DIM_BG },

  // Reticle
  reticle: { width: RETICLE_SIZE, height: RETICLE_SIZE, position: 'relative' },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: Colors.orange, borderWidth: 3 },
  cornerTL: { top: 0, left: 0, borderBottomWidth: 0, borderRightWidth: 0, borderTopLeftRadius: 6 },
  cornerTR: { top: 0, right: 0, borderBottomWidth: 0, borderLeftWidth: 0, borderTopRightRadius: 6 },
  cornerBL: { bottom: 0, left: 0, borderTopWidth: 0, borderRightWidth: 0, borderBottomLeftRadius: 6 },
  cornerBR: { bottom: 0, right: 0, borderTopWidth: 0, borderLeftWidth: 0, borderBottomRightRadius: 6 },

  // Close button
  closeBtn: {
    position: 'absolute', left: 16, zIndex: 10,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },

  // Manual entry trigger
  manualBtn: {
    position: 'absolute', right: 16, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  manualBtnText: { color: Colors.white, fontSize: 13, fontWeight: '600' },

  // Bottom bar
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    alignItems: 'center', paddingTop: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  hintText: {
    color: 'rgba(255,255,255,0.8)', fontSize: 15, fontWeight: '600',
    textAlign: 'center', paddingHorizontal: 32,
  },
  resolvingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  resolvingText: { color: Colors.orange, fontSize: 15, fontWeight: '600' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorText: { color: Colors.warning, fontSize: 14, fontWeight: '600' },

  // Permission denied
  permCard: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  permIconWrap: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },
  permTitle: { color: Colors.white, fontSize: 20, fontWeight: '800', marginBottom: 8 },
  permText: { color: 'rgba(255,255,255,0.6)', fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  permBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.orange, borderRadius: 14,
    paddingHorizontal: 28, paddingVertical: 14, minHeight: 48,
  },
  permBtnText: { color: Colors.white, fontSize: 16, fontWeight: '700' },
  closeTextBtn: { marginTop: 16 },
  closeTextBtnLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: '600' },

  // No-match modal
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  modalCard: {
    backgroundColor: Colors.surface, borderRadius: 24, padding: 28,
    width: '100%', maxWidth: 340, alignItems: 'center',
  },
  modalIconWrap: { marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: Colors.ink, marginBottom: 8 },
  modalBody: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  modalRetryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.orange, borderRadius: 14,
    paddingHorizontal: 28, paddingVertical: 14, minHeight: 48, width: '100%',
    justifyContent: 'center',
  },
  modalRetryText: { color: Colors.white, fontSize: 16, fontWeight: '700' },
  modalCloseBtn: { marginTop: 12 },
  modalCloseText: { color: Colors.textTertiary, fontSize: 14, fontWeight: '600' },

  // Manual input modal
  manualCard: {
    backgroundColor: Colors.surface, borderRadius: 24, padding: 24,
    width: '100%', maxWidth: 360,
  },
  manualTitle: { fontSize: 18, fontWeight: '800', color: Colors.ink, marginBottom: 16 },
  manualInput: {
    backgroundColor: Colors.bg, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 18, fontWeight: '700', color: Colors.ink, letterSpacing: 1,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 16,
  },
  manualActions: { flexDirection: 'row', gap: 10 },
  manualCancelBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, borderRadius: 14,
    backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border,
    minHeight: 48,
  },
  manualCancelText: { color: Colors.textSecondary, fontSize: 15, fontWeight: '600' },
  manualGoBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 14, backgroundColor: Colors.orange,
    minHeight: 48,
  },
  manualGoText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
});
