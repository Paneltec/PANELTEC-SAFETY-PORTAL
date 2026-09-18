/**
 * Personal Info screen — editable worker details.
 * v58.13.132dc — Restored from archive, preview-mode aware.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Colors } from '../../src/theme/colors';
import { fetchWorkerProfile } from '../../src/services/profile';
import { selfEditWorkerProfile, type SelfEditPayload } from '../../src/services/profileExtended';
import { isPreviewSession } from '../../src/services/auth';

interface NokData { name: string; phone: string; relationship: string }

export default function PersonalInfoScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [editField, setEditField] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const preview = isPreviewSession();

  const { data, isLoading } = useQuery({
    queryKey: ['worker-profile'],
    queryFn: fetchWorkerProfile,
    staleTime: 60_000,
  });

  const w = data?.worker;

  const getValue = (field: string) => {
    if (field in draft) return draft[field];
    if (!w) return '';
    return (w as Record<string, unknown>)[field] ?? '';
  };

  const getNok = (field: string): NokData => {
    if (field in draft) return draft[field] as NokData;
    if (!w) return { name: '', phone: '', relationship: '' };
    const val = (w as Record<string, unknown>)[field];
    return (val && typeof val === 'object' ? val : { name: '', phone: '', relationship: '' }) as NokData;
  };

  const setDraftVal = (field: string, val: unknown) => {
    setDraft(prev => ({ ...prev, [field]: val }));
  };

  const handleSave = useCallback(async () => {
    if (preview) {
      Alert.alert('Preview Mode', 'Editing is disabled in preview mode.');
      return;
    }
    if (Object.keys(draft).length === 0) {
      Alert.alert('No Changes', 'No fields have been modified.');
      return;
    }
    setSaving(true);
    try {
      await selfEditWorkerProfile(draft as SelfEditPayload);
      setDraft({});
      setEditField(null);
      qc.invalidateQueries({ queryKey: ['worker-profile'] });
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Update failed';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  }, [draft, qc, preview]);

  if (isLoading || !w) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <Header onBack={() => router.back()} />
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.orange} />
        </View>
      </View>
    );
  }

  const fullName = `${w.first_name || ''} ${w.last_name || ''}`.trim();
  const hasChanges = Object.keys(draft).length > 0;

  return (
    <View testID="personal-info-screen" style={[s.container, { paddingTop: insets.top }]}>
      <Header onBack={() => router.back()} />

      {preview && (
        <View style={s.previewBanner}>
          <Ionicons name="eye-outline" size={14} color="#92400E" />
          <Text style={s.previewBannerText}>Preview mode — editing disabled</Text>
        </View>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll}>
          <Text style={s.sectionLabel}>IDENTITY (READ-ONLY)</Text>
          <ReadOnlyRow label="Full Name" value={fullName} />
          <ReadOnlyRow label="Date of Birth" value={w.birth_date || '—'} />
          <ReadOnlyRow label="Employee ID" value={(w as any).simpro_employee_id || '—'} />
          <ReadOnlyRow label="Position" value={w.position || '—'} />

          <Text style={s.sectionLabel}>CONTACT {preview ? '(READ-ONLY)' : '(EDITABLE)'}</Text>
          {preview ? (
            <>
              <ReadOnlyRow label="Preferred Name" value={String(getValue('preferred_name') || '—')} />
              <ReadOnlyRow label="Phone" value={String(getValue('phone') || '—')} />
              <ReadOnlyRow label="Mobile" value={String(getValue('mobile') || '—')} />
              <ReadOnlyRow label="Email" value={String(getValue('email') || '—')} />
            </>
          ) : (
            <>
              <EditableRow
                testID="edit-preferred-name"
                label="Preferred Name"
                value={getValue('preferred_name') as string}
                editing={editField === 'preferred_name'}
                onEdit={() => setEditField('preferred_name')}
                onChange={(v) => setDraftVal('preferred_name', v)}
                onDone={() => setEditField(null)}
              />
              <EditableRow
                testID="edit-phone"
                label="Phone"
                value={getValue('phone') as string}
                editing={editField === 'phone'}
                onEdit={() => setEditField('phone')}
                onChange={(v) => setDraftVal('phone', v)}
                onDone={() => setEditField(null)}
                keyboardType="phone-pad"
              />
              <EditableRow
                testID="edit-mobile"
                label="Mobile"
                value={getValue('mobile') as string}
                editing={editField === 'mobile'}
                onEdit={() => setEditField('mobile')}
                onChange={(v) => setDraftVal('mobile', v)}
                onDone={() => setEditField(null)}
                keyboardType="phone-pad"
              />
              <EditableRow
                testID="edit-email"
                label="Email"
                value={getValue('email') as string}
                editing={editField === 'email'}
                onEdit={() => setEditField('email')}
                onChange={(v) => setDraftVal('email', v)}
                onDone={() => setEditField(null)}
                keyboardType="email-address"
              />
            </>
          )}

          <Text style={s.sectionLabel}>ADDRESS {preview ? '(READ-ONLY)' : '(EDITABLE)'}</Text>
          {preview ? (
            <>
              <ReadOnlyRow label="Street" value={String(getValue('street_address') || '—')} />
              <ReadOnlyRow label="Suburb" value={String(getValue('suburb') || '—')} />
              <ReadOnlyRow label="State" value={String(getValue('state') || '—')} />
              <ReadOnlyRow label="Postcode" value={String(getValue('postal_code') || '—')} />
            </>
          ) : (
            <>
              <EditableRow
                testID="edit-street"
                label="Street"
                value={getValue('street_address') as string}
                editing={editField === 'street_address'}
                onEdit={() => setEditField('street_address')}
                onChange={(v) => setDraftVal('street_address', v)}
                onDone={() => setEditField(null)}
              />
              <EditableRow
                testID="edit-suburb"
                label="Suburb"
                value={getValue('suburb') as string}
                editing={editField === 'suburb'}
                onEdit={() => setEditField('suburb')}
                onChange={(v) => setDraftVal('suburb', v)}
                onDone={() => setEditField(null)}
              />
              <EditableRow
                testID="edit-state"
                label="State"
                value={getValue('state') as string}
                editing={editField === 'state'}
                onEdit={() => setEditField('state')}
                onChange={(v) => setDraftVal('state', v)}
                onDone={() => setEditField(null)}
              />
              <EditableRow
                testID="edit-postcode"
                label="Postcode"
                value={getValue('postal_code') as string}
                editing={editField === 'postal_code'}
                onEdit={() => setEditField('postal_code')}
                onChange={(v) => setDraftVal('postal_code', v)}
                onDone={() => setEditField(null)}
                keyboardType="number-pad"
              />
            </>
          )}

          {!preview && (
            <>
              <Text style={s.sectionLabel}>NEXT OF KIN (EDITABLE)</Text>
              <NokSection
                testID="edit-nok"
                data={getNok('next_of_kin')}
                editing={editField === 'next_of_kin'}
                onEdit={() => setEditField('next_of_kin')}
                onChange={(v) => setDraftVal('next_of_kin', v)}
                onDone={() => setEditField(null)}
              />

              <Text style={s.sectionLabel}>EMERGENCY CONTACT (EDITABLE)</Text>
              <NokSection
                testID="edit-emergency"
                data={getNok('emergency_contact')}
                editing={editField === 'emergency_contact'}
                onEdit={() => setEditField('emergency_contact')}
                onChange={(v) => setDraftVal('emergency_contact', v)}
                onDone={() => setEditField(null)}
              />
            </>
          )}

          {preview && (
            <>
              <Text style={s.sectionLabel}>NEXT OF KIN (READ-ONLY)</Text>
              <NokReadOnly data={getNok('next_of_kin')} />
              <Text style={s.sectionLabel}>EMERGENCY CONTACT (READ-ONLY)</Text>
              <NokReadOnly data={getNok('emergency_contact')} />
            </>
          )}
        </ScrollView>

        {/* Save bar */}
        {hasChanges && !preview && (
          <View style={s.saveBar}>
            <TouchableOpacity
              testID="personal-save-btn"
              style={[s.saveBtn, saving && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color={Colors.white} />
                  <Text style={s.saveBtnText}>Save Changes</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={s.header}>
      <TouchableOpacity testID="personal-back-btn" style={s.backBtn} onPress={onBack}>
        <Ionicons name="chevron-back" size={24} color={Colors.white} />
      </TouchableOpacity>
      <Text style={s.headerTitle}>Personal Information</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.fieldRow}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={s.fieldValueRO}>{value || '—'}</Text>
    </View>
  );
}

function EditableRow({
  testID, label, value, editing, onEdit, onChange, onDone, keyboardType,
}: {
  testID: string; label: string; value: string;
  editing: boolean; onEdit: () => void; onChange: (v: string) => void; onDone: () => void;
  keyboardType?: 'default' | 'phone-pad' | 'email-address' | 'number-pad';
}) {
  return (
    <View testID={testID} style={s.fieldRow}>
      <Text style={s.fieldLabel}>{label}</Text>
      {editing ? (
        <View style={s.editRow}>
          <TextInput
            testID={`${testID}-input`}
            style={s.editInput}
            value={value || ''}
            onChangeText={onChange}
            onBlur={onDone}
            autoFocus
            keyboardType={keyboardType || 'default'}
          />
          <TouchableOpacity onPress={onDone}>
            <Ionicons name="checkmark" size={20} color={Colors.success} />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={s.valueRow} onPress={onEdit}>
          <Text style={s.fieldValue}>{value || '—'}</Text>
          <Ionicons name="pencil" size={14} color={Colors.orange} />
        </TouchableOpacity>
      )}
    </View>
  );
}

function NokSection({
  testID, data, editing, onEdit, onChange, onDone,
}: {
  testID: string; data: NokData;
  editing: boolean; onEdit: () => void; onChange: (v: NokData) => void; onDone: () => void;
}) {
  if (editing) {
    return (
      <View testID={testID} style={s.nokCard}>
        <TextInput style={s.editInput} placeholder="Name" placeholderTextColor={Colors.textTertiary}
          value={data.name} onChangeText={(v) => onChange({ ...data, name: v })} />
        <TextInput style={[s.editInput, { marginTop: 8 }]} placeholder="Phone" placeholderTextColor={Colors.textTertiary}
          value={data.phone} onChangeText={(v) => onChange({ ...data, phone: v })} keyboardType="phone-pad" />
        <TextInput style={[s.editInput, { marginTop: 8 }]} placeholder="Relationship" placeholderTextColor={Colors.textTertiary}
          value={data.relationship} onChangeText={(v) => onChange({ ...data, relationship: v })} />
        <TouchableOpacity style={s.nokDone} onPress={onDone}>
          <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
          <Text style={s.nokDoneText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <TouchableOpacity testID={testID} style={s.nokCard} onPress={onEdit}>
      <View style={s.nokRow}>
        <Text style={s.nokLabel}>Name</Text>
        <Text style={s.nokValue}>{data.name || '—'}</Text>
      </View>
      <View style={s.nokRow}>
        <Text style={s.nokLabel}>Phone</Text>
        <Text style={s.nokValue}>{data.phone || '—'}</Text>
      </View>
      <View style={s.nokRow}>
        <Text style={s.nokLabel}>Relationship</Text>
        <Text style={s.nokValue}>{data.relationship || '—'}</Text>
      </View>
      <Ionicons name="pencil" size={14} color={Colors.orange} style={{ alignSelf: 'flex-end' }} />
    </TouchableOpacity>
  );
}

function NokReadOnly({ data }: { data: NokData }) {
  return (
    <View style={s.nokCard}>
      <View style={s.nokRow}>
        <Text style={s.nokLabel}>Name</Text>
        <Text style={s.nokValue}>{data.name || '—'}</Text>
      </View>
      <View style={s.nokRow}>
        <Text style={s.nokLabel}>Phone</Text>
        <Text style={s.nokValue}>{data.phone || '—'}</Text>
      </View>
      <View style={s.nokRow}>
        <Text style={s.nokLabel}>Relationship</Text>
        <Text style={s.nokValue}>{data.relationship || '—'}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, paddingBottom: 100 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.navy, paddingHorizontal: 8, paddingVertical: 14,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.white },

  previewBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#FEF3C7', paddingVertical: 8, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: '#FDE68A',
  },
  previewBannerText: { fontSize: 12, fontWeight: '600', color: '#92400E' },

  sectionLabel: {
    fontSize: 11, fontWeight: '800', color: Colors.textTertiary,
    letterSpacing: 1.2, marginTop: 20, marginBottom: 8,
  },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  fieldLabel: { fontSize: 13, color: Colors.textTertiary, fontWeight: '500', width: 100 },
  fieldValueRO: { fontSize: 14, color: Colors.ink, fontWeight: '500', flex: 1, textAlign: 'right' },
  fieldValue: { fontSize: 14, color: Colors.ink, fontWeight: '600', flex: 1, textAlign: 'right', marginRight: 8 },
  valueRow: { flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'flex-end' },
  editRow: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 8 },
  editInput: {
    flex: 1, backgroundColor: Colors.bg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    fontSize: 14, color: Colors.ink, borderWidth: 1, borderColor: Colors.orange,
  },

  nokCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginBottom: 2,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  nokRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  nokLabel: { fontSize: 12, color: Colors.textTertiary },
  nokValue: { fontSize: 14, color: Colors.ink, fontWeight: '500' },
  nokDone: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', marginTop: 10 },
  nokDoneText: { fontSize: 13, color: Colors.success, fontWeight: '600' },

  saveBar: {
    padding: 16, paddingBottom: 24,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.orange, borderRadius: 14, paddingVertical: 16,
  },
  saveBtnText: { color: Colors.white, fontSize: 16, fontWeight: '800' },
});
