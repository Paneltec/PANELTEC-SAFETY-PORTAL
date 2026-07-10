/**
 * NavixyVehiclePicker — searchable dropdown + Vehicle-QR scanner for the
 * `vehicle_navixy` form-field type.
 *
 * Data source: `GET /api/forms/fleet/vehicles` (worker-safe Navixy proxy).
 * v160.1.3 shipped the searchable dropdown. v160.1.4 adds a primary
 * "Scan Vehicle QR" button that reuses the same scan token endpoint as
 * the Pre-Start Vehicle-QR flow (`GET /api/assets/scan/{token}`) and
 * matches the resolved asset's `rego_serial` against the Navixy fleet
 * `plate` / `registration` field to auto-select the vehicle.
 *
 * UX (v160.1.4):
 *   [ 📷  Scan Vehicle QR ]     ← primary button, bronze bg
 *   ────────  or  ────────
 *   [ Select vehicle · 72 ]     ← existing searchable dropdown
 *
 * On successful scan → picker's value updates + scan modal closes.
 * On no match → toast "Vehicle not in fleet".
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Modal, FlatList,
  StyleSheet, ActivityIndicator, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import api, { apiError } from '../lib/api';
import { Colors } from '../lib/colors';
import { toast } from '../lib/toast';
import { parseAssetToken } from '../lib/scan';

type Vehicle = {
  id: string | number;
  label?: string;
  plate?: string;
  registration?: string;
  vehicle_type?: string;
};

type Props = {
  label: string;
  required?: boolean;
  value: string | null;
  onChange: (vehicleId: string | null, vehicle?: Vehicle) => void;
  testID?: string;
  placeholder?: string;
};

export default function NavixyVehiclePicker(props: Props) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  // Scan-QR state
  const [scanOpen, setScanOpen] = useState(false);
  const [scanInput, setScanInput] = useState('');
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const scannedOnceRef = useRef(false);
  const [camPerm, requestCamPerm] = useCameraPermissions();

  useEffect(() => {
    let ok = true;
    setBusy(true);
    setErr(null);
    api.get('/forms/fleet/vehicles')
      .then(({ data }) => {
        if (!ok) return;
        const list: Vehicle[] = (data?.vehicles || []).map((v: Vehicle) => ({
          ...v,
          id: String(v.id),
        }));
        setVehicles(list);
      })
      .catch((e) => { if (ok) setErr(apiError(e)); })
      .finally(() => { if (ok) setBusy(false); });
    return () => { ok = false; };
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return vehicles;
    return vehicles.filter((v) => {
      const rego = (v.registration || v.plate || '').toLowerCase();
      const label = (v.label || '').toLowerCase();
      const vt = (v.vehicle_type || '').toLowerCase();
      return rego.includes(term) || label.includes(term) || vt.includes(term);
    });
  }, [q, vehicles]);

  const displayOf = (v?: Vehicle) => {
    if (!v) return '';
    const rego = v.registration || v.plate || '';
    const lbl = v.label || '';
    if (rego && lbl && lbl !== rego) return `${rego} · ${lbl}`;
    return rego || lbl || String(v.id);
  };

  const selected = vehicles.find((v) => String(v.id) === String(props.value));
  const triggerText = selected
    ? displayOf(selected)
    : `Select vehicle · ${vehicles.length}`;

  const isSelected = (id: string | number) => String(id) === String(props.value);

  const pick = (v: Vehicle) => {
    props.onChange(String(v.id), v);
    setOpen(false);
    setQ('');
  };

  // v160.1.4 — Scan a Vehicle QR sticker → resolve to a fleet vehicle.
  const resolveScanned = async (input: string) => {
    const token = parseAssetToken(input);
    if (!token) { setScanErr('Not a valid QR URL or token'); return; }
    setScanBusy(true); setScanErr(null);
    try {
      const { data: asset } = await api.get(`/assets/scan/${token}`);
      // Match the scanned asset to a Navixy vehicle by rego / plate.
      const rego = (asset?.rego_serial || asset?.name || '').toString().trim().toLowerCase();
      if (!rego) { setScanErr('Scan resolved but has no rego to match'); return; }
      const match = vehicles.find((v) => {
        const p = (v.plate || '').toString().trim().toLowerCase();
        const r = (v.registration || '').toString().trim().toLowerCase();
        return p === rego || r === rego;
      });
      if (!match) {
        setScanErr(`No Navixy vehicle matches rego "${asset?.rego_serial || rego}"`);
        return;
      }
      props.onChange(String(match.id), match);
      setScanOpen(false);
      setScanInput('');
      toast.info(`Vehicle selected: ${displayOf(match)}`);
    } catch (e: any) {
      setScanErr(apiError(e) || 'Unknown scan token');
    } finally {
      setScanBusy(false);
    }
  };

  return (
    <View>
      <Text style={s.label}>{props.label}{props.required ? ' *' : ''}</Text>

      {/* v160.1.4 — Primary Scan Vehicle QR button. */}
      <TouchableOpacity
        testID={(props.testID || 'vehicle-picker') + '-scan'}
        style={s.scanBtn}
        onPress={() => {
          setScanErr(null); scannedOnceRef.current = false;
          if (camPerm && !camPerm.granted) requestCamPerm();
          setScanOpen(true);
        }}
        activeOpacity={0.85}
      >
        <Ionicons name="qr-code" size={18} color={Colors.imSurface} />
        <View style={{ flex: 1 }}>
          <Text style={s.scanBtnTitle}>Scan Vehicle QR</Text>
          <Text style={s.scanBtnSub}>Points camera at the sticker</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={Colors.imSurface} />
      </TouchableOpacity>

      <View style={s.divider}>
        <View style={s.dividerLine} />
        <Text style={s.dividerText}>or</Text>
        <View style={s.dividerLine} />
      </View>

      <TouchableOpacity
        testID={props.testID || 'vehicle-picker-trigger'}
        style={s.trigger}
        onPress={() => setOpen(true)}
        activeOpacity={0.75}
      >
        <Ionicons name="car-sport" size={16} color={Colors.orangeLight} />
        <Text style={[s.triggerText, !props.value && s.triggerPlaceholder]}>
          {triggerText}
        </Text>
        <Ionicons name="chevron-down" size={16} color={Colors.textTertiary} />
      </TouchableOpacity>

      {/* Searchable dropdown modal */}
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{props.label}</Text>
              <TouchableOpacity testID="vehicle-picker-close" onPress={() => setOpen(false)}>
                <Ionicons name="close" size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={s.searchWrap}>
              <Ionicons name="search" size={16} color={Colors.textTertiary} />
              <TextInput
                testID="vehicle-picker-search"
                style={s.searchInput}
                value={q}
                onChangeText={setQ}
                placeholder="Search by rego, label or type"
                placeholderTextColor={Colors.placeholder}
                autoFocus
              />
            </View>
            {busy && <ActivityIndicator style={{ margin: 24 }} color={Colors.orange} />}
            {err && <Text style={s.err}>{err}</Text>}
            {!busy && !err && filtered.length === 0 && (
              <Text style={s.empty}>No matching vehicles.</Text>
            )}
            <FlatList
              data={filtered}
              keyExtractor={(v) => String(v.id)}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const rego = item.registration || item.plate || '';
                const lbl = item.label || '';
                return (
                  <TouchableOpacity
                    testID={`vehicle-option-${item.id}`}
                    style={[s.row, isSelected(item.id) && s.rowSelected]}
                    onPress={() => pick(item)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowName}>{rego || lbl || String(item.id)}</Text>
                      {(lbl && lbl !== rego) || item.vehicle_type ? (
                        <Text style={s.rowMeta}>
                          {[lbl && lbl !== rego ? lbl : null, item.vehicle_type]
                            .filter(Boolean).join(' · ')}
                        </Text>
                      ) : null}
                    </View>
                    {isSelected(item.id) && (
                      <Ionicons name="checkmark" size={20} color={Colors.orange} />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      {/* Scan Vehicle QR modal */}
      <Modal visible={scanOpen} animationType="slide" transparent onRequestClose={() => setScanOpen(false)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Scan Vehicle QR</Text>
              <TouchableOpacity testID="vehicle-scan-close" onPress={() => setScanOpen(false)}>
                <Ionicons name="close" size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={s.scanHelp}>Point the camera at the sticker on the vehicle — or paste the URL/token from the sticker below.</Text>

            {camPerm?.granted && Platform.OS !== 'web' ? (
              <View testID="vehicle-scan-camera" style={s.cameraBox}>
                <CameraView
                  style={{ flex: 1 }}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={(result) => {
                    if (scannedOnceRef.current || scanBusy) return;
                    const raw = result?.data;
                    if (!raw) return;
                    scannedOnceRef.current = true;
                    resolveScanned(String(raw));
                  }}
                />
                <View style={s.cameraReticle} />
              </View>
            ) : Platform.OS === 'web' ? null : (
              <TouchableOpacity
                testID="vehicle-scan-permission"
                style={s.permissionBox}
                onPress={() => requestCamPerm()}
              >
                <Ionicons name="camera" size={22} color={Colors.orange} />
                <Text style={s.permissionText}>Enable camera to scan</Text>
                <Text style={s.permissionSub}>Or paste the URL below</Text>
              </TouchableOpacity>
            )}

            <View style={s.searchWrap}>
              <Ionicons name="link" size={16} color={Colors.textTertiary} />
              <TextInput
                testID="vehicle-scan-url"
                style={s.searchInput}
                value={scanInput}
                onChangeText={setScanInput}
                placeholder="Paste sticker URL or token"
                placeholderTextColor={Colors.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                testID="vehicle-scan-submit"
                onPress={() => resolveScanned(scanInput)}
                disabled={scanBusy || !scanInput.trim()}
                style={s.scanSubmit}
              >
                {scanBusy
                  ? <ActivityIndicator size="small" color={Colors.imSurface} />
                  : <Ionicons name="arrow-forward" size={16} color={Colors.imSurface} />}
              </TouchableOpacity>
            </View>
            {scanErr && <Text style={s.err}>{scanErr}</Text>}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '500', color: Colors.textSecondary, marginBottom: 6, marginTop: 12 },
  // v160.1.4 — primary Scan Vehicle QR CTA — bronze bg + white text.
  scanBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.imBronze,
    borderRadius: 12, paddingVertical: 14, paddingHorizontal: 14,
    minHeight: 56,
  },
  scanBtnTitle: { color: Colors.imSurface, fontSize: 14, fontWeight: '800' },
  scanBtnSub: { color: Colors.imSurface, opacity: 0.85, fontSize: 11, marginTop: 2 },
  divider: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 10,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.imBorder },
  dividerText: { fontSize: 11, color: Colors.imInkSubtle, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },

  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    backgroundColor: Colors.surfaceLight,
    paddingHorizontal: 12, paddingVertical: 12,
  },
  triggerText: { flex: 1, fontSize: 14, color: Colors.ink, fontWeight: '500' },
  triggerPlaceholder: { color: Colors.placeholder, fontWeight: '400' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(2,6,23,0.72)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: 16, maxHeight: '85%',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: Colors.ink },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    backgroundColor: Colors.surfaceLight, paddingHorizontal: 12, marginBottom: 8,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: Colors.ink },
  err: { color: Colors.red, padding: 12, fontSize: 13 },
  empty: { color: Colors.textTertiary, padding: 20, textAlign: 'center', fontSize: 13 },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight, minHeight: 44,
  },
  rowSelected: { backgroundColor: Colors.orangeSoft, borderRadius: 8 },
  rowName: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  rowMeta: { fontSize: 11, color: Colors.textTertiary, marginTop: 1 },

  // Scan modal extras
  scanHelp: { fontSize: 12, color: Colors.textSecondary, marginBottom: 10 },
  cameraBox: { height: 220, borderRadius: 12, overflow: 'hidden', backgroundColor: Colors.imInk, marginBottom: 12 },
  cameraReticle: {
    position: 'absolute', top: '50%', left: '50%',
    width: 160, height: 160, marginLeft: -80, marginTop: -80,
    borderWidth: 3, borderColor: Colors.orange, borderRadius: 16, opacity: 0.85,
    pointerEvents: 'none',
  },
  permissionBox: {
    backgroundColor: Colors.orangeSoft, borderRadius: 10, padding: 12,
    marginBottom: 12, alignItems: 'center',
  },
  permissionText: { color: Colors.orange, fontWeight: '700', marginTop: 4 },
  permissionSub: { color: Colors.textSecondary, fontSize: 11, marginTop: 2 },
  scanSubmit: {
    backgroundColor: Colors.imBronze, borderRadius: 8, width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
  },
});
