import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, Modal } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import api, { apiError } from '../../src/lib/api';
import { getUser } from '../../src/lib/auth';
import PrimaryButton from '../../src/components/PrimaryButton';
import WorkerPicker from '../../src/components/WorkerPicker';
import GpsLocationChip, { GpsFix } from '../../src/components/GpsLocationChip';
import { Colors } from '../../src/lib/colors';
import { toast } from '../../src/lib/toast';

function parseAssetToken(raw: string): string | null {
  const t = (raw || '').trim();
  if (!t) return null;
  const m = t.match(/\/scan\/([^/?#]+)$/);
  if (m) return m[1];
  // Also accept bare token if user typed just the token
  if (/^[A-Za-z0-9_-]{6,32}$/.test(t)) return t;
  return null;
}

export default function PreStartNewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ asset_id?: string }>();
  const [busy, setBusy] = useState(false);
  const [crewIds, setCrewIds] = useState<string[]>([]);
  const [gps, setGps] = useState<GpsFix | null>(null);
  const [asset, setAsset] = useState<any>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanInput, setScanInput] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), crew_lead: '', work_summary: '', hazards_discussed: '', sign_ons: [{ name: '', role: '', signature_ts: null as string | null }] });
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const scannedOnceRef = React.useRef(false);

  // v160.0.11 — hydrate from ?asset_id=<id> (from QR-scan-tab route)
  useEffect(() => {
    if (!params.asset_id) return;
    let live = true;
    api.get(`/assets/${params.asset_id}`)
      .then(({ data }) => { if (live && data) setAsset(data); })
      .catch(() => { /* silent */ });
    return () => { live = false; };
  }, [params.asset_id]);

  // v160.0.11.1 — auto-default the crew picker to the logged-in user's own
  // worker row so the "crew lead running the pre-start" doesn't have to
  // hand-tick themselves every time. `GET /api/workers` returns just the
  // caller's row for non-privileged users (v160.0.8) and the full directory
  // for admins — we pick the first `active` worker matching the caller's
  // email fallback so admins previewing forms also get pre-filled.
  useEffect(() => {
    let live = true;
    (async () => {
      const [{ data: workers }, me] = await Promise.all([
        api.get('/workers').catch(() => ({ data: [] })),
        getUser().catch(() => null),
      ]);
      if (!live) return;
      const list = Array.isArray(workers) ? workers : [];
      const myEmail = (me?.email || '').toLowerCase();
      const own = list.find((w: any) => (w.email || '').toLowerCase() === myEmail && w.active !== false)
                  || list.find((w: any) => w.active !== false)
                  || list[0];
      if (own?.id) {
        setCrewIds((current) => current.length > 0 ? current : [own.id]);
        setForm((f) => f.crew_lead ? f : { ...f, crew_lead: [own.first_name, own.last_name].filter(Boolean).join(' ') || f.crew_lead });
      }
    })();
    return () => { live = false; };
  }, []);

  // v160.0.11.1 — resolve a scanned/pasted QR from inside this form
  const resolveScanned = async (input: string) => {
    const token = parseAssetToken(input);
    if (!token) { setScanErr('Not a valid QR URL or token'); return; }
    setScanBusy(true); setScanErr(null);
    try {
      const { data } = await api.get(`/assets/scan/${token}`);
      setAsset(data);
      setScanOpen(false);
      setScanInput('');
    } catch (e: any) {
      setScanErr(apiError(e) || 'Unknown scan token');
    } finally {
      setScanBusy(false);
    }
  };

  const addSign = () => setForm(f => ({ ...f, sign_ons: [...f.sign_ons, { name: '', role: '', signature_ts: null }] }));
  const updSign = (i: number, patch: any) => setForm(f => ({ ...f, sign_ons: f.sign_ons.map((s, j) => j === i ? { ...s, ...patch } : s) }));
  const sign = (i: number) => updSign(i, { signature_ts: new Date().toISOString() });

  const submit = async () => {
    if (!form.work_summary || !form.crew_lead) { Alert.alert('Error', 'Crew lead and work summary required'); return; }
    if (crewIds.length === 0) { Alert.alert('Error', 'Select at least one crew member'); return; }
    setBusy(true);
    try {
      const user = await getUser();
      await api.post('/pre-starts', {
        ...form,
        workspace_id: user?.workspace_ids?.[0],
        linked_swms_ids: [],
        linked_permits: [],
        crew_worker_ids: crewIds,
        gps_latitude: gps?.latitude,
        gps_longitude: gps?.longitude,
        gps_accuracy: gps?.accuracy,
        gps_street: gps?.street,
        gps_suburb: gps?.suburb,
        asset_id: asset?.id || params.asset_id,
        asset_label: asset?.label,
        asset_rego: asset?.rego_serial,
        asset_meter_reading: asset?.meter_reading,
      });
      toast.success('Pre-start saved');
      router.back();
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView testID="prestart-new" style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.heading}>New Pre-Start</Text>
        {!(asset || params.asset_id) && (
          <TouchableOpacity
            testID="ps-scan-vehicle-qr"
            style={{ backgroundColor: Colors.orange, borderRadius: 12, padding: 16, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12 }}
            onPress={() => {
              setScanErr(null); scannedOnceRef.current = false;
              if (camPerm && !camPerm.granted) requestCamPerm();
              setScanOpen(true);
            }}
            activeOpacity={0.85}
          >
            <Ionicons name="qr-code" size={26} color="#FFFFFF" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 15 }}>Scan Vehicle QR to Auto-Fill</Text>
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 }}>Fastest way to start — points camera at the sticker</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        )}
        {!(asset || params.asset_id) && (
          <Text style={{ textAlign: 'center', color: Colors.textTertiary, fontSize: 12, marginBottom: 12 }}>OR fill manually below ↓</Text>
        )}
        {(asset || params.asset_id) && (
          <View testID="prestart-asset-banner" style={{ backgroundColor: Colors.orangeSoft, borderWidth: 1, borderColor: 'rgba(249,115,22,0.35)', borderRadius: 12, padding: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name={(asset?.type === 'vehicle') ? 'car' : 'construct'} size={22} color={Colors.orangeLight} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 10, fontWeight: '800', letterSpacing: 1.1, color: Colors.orangeLight }}>PRE-START FOR</Text>
              <Text style={{ fontSize: 15, fontWeight: '700', color: Colors.ink }}>
                {asset?.label || asset?.rego_serial || `Asset ${params.asset_id?.slice(0,8)}…`}
              </Text>
              {asset?.rego_serial && <Text style={{ fontSize: 12, color: Colors.textSecondary }}>{asset.rego_serial}{asset?.meter_reading != null ? ` · ${asset.meter_reading} ${asset.meter_unit || ''}` : ''}</Text>}
            </View>
            <TouchableOpacity testID="ps-change-vehicle" onPress={() => { setAsset(null); }}>
              <Text style={{ color: Colors.orangeLight, fontSize: 12, fontWeight: '600' }}>Change</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={s.card}>
          <Text style={s.label}>Date *</Text>
          <TextInput testID="ps-date" style={s.input} value={form.date} onChangeText={v => setForm({...form, date: v})} placeholderTextColor={Colors.placeholder} />
          <Text style={s.label}>Crew lead *</Text>
          <TextInput testID="ps-crew-lead" style={s.input} value={form.crew_lead} onChangeText={v => setForm({...form, crew_lead: v})} placeholder="Name" placeholderTextColor={Colors.placeholder} />
          <WorkerPicker
            label="Crew members"
            required
            multi
            value={crewIds}
            onChange={(ids) => setCrewIds(ids)}
            testID="ps-crew-picker"
          />
          <GpsLocationChip value={gps} onChange={setGps} />
          <Text style={s.label}>Work summary *</Text>
          <TextInput testID="ps-summary" style={[s.input, { minHeight: 70, textAlignVertical: 'top' }]} value={form.work_summary} onChangeText={v => setForm({...form, work_summary: v})} placeholder="What's the crew doing today?" placeholderTextColor={Colors.placeholder} multiline />
          <Text style={s.label}>Hazards discussed</Text>
          <TextInput testID="ps-hazards" style={[s.input, { minHeight: 50, textAlignVertical: 'top' }]} value={form.hazards_discussed} onChangeText={v => setForm({...form, hazards_discussed: v})} placeholder="Toolbox talk topics" placeholderTextColor={Colors.placeholder} multiline />
        </View>

        <View style={s.card}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Crew sign-ons</Text>
            <TouchableOpacity onPress={addSign}><Text style={s.addLink}>+ Add</Text></TouchableOpacity>
          </View>
          {form.sign_ons.map((so, i) => (
            <View key={i} testID={`ps-signon-${i}`} style={s.signRow}>
              <TextInput style={[s.input, { flex: 1 }]} value={so.name} onChangeText={v => updSign(i, { name: v })} placeholder="Name" placeholderTextColor={Colors.placeholder} />
              <TextInput style={[s.input, { width: 80 }]} value={so.role || ''} onChangeText={v => updSign(i, { role: v })} placeholder="Role" placeholderTextColor={Colors.placeholder} />
              {so.signature_ts ? (
                <View style={s.signedBadge}><Text style={s.signedText}>Signed</Text></View>
              ) : (
                <TouchableOpacity testID={`ps-sign-${i}`} style={s.signBtn} onPress={() => sign(i)}><Text style={s.signBtnText}>Sign</Text></TouchableOpacity>
              )}
            </View>
          ))}
        </View>

        <View style={s.btnRow}>
          <PrimaryButton testID="ps-submit" onPress={submit} busy={busy}>Save pre-start</PrimaryButton>
        </View>

        <Modal visible={scanOpen} animationType="slide" transparent onRequestClose={() => setScanOpen(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(2,6,23,0.72)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: Colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: Colors.ink }}>Scan Vehicle QR</Text>
                <TouchableOpacity testID="ps-scan-close" onPress={() => setScanOpen(false)}>
                  <Ionicons name="close" size={22} color={Colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={{ fontSize: 12, color: Colors.textSecondary, marginBottom: 10 }}>
                Point camera at the sticker on the vehicle, or paste the URL from the sticker below.
              </Text>
              {camPerm?.granted && Platform.OS !== 'web' ? (
                <View testID="ps-scan-camera" style={{ height: 220, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000', marginBottom: 12 }}>
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
                  <View pointerEvents="none" style={{ position: 'absolute', top: '50%', left: '50%', width: 160, height: 160, marginLeft: -80, marginTop: -80, borderWidth: 3, borderColor: Colors.orange, borderRadius: 16, opacity: 0.85 }} />
                </View>
              ) : Platform.OS === 'web' ? null : (
                <TouchableOpacity
                  testID="ps-scan-permission"
                  style={{ backgroundColor: Colors.orangeSoft, borderRadius: 10, padding: 12, marginBottom: 12, alignItems: 'center' }}
                  onPress={() => requestCamPerm()}
                >
                  <Ionicons name="camera" size={22} color={Colors.orange} />
                  <Text style={{ color: Colors.orange, fontWeight: '700', marginTop: 4 }}>Enable camera to scan</Text>
                  <Text style={{ color: Colors.textSecondary, fontSize: 11, marginTop: 2 }}>Or paste the URL below</Text>
                </TouchableOpacity>
              )}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  testID="ps-scan-input"
                  style={{ flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, backgroundColor: Colors.surfaceLight, paddingHorizontal: 12, paddingVertical: 10, color: Colors.ink }}
                  value={scanInput}
                  onChangeText={setScanInput}
                  placeholder="Paste QR URL or token"
                  placeholderTextColor={Colors.placeholder}
                  autoFocus
                />
                <TouchableOpacity
                  testID="ps-scan-resolve"
                  style={{ backgroundColor: Colors.orange, paddingHorizontal: 18, borderRadius: 10, justifyContent: 'center' }}
                  onPress={() => resolveScanned(scanInput)}
                  disabled={scanBusy}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{scanBusy ? '…' : 'Go'}</Text>
                </TouchableOpacity>
              </View>
              {scanErr && <Text style={{ color: Colors.red, fontSize: 12, marginTop: 8 }}>{scanErr}</Text>}
              <Text style={{ fontSize: 11, color: Colors.textTertiary, marginTop: 12, textAlign: 'center' }}>
                On mobile, camera scanning also works from the QR Scan tab.
              </Text>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg }, content: { padding: 16, paddingBottom: 40 },
  heading: { fontSize: 22, fontWeight: '700', color: Colors.ink, marginBottom: 16 },
  card: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '500', color: Colors.textSecondary, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: Colors.text },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: Colors.ink },
  addLink: { fontSize: 14, color: Colors.orangeLight, fontWeight: '500' },
  signRow: { flexDirection: 'row', gap: 6, marginBottom: 6, alignItems: 'center' },
  signedBadge: { backgroundColor: Colors.mint, borderWidth: 1, borderColor: Colors.emerald, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  signedText: { fontSize: 11, color: Colors.emeraldDark, fontWeight: '600' },
  signBtn: { borderWidth: 1, borderColor: Colors.blue, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  signBtnText: { fontSize: 12, color: Colors.orangeLight, fontWeight: '500' },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
});
