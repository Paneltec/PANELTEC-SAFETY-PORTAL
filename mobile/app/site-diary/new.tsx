import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import api, { apiError } from '../../src/lib/api';
import { getUser } from '../../src/lib/auth';
import PrimaryButton from '../../src/components/PrimaryButton';
import { Colors } from '../../src/lib/colors';

export default function SiteDiaryNewScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), raw_notes: '' });
  const [structured, setStructured] = useState<any>(null);

  const structure = async () => {
    if (!form.raw_notes.trim()) { Alert.alert('Error', 'Add some notes first'); return; }
    setAiBusy(true);
    try {
      const { data } = await api.post('/ai/diary-structure', { raw_notes: form.raw_notes });
      setStructured(data);
      Alert.alert('Success', 'Diary structured by AI');
    } catch (e: any) { Alert.alert('AI failed', apiError(e)); }
    finally { setAiBusy(false); }
  };

  const save = async () => {
    if (!form.raw_notes) { Alert.alert('Error', 'Notes required'); return; }
    setBusy(true);
    try {
      const user = await getUser();
      await api.post('/site-diary', { workspace_id: user?.workspace_ids?.[0], date: form.date, raw_notes: form.raw_notes, structured_log: structured });
      Alert.alert('Success', 'Diary entry saved');
      router.back();
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView testID="diary-new" style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.heading}>New Diary Entry</Text>
        <View style={s.card}>
          <Text style={s.label}>Date *</Text>
          <TextInput testID="diary-date" style={s.input} value={form.date} onChangeText={v => setForm({...form, date: v})} placeholderTextColor={Colors.textTertiary} />
          <Text style={s.label}>Raw notes *</Text>
          <TextInput testID="diary-raw" style={[s.input, { minHeight: 160, textAlignVertical: 'top' }]} value={form.raw_notes} onChangeText={v => setForm({...form, raw_notes: v})} placeholder="Free-form notes — AI will structure them." placeholderTextColor={Colors.textTertiary} multiline />
          <View style={{ marginTop: 12 }}>
            <PrimaryButton testID="diary-structure-ai" onPress={structure} busy={aiBusy} color={Colors.violet}>Structure with AI</PrimaryButton>
          </View>
        </View>

        {structured && (
          <View testID="diary-structured" style={s.structuredCard}>
            <Text style={s.structuredTitle}>AI STRUCTURED LOG</Text>
            {[['Activities', structured.activities], ['Delays', structured.delays], ['Deliveries', structured.deliveries], ['Visitors', structured.visitors], ['Safety', structured.safety_observations]].map(([k, v]) => (
              <View key={k as string} style={{ marginBottom: 8 }}>
                <Text style={s.structuredLabel}>{k as string}</Text>
                {Array.isArray(v) && v.length > 0 ? v.map((x: string, i: number) => <Text key={i} style={s.structuredItem}>· {x}</Text>) : <Text style={s.empty}>none</Text>}
              </View>
            ))}
            <Text style={s.structuredLabel}>Weather</Text>
            <Text style={s.structuredItem}>{structured.weather || '—'}</Text>
          </View>
        )}

        <View style={s.btnRow}>
          <PrimaryButton testID="diary-submit" onPress={save} busy={busy}>Save diary entry</PrimaryButton>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg }, content: { padding: 16, paddingBottom: 40 },
  heading: { fontSize: 22, fontWeight: '700', color: Colors.ink, marginBottom: 16 },
  card: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '500', color: '#334155', marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: Colors.text },
  structuredCard: { backgroundColor: '#F5F3FF', borderWidth: 1, borderColor: '#DDD6FE', borderRadius: 16, padding: 16, marginBottom: 12 },
  structuredTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.violet, marginBottom: 8 },
  structuredLabel: { fontSize: 10, fontWeight: '700', color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  structuredItem: { fontSize: 13, color: Colors.text, marginTop: 2 },
  empty: { fontSize: 12, color: Colors.textTertiary, fontStyle: 'italic' },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
});
