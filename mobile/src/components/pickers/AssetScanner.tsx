/**
 * AssetScanner — Camera-based QR/barcode scanner for asset_scan fields.
 * ISOLATED in its own file to avoid loading expo-camera native module at app boot.
 * Only imported/rendered when the user explicitly taps "Scan QR".
 */
import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { CameraView } from 'expo-camera';
import { useScannerCamera } from '../../hooks/useScannerCamera';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { lookupAsset } from '../../services/pickerApi';

const SCAN_TOKEN_RE = /\/scan\/([A-Za-z0-9_-]{6,32})$/;
const RAW_TOKEN_RE = /^[A-Za-z0-9_-]{6,32}$/;

function parseScanToken(payload: string): string | null {
  if (!payload) return null;
  const trimmed = payload.trim();
  if (RAW_TOKEN_RE.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    const m = u.pathname.match(SCAN_TOKEN_RE);
    if (m) return m[1];
  } catch { /* not a URL */ }
  const m = trimmed.match(SCAN_TOKEN_RE);
  return m ? m[1] : null;
}

interface AssetScannerProps {
  onResolved: (asset: any, via: string) => void;
  onCancel: () => void;
  onFallbackManual: () => void;
  testId: string;
}

export default function AssetScanner({ onResolved, onCancel, onFallbackManual, testId }: AssetScannerProps) {
  const camera = useScannerCamera();
  const [resolving, setResolving] = useState(false);
  const [scanErr, setScanErr] = useState('');
  const [scanned, setScanned] = useState(false);
  const [resolved, setResolved] = useState<any>(null);
  const handleBarcodeScan = useCallback(async ({ data }: { data: string }) => {
    if (scanned || resolving) return;
    setScanned(true);
    const token = parseScanToken(data);
    if (!token) {
      setScanErr('Not a valid asset code. Try again or pick manually.');
      setTimeout(() => setScanned(false), 2000);
      return;
    }
    setResolving(true); setScanErr('');
    try {
      const asset = await lookupAsset(token);
      if (!asset) {
        setScanErr('Unknown asset code. Try again or pick manually.');
        setTimeout(() => setScanned(false), 2000);
      } else {
        setResolved({ ...asset, _via: 'qr_scan' });
      }
    } catch {
      setScanErr('Lookup failed. Try again.');
      setTimeout(() => setScanned(false), 2000);
    } finally {
      setResolving(false);
    }
  }, [scanned, resolving]);

  // Camera failures are terminal until the user deliberately retries.
  if (!camera.cameraReady) {
    return (
      <View testID={`${testId}-camera-status`} style={ss.permDeniedWrap}>
        <Text style={ss.scanHint}>{camera.message}</Text>
        {camera.requesting ? <ActivityIndicator color={Colors.info} /> : camera.needsSettings ? (
          <TouchableOpacity style={ss.scanManualBtn} onPress={() => Linking.openSettings()}>
            <Text style={ss.scanManualBtnText}>Open Settings</Text>
          </TouchableOpacity>
        ) : camera.canRequest ? (
          <TouchableOpacity testID={`${testId}-enable-camera`} style={ss.scanManualBtn} onPress={camera.enableCamera}>
            <Text style={ss.scanManualBtnText}>{camera.requestLabel}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity testID={`${testId}-scanner-manual`} style={ss.scanManualBtn} onPress={onFallbackManual}>
          <Text style={ss.scanManualBtnText}>Search manually instead</Text>
        </TouchableOpacity>
        <TouchableOpacity testID={`${testId}-scanner-close`} style={ss.scanCloseBtn} onPress={onCancel}>
          <Text style={ss.scanCloseBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Confirmation card
  if (resolved) {
    return (
      <View testID={`${testId}-confirm`} style={ss.confirmCard}>
        <View style={ss.confirmHeader}>
          <View style={ss.avatar}>
            <Ionicons name="checkmark-circle" size={14} color="#10B981" />
          </View>
          <View style={ss.rowBody}>
            <Text style={ss.rowPrimary}>{resolved.name || resolved.rego_serial}</Text>
            <Text style={ss.rowSecondary}>
              {[resolved.asset_type, resolved.rego_serial].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
        <View style={ss.confirmActions}>
          <TouchableOpacity
            testID={`${testId}-confirm-use`}
            style={ss.confirmUseBtn}
            onPress={() => onResolved(resolved, resolved._via || 'qr_scan')}
          >
            <Ionicons name="checkmark" size={16} color="#FFFFFF" />
            <Text style={ss.confirmUseBtnText}>Use this asset</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID={`${testId}-confirm-retry`}
            style={ss.confirmRetryBtn}
            onPress={() => { setResolved(null); setScanned(false); }}
          >
            <Text style={ss.confirmRetryText}>Scan again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Camera view
  return (
    <View testID={`${testId}-scanner`} style={ss.scannerWrap}>
      <View style={ss.cameraBox}>
        <CameraView
          style={ss.camera}
          facing="back"
          onMountError={camera.cameraFailed}
          barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'ean13', 'ean8'] }}
          onBarcodeScanned={scanned ? undefined : handleBarcodeScan}
        />
        {resolving && (
          <View style={ss.scanOverlay}>
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={ss.scanOverlayText}>Looking up asset…</Text>
          </View>
        )}
        <View style={ss.scanFrame} />
      </View>
      {scanErr ? (
        <View style={ss.scanErrRow}>
          <Ionicons name="alert-circle" size={14} color={Colors.error} />
          <Text style={ss.scanErrText}>{scanErr}</Text>
        </View>
      ) : (
        <Text style={ss.scanHint}>Point camera at asset QR code</Text>
      )}
      <View style={ss.scanActions}>
        <TouchableOpacity testID={`${testId}-scanner-close`} style={ss.scanCloseBtn} onPress={onCancel}>
          <Ionicons name="close" size={16} color={Colors.textSecondary} />
          <Text style={ss.scanCloseBtnText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity testID={`${testId}-scanner-manual`} style={ss.scanManualBtn} onPress={onFallbackManual}>
          <Ionicons name="search" size={14} color={Colors.info} />
          <Text style={ss.scanManualBtnText}>Search manually</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const ss = StyleSheet.create({
  permDeniedWrap: { gap: 10 },
  scannerWrap: { gap: 10 },
  cameraBox: {
    height: 220, borderRadius: 16, overflow: 'hidden',
    backgroundColor: '#000', position: 'relative',
  },
  camera: { flex: 1 },
  camLoading: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  camLoadingText: { fontSize: 13, color: '#FFFFFF' },
  scanFrame: {
    position: 'absolute', top: '20%', left: '20%', width: '60%', height: '60%',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)', borderRadius: 12,
  },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  scanOverlayText: { fontSize: 13, color: '#FFFFFF', fontWeight: '600' },
  scanHint: { fontSize: 12, color: Colors.textTertiary, textAlign: 'center' },
  scanErrRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FEF2F2', borderRadius: 10, padding: 10,
  },
  scanErrText: { fontSize: 12, color: '#991B1B', flex: 1 },
  scanActions: { flexDirection: 'row', gap: 8 },
  scanCloseBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 12, backgroundColor: Colors.borderLight,
    minHeight: 44,
  },
  scanCloseBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  scanManualBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.info, backgroundColor: Colors.infoSoft,
    minHeight: 44,
  },
  scanManualBtnText: { fontSize: 13, fontWeight: '600', color: Colors.info },
  confirmCard: {
    backgroundColor: '#F0FDF4', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#A7F3D0', gap: 12,
  },
  confirmHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  confirmActions: { flexDirection: 'row', gap: 8 },
  confirmUseBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.success,
    minHeight: 44,
  },
  confirmUseBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  confirmRetryBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.borderLight,
    minHeight: 44,
  },
  confirmRetryText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  avatar: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: '#D1FAE5',
    alignItems: 'center', justifyContent: 'center',
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowPrimary: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  rowSecondary: { fontSize: 11, color: Colors.textTertiary, marginTop: 1 },
});
