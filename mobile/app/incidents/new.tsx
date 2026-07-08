import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import api, { apiError } from '../../src/lib/api';
import { getUser } from '../../src/lib/auth';
import PrimaryButton from '../../src/components/PrimaryButton';
import WorkerPicker from '../../src/components/WorkerPicker';
import GpsLocationChip, { GpsFix } from '../../src/components/GpsLocationChip';
import { Colors } from '../../src/lib/colors';

const CATS = [['near_miss', 'Near miss'], ['first_aid', 'First aid'], ['medical', 'Medical'], ['ltc', 'Lost-time'], ['env', 'Environmental'], ['property', 'Property']];

export default function IncidentNewScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [personInvolved, setPersonInvolved] = useState<string | null>(null);
  const [gps, setGps] = useState<GpsFix | null>(null);
  const [form, setForm] = useState({ title: '', occurred_at: new Date().toISOString().slice(0, 16), location: '', category: 'near_miss', description: '', immediate_actions: '', follow_up_status: 'open' });

  const save = async () => {
    if (!form.title || !form.description) { Alert.alert('Error', 'Title and description required'); return; }
    if (!personInvolved) { Alert.alert('Error', 'Person involved is required'); return; }
    setBusy(true);
    try {
      const user = await getUser();
      await api.post('/incidents', {
        ...form,
        workspace_id: user?.workspace_ids?.[0],
        occurred_at: new Date(form.occurred_at).toISOString(),
        follow_up_actions: [],
        person_involved: personInvolved,
        gps_latitude: gps?.latitude,
        gps_longitude: gps?.longitude,
        gps_accuracy: gps?.accuracy,
        gps_street: gps?.street,
        gps_suburb: gps?.suburb,
      });
      Alert.alert('Success', 'Incident logged');
      router.back();
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView testID="incident-new" style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.heading}>Log Incident</Text>
        <View style={s.card}>
          <Text style={s.label}>Title *</Text>
          <TextInput testID="inc-title" style={s.input} value={form.title} onChangeText={v => setForm({...form, title: v})} placeholder="What happened?" placeholderTextColor={Colors.placeholder} />
          <Text style={s.label}>Category</Text>
          <View style={s.catRow}>
            {CATS.map(([k, l]) => (
              <TouchableOpacity key={k} testID={`inc-cat-${k}`} style={[s.catBtn, form.category === k && s.catBtnActive]} onPress={() => setForm({...form, category: k})}>
                <Text style={[s.catText, form.category === k && s.catTextActive]}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.label}>Location</Text>
          <TextInput testID="inc-location" style={s.input} value={form.location} onChangeText={v => setForm({...form, location: v})} placeholderTextColor={Colors.placeholder} />
          <GpsLocationChip
            value={gps}
            onChange={(fix) => {
              setGps(fix);
              if (fix?.formatted && !form.location) setForm(f => ({ ...f, location: fix.formatted! }));
            }}
          />
          <WorkerPicker
            label="Person involved"
            required
            value={personInvolved}
            onChange={(id) => setPersonInvolved(id)}
            testID="inc-person-involved"
          />
          <Text style={s.label}>Description *</Text>
          <TextInput testID="inc-description" style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]} value={form.description} onChangeText={v => setForm({...form, description: v})} multiline placeholderTextColor={Colors.placeholder} />
          <Text style={s.label}>Immediate actions taken</Text>
          <TextInput testID="inc-immediate" style={[s.input, { minHeight: 50, textAlignVertical: 'top' }]} value={form.immediate_actions} onChangeText={v => setForm({...form, immediate_actions: v})} multiline placeholderTextColor={Colors.placeholder} />
        </View>
        <View style={s.btnRow}>
          <PrimaryButton testID="inc-submit" onPress={save} busy={busy}>Save incident</PrimaryButton>
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
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  catBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white },
  catBtnActive: { borderColor: Colors.blue, backgroundColor: Colors.blueSoft },
  catText: { fontSize: 12, color: Colors.textSecondary },
  catTextActive: { color: Colors.orangeLight, fontWeight: '600' },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
});
