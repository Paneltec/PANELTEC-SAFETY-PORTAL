/**
 * New record — pre-start / hazard / incident / site diary / inspection.
 * Fields match backend/models.py (PreStartIn, HazardIn, IncidentIn,
 * SiteDiaryIn, InspectionIn). GPS is attached automatically when allowed.
 * Works offline: createItem() queues the record and it sends later.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../../src/theme/colors';
import { Screen, BackHeader, FieldLabel, Input, Hint, Panel } from '../../../src/components/ui';
import PrimaryButton from '../../../src/components/PrimaryButton';
import PhotoCapture from '../../../src/components/PhotoCapture';
import { createItem, analyzePhoto, type CaptureModuleKey } from '../../../src/services/capture';
import { getStoredUser } from '../../../src/services/auth';
import { TITLES } from './index';

import { readGps, type Gps } from '../../../src/services/geo';

const today = () => new Date().toISOString().slice(0, 10);

export default function NewCaptureScreen() {
  const router = useRouter();
  const { module, asset_id, job_id } = useLocalSearchParams<{ module: CaptureModuleKey; asset_id?: string; job_id?: string }>();
  const key = (module || 'pre-starts') as CaptureModuleKey;
  const [gps, setGps] = useState<Gps>(null);
  const [saving, setSaving] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [f, setF] = useState<Record<string, any>>({
    date: today(), crew_lead: '', work_summary: '', hazards_discussed: '', crew: '',
    title: '', description: '', location: '', severity: 'medium',
    occurred_at: new Date().toISOString().slice(0, 16), category: 'near_miss', immediate_actions: '', person_involved: '',
    raw_notes: '', template_name: '', notes: '', operator: '',
  });
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));
  const [signOns, setSignOns] = useState<{ name: string; role: string; signed: boolean }[]>([{ name: '', role: '', signed: false }]);

  useEffect(() => {
    readGps().then(setGps);
    getStoredUser().then(u => { if (u?.name) setF(p => ({ ...p, crew_lead: p.crew_lead || u.name, operator: p.operator || u.name })); });
  }, []);

  const gpsFields = gps ? { gps_latitude: gps.lat, gps_longitude: gps.lng, gps_accuracy: gps.acc } : {};

  const analyse = async (uri: string) => {
    setPhoto(uri); setAnalysing(true);
    try {
      const ai = await analyzePhoto(uri);
      setF(p => ({
        ...p,
        title: p.title || ai.summary?.slice(0, 80) || '',
        description: p.description || [ai.summary, ...(ai.identified_hazards || [])].filter(Boolean).join('\n'),
        severity: ai.severity || p.severity,
        _controls: ai.suggested_controls || [],
        _ai: ai,
      }));
    } catch { /* AI is a bonus; the form still works */ }
    setAnalysing(false);
  };

  const validate = (): string | null => {
    if (key === 'pre-starts') return f.crew_lead.trim() && f.work_summary.trim() ? null : 'Crew lead and work summary are needed.';
    if (key === 'hazards') return f.title.trim() ? null : 'Give the hazard a short title.';
    if (key === 'incidents') return f.title.trim() ? null : 'Give the incident a short title.';
    if (key === 'site-diary') return f.raw_notes.trim() ? null : 'Write a few notes first.';
    if (key === 'inspections') return f.template_name.trim() ? null : 'What was inspected?';
    return null;
  };

  const submit = async () => {
    const err = validate();
    if (err) { Alert.alert('Not quite', err); return; }
    setSaving(true);
    let body: Record<string, any>;
    if (key === 'pre-starts') {
      body = {
        workspace_id: '', date: f.date, crew_lead: f.crew_lead, work_summary: f.work_summary,
        hazards_discussed: f.hazards_discussed, notes: f.crew ? `Crew: ${f.crew}` : null,
        sign_ons: signOns.filter(x => x.name.trim()).map(x => ({ name: x.name.trim(), role: x.role.trim() || null, signature_ts: x.signed ? new Date().toISOString() : null })),
        asset_id: asset_id || null, ...gpsFields,
      };
    } else if (key === 'hazards') {
      body = { workspace_id: '', title: f.title, description: f.description, location: f.location || null, severity: f.severity, controls: f._controls || [], status: 'open', ai_analysis: f._ai || null, photo_url: f._ai?.photo_url || null, ...gpsFields };
    } else if (key === 'incidents') {
      body = { workspace_id: '', title: f.title, occurred_at: new Date(f.occurred_at).toISOString(), location: f.location || null, category: f.category, description: f.description, immediate_actions: f.immediate_actions, person_involved: f.person_involved || null, follow_up_status: 'open', ...gpsFields };
    } else if (key === 'site-diary') {
      body = { workspace_id: '', date: f.date, raw_notes: f.raw_notes };
    } else {
      body = { workspace_id: '', template_name: f.template_name, date: f.date, notes: f.notes || null, operator: f.operator || null, checklist_items: [], ...gpsFields };
    }
    if (job_id) body.job_id = job_id;
    try {
      const rec = await createItem(key, body);
      setSaving(false);
      Alert.alert(rec._offline ? 'Saved on phone' : 'Submitted ✓', rec._offline ? "No signal — it'll send when you're back online." : TITLES[key], [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      setSaving(false);
      Alert.alert("Couldn't submit", e?.response?.data?.detail || e?.message || 'Please try again.');
    }
  };

  const Sev = ({ v, label }: { v: string; label: string }) => (
    <TouchableOpacity testID={`sev-${v}`} style={[s.seg, f.severity === v && s.segOn]} onPress={() => set('severity', v)}>
      <Text style={[s.segText, f.severity === v && s.segTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
  const Cat = ({ v, label }: { v: string; label: string }) => (
    <TouchableOpacity testID={`cat-${v}`} style={[s.seg, f.category === v && s.segOn]} onPress={() => set('category', v)}>
      <Text style={[s.segText, f.category === v && s.segTextOn]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Screen testID={`capture-new-${key}`} bottomPad={40}>
      <BackHeader title={`New ${key === 'pre-starts' ? 'Pre-Start' : key === 'site-diary' ? 'Diary Entry' : key === 'hazards' ? 'Hazard' : key === 'incidents' ? 'Incident' : 'Inspection'}`} />

      {key === 'pre-starts' && (
        <>
          {asset_id ? (
            <View style={s.assetBanner}><Ionicons name="qr-code" size={18} color={Colors.white} /><Text style={s.assetText}>Vehicle / plant filled in from the QR sticker</Text></View>
          ) : (
            <TouchableOpacity testID="prestart-scan-asset" style={s.scanBanner} onPress={() => router.push('/(tabs)/scan' as never)}>
              <Ionicons name="qr-code" size={24} color={Colors.white} />
              <View style={{ flex: 1 }}>
                <Text style={s.scanTitle}>Scan Vehicle QR to auto-fill</Text>
                <Text style={s.scanSub}>Fastest way to start — point the camera at the sticker</Text>
              </View>
            </TouchableOpacity>
          )}
          <FieldLabel>DATE *</FieldLabel>
          <Input testID="ps-date" value={f.date} onChangeText={v => set('date', v)} placeholder="YYYY-MM-DD" />
          <FieldLabel>CREW LEAD *</FieldLabel>
          <Input testID="ps-crew-lead" value={f.crew_lead} onChangeText={v => set('crew_lead', v)} placeholder="Name" />
          <FieldLabel>CREW MEMBERS</FieldLabel>
          <Input testID="ps-crew" value={f.crew} onChangeText={v => set('crew', v)} placeholder="Names, separated by commas" />
          <FieldLabel>WORK SUMMARY *</FieldLabel>
          <Input testID="ps-summary" value={f.work_summary} onChangeText={v => set('work_summary', v)} placeholder="What's the crew doing today?" multiline />
          <FieldLabel>HAZARDS DISCUSSED</FieldLabel>
          <Input testID="ps-hazards" value={f.hazards_discussed} onChangeText={v => set('hazards_discussed', v)} placeholder="Toolbox talk topics" multiline />
          <Text style={s.sectionTitle}>Crew sign-ons</Text>
          {signOns.map((so, i) => (
            <View key={i} style={s.signRow}>
              <Input style={{ flex: 1, minWidth: 0 }} value={so.name} onChangeText={v => setSignOns(a => a.map((x, j) => j === i ? { ...x, name: v } : x))} placeholder="Name" />
              <Input style={{ width: 70, paddingHorizontal: 10 }} value={so.role} onChangeText={v => setSignOns(a => a.map((x, j) => j === i ? { ...x, role: v } : x))} placeholder="Role" />
              <TouchableOpacity
                testID={`ps-sign-${i}`}
                style={[s.signBtn, so.signed && s.signBtnDone]}
                onPress={() => setSignOns(a => a.map((x, j) => j === i ? { ...x, signed: !x.signed } : x))}
              >
                <Text style={[s.signBtnText, so.signed && s.signBtnTextDone]}>{so.signed ? 'Signed' : 'Sign'}</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity testID="ps-add-signon" style={s.addRow} onPress={() => setSignOns(a => [...a, { name: '', role: '', signed: false }])}>
            <Ionicons name="add-circle-outline" size={18} color={Colors.orange} />
            <Text style={s.addRowText}>Add crew member</Text>
          </TouchableOpacity>
        </>
      )}

      {key === 'hazards' && (
        <>
          <Panel style={{ marginTop: 4 }}>
            <PhotoCapture imageUri={photo} onImageCaptured={analyse} onClear={() => setPhoto(null)} loading={analysing} label="Snap the hazard — AI fills in the rest" />
          </Panel>
          <FieldLabel>WHAT IS THE HAZARD? *</FieldLabel>
          <Input testID="hz-title" value={f.title} onChangeText={v => set('title', v)} placeholder="e.g. Open trench near site office" />
          <FieldLabel>SEVERITY</FieldLabel>
          <View style={s.segRow}><Sev v="low" label="LOW" /><Sev v="medium" label="MEDIUM" /><Sev v="high" label="HIGH" /><Sev v="critical" label="CRITICAL" /></View>
          <FieldLabel>WHERE</FieldLabel>
          <Input testID="hz-location" value={f.location} onChangeText={v => set('location', v)} placeholder="Location on site" />
          <FieldLabel>DETAILS</FieldLabel>
          <Input testID="hz-desc" value={f.description} onChangeText={v => set('description', v)} placeholder="What you saw, who's at risk" multiline />
          {!!f._controls?.length && (
            <Panel style={{ marginTop: 14 }}>
              <Text style={s.panelLabel}>SUGGESTED CONTROLS</Text>
              {f._controls.map((c: string, i: number) => <Text key={i} style={s.panelItem}>• {c}</Text>)}
            </Panel>
          )}
        </>
      )}

      {key === 'incidents' && (
        <>
          <FieldLabel>WHAT HAPPENED? *</FieldLabel>
          <Input testID="inc-title" value={f.title} onChangeText={v => set('title', v)} placeholder="Short title" />
          <FieldLabel>TYPE</FieldLabel>
          <View style={s.segRow}><Cat v="near_miss" label="NEAR MISS" /><Cat v="injury" label="INJURY" /><Cat v="property_damage" label="DAMAGE" /><Cat v="environmental" label="ENVIRO" /></View>
          <FieldLabel>WHEN</FieldLabel>
          <Input testID="inc-when" value={f.occurred_at} onChangeText={v => set('occurred_at', v)} placeholder="YYYY-MM-DDTHH:MM" />
          <FieldLabel>WHERE</FieldLabel>
          <Input testID="inc-location" value={f.location} onChangeText={v => set('location', v)} placeholder="Location on site" />
          <FieldLabel>PERSON INVOLVED</FieldLabel>
          <Input testID="inc-person" value={f.person_involved} onChangeText={v => set('person_involved', v)} placeholder="Name (if any)" />
          <FieldLabel>DETAILS</FieldLabel>
          <Input testID="inc-desc" value={f.description} onChangeText={v => set('description', v)} placeholder="What happened, step by step" multiline />
          <FieldLabel>IMMEDIATE ACTIONS TAKEN</FieldLabel>
          <Input testID="inc-actions" value={f.immediate_actions} onChangeText={v => set('immediate_actions', v)} placeholder="First aid, area made safe, supervisor called…" multiline />
        </>
      )}

      {key === 'site-diary' && (
        <>
          <FieldLabel>DATE</FieldLabel>
          <Input testID="sd-date" value={f.date} onChangeText={v => set('date', v)} placeholder="YYYY-MM-DD" />
          <FieldLabel>NOTES *</FieldLabel>
          <Input testID="sd-notes" value={f.raw_notes} onChangeText={v => set('raw_notes', v)} placeholder="Weather, crew, deliveries, progress, delays… the AI tidies it into a diary entry" multiline style={{ minHeight: 160 }} />
        </>
      )}

      {key === 'inspections' && (
        <>
          <FieldLabel>WHAT WAS INSPECTED? *</FieldLabel>
          <Input testID="insp-name" value={f.template_name} onChangeText={v => set('template_name', v)} placeholder="e.g. Site walk, 8t excavator, scaffold" />
          <FieldLabel>DATE</FieldLabel>
          <Input testID="insp-date" value={f.date} onChangeText={v => set('date', v)} placeholder="YYYY-MM-DD" />
          <FieldLabel>INSPECTED BY</FieldLabel>
          <Input testID="insp-operator" value={f.operator} onChangeText={v => set('operator', v)} placeholder="Name" />
          <FieldLabel>FINDINGS / NOTES</FieldLabel>
          <Input testID="insp-notes" value={f.notes} onChangeText={v => set('notes', v)} placeholder="Anything found, anything fixed" multiline />
        </>
      )}

      <View style={{ marginTop: 22 }}>
        <PrimaryButton testID="capture-submit" title={`SUBMIT ${key === 'pre-starts' ? 'PRE-START' : key === 'site-diary' ? 'DIARY ENTRY' : key === 'hazards' ? 'HAZARD' : key === 'incidents' ? 'INCIDENT' : 'INSPECTION'}`} variant="green" onPress={submit} loading={saving} />
      </View>
      <Hint>{gps ? 'Location attached from your phone GPS.' : 'Location will be attached if the phone allows it.'} Sends when online; saved on the phone if not.</Hint>
    </Screen>
  );
}

const s = StyleSheet.create({
  scanBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.orange, borderRadius: 14, padding: 14, minHeight: 64 },
  scanTitle: { color: Colors.white, fontWeight: '800', fontSize: 15 },
  scanSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },
  assetBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.green, borderRadius: 12, padding: 12 },
  assetText: { color: Colors.white, fontWeight: '700', fontSize: 13 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.onScreen, marginTop: 20, marginBottom: 8 },
  signRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 },
  signBtn: { backgroundColor: Colors.green, borderRadius: 10, paddingHorizontal: 12, minHeight: 48, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
  signBtnDone: { backgroundColor: Colors.greenSoft, borderWidth: 1, borderColor: Colors.green },
  signBtnText: { color: Colors.onGreen, fontSize: 13, fontWeight: '800' },
  signBtnTextDone: { color: Colors.green },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  addRowText: { color: Colors.orange, fontWeight: '700', fontSize: 13 },
  segRow: { flexDirection: 'row', gap: 6 },
  seg: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  segOn: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  segText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, color: Colors.onCardMuted },
  segTextOn: { color: Colors.white },
  panelLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: Colors.onCardSubtle, marginBottom: 6 },
  panelItem: { fontSize: 13, color: Colors.onCard, lineHeight: 19 },
});
