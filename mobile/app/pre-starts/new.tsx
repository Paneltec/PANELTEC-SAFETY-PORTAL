import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../../src/lib/api';
import { getUser } from '../../src/lib/auth';
import PrimaryButton from '../../src/components/PrimaryButton';
import WorkerPicker from '../../src/components/WorkerPicker';
import GpsLocationChip, { GpsFix } from '../../src/components/GpsLocationChip';
import { Colors } from '../../src/lib/colors';

export default function PreStartNewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ asset_id?: string }>();
  const [busy, setBusy] = useState(false);
  const [crewIds, setCrewIds] = useState<string[]>([]);
  const [gps, setGps] = useState<GpsFix | null>(null);
  const [asset, setAsset] = useState<any>(null);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), crew_lead: '', work_summary: '', hazards_discussed: '', sign_ons: [{ name: '', role: '', signature_ts: null as string | null }] });

  // v160.0.11 — if we arrived via `/pre-starts/new?asset_id=<id>` (from a
  // Vehicle-QR scan), fetch the asset and pin it to the pre-start.
  useEffect(() => {
    if (!params.asset_id) return;
    let live = true;
    api.get(`/assets/${params.asset_id}`)
      .then(({ data }) => { if (live && data) setAsset(data); })
      .catch(() => { /* silent — worker may not have direct asset read */ });
    return () => { live = false; };
  }, [params.asset_id]);

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
      Alert.alert('Success', 'Pre-start saved');
      router.back();
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView testID="prestart-new" style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.heading}>New Pre-Start</Text>
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
