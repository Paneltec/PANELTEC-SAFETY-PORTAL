/**
 * New Pre-Start — mockup #4 alignment.
 * v58.13.132f — Tri-state toggles (green tick / red cross / grey N/A)
 * taking full third of card width, progress bar top, navy header.
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

type CheckItem = { label: string; response: 'pass' | 'fail' | 'na' };

const DEFAULT_CHECKS: CheckItem[] = [
  { label: 'Site briefing / toolbox talk held', response: 'pass' },
  { label: 'SWMS reviewed and signed', response: 'pass' },
  { label: 'PPE available and worn', response: 'pass' },
  { label: 'Work area inspected', response: 'pass' },
  { label: 'Plant / equipment pre-start done', response: 'pass' },
  { label: 'Exclusion zones in place', response: 'pass' },
  { label: 'Emergency plan discussed', response: 'pass' },
  { label: 'Weather conditions safe', response: 'pass' },
];

export default function NewPreStart() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState(today);
  const [crewLead, setCrewLead] = useState('');
  const [workSummary, setWorkSummary] = useState('');
  const [hazardsDiscussed, setHazardsDiscussed] = useState('');
  const [notes, setNotes] = useState('');
  const [checks, setChecks] = useState<CheckItem[]>(DEFAULT_CHECKS.map(c => ({ ...c })));
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('paneltec_user');
        if (raw) { const u = JSON.parse(raw); setCrewLead(u.name || ''); }
      } catch { /* ok */ }
    })();
  }, []);

  const setResponse = (idx: number, resp: 'pass' | 'fail' | 'na') => {
    setChecks((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], response: resp };
      return next;
    });
  };

  // Progress
  const completed = checks.filter(c => c.response !== 'na').length;
  const progress = completed / checks.length;

  const handleSubmit = useCallback(async (asDraft: boolean) => {
    if (!asDraft && (!crewLead.trim() || !workSummary.trim())) {
      Alert.alert('Required', 'Crew lead and work summary are required');
      return;
    }
    setSubmitting(true);
    try {
      const userRaw = await AsyncStorage.getItem('paneltec_user');
      const user = userRaw ? JSON.parse(userRaw) : {};
      await createItem('pre-starts', {
        workspace_id: user.active_company_id || '',
        date, crew_lead: crewLead.trim() || 'Unknown',
        work_summary: workSummary.trim() || 'N/A',
        hazards_discussed: hazardsDiscussed.trim(),
        notes: notes.trim() || null,
        linked_swms_ids: [], linked_permits: [],
        sign_ons: checks.map(c => ({ check: c.label, result: c.response })),
        crew_worker_ids: [],
        status: asDraft ? 'draft' : 'submitted',
      });
      qc.invalidateQueries({ queryKey: ['capture', 'pre-starts'] });
      Alert.alert(asDraft ? 'Draft saved' : 'Pre-Start submitted', '', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.detail || 'Failed to save');
    }
    setSubmitting(false);
  }, [date, crewLead, workSummary, hazardsDiscussed, notes, checks, qc, router]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View testID="new-prestart-screen" style={[s.container, { paddingTop: insets.top }]}>
        {/* Navy header */}
        <View style={s.header}>
          <TouchableOpacity testID="new-prestart-back" onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={22} color={Colors.white} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>New Pre-Start</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Progress bar */}
        <View style={s.progressBar}>
          <View style={[s.progressFill, { width: `${progress * 100}%` }]} />
        </View>

        <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
          {/* Date + Crew Lead */}
          <View style={s.rowFields}>
            <View style={[s.fieldCard, { flex: 1 }]}>
              <Text style={s.fieldLabel}>Date</Text>
              <TextInput testID="prestart-date-input" style={s.input} value={date}
                onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.placeholder} />
            </View>
            <View style={[s.fieldCard, { flex: 1 }]}>
              <Text style={s.fieldLabel}>Crew Lead *</Text>
              <TextInput testID="prestart-crew-input" style={s.input} value={crewLead}
                onChangeText={setCrewLead} placeholder="Name" placeholderTextColor={Colors.placeholder} />
            </View>
          </View>

          <View style={s.fieldCard}>
            <Text style={s.fieldLabel}>Work Summary *</Text>
            <TextInput testID="prestart-work-input" style={[s.input, s.inputMulti]} value={workSummary}
              onChangeText={setWorkSummary} placeholder="Today's planned activities"
              multiline numberOfLines={3} placeholderTextColor={Colors.placeholder} />
          </View>

          {/* ── Checklist with tri-state toggles (mockup #4) ── */}
          <Text style={s.sectionLabel}>PRE-START CHECKS</Text>
          {checks.map((check, idx) => (
            <View key={idx} testID={`prestart-check-${idx}`} style={s.checkCard}>
              <Text style={s.checkLabel}>{check.label}</Text>
              <View style={s.triState}>
                <TouchableOpacity
                  testID={`check-pass-${idx}`}
                  style={[s.triBtn, check.response === 'pass' && s.triBtnPass]}
                  onPress={() => setResponse(idx, 'pass')}
                >
                  <Ionicons name="checkmark" size={18} color={check.response === 'pass' ? Colors.white : '#10B981'} />
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`check-fail-${idx}`}
                  style={[s.triBtn, check.response === 'fail' && s.triBtnFail]}
                  onPress={() => setResponse(idx, 'fail')}
                >
                  <Ionicons name="close" size={18} color={check.response === 'fail' ? Colors.white : '#EF4444'} />
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`check-na-${idx}`}
                  style={[s.triBtn, check.response === 'na' && s.triBtnNa]}
                  onPress={() => setResponse(idx, 'na')}
                >
                  <Text style={[s.naText, check.response === 'na' && { color: Colors.white }]}>N/A</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          <View style={s.fieldCard}>
            <Text style={s.fieldLabel}>Hazards Discussed</Text>
            <TextInput testID="prestart-hazards-input" style={[s.input, s.inputMulti]} value={hazardsDiscussed}
              onChangeText={setHazardsDiscussed} placeholder="List hazards discussed"
              multiline numberOfLines={3} placeholderTextColor={Colors.placeholder} />
          </View>

          <View style={s.fieldCard}>
            <Text style={s.fieldLabel}>Notes</Text>
            <TextInput style={[s.input, s.inputMulti]} value={notes}
              onChangeText={setNotes} placeholder="Additional notes..."
              multiline numberOfLines={2} placeholderTextColor={Colors.placeholder} />
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>

        <View style={s.footer}>
          <TouchableOpacity testID="prestart-save-draft" style={s.draftBtn}
            onPress={() => handleSubmit(true)} disabled={submitting}>
            <Text style={s.draftText}>Save Draft</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="prestart-submit-btn" style={[s.submitBtn, submitting && s.disabled]}
            onPress={() => handleSubmit(false)} disabled={submitting}>
            {submitting ? <ActivityIndicator color={Colors.white} /> :
              <Text style={s.submitText}>Submit Pre-Start</Text>}
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
  progressBar: { height: 4, backgroundColor: Colors.border },
  progressFill: { height: 4, backgroundColor: Colors.orange, borderRadius: 2 },
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
  // ── Tri-state toggle (mockup #4) ──
  checkCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14,
    marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  checkLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.ink, paddingRight: 8 },
  triState: { flexDirection: 'row', gap: 4 },
  triBtn: {
    width: 40, height: 40, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.border,
    backgroundColor: Colors.surface,
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
    borderRadius: 14, backgroundColor: Colors.orange,
  },
  disabled: { opacity: 0.5 },
  submitText: { fontSize: 15, fontWeight: '700', color: Colors.white },
});
