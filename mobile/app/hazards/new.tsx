import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import api, { apiError } from '../../src/lib/api';
import { getUser } from '../../src/lib/auth';
import PrimaryButton from '../../src/components/PrimaryButton';
import { Colors } from '../../src/lib/colors';

export default function HazardNewScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', location: '', severity: 'medium', controls: [] as string[], status: 'open' });

  const save = async () => {
    if (!form.title) { Alert.alert('Error', 'Title required'); return; }
    setBusy(true);
    try {
      const user = await getUser();
      await api.post('/hazards', { ...form, workspace_id: user?.workspace_ids?.[0], controls: form.controls.filter(Boolean) });
      Alert.alert('Success', 'Hazard reported');
      router.back();
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView testID="hazard-new" style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.heading}>Report a Hazard</Text>
        <View style={s.card}>
          <Text style={s.label}>Title *</Text>
          <TextInput testID="hazard-title" style={s.input} value={form.title} onChangeText={v => setForm({...form, title: v})} placeholder="Hazard title" placeholderTextColor={Colors.textTertiary} />
          <Text style={s.label}>Description</Text>
          <TextInput testID="hazard-description" style={[s.input, { minHeight: 70, textAlignVertical: 'top' }]} value={form.description} onChangeText={v => setForm({...form, description: v})} placeholder="Describe the hazard" placeholderTextColor={Colors.textTertiary} multiline />
          <Text style={s.label}>Location</Text>
          <TextInput testID="hazard-location" style={s.input} value={form.location} onChangeText={v => setForm({...form, location: v})} placeholder="Where?" placeholderTextColor={Colors.textTertiary} />
          <Text style={s.label}>Severity</Text>
          <View style={s.severityRow}>
            {['low', 'medium', 'high', 'critical'].map(sev => (
              <TouchableOpacity key={sev} testID={`hazard-severity-${sev}`} style={[s.sevBtn, form.severity === sev && s.sevBtnActive]} onPress={() => setForm({...form, severity: sev})}>
                <Text style={[s.sevText, form.severity === sev && s.sevTextActive]}>{sev}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={s.btnRow}>
          <PrimaryButton testID="hazard-submit" onPress={save} busy={busy}>Save hazard</PrimaryButton>
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
  severityRow: { flexDirection: 'row', gap: 6 },
  sevBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white },
  sevBtnActive: { borderColor: Colors.blue, backgroundColor: Colors.blueSoft },
  sevText: { fontSize: 13, color: Colors.textSecondary, textTransform: 'capitalize' },
  sevTextActive: { color: Colors.blue, fontWeight: '600' },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
});
