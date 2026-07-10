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
import NavixyVehiclePicker from '../../../src/components/NavixyVehiclePicker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { toast } from '../../../src/lib/toast';
import ConfirmModal from '../../../src/components/ConfirmModal';
import DateTimePicker from '@react-native-community/datetimepicker';

/* ─── Colour helper for radio buttons ─── */
function radioColor(opt: string, selected: boolean) {
  // v160.1.4 — Higher-contrast SELECTED state per user brief. Selected
  // options fill with a saturated brand colour + white text; unselected
  // options stay light with a coloured outline as a subtle affordance.
  //
  // Yes / No / N-A / Fail keep their semantic tint (green / red / grey)
  // because it's genuinely useful for pre-use safety checks — a bright
  // green "Yes" and a bright red "No" read faster than a uniform bronze
  // pair. Any other option falls back to bronze (imBronze).
  const norm = opt.toLowerCase();
  if (norm === 'yes')
    return selected
      ? { bg: Colors.imSuccess, border: Colors.imSuccess, text: Colors.imSurface }
      : { bg: Colors.imSurface, border: Colors.imSuccess, text: Colors.imSuccess };
  if (norm === 'no' || norm === 'defective' || norm.startsWith('fail'))
    return selected
      ? { bg: Colors.imError, border: Colors.imError, text: Colors.imSurface }
      : { bg: Colors.imSurface, border: Colors.imError, text: Colors.imError };
  if (norm === 'n/a' || norm === 'na' || norm === 'not applicable')
    return selected
      ? { bg: Colors.imInkMuted, border: Colors.imInkMuted, text: Colors.imSurface }
      : { bg: Colors.imSurface, border: Colors.imBorder, text: Colors.imInkMuted };
  // Neutral options — bronze fill when selected per user brief.
  return selected
    ? { bg: Colors.imBronze, border: Colors.imBronze, text: Colors.imSurface }
    : { bg: Colors.imSurface, border: Colors.imBorder, text: Colors.imInk };
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
              {selected === o && <Ionicons name="checkmark" size={14} color={Colors.paneltecBlue} />}
            </TouchableOpacity>
          ))}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

/* ─── v160.1.4 · Editable date field with a calendar picker ─── */
function DatePickerField({ value, onChange, defaultToday, testId }: {
  value: string | null | undefined;
  onChange: (iso: string) => void;
  defaultToday?: boolean;
  testId: string;
}) {
  // Pre-fill with today's date when `defaultToday` is set and the field
  // is currently empty. Uses a mount-time effect so it doesn't clobber a
  // hydrated draft value.
  useEffect(() => {
    if (defaultToday && !value) {
      onChange(new Date().toISOString().slice(0, 10));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [pickerOpen, setPickerOpen] = useState(false);
  const asDate = value ? new Date(value) : new Date();
  const display = value || 'YYYY-MM-DD';

  // Web: <input type="date"> already ships a native calendar picker, so
  // let the browser render its own control — cleaner than mounting the
  // native picker.
  if (Platform.OS === 'web') {
    return (
      <View testID={testId} style={fs.datePickerWrap}>
        <Ionicons name="calendar" size={16} color={Colors.imBronze} />
        {/* @ts-expect-error web-only DOM element for RN Web */}
        <input
          type="date"
          value={value || ''}
          onChange={(e: any) => onChange(e.target.value)}
          style={{
            flex: 1, fontSize: 15, fontWeight: '600',
            color: Colors.imInk, border: 'none', background: 'transparent',
            outline: 'none', padding: '4px 0',
          }}
          data-testid={`${testId}-input`}
        />
      </View>
    );
  }

  return (
    <View testID={testId}>
      <TouchableOpacity
        testID={`${testId}-open`}
        style={fs.datePickerWrap}
        onPress={() => setPickerOpen(true)}
        activeOpacity={0.75}
      >
        <Ionicons name="calendar" size={16} color={Colors.imBronze} />
        <Text style={[fs.datePickerText, !value && { color: Colors.textTertiary }]}>{display}</Text>
        <Ionicons name="chevron-down" size={14} color={Colors.textTertiary} />
      </TouchableOpacity>
      {pickerOpen && (
        <DateTimePicker
          testID={`${testId}-native`}
          value={asDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(_e: any, d?: Date) => {
            setPickerOpen(false);
            if (d) onChange(d.toISOString().slice(0, 10));
          }}
        />
      )}
    </View>
  );
}

/* ─── v160.2.3 Time picker field ─── */
function TimePickerField({ value, onChange, testId }: {
  value: string | null | undefined;
  onChange: (hhmm: string) => void;
  testId: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // Parse an existing "HH:MM" back to a Date on today for the picker.
  const asDate = (() => {
    const d = new Date();
    if (value && /^\d{2}:\d{2}$/.test(value)) {
      const [hh, mm] = value.split(':').map((n) => parseInt(n, 10));
      d.setHours(hh || 0, mm || 0, 0, 0);
    }
    return d;
  })();
  const display = value || 'HH:MM';

  if (Platform.OS === 'web') {
    return (
      <View testID={testId} style={fs.datePickerWrap}>
        <Ionicons name="time" size={16} color={Colors.imBronze} />
        {/* @ts-expect-error web-only DOM element for RN Web */}
        <input
          type="time"
          value={value || ''}
          onChange={(e: any) => onChange(e.target.value)}
          style={{
            flex: 1, fontSize: 15, fontWeight: '600',
            color: Colors.imInk, border: 'none', background: 'transparent',
            outline: 'none', padding: '4px 0',
          }}
          data-testid={`${testId}-input`}
        />
      </View>
    );
  }

  return (
    <View testID={testId}>
      <TouchableOpacity
        testID={`${testId}-open`}
        style={fs.datePickerWrap}
        onPress={() => setPickerOpen(true)}
        activeOpacity={0.75}
      >
        <Ionicons name="time" size={16} color={Colors.imBronze} />
        <Text style={[fs.datePickerText, !value && { color: Colors.textTertiary }]}>{display}</Text>
        <Ionicons name="chevron-down" size={14} color={Colors.textTertiary} />
      </TouchableOpacity>
      {pickerOpen && (
        <DateTimePicker
          testID={`${testId}-native`}
          value={asDate}
          mode="time"
          is24Hour={true}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_e: any, d?: Date) => {
            setPickerOpen(false);
            if (d) {
              const hh = String(d.getHours()).padStart(2, '0');
              const mm = String(d.getMinutes()).padStart(2, '0');
              onChange(`${hh}:${mm}`);
            }
          }}
        />
      )}
    </View>
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
  const count = (photos || []).length;
  return (
    <View testID={testId}>
      {count === 0 ? (
        // First-capture affordance — the standard Camera / Library pair.
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity testID={`${testId}-camera`} style={fs.photoBtn} onPress={() => pick(true)}>
            <Ionicons name="camera" size={16} color={Colors.paneltecBlue} />
            <Text style={fs.photoBtnText}>Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity testID={`${testId}-library`} style={fs.photoBtn} onPress={() => pick(false)}>
            <Ionicons name="images" size={16} color={Colors.paneltecBlue} />
            <Text style={fs.photoBtnText}>Library</Text>
          </TouchableOpacity>
        </View>
      ) : (
        // v160.1.4 — Explicit "Add another photo" pill after ≥1 capture
        // so the multi-photo affordance is obvious. Small counter reads
        // "N photos captured".
        <View style={{ gap: 8 }}>
          <View style={fs.photoCountRow}>
            <Ionicons name="checkmark-circle" size={14} color={Colors.imSuccess} />
            <Text style={fs.photoCountText}>
              {count} {count === 1 ? 'photo' : 'photos'} captured
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity testID={`${testId}-camera`} style={fs.photoAddBtn} onPress={() => pick(true)}>
              <Ionicons name="add-circle" size={16} color={Colors.imSurface} />
              <Text style={fs.photoAddBtnText}>Add another photo</Text>
            </TouchableOpacity>
            <TouchableOpacity testID={`${testId}-library`} style={fs.photoBtn} onPress={() => pick(false)}>
              <Ionicons name="images" size={16} color={Colors.paneltecBlue} />
              <Text style={fs.photoBtnText}>Library</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {count > 0 && (
        <View style={fs.photoGrid}>
          {photos.map((p: any, i: number) => (
            <View key={i} style={fs.photoThumb}>
              <Image source={{ uri: p.uri }} style={fs.photoImg} />
              <TouchableOpacity testID={`${testId}-remove-${i}`} style={fs.photoRemove}
                onPress={() => { const n = [...photos]; n.splice(i, 1); onChange(n); }}>
                <Ionicons name="close-circle" size={22} color={Colors.imError} />
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
      // v160.1.4 — Reverse-geocode the coordinates into a human-readable
      // street address and stash it on the field value. Renderer shows
      // the address prominently; submissions carry BOTH the coords and
      // the address so audits can locate the site precisely and
      // stakeholders reading the report don't need to plug lat/lng into
      // a map. reverseGeocodeAsync failures are silent — the form still
      // saves valid coords.
      let address: string | null = null;
      try {
        const places = await Location.reverseGeocodeAsync({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
        if (places && places.length > 0) {
          const p = places[0];
          const parts = [
            [p.streetNumber, p.street].filter(Boolean).join(' '),
            p.district || p.subregion || p.city,
            p.region,
            p.postalCode,
          ].filter(Boolean);
          address = parts.join(', ');
        }
      } catch { /* best-effort — coords always saved */ }
      onChange({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        accuracy: loc.coords.accuracy,
        address,
        captured_at: new Date().toISOString(),
      });
    } catch (e: any) { Alert.alert('GPS Error', e.message); }
    finally { setBusy(false); }
  };
  const hasFix = value && typeof value.lat === 'number';
  return (
    <View testID={testId}>
      <TouchableOpacity testID={`${testId}-capture`} style={fs.gpsBtn} onPress={capture} disabled={busy}>
        {busy ? <ActivityIndicator size="small" color={Colors.paneltecBlue} /> : <Ionicons name={hasFix ? 'refresh' : 'location'} size={16} color={Colors.paneltecBlue} />}
        <Text style={fs.gpsBtnText}>{busy ? 'Capturing…' : hasFix ? 'Re-capture GPS' : 'Capture GPS'}</Text>
      </TouchableOpacity>
      {hasFix && (
        <View style={fs.gpsInfo}>
          {value.address ? (
            <View testID={`${testId}-address`} style={fs.gpsAddress}>
              <Ionicons name="location" size={14} color={Colors.imBronze} />
              <Text style={fs.gpsAddressText} numberOfLines={2}>{value.address}</Text>
            </View>
          ) : null}
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
        <Ionicons name="checkmark-circle" size={16} color={Colors.imInk} />
        <Text testID={`${testId}-label`} style={{ color: Colors.imInk, fontSize: 15, fontWeight: '800' }}>
          {current.name}
        </Text>
        <View style={{ width: 1, height: 14, backgroundColor: Colors.imInk, opacity: 0.4 }} />
        <Ionicons name="swap-horizontal" size={16} color={Colors.imInk} />
        <Text style={{ color: Colors.imInk, opacity: 0.75, fontSize: 12, fontWeight: '600' }}>
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
                {value === c.id && <Ionicons name="checkmark" size={14} color={Colors.paneltecBlue} />}
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
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.imInk, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="camera" size={24} color={Colors.orangeLight} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: Colors.imInk, fontWeight: '800', fontSize: 16 }}>Scan Equipment QR</Text>
            <Text style={{ color: Colors.imInk, opacity: 0.85, fontSize: 12, fontWeight: '600' }}>Point camera at the vehicle sticker to auto-fill</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Colors.imInk} />
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
              <View style={{ height: 220, borderRadius: 12, overflow: 'hidden', backgroundColor: Colors.imInk }}>
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
            {err && <Text style={{ color: Colors.imError, fontSize: 12 }}>{err}</Text>}
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
        {busy ? <ActivityIndicator color={Colors.imSurface} /> : <Text style={{ color: Colors.imSurface, fontWeight: '700' }}>Go</Text>}
      </TouchableOpacity>
    </View>
  );
}

/* ─── v160.0.12.6 · Worker picker with inline company toggle ───
 * Self-contained: holds its OWN company state (defaults to Paneltec Civil).
 * Not linked to the top-level `company_selector` field — the operator can
 * belong to a different company than the form's submitting entity. */
function InlineTogglePicker({ testId, companyOptions, value, onChange, multi }: any) {
  const opts: Array<{ label: string; simpro_id: string }> = companyOptions?.length
    ? companyOptions
    : [{ label: 'Paneltec Civil', simpro_id: '2' }, { label: 'Viatec', simpro_id: '3' }];
  const [company, setCompany] = useState(opts[0]);

  const flip = () => {
    const other = opts.find((o) => o.simpro_id !== company.simpro_id) || opts[0];
    setCompany(other);
    // Clear the picker value so the user doesn't submit a worker from the
    // previous company by accident.
    if (multi ? (value && value.length > 0) : !!value) {
      onChange(multi ? [] : null);
    }
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
        <Ionicons name="business" size={14} color={Colors.imInk} />
        <Text testID={`${testId}-toggle-label`} style={{ color: Colors.imInk, fontSize: 13, fontWeight: '800' }}>
          {company.label}
        </Text>
        <View style={{ width: 1, height: 12, backgroundColor: Colors.imInk, opacity: 0.4 }} />
        <Ionicons name="swap-horizontal" size={14} color={Colors.imInk} />
        <Text style={{ color: Colors.imInk, opacity: 0.75, fontSize: 11, fontWeight: '600' }}>Tap to switch</Text>
      </TouchableOpacity>
      {multi ? (
        // v160.2.0 — multi-select variant used by "Prepared By" /
        // "Attendee(s)" fields. Storage: array of worker ids.
        <WorkerPicker
          label=""
          multi={true}
          value={Array.isArray(value) ? value : []}
          companyFilter={{ simpro_company_id: company.simpro_id, name: company.label }}
          onChange={(wids: string[]) => onChange(wids)}
        />
      ) : (
        <WorkerPicker
          label=""
          value={value || null}
          companyFilter={{ simpro_company_id: company.simpro_id, name: company.label }}
          onChange={(wid: string | null) => onChange(wid)}
        />
      )}
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
  // v160.2.1 — `settledRef` mount-window guard. `default_today` in
  // DatePickerField and any AsyncStorage-hydrated draft both call
  // `setVal` synchronously on mount, which USED to flip `dirtyRef` and
  // pop the discard dialog on every "fresh" form open. We now ignore
  // dirty flips for the first 500 ms after mount, giving auto-populated
  // defaults time to settle before we start listening for real user input.
  const dirtyRef = useRef(false);
  const settledRef = useRef(false);
  useEffect(() => {
    const tmr = setTimeout(() => { settledRef.current = true; }, 500);
    return () => clearTimeout(tmr);
  }, []);

  const setVal = useCallback((fid: string, v: any) => {
    if (settledRef.current) dirtyRef.current = true;
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
    // v160.2.1 — Use ConfirmModal (custom RN Modal) instead of
    // Alert.alert. Alert.alert is a no-op on RN Web, so the discard
    // dialog was invisible on the browser preview; the custom modal
    // renders identically on iOS, Android and RN Web.
    setShowDiscardConfirm(true);
    return true;
  }, [photos]);

  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const performDiscard = useCallback(async () => {
    setShowDiscardConfirm(false);
    try { await AsyncStorage.removeItem(draftKey); } catch { /* ignore */ }
    router.back();
  }, [draftKey, router]);

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

  // v160.1.5 — Client-side required-field validation. Backend accepts
  // any payload silently, so if the operator missed a required field
  // they used to get zero feedback. Now: submit is blocked, first
  // missing field is scrolled into view + gets a red border + inline
  // "This field is required" text, and a top banner enumerates every
  // missing field by label.
  const isAnswerValid = (f: any, val: any, phs: any[] | undefined): boolean => {
    if (f.type === 'photo') return (phs || []).length > 0;
    if (f.type === 'gps') return val && typeof val.lat === 'number';
    if (f.type === 'signature') return typeof val === 'string' && val.length > 100;
    if (f.type === 'multi_select') return Array.isArray(val) && val.length > 0;
    if (val === null || val === undefined) return false;
    if (typeof val === 'string') return val.trim().length > 0;
    if (typeof val === 'number') return !Number.isNaN(val);
    return true;
  };
  const missingFields = useMemo(() => (tpl?.fields || []).filter((f: any) => {
    if (!f.required) return false;
    return !isAnswerValid(f, values[f.id], photos[f.id]);
  }), [tpl, values, photos]);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const missingIds = useMemo(
    () => new Set(missingFields.map((f: any) => f.id)),
    [missingFields],
  );
  // Field-row layout offsets so we can scroll to the first missing field.
  const fieldOffsetsRef = useRef<Record<string, number>>({});
  const scrollRef = useRef<ScrollView | null>(null);

  const submit = async () => {
    if (!tpl) return;
    // v160.1.5 — validation gate.
    if (missingFields.length > 0) {
      setSubmitAttempted(true);
      const first = missingFields[0] as any;
      const y = fieldOffsetsRef.current[first.id];
      if (typeof y === 'number' && scrollRef.current) {
        scrollRef.current.scrollTo({ y: Math.max(0, y - 40), animated: true });
      }
      toast.error(
        `Please complete: ${missingFields.slice(0, 3).map((f: any) => f.label).join(', ')}${missingFields.length > 3 ? ` +${missingFields.length - 3} more` : ''}`,
      );
      return;
    }
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
      {/* v160.2.1 — Cross-platform discard-confirm dialog. */}
      <ConfirmModal
        visible={showDiscardConfirm}
        title="Discard this form?"
        body="Any information you've entered will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep filling"
        destructive
        onConfirm={performDiscard}
        onCancel={() => setShowDiscardConfirm(false)}
        testID="discard-confirm"
      />
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
            <Ionicons name="location" size={14} color={Colors.imSuccess} />
            <Text style={fs.gpsBannerText}>
              GPS captured: {capturedGps.lat.toFixed(5)}, {capturedGps.lng.toFixed(5)}
            </Text>
          </View>
        )}

        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          keyboardShouldPersistTaps="handled">
          {/* v160.1.5 — Persistent missing-fields banner. Appears after
              the first failed submit; lists every required field that
              still needs a value. Tap a chip to jump to that field. */}
          {submitAttempted && missingFields.length > 0 && (
            <View testID="missing-fields-banner" style={fs.missingBanner}>
              <Text style={fs.missingBannerTitle}>PLEASE COMPLETE</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {missingFields.map((mf: any) => (
                  <TouchableOpacity
                    key={mf.id}
                    testID={`missing-chip-${mf.id}`}
                    onPress={() => {
                      const y = fieldOffsetsRef.current[mf.id];
                      if (typeof y === 'number' && scrollRef.current) {
                        scrollRef.current.scrollTo({ y: Math.max(0, y - 40), animated: true });
                      }
                    }}
                    style={fs.missingChip}
                  >
                    <Text style={fs.missingChipText}>{mf.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
          {(tpl.fields || []).length === 0 ? (
            <Text style={{ fontSize: 13, color: Colors.textTertiary, fontStyle: 'italic' }}>No fields in this template.</Text>
          ) : (tpl.fields || []).map((f: any) => {
            const hasErr = submitAttempted && missingIds.has(f.id);
            return (
            <View
              key={f.id}
              testID={`field-row-${f.id}`}
              onLayout={(e) => { fieldOffsetsRef.current[f.id] = e.nativeEvent.layout.y; }}
              style={[fs.fieldWrap, hasErr && fs.fieldWrapError]}
            >
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
                // v160.1.4 — Editable date input with a native calendar
                // picker. `config.default_today: true` pre-fills today's
                // date on mount (see DatePickerField above).
                <DatePickerField
                  value={values[f.id]}
                  onChange={(v) => setVal(f.id, v)}
                  defaultToday={!!(f.config?.default_today)}
                  testId={`field-${f.id}`}
                />
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

              {/* v160.1.4 — Higher-contrast radio buttons. Selected state
                  fills with a saturated colour + white text and shows a
                  small check icon on the left. Rows keep the 44px min
                  tap target via the shared `fs.colorRadio` style. */}
              {f.type === 'radio' && (
                <View testID={`field-${f.id}`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(f.options || []).map((o: string) => {
                    const sel = values[f.id] === o;
                    const c = radioColor(o, sel);
                    return (
                      <TouchableOpacity key={o} testID={`radio-${f.id}-${o}`}
                        style={[fs.colorRadio, { borderColor: c.border, backgroundColor: c.bg }]}
                        onPress={() => setVal(f.id, o)}>
                        {sel && (
                          <Ionicons name="checkmark" size={14} color={c.text} style={{ marginRight: 4 }} />
                        )}
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
                        <Ionicons name="pencil" size={12} color={Colors.paneltecBlue} />
                        <Text style={fs.resignBtnText}>Re-sign</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity testID={`sig-open-${f.id}`} style={fs.sigOpenBtn}
                      onPress={() => setSigModalField(f.id)}>
                      <Ionicons name="pencil" size={16} color={Colors.paneltecBlue} />
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
              {/* v160.2.3 — HH:MM time picker for permit issue/expiry
                  and Time In/Out on toolbox / sign-in / induction. */}
              {f.type === 'time' && (
                <TimePickerField
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
                      multi={!!f.config?.multi}
                      value={f.config?.multi
                        ? (Array.isArray(values[f.id]) ? values[f.id] : [])
                        : (values[f.id] || null)}
                      onChange={(v: any) => setVal(f.id, v)}
                    />
                  );
                }
                // Legacy path — no inline toggle. Supports multi via config.
                return (
                  <View testID={`field-${f.id}`}>
                    {f.config?.multi ? (
                      <WorkerPicker
                        label=""
                        multi={true}
                        value={Array.isArray(values[f.id]) ? values[f.id] : []}
                        onChange={(ids: string[]) => setVal(f.id, ids)}
                      />
                    ) : (
                      <WorkerPicker
                        label=""
                        value={values[f.id] || null}
                        onChange={(wid: string | null) => setVal(f.id, wid)}
                      />
                    )}
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
                // v160.1.3 — swapped the bare TextInput for the new
                // searchable NavixyVehiclePicker. Vehicle-QR autofill
                // (see autofillMap on the Asset QR field) writes the
                // vehicle id into this same field state, so scanning
                // a sticker still auto-selects the correct vehicle.
                <NavixyVehiclePicker
                  label=""
                  required={!!f.required}
                  value={values[f.id] || null}
                  onChange={(id) => setVal(f.id, id)}
                  testID={`field-${f.id}`}
                  placeholder={f.placeholder || 'Select vehicle'}
                />
              )}
              {hasErr && (
                <View testID={`field-error-${f.id}`} style={fs.fieldErrorRow}>
                  <Ionicons name="alert-circle" size={13} color={Colors.imError} />
                  <Text style={fs.fieldErrorText}>This field is required</Text>
                </View>
              )}
            </View>
          );})}
        </ScrollView>

        {/* Submit bar — orange-amber */}
        <View style={fs.submitBar}>
          {progress ? <Text style={fs.progressText}>{progress}</Text> : null}
          <TouchableOpacity testID="form-submit-btn" style={[fs.submitBtn, saving && { opacity: 0.6 }]}
            onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color={Colors.imSurface} /> : <Ionicons name="checkmark-circle" size={16} color={Colors.imSurface} />}
            {/* v160.1.5 — Submit label enumerates missing fields inline
                so the operator sees exactly what's blocking a submit. */}
            <Text style={fs.submitBtnText}>
              {submitAttempted && missingFields.length > 0
                ? `Complete: ${missingFields.slice(0, 2).map((f: any) => f.label).join(', ')}${missingFields.length > 2 ? ` +${missingFields.length - 2}` : ''}`
                : 'Submit Form'}
            </Text>
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
  headerTitle: { fontSize: 15, fontWeight: '700', color: Colors.imSurface }, // linter-ok: HV header title — explicit white on hvAsphalt
  draftBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.amberSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)',
  },
  draftBadgeText: { fontSize: 9, fontWeight: '600', color: Colors.hvYellow },
  gpsBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: Colors.imConcrete, borderBottomWidth: 1, borderBottomColor: Colors.imSuccess,
  },
  gpsBannerText: { fontSize: 12, fontWeight: '600', color: Colors.imSuccess },
  fieldWrap: { marginBottom: 20 },
  // v160.1.5 — validation-error styling on missing required fields.
  fieldWrapError: {
    borderWidth: 2, borderColor: Colors.imError, borderRadius: 12,
    padding: 12, marginHorizontal: -12,
    backgroundColor: 'rgba(139,58,58,0.05)',
  },
  fieldErrorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8,
  },
  fieldErrorText: {
    fontSize: 12, fontWeight: '600', color: Colors.imError,
  },
  // Persistent top banner listing every missing required field.
  missingBanner: {
    backgroundColor: 'rgba(139,58,58,0.1)',
    borderWidth: 1, borderColor: Colors.imError,
    borderRadius: 12, padding: 12, marginBottom: 14, gap: 8,
  },
  missingBannerTitle: {
    fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: Colors.imError,
  },
  missingChip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    borderWidth: 1, borderColor: Colors.imError, backgroundColor: Colors.imSurface,
  },
  missingChipText: { fontSize: 12, fontWeight: '700', color: Colors.imError },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: Colors.ink },
  fieldType: { fontSize: 9, fontWeight: '600', color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  reqStar: { fontSize: 14, color: Colors.imError, fontWeight: '700' },
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
    flexDirection: 'row',
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
    borderWidth: 2, minHeight: 44, minWidth: 74,
    alignItems: 'center', justifyContent: 'center',
  },
  colorRadioText: { fontSize: 14 },
  photoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1,
    backgroundColor: Colors.surfaceLight, borderWidth: 2, borderStyle: 'dashed', borderColor: Colors.border,
    borderRadius: 10, paddingVertical: 12, minHeight: 48,
  },
  photoBtnText: { fontSize: 13, fontWeight: '600', color: Colors.orangeLight },
  // v160.1.4 — Date picker trigger — matches the existing input aesthetic.
  datePickerWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    backgroundColor: Colors.surfaceLight,
    paddingHorizontal: 12, paddingVertical: 12, minHeight: 44,
  },
  datePickerText: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.imInk },
  // v160.1.4 — Multi-photo affordance.
  photoAddBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1,
    backgroundColor: Colors.imBronze, borderWidth: 2, borderColor: Colors.imBronze,
    borderRadius: 10, paddingVertical: 12, minHeight: 44,
  },
  photoAddBtnText: { fontSize: 13, fontWeight: '700', color: Colors.imSurface },
  photoCountRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 4, paddingVertical: 2,
  },
  photoCountText: { fontSize: 12, fontWeight: '600', color: Colors.imInkMuted },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  photoThumb: { width: 88, height: 88, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  photoImg: { width: '100%', height: '100%' },
  photoRemove: {
    position: 'absolute', top: 2, right: 2,
    backgroundColor: Colors.imSurface, borderRadius: 12,
    width: 26, height: 26, alignItems: 'center', justifyContent: 'center',
  },
  sigOpenBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.surfaceLight, borderWidth: 2, borderStyle: 'dashed', borderColor: Colors.border,
    borderRadius: 10, paddingVertical: 20, minHeight: 48,
  },
  sigOpenBtnText: { fontSize: 13, fontWeight: '600', color: Colors.orangeLight },
  sigPreview: { width: '100%', height: 120, backgroundColor: Colors.imSurface, borderWidth: 1, borderColor: Colors.border, borderRadius: 10 },
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
  // v160.1.4 — Reverse-geocoded street address banner on the GPS card.
  gpsAddress: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: Colors.imConcrete,
    borderBottomWidth: 1, borderBottomColor: Colors.imBorder,
  },
  gpsAddressText: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.imInk, lineHeight: 18 },
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
  submitBtnText: { color: Colors.imSurface, fontSize: 14, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  pickerBox: { backgroundColor: Colors.white, borderRadius: 16, padding: 16, width: '100%', maxWidth: 320 },
  pickerTitle: { fontSize: 15, fontWeight: '700', color: Colors.ink, marginBottom: 8 },
  pickerItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  pickerItemText: { fontSize: 14, color: Colors.text },
});
