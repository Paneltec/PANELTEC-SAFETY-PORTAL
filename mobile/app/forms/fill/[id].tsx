import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Platform, KeyboardAvoidingView, Image, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SignatureScreen from 'react-native-signature-canvas';
import api, { apiError, API_BASE } from '../../../src/lib/api';
import { Colors } from '../../../src/lib/colors';

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
            <Text style={[fs.pickerItemText, !selected && { color: '#1e4a8c', fontWeight: '700' }]}>— Select —</Text>
          </TouchableOpacity>
          {(options || []).map((o: string) => (
            <TouchableOpacity key={o} style={fs.pickerItem} onPress={() => onSelect(o)}>
              <Text style={[fs.pickerItemText, selected === o && { color: '#1e4a8c', fontWeight: '700' }]}>{o}</Text>
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
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: Colors.ink }}>Sign below</Text>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={Colors.textTertiary} /></TouchableOpacity>
        </View>
        <SignatureScreen
          ref={sigRef}
          onOK={(sig: string) => onSave(sig)}
          onEmpty={() => Alert.alert('Please sign first')}
          descriptionText=""
          clearText="Clear"
          confirmText="Save"
          webStyle={`.m-signature-pad { box-shadow: none; border: 1px solid #e2e8f0; border-radius: 12px; margin: 16px; }
            .m-signature-pad--body { border: none; }
            .m-signature-pad--footer .button { background-color: #1e4a8c; color: white; border-radius: 8px; padding: 10px 24px; font-weight: 600; }
            .m-signature-pad--footer .button.clear { background-color: #f1f5f9; color: #475569; }`}
          style={{ flex: 1 }}
        />
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
  const draftKey = `form_draft_${id}`;

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

  const setVal = useCallback((fid: string, v: any) => setValues((p) => ({ ...p, [fid]: v })), []);
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
        {/* Header */}
        <View testID="fill-header" style={fs.header}>
          <TouchableOpacity testID="fill-back" onPress={() => router.back()} style={{ padding: 4 }}>
            <Ionicons name="arrow-back" size={20} color="#1e4a8c" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={fs.headerOverline}>FILL OUT</Text>
            <Text style={fs.headerTitle} numberOfLines={1}>{tpl.name}</Text>
          </View>
          <View style={fs.draftBadge}>
            <Ionicons name="save" size={10} color="#8c6a1a" />
            <Text style={fs.draftBadgeText}>auto-save</Text>
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
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#e6eff9', borderBottomWidth: 1, borderBottomColor: '#b9d2ec',
  },
  headerOverline: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2, color: '#1e4a8c' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.ink },
  draftBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#f7eed1', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
  },
  draftBadgeText: { fontSize: 9, fontWeight: '600', color: '#8c6a1a' },
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
    backgroundColor: '#eff5fc', borderWidth: 2, borderStyle: 'dashed', borderColor: '#b9d2ec',
    borderRadius: 10, paddingVertical: 12, minHeight: 48,
  },
  photoBtnText: { fontSize: 13, fontWeight: '600', color: '#1e4a8c' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  photoThumb: { width: 80, height: 80, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  photoImg: { width: '100%', height: '100%' },
  photoRemove: { position: 'absolute', top: 2, right: 2 },
  sigOpenBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#eff5fc', borderWidth: 2, borderStyle: 'dashed', borderColor: '#b9d2ec',
    borderRadius: 10, paddingVertical: 20, minHeight: 48,
  },
  sigOpenBtnText: { fontSize: 13, fontWeight: '600', color: '#1e4a8c' },
  sigPreview: { width: '100%', height: 120, backgroundColor: '#fff', borderWidth: 1, borderColor: Colors.border, borderRadius: 10 },
  resignBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end',
    paddingHorizontal: 10, paddingVertical: 6,
  },
  resignBtnText: { fontSize: 12, fontWeight: '500', color: '#1e4a8c' },
  gpsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#eff5fc', borderWidth: 1, borderColor: '#b9d2ec',
    borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, minHeight: 48,
  },
  gpsBtnText: { fontSize: 13, fontWeight: '600', color: '#1e4a8c' },
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
    backgroundColor: '#d97706', borderRadius: 12, paddingVertical: 14, minHeight: 50,
  },
  submitBtnText: { color: '#fff', fontSize: 14, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  pickerBox: { backgroundColor: Colors.white, borderRadius: 16, padding: 16, width: '100%', maxWidth: 320 },
  pickerTitle: { fontSize: 15, fontWeight: '700', color: Colors.ink, marginBottom: 8 },
  pickerItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  pickerItemText: { fontSize: 14, color: Colors.text },
});
