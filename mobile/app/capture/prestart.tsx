/**
 * Daily Pre-Start Form — Phase 4.
 * Date, work summary, linked SWMS, hazards discussed, crew sign-on.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, C } from '../../src/theme/colors';
import { createItem } from '../../src/services/capture';
import { authGet } from '../../src/services/apiClient';
import { getStoredUser } from '../../src/services/auth';

interface SwmsItem {
  id: string;
  title: string;
  version?: string;
}

interface CrewMember {
  name: string;
  role: string;
  signedAt: string | null;
}

export default function PreStartCapture() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const today = new Date().toISOString().slice(0, 10);
  const [date] = useState(today);
  const [workSummary, setWorkSummary] = useState('');
  const [hazardsDiscussed, setHazardsDiscussed] = useState('');
  const [notes, setNotes] = useState('');
  const [crewMembers, setCrewMembers] = useState<CrewMember[]>([]);
  const [newCrewName, setNewCrewName] = useState('');
  const [newCrewRole, setNewCrewRole] = useState('');
  const [linkedSwms, setLinkedSwms] = useState<string[]>([]);
  const [swmsList, setSwmsList] = useState<SwmsItem[]>([]);
  const [showSwmsPicker, setShowSwmsPicker] = useState(false);
  const [swmsLoading, setSwmsLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSwms();
  }, []);

  const loadSwms = async () => {
    setSwmsLoading(true);
    try {
      const res = await authGet<any[]>('/api/swms');
      if (res.ok && Array.isArray(res.data)) {
        setSwmsList(res.data.map((s: any) => ({
          id: s.id,
          title: s.title || s.name || 'Untitled SWMS',
          version: s.version,
        })));
      }
    } catch { /* ignore */ }
    setSwmsLoading(false);
  };

  const addCrewMember = () => {
    if (!newCrewName.trim()) return;
    setCrewMembers([
      ...crewMembers,
      { name: newCrewName.trim(), role: newCrewRole.trim() || 'Worker', signedAt: null },
    ]);
    setNewCrewName('');
    setNewCrewRole('');
  };

  const signCrewMember = (idx: number) => {
    const updated = [...crewMembers];
    updated[idx].signedAt = new Date().toISOString();
    setCrewMembers(updated);
  };

  const removeCrewMember = (idx: number) => {
    setCrewMembers(crewMembers.filter((_, i) => i !== idx));
  };

  const toggleSwms = (id: string) => {
    if (linkedSwms.includes(id)) {
      setLinkedSwms(linkedSwms.filter((s) => s !== id));
    } else {
      setLinkedSwms([...linkedSwms, id]);
    }
  };

  const handleSave = async () => {
    if (!workSummary.trim()) {
      Alert.alert('Required', 'Please enter a work summary.');
      return;
    }
    setSaving(true);
    try {
      const user = await getStoredUser();
      await createItem('pre-starts', {
        workspace_id: user?.org_id || 'default',
        date,
        crew_lead: user?.name || 'Unknown',
        work_summary: workSummary.trim(),
        linked_swms_ids: linkedSwms,
        hazards_discussed: hazardsDiscussed.trim(),
        notes: notes.trim() || undefined,
        sign_ons: crewMembers
          .filter((m) => m.signedAt)
          .map((m) => ({
            name: m.name,
            role: m.role,
            signature_ts: m.signedAt,
          })),
      });
      Alert.alert('Saved', 'Pre-start submitted successfully.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to save pre-start.');
    }
    setSaving(false);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <View testID="prestart-capture" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity testID="prestart-back" onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.white} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Daily Pre-Start</Text>
          <TouchableOpacity
            testID="prestart-save-btn"
            style={s.saveHeaderBtn}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Text style={s.saveHeaderBtnText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={s.formScroll} keyboardShouldPersistTaps="handled">
          <Text style={s.label}>Date</Text>
          <View style={s.dateRow}>
            <Ionicons name="calendar-outline" size={18} color={Colors.orange} />
            <Text style={s.dateText}>{date}</Text>
          </View>

          <Text style={s.label}>Work Summary *</Text>
          <TextInput
            testID="prestart-summary-input"
            style={[s.input, s.multiline]}
            value={workSummary}
            onChangeText={setWorkSummary}
            placeholder="Describe today's planned work..."
            placeholderTextColor={C.card.textLabel}
            multiline
            numberOfLines={4}
          />

          <Text style={s.label}>Linked SWMS</Text>
          <TouchableOpacity
            testID="prestart-select-swms"
            style={s.pickerBtn}
            onPress={() => setShowSwmsPicker(true)}
          >
            <Ionicons name="shield-checkmark-outline" size={18} color={Colors.info} />
            <Text style={s.pickerBtnText}>
              {linkedSwms.length > 0 ? `${linkedSwms.length} SWMS selected` : 'Select SWMS…'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={C.textOnNavy.faint} />
          </TouchableOpacity>
          {linkedSwms.length > 0 && (
            <View style={s.chipRow}>
              {linkedSwms.map((id) => {
                const swms = swmsList.find((s) => s.id === id);
                return (
                  <View key={id} style={s.chip}>
                    <Text style={s.chipText} numberOfLines={1}>{swms?.title || id}</Text>
                    <TouchableOpacity onPress={() => toggleSwms(id)}>
                      <Ionicons name="close-circle" size={16} color={C.card.textLabel} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}

          <Text style={s.label}>Hazards Discussed</Text>
          <TextInput
            testID="prestart-hazards-input"
            style={[s.input, s.multiline]}
            value={hazardsDiscussed}
            onChangeText={setHazardsDiscussed}
            placeholder="List hazards discussed with crew..."
            placeholderTextColor={C.card.textLabel}
            multiline
            numberOfLines={3}
          />

          <Text style={s.label}>Crew Sign-On</Text>
          {crewMembers.map((member, idx) => (
            <View key={idx} style={s.crewRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.crewName}>{member.name}</Text>
                <Text style={s.crewRole}>{member.role}</Text>
              </View>
              {member.signedAt ? (
                <View style={s.signedBadge}>
                  <Ionicons name="checkmark-circle" size={14} color={C.green.base} />
                  <Text style={s.signedText}>Signed</Text>
                </View>
              ) : (
                <TouchableOpacity
                  testID={`prestart-sign-${idx}`}
                  style={s.signNowBtn}
                  onPress={() => signCrewMember(idx)}
                >
                  <Text style={s.signNowText}>Sign Now</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => removeCrewMember(idx)}>
                <Ionicons name="close" size={18} color={C.card.textLabel} />
              </TouchableOpacity>
            </View>
          ))}
          <View style={s.addCrewRow}>
            <TextInput
              testID="prestart-crew-name"
              style={[s.input, { flex: 1 }]}
              value={newCrewName}
              onChangeText={setNewCrewName}
              placeholder="Name"
              placeholderTextColor={C.card.textLabel}
            />
            <TextInput
              testID="prestart-crew-role"
              style={[s.input, { width: 90 }]}
              value={newCrewRole}
              onChangeText={setNewCrewRole}
              placeholder="Role"
              placeholderTextColor={C.card.textLabel}
            />
            <TouchableOpacity testID="prestart-add-crew" style={s.addCrewBtn} onPress={addCrewMember}>
              <Ionicons name="add" size={20} color={Colors.white} />
            </TouchableOpacity>
          </View>

          <Text style={s.label}>Notes</Text>
          <TextInput
            testID="prestart-notes-input"
            style={[s.input, { minHeight: 60 }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Any additional notes..."
            placeholderTextColor={C.card.textLabel}
            multiline
          />

          <TouchableOpacity
            testID="prestart-submit-btn"
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
                <Text style={s.submitBtnText}>Submit Pre-Start</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>

        {/* SWMS picker modal */}
        <Modal visible={showSwmsPicker} animationType="slide" transparent onRequestClose={() => setShowSwmsPicker(false)}>
          <View style={s.modalBackdrop}>
            <View style={s.modalCard}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>Select SWMS</Text>
                <TouchableOpacity onPress={() => setShowSwmsPicker(false)}>
                  <Ionicons name="close" size={24} color={C.card.textMain} />
                </TouchableOpacity>
              </View>
              {swmsLoading ? (
                <ActivityIndicator size="large" color={Colors.orange} style={{ marginVertical: 40 }} />
              ) : (
                <ScrollView style={{ maxHeight: 400 }}>
                  {swmsList.length === 0 ? (
                    <Text style={s.emptyText}>No SWMS found</Text>
                  ) : swmsList.map((sw) => (
                    <TouchableOpacity
                      key={sw.id}
                      style={s.swmsRow}
                      onPress={() => toggleSwms(sw.id)}
                    >
                      <Ionicons
                        name={linkedSwms.includes(sw.id) ? 'checkbox' : 'square-outline'}
                        size={22}
                        color={linkedSwms.includes(sw.id) ? C.green.base : C.card.textLabel}
                      />
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={s.swmsTitle} numberOfLines={2}>{sw.title}</Text>
                        {sw.version && <Text style={s.swmsVersion}>v{sw.version}</Text>}
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              <TouchableOpacity
                style={s.modalDoneBtn}
                onPress={() => setShowSwmsPicker(false)}
              >
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
  container: { flex: 1, backgroundColor: C.screen.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.screen.bar, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14,
  },
  backBtn: { padding: 4, marginRight: 8 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: C.textOnNavy.main, flex: 1 },
  saveHeaderBtn: {
    backgroundColor: C.green.base, borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 8, minWidth: 60, alignItems: 'center',
  },
  saveHeaderBtnText: { color: C.green.buttonText, fontSize: 14, fontWeight: '700' },
  formScroll: { padding: 16, paddingBottom: 32 },

  label: {
    fontSize: 12, fontWeight: '700', color: C.textOnNavy.secondary,
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6, marginTop: 14,
  },
  input: {
    backgroundColor: C.card.bg, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: C.card.textMain, borderWidth: 1, borderColor: C.card.border,
  },
  multiline: { minHeight: 100, textAlignVertical: 'top' },

  dateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.card.bg, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.card.border,
  },
  dateText: { fontSize: 15, fontWeight: '600', color: C.card.textMain },

  pickerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.card.bg, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.card.border,
  },
  pickerBtnText: { flex: 1, fontSize: 15, color: C.card.textMain },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.card.bg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: C.card.border, maxWidth: '90%',
  },
  chipText: { fontSize: 12, color: C.card.textMain, flexShrink: 1 },

  // Crew sign-on
  crewRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.card.bg, borderRadius: 12, padding: 12, marginBottom: 6,
    borderWidth: 1, borderColor: C.card.border,
  },
  crewName: { fontSize: 14, fontWeight: '600', color: C.card.textMain },
  crewRole: { fontSize: 11, color: C.card.textLabel },
  signedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  signedText: { fontSize: 11, fontWeight: '700', color: C.green.base },
  signNowBtn: {
    backgroundColor: Colors.orange, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6, minHeight: 32,
  },
  signNowText: { color: Colors.white, fontSize: 12, fontWeight: '700' },
  addCrewRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 6 },
  addCrewBtn: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center',
  },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: C.green.base, borderRadius: 16, paddingVertical: 18,
    marginTop: 24, minHeight: 56,
  },
  submitBtnText: { color: C.green.buttonText, fontSize: 16, fontWeight: '800' },

  // SWMS picker modal
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: C.card.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: '75%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: C.card.textMain },
  swmsRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.card.border,
  },
  swmsTitle: { fontSize: 14, fontWeight: '600', color: C.card.textMain },
  swmsVersion: { fontSize: 11, color: C.card.textLabel, marginTop: 2 },
  emptyText: { color: C.card.textLabel, fontSize: 14, textAlign: 'center', paddingVertical: 40 },
  modalDoneBtn: {
    backgroundColor: Colors.orange, borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', marginTop: 16, minHeight: 48,
  },
  modalDoneBtnText: { color: Colors.white, fontSize: 16, fontWeight: '700' },
});
