/**
 * Inspection Checklist — Phase 4.
 * Pick template → walk through items → submit.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, C } from '../../src/theme/colors';
import { createItem } from '../../src/services/capture';
import { authGet } from '../../src/services/apiClient';
import { getStoredUser } from '../../src/services/auth';

interface Template {
  id: string;
  name: string;
  checklist_items?: { label: string }[];
}

interface ChecklistItem {
  label: string;
  response: 'pass' | 'fail' | 'na';
  notes: string;
}

interface CorrectiveAction {
  description: string;
}

export default function InspectionCapture() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [correctiveActions, setCorrActions] = useState<CorrectiveAction[]>([]);
  const [newAction, setNewAction] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      // Try fetching inspection templates from the inspections endpoint
      const res = await authGet<any[]>('/api/inspections');
      if (res.ok && Array.isArray(res.data)) {
        // Extract unique template names from existing inspections
        const templateMap = new Map<string, Template>();
        res.data.forEach((insp: any) => {
          if (insp.template_name && !templateMap.has(insp.template_name)) {
            templateMap.set(insp.template_name, {
              id: insp.template_name,
              name: insp.template_name,
              checklist_items: insp.checklist_items?.map((ci: any) => ({ label: ci.label })),
            });
          }
        });
        setTemplates(Array.from(templateMap.values()));
      }
    } catch { /* ignore */ }

    // If no templates found, seed with defaults
    if (templates.length === 0) {
      setTemplates([
        {
          id: 'site-safety',
          name: 'Site Safety Inspection',
          checklist_items: [
            { label: 'PPE compliance' },
            { label: 'Housekeeping' },
            { label: 'Emergency exits clear' },
            { label: 'Fire extinguishers accessible' },
            { label: 'First aid kit stocked' },
            { label: 'Signage visible' },
            { label: 'Traffic management in place' },
            { label: 'Exclusion zones marked' },
          ],
        },
        {
          id: 'plant-inspection',
          name: 'Plant & Equipment Inspection',
          checklist_items: [
            { label: 'Pre-start completed' },
            { label: 'Operator competent' },
            { label: 'Safety devices working' },
            { label: 'Lights & mirrors clean' },
            { label: 'No fluid leaks' },
            { label: 'Tyres & tracks OK' },
            { label: 'ROPS/FOPS intact' },
            { label: 'Fire extinguisher on unit' },
          ],
        },
        {
          id: 'excavation',
          name: 'Excavation Inspection',
          checklist_items: [
            { label: 'SWMS acknowledged' },
            { label: 'Dial Before You Dig consulted' },
            { label: 'Shoring/battering adequate' },
            { label: 'Spoil at safe distance' },
            { label: 'Edge protection in place' },
            { label: 'Access/egress provided' },
            { label: 'Atmospheric monitoring done' },
            { label: 'Services located & marked' },
          ],
        },
      ]);
    }
    setLoading(false);
  };

  const selectTemplate = (tmpl: Template) => {
    setSelectedTemplate(tmpl);
    setChecklist(
      (tmpl.checklist_items || []).map((ci) => ({
        label: ci.label,
        response: 'pass',
        notes: '',
      })),
    );
  };

  const setItemResponse = (idx: number, response: 'pass' | 'fail' | 'na') => {
    const updated = [...checklist];
    updated[idx].response = response;
    setChecklist(updated);
  };

  const setItemNotes = (idx: number, text: string) => {
    const updated = [...checklist];
    updated[idx].notes = text;
    setChecklist(updated);
  };

  const addCorrectiveAction = () => {
    if (!newAction.trim()) return;
    setCorrActions([...correctiveActions, { description: newAction.trim() }]);
    setNewAction('');
  };

  const removeCorrectiveAction = (idx: number) => {
    setCorrActions(correctiveActions.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!selectedTemplate) {
      Alert.alert('Required', 'Please select a template.');
      return;
    }
    setSaving(true);
    try {
      const user = await getStoredUser();
      await createItem('inspections', {
        workspace_id: user?.org_id || 'default',
        template_name: selectedTemplate.name,
        date: new Date().toISOString().slice(0, 10),
        checklist_items: checklist.map((ci) => ({
          label: ci.label,
          response: ci.response,
          notes: ci.notes || undefined,
        })),
        corrective_actions: correctiveActions,
        notes: notes.trim() || undefined,
        operator: user?.name || undefined,
      });
      Alert.alert('Saved', 'Inspection submitted.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to save inspection.');
    }
    setSaving(false);
  };

  // Template picker
  if (!selectedTemplate) {
    return (
      <View testID="inspection-template-picker" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity testID="inspection-back" onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.white} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Pick Inspection Template</Text>
        </View>

        {loading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={Colors.orange} />
            <Text style={s.loadingText}>Loading templates…</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={s.formScroll}>
            {templates.map((tmpl) => (
              <TouchableOpacity
                key={tmpl.id}
                testID={`inspection-template-${tmpl.id}`}
                style={s.templateCard}
                onPress={() => selectTemplate(tmpl)}
                activeOpacity={0.7}
              >
                <View style={s.templateIcon}>
                  <Ionicons name="clipboard-outline" size={24} color="#7C3AED" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.templateName}>{tmpl.name}</Text>
                  <Text style={s.templateCount}>
                    {tmpl.checklist_items?.length || 0} checklist items
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={C.textOnNavy.faint} />
              </TouchableOpacity>
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        )}
      </View>
    );
  }

  // Checklist form
  const passCount = checklist.filter((c) => c.response === 'pass').length;
  const failCount = checklist.filter((c) => c.response === 'fail').length;
  const naCount = checklist.filter((c) => c.response === 'na').length;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <View testID="inspection-checklist" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => setSelectedTemplate(null)} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.white} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle} numberOfLines={1}>{selectedTemplate.name}</Text>
          </View>
          <TouchableOpacity
            testID="inspection-save-header"
            style={s.saveHeaderBtn}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Text style={s.saveHeaderBtnText}>Submit</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Progress bar */}
        <View style={s.progressBar}>
          <View style={[s.progressPass, { flex: passCount || 0.01 }]} />
          <View style={[s.progressFail, { flex: failCount || 0.01 }]} />
          <View style={[s.progressNA, { flex: naCount || 0.01 }]} />
        </View>
        <View style={s.progressLabels}>
          <Text style={s.progressLabel}>✓ {passCount} Pass</Text>
          <Text style={[s.progressLabel, { color: '#EF4444' }]}>✕ {failCount} Fail</Text>
          <Text style={[s.progressLabel, { color: '#9CA3AF' }]}>— {naCount} N/A</Text>
        </View>

        <ScrollView contentContainerStyle={s.formScroll} keyboardShouldPersistTaps="handled">
          {checklist.map((item, idx) => (
            <View key={idx} style={s.checkItem} testID={`inspection-item-${idx}`}>
              <Text style={s.checkLabel}>{item.label}</Text>
              <View style={s.responseRow}>
                <TouchableOpacity
                  testID={`inspection-pass-${idx}`}
                  style={[s.responseBtn, item.response === 'pass' && s.responseBtnPass]}
                  onPress={() => setItemResponse(idx, 'pass')}
                >
                  <Ionicons name="checkmark" size={18} color={item.response === 'pass' ? '#FFF' : C.card.textMain} />
                  <Text style={[s.responseBtnText, item.response === 'pass' && { color: '#FFF' }]}>Pass</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`inspection-fail-${idx}`}
                  style={[s.responseBtn, item.response === 'fail' && s.responseBtnFail]}
                  onPress={() => setItemResponse(idx, 'fail')}
                >
                  <Ionicons name="close" size={18} color={item.response === 'fail' ? '#FFF' : C.card.textMain} />
                  <Text style={[s.responseBtnText, item.response === 'fail' && { color: '#FFF' }]}>Fail</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`inspection-na-${idx}`}
                  style={[s.responseBtn, item.response === 'na' && s.responseBtnNA]}
                  onPress={() => setItemResponse(idx, 'na')}
                >
                  <Text style={[s.responseBtnText, item.response === 'na' && { color: '#FFF' }]}>N/A</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                testID={`inspection-notes-${idx}`}
                style={s.noteInput}
                value={item.notes}
                onChangeText={(text) => setItemNotes(idx, text)}
                placeholder="Notes (optional)"
                placeholderTextColor={C.card.textLabel}
              />
            </View>
          ))}

          <Text style={s.sectionLabel}>Corrective Actions</Text>
          {correctiveActions.map((ca, idx) => (
            <View key={idx} style={s.caRow}>
              <Text style={s.caText}>{ca.description}</Text>
              <TouchableOpacity onPress={() => removeCorrectiveAction(idx)}>
                <Ionicons name="close-circle" size={20} color={C.card.textLabel} />
              </TouchableOpacity>
            </View>
          ))}
          <View style={s.addCaRow}>
            <TextInput
              testID="inspection-new-action"
              style={[s.input, { flex: 1 }]}
              value={newAction}
              onChangeText={setNewAction}
              placeholder="Add corrective action..."
              placeholderTextColor={C.card.textLabel}
              returnKeyType="done"
              onSubmitEditing={addCorrectiveAction}
            />
            <TouchableOpacity style={s.addCaBtn} onPress={addCorrectiveAction}>
              <Ionicons name="add" size={20} color={Colors.white} />
            </TouchableOpacity>
          </View>

          <Text style={s.label}>Additional Notes</Text>
          <TextInput
            testID="inspection-notes-global"
            style={[s.input, { minHeight: 60 }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Any additional notes..."
            placeholderTextColor={C.card.textLabel}
            multiline
          />

          <TouchableOpacity
            testID="inspection-submit-btn"
            style={s.submitBtn}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.7}
          >
            {saving ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color={Colors.white} />
                <Text style={s.submitBtnText}>Submit Inspection</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.screen.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.screen.bar, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14,
  },
  backBtn: { padding: 4, marginRight: 8 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: C.textOnNavy.main },
  saveHeaderBtn: {
    backgroundColor: '#7C3AED', borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 8, minWidth: 60, alignItems: 'center',
  },
  saveHeaderBtnText: { color: Colors.white, fontSize: 14, fontWeight: '700' },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: C.textOnNavy.faint, fontSize: 13 },
  formScroll: { padding: 16, paddingBottom: 32 },

  templateCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: C.card.bg, borderRadius: 16, padding: 18, marginBottom: 10, minHeight: 76,
  },
  templateIcon: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: '#EDE9FE', alignItems: 'center', justifyContent: 'center',
  },
  templateName: { fontSize: 16, fontWeight: '700', color: C.card.textMain },
  templateCount: { fontSize: 12, color: C.card.textLabel, marginTop: 2 },

  // Progress
  progressBar: {
    flexDirection: 'row', height: 4, backgroundColor: '#E5E7EB',
    marginHorizontal: 16, marginTop: 8, borderRadius: 2, overflow: 'hidden',
  },
  progressPass: { backgroundColor: C.green.base },
  progressFail: { backgroundColor: '#EF4444' },
  progressNA: { backgroundColor: '#D1D5DB' },
  progressLabels: {
    flexDirection: 'row', justifyContent: 'center', gap: 16,
    paddingVertical: 6, marginBottom: 4,
  },
  progressLabel: { fontSize: 11, fontWeight: '700', color: C.green.base },

  // Checklist items
  checkItem: {
    backgroundColor: C.card.bg, borderRadius: 14, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: C.card.border,
  },
  checkLabel: { fontSize: 15, fontWeight: '600', color: C.card.textMain, marginBottom: 10 },
  responseRow: { flexDirection: 'row', gap: 8 },
  responseBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.card.border, backgroundColor: C.card.bg, minHeight: 44,
  },
  responseBtnPass: { backgroundColor: C.green.base, borderColor: C.green.base },
  responseBtnFail: { backgroundColor: '#EF4444', borderColor: '#EF4444' },
  responseBtnNA: { backgroundColor: '#6B7280', borderColor: '#6B7280' },
  responseBtnText: { fontSize: 13, fontWeight: '700', color: C.card.textMain },
  noteInput: {
    backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8,
    fontSize: 13, color: C.card.textMain, marginTop: 8,
  },

  sectionLabel: {
    fontSize: 14, fontWeight: '800', color: C.textOnNavy.main,
    marginTop: 20, marginBottom: 8,
  },
  label: {
    fontSize: 12, fontWeight: '700', color: C.textOnNavy.secondary,
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6, marginTop: 14,
  },
  input: {
    backgroundColor: C.card.bg, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: C.card.textMain, borderWidth: 1, borderColor: C.card.border,
  },

  caRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.card.bg, borderRadius: 10, padding: 12, marginBottom: 6,
    borderWidth: 1, borderColor: C.card.border,
  },
  caText: { fontSize: 14, color: C.card.textMain, flex: 1 },
  addCaRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addCaBtn: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: '#7C3AED', alignItems: 'center', justifyContent: 'center',
  },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#7C3AED', borderRadius: 16, paddingVertical: 18,
    marginTop: 24, minHeight: 56,
  },
  submitBtnText: { color: Colors.white, fontSize: 16, fontWeight: '800' },
});
