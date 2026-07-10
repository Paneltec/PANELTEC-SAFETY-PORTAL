import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Platform, KeyboardAvoidingView, Image, Modal,
  BackHandler, StatusBar as RNStatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SignatureScreen from 'react-native-signature-canvas';
import SignaturePadWeb from '../../../src/components/SignaturePadWeb';
import api, { apiError, API_BASE } from '../../../src/lib/api';
import { Colors } from '../../../src/lib/colors';
import WorkerPicker from '../../../src/components/WorkerPicker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { toast } from '../../../src/lib/toast';

/* ─── Colour helper for radio buttons ─── */
function radioColor(opt: string, selected: boolean) {
  const norm = opt.toLowerCase();
  if (norm === 'yes')
    return selected
      ? { bg: '#ecfdf5', border: '#10b981', text: '#047857' }
      : { bg: '#fff', border: '#6ee7b7', text: '#047857' };
  if (norm === 'no' || norm === 'defective' || norm.startsWith('fail'))
    return selected
      ? { bg: '#fef2f2', border: '#ef4444', text: '#b91c1c' }
      : { bg: '#fff', border: '#fca5a5', text: '#b91c1c' };
  if (norm === 'n/a' || norm === 'na' || norm === 'not applicable')
    return selected
      ? { bg: '#f1f5f9', border: '#64748b', text: '#334155' }
      : { bg: '#fff', border: '#cbd5e1', text: '#475569' };
  return selected
    ? { bg: '#f1f5f9', border: '#64748b', text: '#1e293b' }
    : { bg: '#fff', border: '#cbd5e1', text: '#475569' };
}

/* ─── Select picker modal ─── */
function SelectModal({ visible, options, selected, onSelect, onClose }: any) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={fs.overlay} activeOpacity={1} onPress={onClose}>
        <View style={fs.pickerBox}>
          <Text style={fs.pickerTitle}>Select option</Text>
          <TouchableOpacity style={fs.pickerItem} onPress={() => onSelect('')}>
            <Text style={[fs.pickerItemText, !selected && { color: Colors.orangeLight, fontWeight: '700' }]}>— Select —</Text>
          </TouchableOpacity>
          {(options || []).map((o: string) => (
            <TouchableOpacity key={o} style={fs.pickerItem} onPress={() => onSelect(o)}>
              <Text style={[fs.pickerItemText, selected === o && { color: Colors.orangeLight, fontWeight: '700' }]}>{o}</Text>
              {selected === o && <Ionicons name="checkmark" size={14} color="#1e4a8c" />}
            </TouchableOpacity>
          ))}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

/* ─── Signature modal ─── */
function SignatureModal({ visible, onSave, onClose }: any) {
  const sigRef = useRef<any>(null);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.surface }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: Colors.ink }}>Sign below</Text>
          <TouchableOpacity testID="sig-modal-close" onPress={onClose}><Ionicons name="close" size={22} color={Colors.textTertiary} /></TouchableOpacity>
        </View>
        {Platform.OS === 'web' ? (
          // v160.0.8.1 — react-native-signature-canvas / react-native-webview
          // renders a red "does not support this platform" error on web,
          // so we swap to a canvas-backed pad. Native paths keep the
          // existing WebView-based SignatureScreen.
          <SignaturePadWeb onSave={onSave} onClose={onClose} />
        ) : (
          <SignatureScreen
            ref={sigRef}
            onOK={(sig: string) => onSave(sig)}
            onEmpty={() => Alert.alert('Please sign first')}
            descriptionText=""
            clearText="Clear"
            confirmText="Save"
            webStyle={`.m-signature-pad { box-shadow: none; border: 1px solid ${Colors.border}; border-radius: 12px; margin: 16px; background: #fff; }
              .m-signature-pad--body { border: none; }
              .m-signature-pad--footer .button { background-color: ${Colors.orange}; color: white; border-radius: 8px; padding: 10px 24px; font-weight: 600; }
              .m-signature-pad--footer .button.clear { background-color: ${Colors.surfaceLight}; color: ${Colors.textSecondary}; }`}
            style={{ flex: 1 }}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

/* ─── Photo field ─── */
function PhotoField({ photos, onChange, testId }: any) {
  const pick = async (useCamera: boolean) => {
    const perm = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow access to continue.'); return; }
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, base64: true })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, base64: true, allowsMultipleSelection: true });
    if (result.canceled || !result.assets?.length) return;
    const newPhotos = result.assets.map((a) => ({
      uri: a.uri, base64: a.base64, name: a.fileName || `photo_${Date.now()}.jpg`,
      mimeType: a.mimeType || 'image/jpeg',
    }));
    onChange([...(photos || []), ...newPhotos]);
  };
  return (
    <View testID={testId}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity testID={`${testId}-camera`} style={fs.photoBtn} onPress={() => pick(true)}>
          <Ionicons name="camera" size={16} color="#1e4a8c" />
          <Text style={fs.photoBtnText}>Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity testID={`${testId}-library`} style={fs.photoBtn} onPress={() => pick(false)}>
          <Ionicons name="images" size={16} color="#1e4a8c" />
          <Text style={fs.photoBtnText}>Library</Text>
        </TouchableOpacity>
      </View>
      {(photos || []).length > 0 && (
        <View style={fs.photoGrid}>
          {photos.map((p: any, i: number) => (
            <View key={i} style={fs.photoThumb}>
              <Image source={{ uri: p.uri }} style={fs.photoImg} />
              <TouchableOpacity testID={`${testId}-remove-${i}`} style={fs.photoRemove}
                onPress={() => { const n = [...photos]; n.splice(i, 1); onChange(n); }}>
                <Ionicons name="close-circle" size={18} color="#a8324c" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/* ─── GPS field ─── */
function GpsField({ value, onChange, testId }: any) {
  const [busy, setBusy] = useState(false);
  const capture = async () => {
    setBusy(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission denied', 'Location access needed.'); setBusy(false); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      onChange({ lat: loc.coords.latitude, lng: loc.coords.longitude, accuracy: loc.coords.accuracy, captured_at: new Date().toISOString() });
    } catch (e: any) { Alert.alert('GPS Error', e.message); }
    finally { setBusy(false); }
  };
  const hasFix = value && typeof value.lat === 'number';
  return (
    <View testID={testId}>
      <TouchableOpacity testID={`${testId}-capture`} style={fs.gpsBtn} onPress={capture} disabled={busy}>
        {busy ? <ActivityIndicator size="small" color="#1e4a8c" /> : <Ionicons name={hasFix ? 'refresh' : 'location'} size={16} color="#1e4a8c" />}
        <Text style={fs.gpsBtnText}>{busy ? 'Capturing…' : hasFix ? 'Re-capture GPS' : 'Capture GPS'}</Text>
      </TouchableOpacity>
      {hasFix && (
        <View style={fs.gpsInfo}>
          <View style={fs.gpsRow}>
            <View style={fs.gpsCell}><Text style={fs.gpsCellLabel}>LAT</Text><Text style={fs.gpsCellVal}>{value.lat.toFixed(5)}</Text></View>
            <View style={fs.gpsCell}><Text style={fs.gpsCellLabel}>LNG</Text><Text style={fs.gpsCellVal}>{value.lng.toFixed(5)}</Text></View>
            <View style={fs.gpsCell}><Text style={fs.gpsCellLabel}>± M</Text><Text style={fs.gpsCellVal}>{Math.round(value.accuracy ?? 0)}</Text></View>
          </View>
        </View>
      )}
    </View>
  );
}

/* ─── v160.0.12.2 · Company selector — segmented toggle for ≤2 companies, dropdown for more ─── */
function CompanySelectorField({ value, onChange, testId, required }: any) {
  const [companies, setCompanies] = useState<Array<{ id: string; name: string; simpro_company_id?: string }>>([]);
  const [modalOpen, setModalOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    api.get('/org/companies')
      .then(({ data }) => { if (alive) setCompanies(data?.companies || []); })
      .catch(() => { /* keep list empty — user still sees the field */ });
    return () => { alive = false; };
  }, []);

  // v160.0.12.3 — Single-state flip toggle for exactly 2 companies. Shows
  // only the currently-selected company; tapping flips to the other. Saves
  // one row of vertical space vs the segmented control.
  if (companies.length === 2) {
    const current = companies.find((c) => c.id === value) || companies[0];
    const other = companies.find((c) => c.id !== current.id) || companies[1];
    // Auto-seed the form field with the first company on mount so the
    // caller doesn't submit with a blank company_selector.
    if (!value) {
      // set-on-mount without an effect — safe because setState guards against
      // duplicate updates.
      setTimeout(() => onChange(current.id), 0);
    }
    return (
      <TouchableOpacity
        testID={testId}
        onPress={() => onChange(other.id)}
        activeOpacity={0.7}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          backgroundColor: Colors.orange, borderRadius: 999,
          paddingVertical: 10, paddingHorizontal: 16, alignSelf: 'flex-start',
          borderWidth: 2, borderColor: Colors.orangeLight,
        }}
      >
        <Ionicons name="checkmark-circle" size={16} color="#0F172A" />
        <Text testID={`${testId}-label`} style={{ color: '#0F172A', fontSize: 15, fontWeight: '800' }}>
          {current.name}
        </Text>
        <View style={{ width: 1, height: 14, backgroundColor: '#0F172A', opacity: 0.4 }} />
        <Ionicons name="swap-horizontal" size={16} color="#0F172A" />
        <Text style={{ color: '#0F172A', opacity: 0.75, fontSize: 12, fontWeight: '600' }}>
          Tap to switch
        </Text>
      </TouchableOpacity>
    );
  }

  // Fallback: dropdown for >2 companies or 0/1 (still readable).
  const selected = companies.find((c) => c.id === value);
  return (
    <View testID={testId}>
      <TouchableOpacity testID={`${testId}-open`} style={fs.selectBtn} onPress={() => setModalOpen(true)}>
        <Text style={[fs.selectBtnText, !selected && { color: Colors.textTertiary }]}>
          {selected ? selected.name : (required ? '— Select a company —' : '— Optional —')}
        </Text>
        <Ionicons name="chevron-down" size={14} color={Colors.textTertiary} />
      </TouchableOpacity>
      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <TouchableOpacity style={fs.overlay} activeOpacity={1} onPress={() => setModalOpen(false)}>
          <View style={fs.pickerBox}>
            <Text style={fs.pickerTitle}>Select company</Text>
            {companies.length === 0 ? (
              <Text style={{ padding: 12, color: Colors.textTertiary }}>No companies configured yet</Text>
            ) : companies.map((c) => (
              <TouchableOpacity key={c.id} testID={`${testId}-opt-${c.id}`} style={fs.pickerItem}
                onPress={() => { onChange(c.id); setModalOpen(false); }}>
                <Text style={[fs.pickerItemText, value === c.id && { color: Colors.orangeLight, fontWeight: '700' }]}>{c.name}</Text>
                {value === c.id && <Ionicons name="checkmark" size={14} color="#1e4a8c" />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

/* ─── v160.0.12.2 · Auto-date — locked timestamp, HIGH-CONTRAST readable ─── */
function AutoDateField({ value, onChange, testId }: any) {
  useEffect(() => {
    if (!value) onChange(new Date().toISOString().slice(0, 10));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View testID={testId} style={{
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: Colors.surfaceLight,
      borderWidth: 1, borderColor: Colors.border,
      borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12,
    }}>
      <Ionicons name="lock-closed" size={14} color={Colors.orangeLight} />
      <Text style={{ color: Colors.ink, fontWeight: '700', fontSize: 15 }}>{value || '—'}</Text>
      <View style={{ flex: 1 }} />
      <Text style={{ color: Colors.textSecondary, fontSize: 12, fontWeight: '500' }}>Auto-filled today</Text>
    </View>
  );
}

/* ─── v160.0.12 · Asset QR scanner — reuses pre-start scanner pattern ─── */
function AssetQrScanField({ value, onChange, testId, autofillMap, setSiblings }: any) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const scannedOnceRef = useRef(false);

  const resolve = useCallback(async (raw: string) => {
    if (busy) return;
    setErr(null); setBusy(true);
    try {
      const t = raw.trim();
      const token = t.startsWith('http') ? (t.split('/').pop() || t) : t;
      const { data: asset } = await api.get(`/assets/scan/${token}`);
      // Optionally hydrate the linked vehicle_navixy / other siblings.
      const snapshot: any = {
        id: asset.id, name: asset.name, rego_serial: asset.rego_serial,
        navixy_device_id: asset.navixy_device_id ?? null,
        hours_meter: asset.hours_meter ?? null, odo_km: asset.odo_km ?? null,
        last_lat: asset.last_known_lat ?? null, last_lng: asset.last_known_lng ?? null,
        scanned_at: new Date().toISOString(),
      };
      onChange(snapshot);
      // Auto-fill siblings — best-effort, silently skip missing target ids.
      if (autofillMap && setSiblings) {
        const patch: Record<string, any> = {};
        if (autofillMap.vehicle_navixy) patch[autofillMap.vehicle_navixy] = asset.rego_serial || asset.name || asset.id;
        if (autofillMap.plant_make_model && asset.name) patch[autofillMap.plant_make_model] = asset.name;
        if (autofillMap.hour_meter && asset.hours_meter != null) patch[autofillMap.hour_meter] = asset.hours_meter;
        setSiblings(patch);
      }
      setOpen(false);
    } catch (e: any) {
      setErr(apiError(e) || 'Could not resolve asset');
    } finally {
      setBusy(false);
    }
  }, [busy, onChange, autofillMap, setSiblings]);

  return (
    <View testID={testId}>
      {value?.id ? (
        <View style={{ backgroundColor: Colors.orangeSoft, borderRadius: 12, padding: 12, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="checkmark-circle" size={18} color={Colors.orange} />
            <Text style={{ fontWeight: '700', color: Colors.textPrimary, flex: 1 }} numberOfLines={1}>
              {value.name || value.rego_serial || value.id}
            </Text>
            <TouchableOpacity testID={`${testId}-reset`} onPress={() => onChange(null)}>
              <Text style={{ color: Colors.orange, fontSize: 12, fontWeight: '600' }}>Change</Text>
            </TouchableOpacity>
          </View>
          {value.rego_serial && <Text style={{ fontSize: 11, color: Colors.textSecondary }}>Rego / Serial: {value.rego_serial}</Text>}
          {value.hours_meter != null && <Text style={{ fontSize: 11, color: Colors.textSecondary }}>Hours: {value.hours_meter}</Text>}
          {value.odo_km != null && <Text style={{ fontSize: 11, color: Colors.textSecondary }}>Odo: {value.odo_km} km</Text>}
          {value.navixy_device_id && <Text style={{ fontSize: 11, color: Colors.textTertiary }}>Navixy device #{value.navixy_device_id}</Text>}
        </View>
      ) : (
        <TouchableOpacity
          testID={`${testId}-open`}
          style={{
            backgroundColor: Colors.orange, borderRadius: 14,
            paddingVertical: 18, paddingHorizontal: 16,
            flexDirection: 'row', alignItems: 'center', gap: 14,
            borderWidth: 2, borderColor: Colors.orangeLight,
            shadowColor: Colors.orange, shadowOpacity: 0.4,
            shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
            elevation: 6,
          }}
          onPress={() => { setErr(null); scannedOnceRef.current = false; if (camPerm && !camPerm.granted) requestCamPerm(); setOpen(true); }}
        >
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="camera" size={24} color={Colors.orangeLight} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#0F172A', fontWeight: '800', fontSize: 16 }}>Scan Equipment QR</Text>
            <Text style={{ color: '#0F172A', opacity: 0.85, fontSize: 12, fontWeight: '600' }}>Point camera at the vehicle sticker to auto-fill</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#0F172A" />
        </TouchableOpacity>
      )}
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={fs.overlay}>
          <View style={[fs.pickerBox, { padding: 16, gap: 10 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={fs.pickerTitle}>Scan Equipment QR</Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity testID={`${testId}-close`} onPress={() => setOpen(false)}>
                <Ionicons name="close" size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {camPerm?.granted && Platform.OS !== 'web' ? (
              <View style={{ height: 220, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' }}>
                <CameraView
                  style={{ flex: 1 }} facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={(r) => {
                    if (scannedOnceRef.current || busy) return;
                    if (!r?.data) return;
                    scannedOnceRef.current = true;
                    resolve(String(r.data));
                  }}
                />
                <View pointerEvents="none" style={{ position: 'absolute', top: '50%', left: '50%', width: 140, height: 140, marginLeft: -70, marginTop: -70, borderWidth: 3, borderColor: Colors.orange, borderRadius: 14, opacity: 0.85 }} />
              </View>
            ) : Platform.OS === 'web' ? (
              <View style={{ padding: 12, backgroundColor: Colors.surfaceLight, borderRadius: 10, borderWidth: 1, borderColor: Colors.orange, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="information-circle" size={16} color={Colors.orangeLight} />
                <Text style={{ color: Colors.ink, fontSize: 13, fontWeight: '600', flex: 1 }}>
                  Web preview — paste the QR URL below.
                </Text>
              </View>
            ) : (
              <TouchableOpacity testID={`${testId}-cam-permission`} onPress={() => requestCamPerm()} style={{ backgroundColor: Colors.orangeSoft, padding: 12, borderRadius: 10, alignItems: 'center' }}>
                <Ionicons name="camera" size={22} color={Colors.orange} />
                <Text style={{ color: Colors.orange, fontWeight: '700', marginTop: 4 }}>Enable camera</Text>
              </TouchableOpacity>
            )}
            <PastePanel busy={busy} onSubmit={resolve} testId={testId} />
            {err && <Text style={{ color: '#b91c1c', fontSize: 12 }}>{err}</Text>}
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ─── v160.0.12 · Paste-URL fallback panel (web + permission-denied) ─── */
function PastePanel({ busy, onSubmit, testId }: any) {
  const [url, setUrl] = useState('');
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <TextInput
        testID={`${testId}-paste-input`}
        placeholder="Or paste scan URL…"
        placeholderTextColor={Colors.textTertiary}
        style={[fs.input, { flex: 1 }]}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
      />
      <TouchableOpacity
        testID={`${testId}-paste-go`}
        style={{ backgroundColor: Colors.orange, paddingHorizontal: 16, borderRadius: 10, justifyContent: 'center' }}
        onPress={() => url.trim() && onSubmit(url)}
        disabled={busy}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Go</Text>}
      </TouchableOpacity>
    </View>
  );
}

/* ─── v160.0.12.6 · Worker picker with inline company toggle ───
 * Self-contained: holds its OWN company state (defaults to Paneltec Civil).
 * Not linked to the top-level `company_selector` field — the operator can
 * belong to a different company than the form's submitting entity. */
function InlineTogglePicker({ testId, companyOptions, value, onChange }: any) {
  const opts: Array<{ label: string; simpro_id: string }> = companyOptions?.length
    ? companyOptions
    : [{ label: 'Paneltec Civil', simpro_id: '2' }, { label: 'Viatec', simpro_id: '3' }];
  const [company, setCompany] = useState(opts[0]);

  const flip = () => {
    const other = opts.find((o) => o.simpro_id !== company.simpro_id) || opts[0];
    setCompany(other);
    // Clear the picker value so the user doesn't submit a worker from the
    // previous company by accident.
    if (value) onChange(null);
  };

  return (
    <View testID={testId}>
      <TouchableOpacity
        testID={`${testId}-toggle`}
        onPress={flip}
        activeOpacity={0.7}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          backgroundColor: Colors.orange, borderRadius: 999,
          paddingVertical: 8, paddingHorizontal: 14, alignSelf: 'flex-start',
          borderWidth: 2, borderColor: Colors.orangeLight, marginBottom: 8,
        }}
      >
        <Ionicons name="business" size={14} color="#0F172A" />
        <Text testID={`${testId}-toggle-label`} style={{ color: '#0F172A', fontSize: 13, fontWeight: '800' }}>
          {company.label}
        </Text>
        <View style={{ width: 1, height: 12, backgroundColor: '#0F172A', opacity: 0.4 }} />
        <Ionicons name="swap-horizontal" size={14} color="#0F172A" />
        <Text style={{ color: '#0F172A', opacity: 0.75, fontSize: 11, fontWeight: '600' }}>Tap to switch</Text>
      </TouchableOpacity>
      <WorkerPicker
        label=""
        mode="single"
        value={value || null}
        companyFilter={{ simpro_company_id: company.simpro_id, name: company.label }}
        onChange={(wid: string | null) => onChange(wid)}
      />
    </View>
  );
}

/* ─── Main fill-out screen ─── */
export default function FillOutScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tpl, setTpl] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<Record<string, any>>({});
  const [photos, setPhotos] = useState<Record<string, any[]>>({});
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState('');
  const [sigModalField, setSigModalField] = useState<string | null>(null);
  const [selectModalField, setSelectModalField] = useState<string | null>(null);
  // v160.0.12.2 — Company toggle drives per-picker worker filtering. Load
  // the org's companies once at parent level so the WorkerPicker filter
  // can dereference the selected `co_v160012` id → simpro_company_id.
  const [companies, setCompanies] = useState<Array<{ id: string; name: string; simpro_company_id?: string }>>([]);
  useEffect(() => {
    let alive = true;
    api.get('/org/companies').then(({ data }) => {
      if (alive) setCompanies(data?.companies || []);
    }).catch(() => { /* keep empty */ });
    return () => { alive = false; };
  }, []);
  const draftKey = `form_draft_${id}`;

  // v160.0.12.2 — When the operator changes company, clear any picked
  // worker whose simpro_company_id no longer matches the new company.
  // This prevents "operator from Paneltec, reported to Viatec worker"
  // ghost combinations after a re-toggle.
  const prevCompanyRef = useRef<string | null>(null);
  useEffect(() => {
    const cid = values['co_v160012'] as string | undefined;
    if (prevCompanyRef.current !== null && cid && cid !== prevCompanyRef.current) {
      // Clear both worker pickers when company toggle flips.
      setValues((prev) => {
        const next = { ...prev };
        for (const key of ['op_v160012', 'rt_v160012']) {
          if (next[key]) next[key] = null;
        }
        return next;
      });
      toast.info('Company changed — please reselect worker');
    }
    if (cid) prevCompanyRef.current = cid;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values['co_v160012']]);

  useEffect(() => {
    api.get(`/forms/templates/${id}`)
      .then(({ data }) => setTpl(data))
      .catch((e) => Alert.alert('Error', apiError(e)))
      .finally(() => setLoading(false));
  }, [id]);

  // Load draft
  useEffect(() => {
    AsyncStorage.getItem(draftKey).then((raw) => {
      if (raw) {
        try { const d = JSON.parse(raw); if (d.values) setValues(d.values); } catch { /* ignore */ }
      }
    });
  }, [draftKey]);

  // Auto-save every 5s
  const valRef = useRef(values);
  valRef.current = values;
  useEffect(() => {
    const iv = setInterval(() => {
      AsyncStorage.setItem(draftKey, JSON.stringify({ values: valRef.current, saved_at: new Date().toISOString() }));
    }, 5000);
    return () => clearInterval(iv);
  }, [draftKey]);

  // v160.1.1 — dirtyRef declared FIRST so setVal + handleBackAttempt can
  // close over it without TS "used before declaration" complaints.
  // Tracks whether the user has entered ANY input since load. We can't
  // rely on `Object.keys(values).length` because the auto-load hook
  // above hydrates a saved draft, which we don't want to count as
  // "dirty". `dirtyRef` only flips to true from `setVal`.
  const dirtyRef = useRef(false);

  const setVal = useCallback((fid: string, v: any) => {
    dirtyRef.current = true;
    setValues((p) => ({ ...p, [fid]: v }));
  }, []);

  // v160.1.1 — Escape-route support (sticky Cancel + discard confirm)
  const insets = useSafeAreaInsets();
  const androidExtra = Platform.OS === 'android' ? (RNStatusBar.currentHeight || 0) + 16 : 24;
  const headerTopPad = Math.max(insets.top, androidExtra, 44);

  const handleBackAttempt = useCallback(() => {
    const hasPhotos = Object.keys(photos).some((k) => (photos[k] || []).length > 0);
    if (!dirtyRef.current && !hasPhotos) {
      router.back();
      return true;
    }
    Alert.alert(
      'Discard this form?',
      "Any information you've entered will be lost.",
      [
        { text: 'Keep filling', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            try { await AsyncStorage.removeItem(draftKey); } catch { /* ignore */ }
            router.back();
          },
        },
      ],
      { cancelable: true },
    );
    return true;
  }, [photos, router, draftKey]);

  // Android hardware back button routes through the same discard flow.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBackAttempt();
      return true;
    });
    return () => sub.remove();
  }, [handleBackAttempt]);
  const setPhotoField = useCallback((fid: string, v: any[]) => setPhotos((p) => ({ ...p, [fid]: v })), []);

  // Aggregate captured GPS for banner
  const capturedGps = useMemo(() => {
    if (!tpl) return null;
    for (const f of tpl.fields || []) {
      if (f.type === 'gps' && values[f.id]?.lat != null) return values[f.id];
    }
    return null;
  }, [tpl, values]);

  const submit = async () => {
    if (!tpl) return;
    setSaving(true);
    try {
      setProgress('Saving submission…');
      const payload = {
        fields: (tpl.fields || []).map((f: any) => ({
          id: f.id, label: f.label, type: f.type,
          value: f.type === 'photo' ? [] : (values[f.id] ?? null),
        })),
      };
      const { data: sub } = await api.post(`/forms/templates/${id}/submissions`, payload);
      const photoFieldIds = Object.keys(photos).filter((fid) => (photos[fid] || []).length > 0);
      for (let i = 0; i < photoFieldIds.length; i++) {
        const fid = photoFieldIds[i];
        setProgress(`Uploading photos (${i + 1}/${photoFieldIds.length})…`);
        const fd = new FormData();
        fd.append('field_id', fid);
        (photos[fid] || []).forEach((p) => {
          fd.append('files', { uri: p.uri, name: p.name, type: p.mimeType || 'image/jpeg' } as any);
        });
        await api.post(`/forms/submissions/${sub.id}/photos`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      await AsyncStorage.removeItem(draftKey);
      Alert.alert('Submitted ✓', tpl.name, [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setSaving(false); setProgress(''); }
  };

  if (loading) return <SafeAreaView style={fs.safe}><ActivityIndicator testID="fill-loading" style={{ marginTop: 60 }} color={Colors.blue} /></SafeAreaView>;
  if (!tpl) return <SafeAreaView style={fs.safe}><Text style={{ padding: 24 }}>Template not found.</Text></SafeAreaView>;

  const activeSelectField = tpl.fields?.find((f: any) => f.id === selectModalField);

  return (
    <SafeAreaView style={fs.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* v160.1.1 — Sticky header with brute-force notch clearance.
            Provides the ESCAPE ROUTE the user reported was missing:
            "Cancel" button + form title. Tapping Cancel invokes
            handleBackAttempt() which either exits immediately (clean
            form) or prompts the discard-confirm dialog (dirty form). */}
        <View testID="fill-header" style={fs.header}>
          <View style={{ height: headerTopPad }} />
          <View style={fs.headerRow}>
            <TouchableOpacity
              testID="fill-cancel-btn"
              onPress={handleBackAttempt}
              activeOpacity={0.7}
              style={fs.cancelBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="chevron-back" size={20} color={Colors.hvOrange} />
              <Text style={fs.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 8 }}>
              <Text style={fs.headerOverline}>FILL OUT</Text>
              <Text style={fs.headerTitle} numberOfLines={1}>{tpl.name}</Text>
            </View>
            <View style={fs.draftBadge}>
              <Ionicons name="save" size={10} color={Colors.hvYellow} />
              <Text style={fs.draftBadgeText}>auto-save</Text>
            </View>
          </View>
        </View>

        {/* GPS captured banner */}
        {capturedGps && (
          <View testID="gps-captured-indicator" style={fs.gpsBanner}>
            <Ionicons name="location" size={14} color="#047857" />
            <Text style={fs.gpsBannerText}>
              GPS captured: {capturedGps.lat.toFixed(5)}, {capturedGps.lng.toFixed(5)}
            </Text>
          </View>
        )}

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          keyboardShouldPersistTaps="handled">
          {(tpl.fields || []).length === 0 ? (
            <Text style={{ fontSize: 13, color: Colors.textTertiary, fontStyle: 'italic' }}>No fields in this template.</Text>
          ) : (tpl.fields || []).map((f: any) => (
            <View key={f.id} testID={`field-row-${f.id}`} style={fs.fieldWrap}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                <Text style={fs.fieldLabel}>{f.label}</Text>
                {f.required && <Text style={fs.reqStar}>*</Text>}
                <Text style={fs.fieldType}>{f.type}</Text>
              </View>

              {f.type === 'text' && (
                <TextInput testID={`field-${f.id}`} style={fs.input} value={values[f.id] || ''}
                  onChangeText={(v) => setVal(f.id, v)} placeholder={f.placeholder || ''}
                  placeholderTextColor={Colors.textTertiary} />
              )}
              {f.type === 'textarea' && (
                <TextInput testID={`field-${f.id}`} style={[fs.input, { minHeight: 80, textAlignVertical: 'top' }]}
                  multiline value={values[f.id] || ''} onChangeText={(v) => setVal(f.id, v)}
                  placeholder={f.placeholder || ''} placeholderTextColor={Colors.textTertiary} />
              )}
              {f.type === 'number' && (
                <TextInput testID={`field-${f.id}`} style={fs.input}
                  value={values[f.id] != null ? String(values[f.id]) : ''}
                  onChangeText={(v) => setVal(f.id, v)} keyboardType="numeric"
                  placeholder={f.placeholder || ''} placeholderTextColor={Colors.textTertiary} />
              )}
              {f.type === 'date' && (
                <TextInput testID={`field-${f.id}`} style={fs.input} value={values[f.id] || ''}
                  onChangeText={(v) => setVal(f.id, v)} placeholder="YYYY-MM-DD"
                  placeholderTextColor={Colors.textTertiary} />
              )}
              {f.type === 'select' && (
                <TouchableOpacity testID={`field-${f.id}`} style={fs.selectBtn}
                  onPress={() => setSelectModalField(f.id)}>
                  <Text style={[fs.selectBtnText, !values[f.id] && { color: Colors.textTertiary }]}>
                    {values[f.id] || '— Select —'}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color={Colors.textTertiary} />
                </TouchableOpacity>
              )}

              {/* Coloured radio buttons */}
              {f.type === 'radio' && (
                <View testID={`field-${f.id}`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(f.options || []).map((o: string) => {
                    const sel = values[f.id] === o;
                    const c = radioColor(o, sel);
                    return (
                      <TouchableOpacity key={o} testID={`radio-${f.id}-${o}`}
                        style={[fs.colorRadio, { borderColor: c.border, backgroundColor: c.bg }]}
                        onPress={() => setVal(f.id, o)}>
                        <Text style={[fs.colorRadioText, { color: c.text, fontWeight: sel ? '700' : '600' }]}>{o}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {f.type === 'photo' && (
                <PhotoField photos={photos[f.id]} onChange={(v: any) => setPhotoField(f.id, v)} testId={`field-${f.id}`} />
              )}
              {f.type === 'signature' && (
                <View testID={`field-${f.id}`}>
                  {values[f.id] ? (
                    <View style={{ gap: 8 }}>
                      <Image source={{ uri: values[f.id] }} style={fs.sigPreview} resizeMode="contain" />
                      <TouchableOpacity testID={`sig-resign-${f.id}`} style={fs.resignBtn}
                        onPress={() => setSigModalField(f.id)}>
                        <Ionicons name="pencil" size={12} color="#1e4a8c" />
                        <Text style={fs.resignBtnText}>Re-sign</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity testID={`sig-open-${f.id}`} style={fs.sigOpenBtn}
                      onPress={() => setSigModalField(f.id)}>
                      <Ionicons name="pencil" size={16} color="#1e4a8c" />
                      <Text style={fs.sigOpenBtnText}>Tap to sign</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
              {f.type === 'gps' && (
                <GpsField value={values[f.id]} onChange={(v: any) => setVal(f.id, v)} testId={`field-${f.id}`} />
              )}

              {/* v160.0.12 — new field types for Heavy Equipment Pre-Op template */}
              {f.type === 'company_selector' && (
                <CompanySelectorField
                  value={values[f.id]}
                  onChange={(v: string) => setVal(f.id, v)}
                  testId={`field-${f.id}`}
                  required={f.required}
                />
              )}
              {f.type === 'auto_date' && (
                <AutoDateField
                  value={values[f.id]}
                  onChange={(v: string) => setVal(f.id, v)}
                  testId={`field-${f.id}`}
                />
              )}
              {f.type === 'worker_picker' && (() => {
                // v160.0.12.6 — When the field carries an inline company
                // toggle config, render a self-contained picker with its
                // own local company filter (INDEPENDENT of the top-level
                // company_selector). This is the "who is doing the form"
                // pattern — the operator can be Paneltec even if the form
                // is being submitted under Viatec, and vice-versa.
                if (f.config?.inline_company_toggle) {
                  return (
                    <InlineTogglePicker
                      testId={`field-${f.id}`}
                      companyOptions={f.config.company_options || []}
                      value={values[f.id] || null}
                      onChange={(wid: string | null) => setVal(f.id, wid)}
                    />
                  );
                }
                // Legacy path — no inline toggle, no filter.
                return (
                  <View testID={`field-${f.id}`}>
                    <WorkerPicker
                      label=""
                      mode="single"
                      value={values[f.id] || null}
                      onChange={(wid: string | null) => setVal(f.id, wid)}
                    />
                  </View>
                );
              })()}
              {f.type === 'asset_scan' && (
                <AssetQrScanField
                  value={values[f.id]}
                  onChange={(v: any) => setVal(f.id, v)}
                  testId={`field-${f.id}`}
                  autofillMap={f.config?.autofill}
                  setSiblings={(patch: Record<string, any>) => setValues((prev) => ({ ...prev, ...patch }))}
                />
              )}
              {f.type === 'vehicle_navixy' && (
                <TextInput
                  testID={`field-${f.id}`}
                  style={fs.input}
                  value={values[f.id] || ''}
                  onChangeText={(v) => setVal(f.id, v)}
                  placeholder={f.placeholder || 'Plant ID / Fleet #'}
                  placeholderTextColor={Colors.textTertiary}
                />
              )}
            </View>
          ))}
        </ScrollView>

        {/* Submit bar — orange-amber */}
        <View style={fs.submitBar}>
          {progress ? <Text style={fs.progressText}>{progress}</Text> : null}
          <TouchableOpacity testID="form-submit-btn" style={[fs.submitBtn, saving && { opacity: 0.6 }]}
            onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark-circle" size={16} color="#fff" />}
            <Text style={fs.submitBtnText}>Submit Form</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <SignatureModal visible={!!sigModalField}
        onSave={(sig: string) => { if (sigModalField) setVal(sigModalField, sig); setSigModalField(null); }}
        onClose={() => setSigModalField(null)} />

      {activeSelectField && (
        <SelectModal visible={!!selectModalField} options={activeSelectField.options}
          selected={values[selectModalField!]}
          onSelect={(v: string) => { setVal(selectModalField!, v); setSelectModalField(null); }}
          onClose={() => setSelectModalField(null)} />
      )}
    </SafeAreaView>
  );
}

const fs = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    // v160.1.1 — Solid opaque sticky header. Same colour as safe bg
    // so the notch backdrop reads as a continuous top bar with no seam.
    backgroundColor: Colors.hvAsphalt,
    paddingHorizontal: 16, paddingBottom: 12,
  },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  cancelBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingVertical: 4,
  },
  cancelText: {
    fontSize: 14, fontWeight: '700', color: Colors.hvOrange,
  },
  headerOverline: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2, color: Colors.hvYellow },
  headerTitle: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' }, // linter-ok: HV header title — explicit white on hvAsphalt
  draftBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.amberSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)',
  },
  draftBadgeText: { fontSize: 9, fontWeight: '600', color: '#FBBF24' },
  gpsBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: '#ecfdf5', borderBottomWidth: 1, borderBottomColor: '#a7f3d0',
  },
  gpsBannerText: { fontSize: 12, fontWeight: '600', color: '#047857' },
  fieldWrap: { marginBottom: 20 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: Colors.ink },
  fieldType: { fontSize: 9, fontWeight: '600', color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  reqStar: { fontSize: 14, color: '#dc2626', fontWeight: '700' },
  input: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, color: Colors.text, minHeight: 48,
  },
  selectBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, minHeight: 48,
  },
  selectBtnText: { fontSize: 14, color: Colors.text },
  colorRadio: {
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12,
    borderWidth: 2, minHeight: 48, minWidth: 80,
    alignItems: 'center', justifyContent: 'center',
  },
  colorRadioText: { fontSize: 14 },
  photoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1,
    backgroundColor: Colors.surfaceLight, borderWidth: 2, borderStyle: 'dashed', borderColor: Colors.border,
    borderRadius: 10, paddingVertical: 12, minHeight: 48,
  },
  photoBtnText: { fontSize: 13, fontWeight: '600', color: Colors.orangeLight },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  photoThumb: { width: 80, height: 80, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  photoImg: { width: '100%', height: '100%' },
  photoRemove: { position: 'absolute', top: 2, right: 2 },
  sigOpenBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.surfaceLight, borderWidth: 2, borderStyle: 'dashed', borderColor: Colors.border,
    borderRadius: 10, paddingVertical: 20, minHeight: 48,
  },
  sigOpenBtnText: { fontSize: 13, fontWeight: '600', color: Colors.orangeLight },
  sigPreview: { width: '100%', height: 120, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: Colors.border, borderRadius: 10 },
  resignBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end',
    paddingHorizontal: 10, paddingVertical: 6,
  },
  resignBtnText: { fontSize: 12, fontWeight: '500', color: Colors.orangeLight },
  gpsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surfaceLight, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, minHeight: 48,
  },
  gpsBtnText: { fontSize: 13, fontWeight: '600', color: Colors.orangeLight },
  gpsInfo: {
    marginTop: 8, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, overflow: 'hidden',
  },
  gpsRow: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, gap: 12 },
  gpsCell: { flex: 1 },
  gpsCellLabel: { fontSize: 9, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 1, textTransform: 'uppercase' },
  gpsCellVal: { fontSize: 12, fontWeight: '600', color: Colors.ink, marginTop: 2 },
  submitBar: {
    paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 24,
    backgroundColor: Colors.bg, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  progressText: { fontSize: 11, color: Colors.textTertiary, marginBottom: 6 },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.brandOrange, borderRadius: 12, paddingVertical: 14, minHeight: 50,
  },
  submitBtnText: { color: '#fff', fontSize: 14, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  pickerBox: { backgroundColor: Colors.white, borderRadius: 16, padding: 16, width: '100%', maxWidth: 320 },
  pickerTitle: { fontSize: 15, fontWeight: '700', color: Colors.ink, marginBottom: 8 },
  pickerItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  pickerItemText: { fontSize: 14, color: Colors.text },
});
