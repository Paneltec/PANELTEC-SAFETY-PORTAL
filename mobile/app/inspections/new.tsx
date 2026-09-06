/**
 * New Inspection — mockup alignment with tri-state toggles.
 * v58.13.132f — Same toggle style as Pre-Start (mockup #4),
 * navy header, white cards with shadow, progress bar.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Colors } from '../../src/theme/colors';
import { createItem } from '../../src/services/capture';
import AsyncStorage from '@react-native-async-storage/async-storage';

type CheckItem = { label: string; response: 'pass' | 'fail' | 'na'; notes: string };

const DEFAULT_CHECKLIST: CheckItem[] = [
  { label: 'PPE worn correctly', response: 'pass', notes: '' },
  { label: 'Housekeeping standards', response: 'pass', notes: '' },
  { label: 'Barricades / exclusion zones', response: 'pass', notes: '' },
  { label: 'Emergency exits clear', response: 'pass', notes: '' },
  { label: 'First aid kit stocked', response: 'pass', notes: '' },
  { label: 'Fire extinguishers accessible', response: 'pass', notes: '' },
  { label: 'Electrical leads / tools tagged', response: 'pass', notes: '' },
  { label: 'Scaffolding inspected', response: 'pass', notes: '' },
];

export default function NewInspection() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const [templateName, setTemplateName] = useState('Daily Site Inspection');
  const [date, setDate] = useState(today);
  const [operator, setOperator] = useState('');
  const [notes, setNotes] = useState('');
  const [checklist, setChecklist] = useState<CheckItem[]>(DEFAULT_CHECKLIST.map(c => ({ ...c })));
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('paneltec_user');
        if (raw) { const u = JSON.parse(raw); setOperator(u.name || ''); }
      } catch { /* ok */ }
    })();
  }, []);

  const setResponse = (idx: number, resp: 'pass' | 'fail' | 'na') => {
    setChecklist((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], response: resp };
      return next;
    });
  };

  const passCount = checklist.filter(c => c.response === 'pass').length;
  const failCount = checklist.filter(c => c.response === 'fail').length;

  const handleSubmit = useCallback(async (asDraft: boolean) => {
    if (!asDraft && !templateName.trim()) {
      Alert.alert('Required', 'Template name is required');
      return;
    }
    setSubmitting(true);
    try {
      const userRaw = await AsyncStorage.getItem('paneltec_user');
      const user = userRaw ? JSON.parse(userRaw) : {};
      await createItem('inspections', {
        workspace_id: user.active_company_id || '',
        template_name: templateName.trim(), date,
        checklist_items: checklist.map(c => ({ label: c.label, response: c.response, notes: c.notes || null, photo_url: null })),
        corrective_actions: [], notes: notes.trim() || null,
        operator: operator.trim() || null,
        status: asDraft ? 'draft' : 'submitted',
      });
      qc.invalidateQueries({ queryKey: ['capture', 'inspections'] });
      Alert.alert(asDraft ? 'Draft saved' : 'Inspection submitted', '', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.detail || 'Failed to save');
    }
    setSubmitting(false);
  }, [templateName, date, operator, notes, checklist, qc, router]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View testID="new-inspection-screen" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity testID="new-inspection-back" onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={22} color={Colors.white} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>New Inspection</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Score bar */}
        <View style={s.scoreBar}>
          <View style={s.scoreChip}>
            <Ionicons name="checkmark-circle" size={14} color="#10B981" />
            <Text style={s.scorePassText}>{passCount} pass</Text>
          </View>
          {failCount > 0 && (
            <View style={s.scoreChip}>
              <Ionicons name="close-circle" size={14} color="#EF4444" />
              <Text style={s.scoreFailText}>{failCount} fail</Text>
            </View>
          )}
        </View>

        <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
          <View style={s.rowFields}>
            <View style={[s.fieldCard, { flex: 1 }]}>
              <Text style={s.fieldLabel}>Template</Text>
              <TextInput testID="inspection-template-input" style={s.input} value={templateName}
                onChangeText={setTemplateName} placeholder="Type" placeholderTextColor={Colors.placeholder} />
            </View>
            <View style={[s.fieldCard, { flex: 1 }]}>
              <Text style={s.fieldLabel}>Date</Text>
              <TextInput style={s.input} value={date} onChangeText={setDate}
                placeholder="YYYY-MM-DD" placeholderTextColor={Colors.placeholder} />
            </View>
          </View>

          <View style={s.fieldCard}>
            <Text style={s.fieldLabel}>Inspector</Text>
            <TextInput style={s.input} value={operator} onChangeText={setOperator}
              placeholder="Name" placeholderTextColor={Colors.placeholder} />
          </View>

          <Text style={s.sectionLabel}>CHECKLIST</Text>
          {checklist.map((item, idx) => (
            <View key={idx} testID={`checklist-item-${idx}`} style={s.checkCard}>
              <Text style={s.checkLabel}>{item.label}</Text>
              <View style={s.triState}>
                <TouchableOpacity
                  testID={`insp-pass-${idx}`}
                  style={[s.triBtn, item.response === 'pass' && s.triBtnPass]}
                  onPress={() => setResponse(idx, 'pass')}
                >
                  <Ionicons name="checkmark" size={18} color={item.response === 'pass' ? Colors.white : '#10B981'} />
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`insp-fail-${idx}`}
                  style={[s.triBtn, item.response === 'fail' && s.triBtnFail]}
                  onPress={() => setResponse(idx, 'fail')}
                >
                  <Ionicons name="close" size={18} color={item.response === 'fail' ? Colors.white : '#EF4444'} />
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`insp-na-${idx}`}
                  style={[s.triBtn, item.response === 'na' && s.triBtnNa]}
                  onPress={() => setResponse(idx, 'na')}
                >
                  <Text style={[s.naText, item.response === 'na' && { color: Colors.white }]}>N/A</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          <View style={s.fieldCard}>
            <Text style={s.fieldLabel}>Notes</Text>
            <TextInput style={[s.input, s.inputMulti]} value={notes}
              onChangeText={setNotes} placeholder="Additional observations..."
              multiline numberOfLines={3} placeholderTextColor={Colors.placeholder} />
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>

        <View style={s.footer}>
          <TouchableOpacity testID="inspection-save-draft" style={s.draftBtn}
            onPress={() => handleSubmit(true)} disabled={submitting}>
            <Text style={s.draftText}>Save Draft</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="inspection-submit-btn" style={[s.submitBtn, submitting && s.disabled]}
            onPress={() => handleSubmit(false)} disabled={submitting}>
            {submitting ? <ActivityIndicator color={Colors.white} /> :
              <Text style={s.submitText}>Submit Inspection</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: Colors.navy,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.white },
  scoreBar: {
    flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  scoreChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  scorePassText: { fontSize: 13, fontWeight: '700', color: '#10B981' },
  scoreFailText: { fontSize: 13, fontWeight: '700', color: '#EF4444' },
  form: { padding: 16, paddingBottom: 120 },
  sectionLabel: {
    fontSize: 11, fontWeight: '800', color: Colors.textTertiary,
    letterSpacing: 1.2, marginBottom: 10, marginTop: 20,
  },
  rowFields: { flexDirection: 'row', gap: 12 },
  fieldCard: {
    backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 0.5, marginBottom: 8 },
  input: {
    backgroundColor: Colors.bg, borderRadius: 12, borderWidth: 1,
    borderColor: Colors.border, padding: 14, fontSize: 15, color: Colors.ink,
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  checkCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  checkLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.ink, paddingRight: 8 },
  triState: { flexDirection: 'row', gap: 4 },
  triBtn: {
    width: 40, height: 40, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.border, backgroundColor: Colors.surface,
  },
  triBtnPass: { backgroundColor: '#10B981', borderColor: '#10B981' },
  triBtnFail: { backgroundColor: '#EF4444', borderColor: '#EF4444' },
  triBtnNa: { backgroundColor: '#94A3B8', borderColor: '#94A3B8' },
  naText: { fontSize: 11, fontWeight: '800', color: '#94A3B8' },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 12, padding: 16, paddingBottom: 32,
    backgroundColor: Colors.surface,
    borderTopWidth: 1, borderTopColor: Colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08, shadowRadius: 8, elevation: 8,
  },
  draftBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 16,
    borderRadius: 14, borderWidth: 2, borderColor: Colors.border,
  },
  draftText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  submitBtn: {
    flex: 2, alignItems: 'center', paddingVertical: 16,
    borderRadius: 14, backgroundColor: '#7C3AED',
  },
  disabled: { opacity: 0.5 },
  submitText: { fontSize: 15, fontWeight: '700', color: Colors.white },
});
