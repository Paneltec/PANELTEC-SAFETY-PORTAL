/**
 * CustomChecklistRow — editable trinary row added via "+ ADD".
 * v58.13.132kx — Ported from web CustomChecklistRow (.132kd).
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { classifyTrinaryOption, PILL_COLORS, CHECKLIST_TINT } from '../../lib/checklistDetect';

export interface CustomRow {
  id: string;
  label: string;
  value: string | null;
  notes: string;
}

interface Props {
  row: CustomRow;
  onLabelChange: (label: string) => void;
  onValueChange: (v: string | null) => void;
  onNotesChange: (v: string) => void;
  onDelete: () => void;
  readOnly?: boolean;
}

export default function CustomChecklistRow({
  row, onLabelChange, onValueChange, onNotesChange, onDelete, readOnly,
}: Props) {
  const [editing, setEditing] = useState(!row.label);
  const [draft, setDraft] = useState(row.label || '');
  const selectedKind = classifyTrinaryOption(row.value);
  const tint = selectedKind ? CHECKLIST_TINT[selectedKind] : null;

  const commit = () => {
    setEditing(false);
    if (draft !== row.label) onLabelChange(draft);
  };

  const toggle = (opt: string) => {
    if (readOnly) return;
    onValueChange(row.value === opt ? null : opt);
  };

  const renderPill = (label: string, opt: string, kind: 'cross' | 'check' | 'na') => {
    const isSelected = row.value === opt;
    const colors = isSelected ? PILL_COLORS[kind] : PILL_COLORS.unset;
    return (
      <TouchableOpacity
        key={kind}
        testID={`custom-${kind}-${row.id}`}
        style={[
          st.pill,
          { backgroundColor: colors.bg },
          isSelected
            ? { borderColor: colors.bg }
            : { borderColor: PILL_COLORS.unset.border },
        ]}
        onPress={() => toggle(opt)}
        disabled={readOnly}
        activeOpacity={0.7}
      >
        <Text style={[st.pillText, { color: colors.text }]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View
      testID={`custom-row-${row.id}`}
      style={[
        st.container,
        tint ? { backgroundColor: tint.bg, borderColor: tint.border } : {},
      ]}
    >
      <View style={st.labelRow}>
        {editing ? (
          <TextInput
            testID={`custom-label-input-${row.id}`}
            style={st.labelInput}
            value={draft}
            onChangeText={setDraft}
            onBlur={commit}
            onSubmitEditing={commit}
            placeholder="Custom item..."
            placeholderTextColor="#94A3B8"
            autoFocus
          />
        ) : (
          <TouchableOpacity
            testID={`custom-label-${row.id}`}
            style={st.labelBtn}
            onPress={() => !readOnly && setEditing(true)}
          >
            <Text style={st.labelText} numberOfLines={2}>
              {row.label || 'Custom item...'}
            </Text>
          </TouchableOpacity>
        )}
        {!readOnly && (
          <TouchableOpacity
            testID={`custom-delete-${row.id}`}
            style={st.deleteBtn}
            onPress={onDelete}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close-circle" size={18} color="#94A3B8" />
          </TouchableOpacity>
        )}
      </View>
      <View style={st.pillsRow}>
        {renderPill('✗', '✗ Repair', 'cross')}
        {renderPill('✓', '✓ Check', 'check')}
        {renderPill('NA', 'N/A', 'na')}
      </View>
      <TextInput
        testID={`custom-notes-${row.id}`}
        style={st.notesInput}
        value={row.notes || ''}
        onChangeText={onNotesChange}
        placeholder="Notes"
        placeholderTextColor="#94A3B8"
        editable={!readOnly}
      />
    </View>
  );
}

const st = StyleSheet.create({
  container: {
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12,
    padding: 12, marginBottom: 6, backgroundColor: '#FAFAFA',
    borderLeftWidth: 3, borderLeftColor: '#8B5CF6',
  },
  labelRow: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 8,
  },
  labelInput: {
    flex: 1, height: 36, paddingHorizontal: 10, borderRadius: 8,
    borderWidth: 1, borderColor: '#8B5CF6', backgroundColor: '#FFFFFF',
    fontSize: 14, color: '#1E293B',
  },
  labelBtn: { flex: 1 },
  labelText: { fontSize: 14, fontWeight: '600', color: '#1E293B' },
  deleteBtn: { marginLeft: 8, padding: 2 },
  pillsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  pill: {
    minWidth: 44, minHeight: 44, borderRadius: 6,
    borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 10,
  },
  pillText: { fontSize: 15, fontWeight: '700' },
  notesInput: {
    height: 40, paddingHorizontal: 12, borderRadius: 10,
    borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF',
    fontSize: 14, color: '#1E293B',
  },
});
