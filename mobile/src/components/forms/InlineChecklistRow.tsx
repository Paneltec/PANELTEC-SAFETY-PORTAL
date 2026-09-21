/**
 * InlineChecklistRow — Service Check Sheet row.
 * .132kc — Ported from web InlineChecklistRow (.132kb).
 *
 * Phone portrait (<600dp): stacked layout (label → pills → notes below)
 * Tablet / landscape (≥600dp): inline one-row layout [Label] [✗] [✓] [NA] [Notes]
 */
import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  useWindowDimensions,
} from 'react-native';
import type { FormField } from '../../services/forms';
import {
  classifyTrinaryOption,
  findTrinaryOption,
  CHECKLIST_TINT,
  PILL_COLORS,
} from '../../lib/checklistDetect';

interface Props {
  radio: FormField;
  notes: FormField;
  radioValue: string | null;
  notesValue: string;
  onRadioChange: (v: string | null) => void;
  onNotesChange: (v: string) => void;
  readOnly?: boolean;
  locked?: boolean;
}

export default function InlineChecklistRow({
  radio, notes, radioValue, notesValue, onRadioChange, onNotesChange, readOnly, locked,
}: Props) {
  const { width } = useWindowDimensions();
  const isWide = width >= 600;
  const selectedKind = radioValue ? classifyTrinaryOption(radioValue) : null;

  const optCross = findTrinaryOption(radio, 'cross');
  const optCheck = findTrinaryOption(radio, 'check');
  const optNa    = findTrinaryOption(radio, 'na');

  const tint = selectedKind ? CHECKLIST_TINT[selectedKind] : null;
  const rowBg = tint ? tint.bg : '#FFFFFF';
  const rowBorder = tint ? tint.border : '#E5E7EB';

  const togglePill = (opt: string) => {
    if (readOnly || locked) return;
    onRadioChange(radioValue === opt ? null : opt);
  };

  const renderPill = (opt: string | null, kind: 'cross' | 'check' | 'na', label: string) => {
    if (!opt) return null;
    const isSelected = radioValue === opt;
    const colors = isSelected ? PILL_COLORS[kind] : PILL_COLORS.unset;
    return (
      <TouchableOpacity
        key={kind}
        testID={`checklist-${kind}-${radio.id}`}
        style={[
          st.pill,
          { backgroundColor: colors.bg },
          isSelected
            ? { borderColor: colors.bg, shadowColor: colors.bg, shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 }
            : { borderColor: PILL_COLORS.unset.border },
        ]}
        onPress={() => togglePill(opt)}
        disabled={readOnly || locked}
        activeOpacity={0.7}
      >
        <Text style={[st.pillText, { color: colors.text }]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  // ── Inline (wide / tablet) layout ──
  if (isWide) {
    return (
      <View
        testID={`checklist-row-${radio.id}`}
        style={[st.rowInline, { backgroundColor: rowBg, borderColor: rowBorder }]}
      >
        <Text style={st.labelInline} numberOfLines={2}>
          {radio.label}
          {radio.required && <Text style={st.required}> *</Text>}
        </Text>
        <View style={st.pillsInline}>
          {renderPill(optCross, 'cross', '✗')}
          {renderPill(optCheck, 'check', '✓')}
          {renderPill(optNa, 'na', 'NA')}
        </View>
        <TextInput
          testID={`checklist-notes-${notes.id}`}
          style={st.notesInline}
          value={notesValue || ''}
          onChangeText={onNotesChange}
          placeholder="Notes"
          placeholderTextColor="#94A3B8"
          editable={!readOnly && !locked}
        />
      </View>
    );
  }

  // ── Stacked (phone portrait) layout ──
  return (
    <View
      testID={`checklist-row-${radio.id}`}
      style={[st.rowStacked, { backgroundColor: rowBg, borderColor: rowBorder }]}
    >
      <Text style={st.labelStacked}>
        {radio.label}
        {radio.required && <Text style={st.required}> *</Text>}
      </Text>
      <View style={st.pillsStacked}>
        {renderPill(optCross, 'cross', '✗')}
        {renderPill(optCheck, 'check', '✓')}
        {renderPill(optNa, 'na', 'NA')}
      </View>
      <TextInput
        testID={`checklist-notes-${notes.id}`}
        style={st.notesStacked}
        value={notesValue || ''}
        onChangeText={onNotesChange}
        placeholder="Notes"
        placeholderTextColor="#94A3B8"
        editable={!readOnly && !locked}
      />
    </View>
  );
}

const st = StyleSheet.create({
  // ── Shared ──
  pill: {
    minWidth: 44, minHeight: 44, borderRadius: 6,
    borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 10,
  },
  pillText: { fontSize: 15, fontWeight: '700' },
  required: { color: '#F43F5E' },

  // ── Inline (tablet ≥600dp) ──
  rowInline: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderRadius: 12,
    paddingVertical: 8, paddingHorizontal: 12,
    marginBottom: 6, gap: 12,
  },
  labelInline: {
    flex: 5, fontSize: 14, fontWeight: '600', color: '#1E293B',
  },
  pillsInline: {
    flex: 3, flexDirection: 'row', alignItems: 'center', gap: 6,
    justifyContent: 'center',
  },
  notesInline: {
    flex: 4, height: 40, paddingHorizontal: 10, borderRadius: 8,
    borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF',
    fontSize: 14, color: '#1E293B',
  },

  // ── Stacked (phone <600dp) ──
  rowStacked: {
    borderWidth: 1, borderRadius: 14,
    padding: 14, marginBottom: 8, gap: 10,
  },
  labelStacked: {
    fontSize: 15, fontWeight: '700', color: '#1E293B',
  },
  pillsStacked: {
    flexDirection: 'row', gap: 8,
  },
  notesStacked: {
    height: 42, paddingHorizontal: 12, borderRadius: 10,
    borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF',
    fontSize: 14, color: '#1E293B',
  },
});
