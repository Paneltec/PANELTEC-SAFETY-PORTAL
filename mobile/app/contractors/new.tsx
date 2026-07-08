import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import api, { apiError } from '../../src/lib/api';
import PrimaryButton from '../../src/components/PrimaryButton';
import GhostButton from '../../src/components/GhostButton';
import { Colors } from '../../src/lib/colors';

const STATUS_OPTIONS = ['active', 'inactive', 'suspended'];

export default function ContractorNewScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: '', abn: '', contact_name: '', contact_email: '', contact_phone: '', trade: '', status: 'active',
  });

  const save = async () => {
    if (!form.name) { Alert.alert('Error', 'Company name required'); return; }
    setBusy(true);
    try {
      const { data } = await api.post('/contractors', form);
      Alert.alert('Success', 'Contractor added');
      router.replace(`/contractors/${data.id}`);
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView testID="contractor-new" style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.heading}>Add Contractor</Text>

        <View style={s.card}>
          <Text style={s.label}>Company name *</Text>
          <TextInput testID="c-name" style={s.input} value={form.name} onChangeText={v => setForm({ ...form, name: v })} placeholder="Acme Civil Pty Ltd" placeholderTextColor={Colors.textTertiary} />

          <View style={s.row}>
            <View style={s.half}>
              <Text style={s.label}>ABN</Text>
              <TextInput testID="c-abn" style={s.input} value={form.abn} onChangeText={v => setForm({ ...form, abn: v })} placeholder="12 345 678 901" placeholderTextColor={Colors.textTertiary} keyboardType="numeric" />
            </View>
            <View style={s.half}>
              <Text style={s.label}>Trade</Text>
              <TextInput testID="c-trade" style={s.input} value={form.trade} onChangeText={v => setForm({ ...form, trade: v })} placeholder="Civil works" placeholderTextColor={Colors.textTertiary} />
            </View>
          </View>

          <Text style={s.label}>Contact name</Text>
          <TextInput style={s.input} value={form.contact_name} onChangeText={v => setForm({ ...form, contact_name: v })} placeholder="John Smith" placeholderTextColor={Colors.textTertiary} />

          <Text style={s.label}>Contact email</Text>
          <TextInput testID="c-email" style={s.input} value={form.contact_email} onChangeText={v => setForm({ ...form, contact_email: v })} placeholder="john@acme.com" placeholderTextColor={Colors.textTertiary} keyboardType="email-address" autoCapitalize="none" />

          <Text style={s.label}>Contact phone</Text>
          <TextInput style={s.input} value={form.contact_phone} onChangeText={v => setForm({ ...form, contact_phone: v })} placeholder="0412 345 678" placeholderTextColor={Colors.textTertiary} keyboardType="phone-pad" />

          <Text style={s.label}>Status</Text>
          <View style={s.statusRow}>
            {STATUS_OPTIONS.map(st => (
              <TouchableOpacity key={st} style={[s.statusBtn, form.status === st && s.statusBtnActive]} onPress={() => setForm({ ...form, status: st })}>
                <Text style={[s.statusText, form.status === st && s.statusTextActive]}>{st}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={s.btnRow}>
          <GhostButton onPress={() => router.back()}>Cancel</GhostButton>
          <PrimaryButton testID="c-submit" onPress={save} busy={busy}>Save contractor</PrimaryButton>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  heading: { fontSize: 22, fontWeight: '700', color: Colors.ink, marginBottom: 16 },
  card: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '500', color: Colors.textSecondary, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: Colors.text },
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  statusRow: { flexDirection: 'row', gap: 8 },
  statusBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white },
  statusBtnActive: { borderColor: Colors.blue, backgroundColor: Colors.blueSoft },
  statusText: { fontSize: 13, color: Colors.textSecondary, textTransform: 'capitalize' },
  statusTextActive: { color: Colors.orangeLight, fontWeight: '600' },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
});
