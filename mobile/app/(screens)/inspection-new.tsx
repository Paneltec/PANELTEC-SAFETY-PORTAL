/**
 * Phase 4 — Inspection form.
 * Pick template → walk through checklist items → corrective actions → submit.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Modal, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { civilGet, civilPost, getDefaultWorkspaceId } from '../../src/services/civilApi';

const BLUE = '#2C6BFF';
const GREEN = '#10B981';
const RED = '#EF4444';
const AMBER = '#F59E0B';
const BG = '#F8FAFC';
const INK = '#0F172A';
const MUTED = '#64748B';

// Seeded templates from the backend (will be fetched if available)
const DEFAULT_TEMPLATES = [
  { id: 'general-site', name: 'General Site Inspection', items: [
    'Site access and egress clear', 'First aid kit accessible and stocked',
    'Fire extinguishers in place and tagged', 'Housekeeping acceptable',
    'PPE being worn correctly', 'Exclusion zones established',
    'Plant and equipment pre-started', 'SDS available for chemicals on site',
  ]},
  { id: 'scaffold', name: 'Scaffold Inspection', items: [
    'Base plates and sole boards in place', 'Standards plumb and level',
    'Bracing complete', 'Guardrails installed', 'Toe boards fitted',
    'Access ladders secured', 'Scaffold tag displayed and current',
    'Ties to structure at required intervals',
  ]},
  { id: 'excavation', name: 'Excavation Inspection', items: [
    'Excavation edges barricaded', 'Batter/benching angle safe',
    'Shoring or trench cage in place', 'Underground services located and marked',
    'Soil conditions assessed', 'Adequate access/egress from excavation',
    'Spoil stored minimum 1m from edge', 'Dewatering in place if needed',
  ]},
];

interface ChecklistItem {
  label: string;
  result: 'pass' | 'fail' | 'na' | null;
  notes: string;
}

export default function InspectionNewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);
  const [selectedTemplate, setSelectedTemplate] = useState<typeof DEFAULT_TEMPLATES[0] | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [correctiveActions, setCorrectiveActions] = useState<string[]>(['']);
  const [saving, setSaving] = useState(false);
  const [templateModal, setTemplateModal] = useState(true);

  const selectTemplate = (tmpl: typeof DEFAULT_TEMPLATES[0]) => {
    setSelectedTemplate(tmpl);
    setChecklist(tmpl.items.map(label => ({ label, result: null, notes: '' })));
    setTemplateModal(false);
  };

  const setResult = (idx: number, result: 'pass' | 'fail' | 'na') => {
    const updated = [...checklist];
    updated[idx] = { ...updated[idx], result: updated[idx].result === result ? null : result };
    setChecklist(updated);
  };

  const setItemNotes = (idx: number, notes: string) => {
    const updated = [...checklist];
    updated[idx] = { ...updated[idx], notes };
    setChecklist(updated);
  };

  const addCorrectiveAction = () => {
    setCorrectiveActions([...correctiveActions, '']);
  };

  const updateCorrectiveAction = (idx: number, text: string) => {
    const updated = [...correctiveActions];
    updated[idx] = text;
    setCorrectiveActions(updated);
  };

  const removeCorrectiveAction = (idx: number) => {
    setCorrectiveActions(correctiveActions.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!selectedTemplate) return;
    const unanswered = checklist.filter(c => c.result === null).length;
    if (unanswered > 0) {
      Alert.alert('Incomplete', `${unanswered} items have not been assessed.`);
      return;
    }
    setSaving(true);
    const wsId = await getDefaultWorkspaceId();
    const res = await civilPost('/inspections', {
      template_name: selectedTemplate.name,
      date: new Date().toISOString().split('T')[0],
      checklist_items: checklist.map(c => ({
        label: c.label,
        result: c.result,
        notes: c.notes || '',
      })),
      corrective_actions: correctiveActions.filter(a => a.trim()),
      workspace_id: wsId,
    });
    setSaving(false);
    if (res.ok) {
      Alert.alert('Saved', 'Inspection submitted.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } else {
      Alert.alert('Error', res.error || 'Failed to save.');
    }
  };

  const passCount = checklist.filter(c => c.result === 'pass').length;
  const failCount = checklist.filter(c => c.result === 'fail').length;
  const total = checklist.length;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View testID="inspection-screen" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity testID="inspection-back-btn" onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={INK} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Inspection</Text>
            {selectedTemplate && (
              <Text style={s.headerSub}>{selectedTemplate.name}</Text>
            )}
          </View>
          {selectedTemplate && (
            <TouchableOpacity testID="inspection-change-template" onPress={() => setTemplateModal(true)}>
              <Text style={s.changeText}>Change</Text>
            </TouchableOpacity>
          )}
        </View>

        {selectedTemplate ? (
          <ScrollView contentContainerStyle={s.formContent} keyboardShouldPersistTaps="handled">
            {/* Progress */}
            <View testID="inspection-progress" style={s.progressCard}>
              <View style={s.progressRow}>
                <View style={[s.progressDot, { backgroundColor: GREEN }]} />
                <Text style={s.progressText}>{passCount} Pass</Text>
                <View style={[s.progressDot, { backgroundColor: RED }]} />
                <Text style={s.progressText}>{failCount} Fail</Text>
                <View style={[s.progressDot, { backgroundColor: '#CBD5E1' }]} />
                <Text style={s.progressText}>{total - passCount - failCount - checklist.filter(c => c.result === 'na').length} Remaining</Text>
              </View>
            </View>

            {/* Checklist items */}
            {checklist.map((item, idx) => (
              <View key={idx} testID={`inspection-item-${idx}`} style={s.itemCard}>
                <Text style={s.itemLabel}>{item.label}</Text>
                <View style={s.resultRow}>
                  <TouchableOpacity
                    testID={`inspection-pass-${idx}`}
                    style={[s.resultBtn, s.passBtn, item.result === 'pass' && s.passActive]}
                    onPress={() => setResult(idx, 'pass')}
                  >
                    <Ionicons name="checkmark" size={20} color={item.result === 'pass' ? '#FFF' : GREEN} />
                    <Text style={[s.resultBtnText, item.result === 'pass' && { color: '#FFF' }]}>Pass</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID={`inspection-fail-${idx}`}
                    style={[s.resultBtn, s.failBtn, item.result === 'fail' && s.failActive]}
                    onPress={() => setResult(idx, 'fail')}
                  >
                    <Ionicons name="close" size={20} color={item.result === 'fail' ? '#FFF' : RED} />
                    <Text style={[s.resultBtnText, item.result === 'fail' && { color: '#FFF' }]}>Fail</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID={`inspection-na-${idx}`}
                    style={[s.resultBtn, s.naBtn, item.result === 'na' && s.naActive]}
                    onPress={() => setResult(idx, 'na')}
                  >
                    <Text style={[s.resultBtnText, item.result === 'na' && { color: '#FFF' }]}>N/A</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  testID={`inspection-notes-${idx}`}
                  style={s.itemNotes}
                  value={item.notes}
                  onChangeText={(t) => setItemNotes(idx, t)}
                  placeholder="Notes (optional)"
                  placeholderTextColor="#94A3B8"
                />
              </View>
            ))}

            {/* Corrective actions */}
            <Text style={s.sectionTitle}>Corrective Actions</Text>
            {correctiveActions.map((action, idx) => (
              <View key={idx} style={s.caRow}>
                <TextInput
                  testID={`inspection-ca-${idx}`}
                  style={[s.input, { flex: 1, marginBottom: 0 }]}
                  value={action}
                  onChangeText={(t) => updateCorrectiveAction(idx, t)}
                  placeholder="Corrective action..."
                  placeholderTextColor="#94A3B8"
                />
                <TouchableOpacity testID={`inspection-remove-ca-${idx}`} onPress={() => removeCorrectiveAction(idx)}>
                  <Ionicons name="close-circle" size={22} color={RED} />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity testID="inspection-add-ca" style={s.addCaBtn} onPress={addCorrectiveAction}>
              <Ionicons name="add" size={18} color={BLUE} />
              <Text style={s.addCaText}>Add Corrective Action</Text>
            </TouchableOpacity>

            {/* Submit */}
            <TouchableOpacity
              testID="inspection-save-btn"
              style={[s.saveBtn, saving && s.saveBtnDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color="#FFF" /> : (
                <Text style={s.saveBtnText}>Submit Inspection</Text>
              )}
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
        ) : (
          <View style={s.emptyWrap}>
            <Ionicons name="clipboard-outline" size={48} color="#CBD5E1" />
            <Text style={s.emptyText}>Select a template to begin</Text>
          </View>
        )}

        {/* Template picker modal */}
        <Modal visible={templateModal} animationType="slide" transparent>
          <View style={s.modalOverlay}>
            <View style={s.modalContent}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>Select Template</Text>
                {selectedTemplate && (
                  <TouchableOpacity testID="inspection-modal-close" onPress={() => setTemplateModal(false)}>
                    <Ionicons name="close" size={24} color={INK} />
                  </TouchableOpacity>
                )}
              </View>
              {templates.map((tmpl) => (
                <TouchableOpacity
                  key={tmpl.id}
                  testID={`inspection-template-${tmpl.id}`}
                  style={s.templateItem}
                  onPress={() => selectTemplate(tmpl)}
                >
                  <Ionicons name="clipboard-outline" size={24} color={BLUE} />
                  <View style={{ flex: 1, marginLeft: 14 }}>
                    <Text style={s.templateName}>{tmpl.name}</Text>
                    <Text style={s.templateCount}>{tmpl.items.length} checklist items</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#CBD5E1" />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </Modal>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFF', paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#E5E7EB', gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: INK },
  headerSub: { fontSize: 12, color: MUTED, marginTop: 2 },
  changeText: { fontSize: 13, fontWeight: '600', color: BLUE },
  formContent: { padding: 16, paddingBottom: 32 },

  progressCard: {
    backgroundColor: '#FFF', borderRadius: 14, padding: 14, marginBottom: 16,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  progressDot: { width: 10, height: 10, borderRadius: 5 },
  progressText: { fontSize: 13, fontWeight: '600', color: INK, marginRight: 8 },

  itemCard: {
    backgroundColor: '#FFF', borderRadius: 14, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  itemLabel: { fontSize: 15, fontWeight: '600', color: INK, marginBottom: 12 },
  resultRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  resultBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderWidth: 1.5, borderRadius: 10, paddingVertical: 12, minHeight: 48,
  },
  passBtn: { borderColor: '#D1FAE5', backgroundColor: '#F0FDF4' },
  passActive: { backgroundColor: GREEN, borderColor: GREEN },
  failBtn: { borderColor: '#FECACA', backgroundColor: '#FEF2F2' },
  failActive: { backgroundColor: RED, borderColor: RED },
  naBtn: { borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  naActive: { backgroundColor: '#94A3B8', borderColor: '#94A3B8' },
  resultBtnText: { fontSize: 14, fontWeight: '600', color: INK },
  itemNotes: {
    backgroundColor: '#F8FAFC', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0',
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: INK,
  },

  sectionTitle: { fontSize: 16, fontWeight: '700', color: INK, marginTop: 16, marginBottom: 10 },
  input: {
    backgroundColor: '#FFF', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0',
    paddingHorizontal: 14, paddingVertical: 14, fontSize: 15, color: INK, marginBottom: 8,
  },
  caRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  addCaBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderColor: '#DBEAFE', borderRadius: 12, paddingVertical: 12,
    backgroundColor: '#EFF6FF',
  },
  addCaText: { fontSize: 14, fontWeight: '600', color: BLUE },

  saveBtn: {
    backgroundColor: BLUE, borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    marginTop: 20, minHeight: 56,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#FFF' },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 16, fontWeight: '600', color: MUTED },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: INK },
  templateItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 18,
    borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  templateName: { fontSize: 16, fontWeight: '600', color: INK },
  templateCount: { fontSize: 12, color: MUTED, marginTop: 2 },
});
