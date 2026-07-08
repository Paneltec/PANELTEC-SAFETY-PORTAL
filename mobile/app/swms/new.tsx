import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../../src/lib/api';
import { getUser } from '../../src/lib/auth';
import PrimaryButton from '../../src/components/PrimaryButton';
import GhostButton from '../../src/components/GhostButton';
import { Colors } from '../../src/lib/colors';

export default function SwmsNewScreen() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', job_description: '', location: '', tasks: [] as any[], hazards: [] as any[], controls: [] as any[], ppe: [] as string[] });

  const generate = async () => {
    if (!form.job_description.trim()) { Alert.alert('Error', 'Add a job description first'); return; }
    setBusy(true);
    try {
      const { data } = await api.post('/ai/swms-draft', { job_description: form.job_description, location: form.location || undefined });
      setForm(f => ({ ...f, tasks: data.tasks || [], hazards: data.hazards || [], controls: data.controls || [], ppe: data.ppe || [], title: f.title || data.tasks?.[0]?.description?.slice(0, 60) || 'New SWMS' }));
      setStep(2);
      Alert.alert('Success', 'Draft generated — edit and submit.');
    } catch (e: any) {
      Alert.alert('AI fallback', apiError(e) + '. Fill in manually.');
      setStep(2);
    } finally { setBusy(false); }
  };

  const save = async (status: string) => {
    if (!form.title) { Alert.alert('Error', 'Title is required'); return; }
    setBusy(true);
    try {
      const user = await getUser();
      await api.post('/swms', { ...form, workspace_id: user?.workspace_ids?.[0], status });
      Alert.alert('Success', status === 'submitted' ? 'Submitted for review' : 'Saved as draft');
      router.back();
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView testID="swms-new" style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.heading}>Create SWMS</Text>
        <Text style={s.sub}>{step === 1 ? 'Step 1 — describe the job.' : 'Step 2 — review and edit.'}</Text>

        {step === 1 ? (
          <View style={s.card}>
            <Text style={s.label}>Title</Text>
            <TextInput testID="swms-title" style={s.input} value={form.title} onChangeText={v => setForm({...form, title: v})} placeholder="e.g. Install steel handrail" placeholderTextColor={Colors.textTertiary} />
            <Text style={s.label}>Location (optional)</Text>
            <TextInput testID="swms-location" style={s.input} value={form.location} onChangeText={v => setForm({...form, location: v})} placeholder="e.g. Sydney Metro bridge deck" placeholderTextColor={Colors.textTertiary} />
            <Text style={s.label}>Job description *</Text>
            <TextInput testID="swms-job-description" style={[s.input, { minHeight: 100, textAlignVertical: 'top' }]} value={form.job_description} onChangeText={v => setForm({...form, job_description: v})} placeholder="2-4 sentences. Mention plant, height, duration, crew size." placeholderTextColor={Colors.textTertiary} multiline />
            <View style={s.btnRow}>
              <GhostButton testID="swms-skip-ai" onPress={() => setStep(2)}>Skip AI</GhostButton>
              <PrimaryButton testID="swms-generate-ai" onPress={generate} busy={busy} color={Colors.violet}>Generate with AI</PrimaryButton>
            </View>
          </View>
        ) : (
          <View>
            <View style={s.card}>
              <Text style={s.label}>Title *</Text>
              <TextInput testID="swms-step2-title" style={s.input} value={form.title} onChangeText={v => setForm({...form, title: v})} placeholderTextColor={Colors.textTertiary} />
              <Text style={s.label}>Tasks ({form.tasks.length})</Text>
              {form.tasks.map((t: any, i: number) => (
                <View key={i} style={s.row}><Text style={s.rowText}>{t.step}. {t.description}</Text></View>
              ))}
              <Text style={s.label}>Hazards ({form.hazards.length})</Text>
              {form.hazards.map((h: any, i: number) => (
                <View key={i} style={s.row}><Text style={s.rowText}>{h.label} ({h.risk})</Text></View>
              ))}
              <Text style={s.label}>Controls ({form.controls.length})</Text>
              {form.controls.map((c: any, i: number) => (
                <View key={i} style={s.row}><Text style={s.rowText}>{c.label} — {c.method}</Text></View>
              ))}
              <Text style={s.label}>PPE ({form.ppe.length})</Text>
              {form.ppe.map((p: string, i: number) => (
                <View key={i} style={s.row}><Text style={s.rowText}>{p}</Text></View>
              ))}
            </View>
            <View style={s.btnRow}>
              <GhostButton testID="swms-back" onPress={() => setStep(1)}>Back</GhostButton>
              <GhostButton testID="swms-save-draft" onPress={() => save('draft')}>Save draft</GhostButton>
              <PrimaryButton testID="swms-submit" onPress={() => save('submitted')} busy={busy}>Submit</PrimaryButton>
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  heading: { fontSize: 22, fontWeight: '700', color: Colors.ink },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2, marginBottom: 16 },
  card: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '500', color: Colors.textSecondary, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: Colors.text },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  row: { backgroundColor: Colors.bg, borderRadius: 8, padding: 10, marginBottom: 4 },
  rowText: { fontSize: 13, color: Colors.text },
});
