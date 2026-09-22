/**
 * CollapsibleSectionGroup — SCS collapsible section with header + body.
 * v58.13.132kx — Ported from web CollapsibleSectionGroup (.132kd/.132kd1).
 *
 * Header: chevron + letter/icon badge + label + status pill + +ADD + ✓ALL
 * Body: InlineChecklistRow items + FieldRenderer for regular fields + custom rows
 */
import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FormField } from '../../services/forms';
import InlineChecklistRow from './InlineChecklistRow';
import CustomChecklistRow, { type CustomRow } from './CustomChecklistRow';
import {
  type SectionGroupEntry,
  paletteForSection,
  computeSectionStatus,
  findTrinaryOption,
} from '../../lib/checklistDetect';

interface Props {
  group: SectionGroupEntry;
  expanded: boolean;
  onToggle: () => void;
  values: Record<string, unknown>;
  setField: (id: string, v: unknown) => void;
  readOnly?: boolean;
  customRows: Record<string, CustomRow[]>;
  addCustomRow: (key: string) => void;
  updateCustomRow: (key: string, rowId: string, patch: Partial<CustomRow>) => void;
  deleteCustomRow: (key: string, rowId: string) => void;
  markAllChecked: (key: string, rowId: string, value: string) => void;
  renderField: (field: FormField) => React.ReactNode;
}

export default function CollapsibleSectionGroup({
  group, expanded, onToggle, values, setField, readOnly,
  customRows, addCustomRow, updateCustomRow, deleteCustomRow, markAllChecked,
  renderField,
}: Props) {
  const palette = paletteForSection(group);
  const customRowsForKey = useMemo(() => customRows[group.key] || [], [customRows, group.key]);

  // Include custom rows in status computation
  const entriesForStatus = useMemo(() => {
    const extra = customRowsForKey.map((r) => ({
      kind: 'checklist_row' as const,
      radio: { id: `custom-answer-${r.id}` } as FormField,
      notes: { id: `custom-notes-${r.id}` } as FormField,
    }));
    return [...group.entries, ...extra];
  }, [group.entries, customRowsForKey]);

  const status = computeSectionStatus(
    entriesForStatus as { kind: string; radio?: { id: string }; field?: FormField }[],
    { ...values, ...Object.fromEntries(customRowsForKey.map((r) => [`custom-answer-${r.id}`, r.value])) },
  );

  // Strip leading letter prefix since we show badge separately
  const displayLabel = useMemo(() => {
    const raw = group.header?.label || '';
    if (group.letter) return raw.replace(/^[A-K]\.\s*/, '');
    return raw.replace(/^▪\s*/, '');
  }, [group.header, group.letter]);

  const handleCheckAll = () => {
    if (readOnly) return;
    let filled = 0;
    for (const en of group.entries) {
      if (en.kind === 'checklist_row') {
        const current = values[en.radio.id];
        if (!current) {
          const checkOpt = findTrinaryOption(en.radio, 'check');
          if (checkOpt) { setField(en.radio.id, checkOpt); filled += 1; }
        }
      }
    }
    for (const r of customRowsForKey) {
      if (!r.value) {
        markAllChecked(group.key, r.id, '✓ Check');
        filled += 1;
      }
    }
    if (filled > 0) {
      Alert.alert('✓ All', `${filled} item${filled === 1 ? '' : 's'} marked ✓`);
    }
  };

  const handleAddCustom = () => {
    if (readOnly) return;
    addCustomRow(group.key);
    // Auto-expand when adding a row
    if (!expanded) onToggle();
  };

  return (
    <View
      testID={`section-group-${group.key}`}
      style={[
        st.wrapper,
        {
          backgroundColor: expanded ? '#FFFFFF' : palette.tint,
          borderColor: palette.accent + '55',
          borderLeftColor: palette.accent,
        },
      ]}
    >
      {/* Header row */}
      <TouchableOpacity
        testID={`section-toggle-${group.key}`}
        style={st.header}
        onPress={onToggle}
        activeOpacity={0.7}
      >
        {/* Chevron */}
        <Ionicons
          name={expanded ? 'chevron-down' : 'chevron-forward'}
          size={18}
          color="#64748B"
        />

        {/* Badge */}
        {group.letter ? (
          <View testID={`section-badge-${group.key}`} style={[st.badge, { backgroundColor: palette.badge }]}>
            <Text style={st.badgeText}>{group.letter}</Text>
          </View>
        ) : group.icon === 'gauge' ? (
          <View style={[st.badge, { backgroundColor: palette.badge }]}>
            <Ionicons name="speedometer-outline" size={16} color="#FFFFFF" />
          </View>
        ) : group.icon === 'clipboard' ? (
          <View style={[st.badge, { backgroundColor: palette.badge }]}>
            <Ionicons name="clipboard-outline" size={16} color="#FFFFFF" />
          </View>
        ) : null}

        {/* Label */}
        <Text style={st.headerLabel} numberOfLines={1}>{displayLabel}</Text>

        {/* Status pill */}
        <View testID={`section-status-${group.key}`} style={[st.statusPill, { backgroundColor: status.bg }]}>
          <Text style={[st.statusText, { color: status.fg }]}>{status.key}</Text>
        </View>
      </TouchableOpacity>

      {/* Action chips row (below header, above body) */}
      {!readOnly && group.hasTrinary && (
        <View style={st.chipsRow}>
          <TouchableOpacity
            testID={`section-add-${group.key}`}
            style={st.addChip}
            onPress={handleAddCustom}
            activeOpacity={0.7}
          >
            <Ionicons name="add" size={12} color="#7C3AED" />
            <Text style={st.addChipText}>ADD</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID={`section-check-all-${group.key}`}
            style={st.checkAllChip}
            onPress={handleCheckAll}
            activeOpacity={0.7}
          >
            <Ionicons name="checkmark-done" size={12} color="#047857" />
            <Text style={st.checkAllText}>ALL</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Body */}
      {expanded && (
        <View testID={`section-body-${group.key}`} style={st.body}>
          {group.entries.map((en) => {
            if (en.kind === 'checklist_row') {
              return (
                <InlineChecklistRow
                  key={en.radio.id}
                  radio={en.radio}
                  notes={en.notes}
                  radioValue={(values[en.radio.id] as string) || null}
                  notesValue={(values[en.notes.id] as string) || ''}
                  onRadioChange={(v) => setField(en.radio.id, v)}
                  onNotesChange={(v) => setField(en.notes.id, v)}
                  readOnly={readOnly}
                />
              );
            }
            // Regular field inside section (e.g. tread depth numbers)
            return (
              <View key={en.field.id} style={st.regularFieldWrap}>
                {renderField(en.field)}
              </View>
            );
          })}
          {/* Custom rows */}
          {customRowsForKey.map((row) => (
            <CustomChecklistRow
              key={row.id}
              row={row}
              onLabelChange={(label) => updateCustomRow(group.key, row.id, { label })}
              onValueChange={(v) => updateCustomRow(group.key, row.id, { value: v })}
              onNotesChange={(v) => updateCustomRow(group.key, row.id, { notes: v })}
              onDelete={() => deleteCustomRow(group.key, row.id)}
              readOnly={readOnly}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  wrapper: {
    borderWidth: 1, borderRadius: 14, overflow: 'hidden', marginBottom: 10,
    borderLeftWidth: 4,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 12,
    minHeight: 52,
  },
  badge: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeText: {
    fontSize: 14, fontWeight: '900', color: '#FFFFFF',
  },
  headerLabel: {
    flex: 1, fontSize: 14, fontWeight: '700', color: '#1E293B',
  },
  statusPill: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
  },
  statusText: {
    fontSize: 9, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase',
  },
  chipsRow: {
    flexDirection: 'row', gap: 6,
    paddingHorizontal: 12, paddingBottom: 8,
    marginTop: -4,
  },
  addChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#EDE9FE', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 5,
  },
  addChipText: {
    fontSize: 10, fontWeight: '900', color: '#7C3AED', letterSpacing: 0.5,
  },
  checkAllChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#D1FAE5', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 5,
  },
  checkAllText: {
    fontSize: 10, fontWeight: '900', color: '#047857', letterSpacing: 0.5,
  },
  body: {
    paddingHorizontal: 8, paddingBottom: 10, paddingTop: 4,
  },
  regularFieldWrap: {
    backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 10,
    padding: 8, marginBottom: 6,
  },
});
