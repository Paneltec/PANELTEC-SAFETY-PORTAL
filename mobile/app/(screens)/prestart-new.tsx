/**
 * Phase 4 — Daily Pre-Start form.
 * Date, work summary, linked SWMS, hazards discussed, crew sign-on.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Modal, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { civilGet, civilPost, getDefaultWorkspaceId, getStoredCivilUser } from '../../src/services/civilApi';

const BLUE = '#2C6BFF';
const GREEN = '#10B981';
const BG = '#F8FAFC';
const INK = '#0F172A';
const MUTED = '#64748B';

interface CrewMember {
  name: string;
  role: string;
  signed_at?: string;
}

export default function PrestartNewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [date] = useState(new Date().toISOString().split('T')[0]);
  const [workSummary, setWorkSummary] = useState('');
  const [hazardsDiscussed, setHazardsDiscussed] = useState('');
  const [linkedSwmsIds, setLinkedSwmsIds] = useState<string[]>([]);
  const [crewMembers, setCrewMembers] = useState<CrewMember[]>([]);
  const [newCrewName, setNewCrewName] = useState('');
  const [newCrewRole, setNewCrewRole] = useState('');
  const [saving, setSaving] = useState(false);

  // SWMS picker
  const [swmsList, setSwmsList] = useState<any[]>([]);
  const [swmsModal, setSwmsModal] = useState(false);
  const [swmsLoading, setSwmsLoading] = useState(false);

  useEffect(() => {
    loadSwms();
  }, []);

  const loadSwms = async () => {
    setSwmsLoading(true);
    const res = await civilGet<any[]>('/swms');
    if (res.ok && res.data) setSwmsList(res.data);
    setSwmsLoading(false);
  };

  const toggleSwms = (id: string) => {
    setLinkedSwmsIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const addCrewMember = () => {
    if (!newCrewName.trim()) return;
    setCrewMembers([
      ...crewMembers,
      { name: newCrewName.trim(), role: newCrewRole.trim() || 'Worker' },
    ]);
    setNewCrewName('');
    setNewCrewRole('');
  };

  const signCrewMember = (idx: number) => {
    const updated = [...crewMembers];
    updated[idx] = { ...updated[idx], signed_at: new Date().toISOString() };
    setCrewMembers(updated);
  };

  const removeCrewMember = (idx: number) => {
    setCrewMembers(crewMembers.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!workSummary.trim()) {
      Alert.alert('Required', 'Enter a work summary.');
      return;
    }
    setSaving(true);
    const wsId = await getDefaultWorkspaceId();
    const user = await getStoredCivilUser();
    const res = await civilPost('/pre-starts', {
      date,
      work_summary: workSummary.trim(),
      linked_swms_ids: linkedSwmsIds,
      hazards_discussed: hazardsDiscussed.trim(),
      sign_ons: crewMembers.map(c => ({
        name: c.name,
        role: c.role,
        signed_at: c.signed_at || null,
      })),
      workspace_id: wsId,
      crew_lead: user?.id,
    });
    setSaving(false);
    if (res.ok) {
      Alert.alert('Saved', 'Pre-start created.', [{ text: 'OK', onPress: () => router.back() }]);
    } else {
      Alert.alert('Error', res.error || 'Failed to save.');
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View testID="prestart-screen" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity testID="prestart-back-btn" onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={INK} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Daily Pre-Start</Text>
        </View>

        <ScrollView contentContainerStyle={s.formContent} keyboardShouldPersistTaps="handled">
          {/* Date */}
          <Text style={s.label}>Date</Text>
          <View style={s.dateBox}>
            <Ionicons name="calendar-outline" size={18} color={MUTED} />
            <Text testID="prestart-date" style={s.dateText}>{date}</Text>
          </View>

          {/* Work summary */}
          <Text style={s.label}>Work Summary *</Text>
          <TextInput
            testID="prestart-summary-input"
            style={[s.input, s.textarea]}
            value={workSummary}
            onChangeText={setWorkSummary}
            placeholder="Describe today's planned work..."
            placeholderTextColor="#94A3B8"
            multiline
          />

          {/* Linked SWMS */}
          <Text style={s.label}>Linked SWMS</Text>
          <TouchableOpacity testID="prestart-swms-picker" style={s.pickerBtn} onPress={() => setSwmsModal(true)}>
            <Ionicons name="document-text-outline" size={18} color={BLUE} />
            <Text style={s.pickerBtnText}>
              {linkedSwmsIds.length > 0 ? `${linkedSwmsIds.length} SWMS selected` : 'Select SWMS'}
            </Text>
            <Ionicons name="chevron-down" size={16} color={MUTED} />
          </TouchableOpacity>

          {/* Hazards discussed */}
          <Text style={s.label}>Hazards Discussed</Text>
          <TextInput
            testID="prestart-hazards-input"
            style={[s.input, s.textarea]}
            value={hazardsDiscussed}
            onChangeText={setHazardsDiscussed}
            placeholder="List hazards discussed with crew..."
            placeholderTextColor="#94A3B8"
            multiline
          />

          {/* Crew sign-on */}
          <Text style={s.label}>Crew Sign-On</Text>
          {crewMembers.map((member, idx) => (
            <View key={idx} testID={`prestart-crew-${idx}`} style={s.crewRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.crewName}>{member.name}</Text>
                <Text style={s.crewRole}>{member.role}</Text>
              </View>
              {member.signed_at ? (
                <View style={s.signedBadge}>
                  <Ionicons name="checkmark-circle" size={14} color={GREEN} />
                  <Text style={s.signedText}>Signed</Text>
                </View>
              ) : (
                <TouchableOpacity
                  testID={`prestart-sign-${idx}`}
                  style={s.signBtn}
                  onPress={() => signCrewMember(idx)}
                >
                  <Text style={s.signBtnText}>Sign Now</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity testID={`prestart-remove-crew-${idx}`} onPress={() => removeCrewMember(idx)}>
                <Ionicons name="close-circle" size={22} color="#EF4444" />
              </TouchableOpacity>
            </View>
          ))}
          <View style={s.addCrewRow}>
            <TextInput
              testID="prestart-new-crew-name"
              style={[s.input, { flex: 1, marginBottom: 0 }]}
              value={newCrewName}
              onChangeText={setNewCrewName}
              placeholder="Name"
              placeholderTextColor="#94A3B8"
            />
            <TextInput
              testID="prestart-new-crew-role"
              style={[s.input, { width: 80, marginBottom: 0 }]}
              value={newCrewRole}
              onChangeText={setNewCrewRole}
              placeholder="Role"
              placeholderTextColor="#94A3B8"
            />
            <TouchableOpacity testID="prestart-add-crew-btn" style={s.addCrewBtn} onPress={addCrewMember}>
              <Ionicons name="add" size={22} color="#FFF" />
            </TouchableOpacity>
          </View>

          {/* Save */}
          <TouchableOpacity
            testID="prestart-save-btn"
            style={[s.saveBtn, saving && s.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#FFF" /> : (
              <Text style={s.saveBtnText}>Save Pre-Start</Text>
            )}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>

        {/* SWMS Picker Modal */}
        <Modal visible={swmsModal} animationType="slide" transparent>
          <View style={s.modalOverlay}>
            <View style={s.modalContent}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>Select SWMS</Text>
                <TouchableOpacity testID="prestart-swms-close" onPress={() => setSwmsModal(false)}>
                  <Ionicons name="close" size={24} color={INK} />
                </TouchableOpacity>
              </View>
              {swmsLoading ? (
                <ActivityIndicator color={BLUE} style={{ marginVertical: 20 }} />
              ) : (
                <FlatList
                  data={swmsList}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      testID={`swms-option-${item.id}`}
                      style={s.swmsItem}
                      onPress={() => toggleSwms(item.id)}
                    >
                      <Ionicons
                        name={linkedSwmsIds.includes(item.id) ? 'checkbox' : 'square-outline'}
                        size={22}
                        color={linkedSwmsIds.includes(item.id) ? BLUE : MUTED}
                      />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={s.swmsTitle}>{item.title}</Text>
                        <Text style={s.swmsCode}>{item.code} · v{item.version}</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={<Text style={s.emptyText}>No SWMS found</Text>}
                />
              )}
              <TouchableOpacity testID="prestart-swms-done" style={s.modalDoneBtn} onPress={() => setSwmsModal(false)}>
                <Text style={s.modalDoneBtnText}>Done</Text>
              </TouchableOpacity>
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
  formContent: { padding: 16, paddingBottom: 32 },

  label: { fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: '#FFF', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0',
    paddingHorizontal: 14, paddingVertical: 14, fontSize: 15, color: INK, marginBottom: 8,
  },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  dateBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFF', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0',
    paddingHorizontal: 14, paddingVertical: 14, marginBottom: 8,
  },
  dateText: { fontSize: 15, fontWeight: '600', color: INK },

  pickerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFF', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0',
    paddingHorizontal: 14, paddingVertical: 14, marginBottom: 8,
  },
  pickerBtnText: { flex: 1, fontSize: 15, color: INK },

  // Crew
  crewRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFF', borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  crewName: { fontSize: 15, fontWeight: '600', color: INK },
  crewRole: { fontSize: 12, color: MUTED, marginTop: 2 },
  signedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  signedText: { fontSize: 12, fontWeight: '600', color: GREEN },
  signBtn: {
    backgroundColor: GREEN, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8,
  },
  signBtnText: { fontSize: 12, fontWeight: '700', color: '#FFF' },
  addCrewRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 16 },
  addCrewBtn: {
    width: 48, height: 48, borderRadius: 12, backgroundColor: BLUE,
    alignItems: 'center', justifyContent: 'center',
  },

  // Save
  saveBtn: {
    backgroundColor: GREEN, borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    marginTop: 16, minHeight: 56,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#FFF' },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 16, maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: INK },
  swmsItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  swmsTitle: { fontSize: 15, fontWeight: '600', color: INK },
  swmsCode: { fontSize: 12, color: MUTED, marginTop: 2 },
  emptyText: { textAlign: 'center', color: MUTED, padding: 20 },
  modalDoneBtn: {
    backgroundColor: BLUE, borderRadius: 14, paddingVertical: 14, marginHorizontal: 20,
    marginVertical: 16, alignItems: 'center',
  },
  modalDoneBtnText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
});
