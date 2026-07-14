/**
 * CrewGroupCard — v160.3.8.0
 *
 * Visually groups consecutive `worker_picker` fields that share
 * `config.group === "crew"` into a single bordered card with ONE
 * company toggle at the top. The shared company filter propagates
 * to every WorkerPicker inside the group, replacing the per-worker
 * inline toggle.
 *
 * Data model: each worker slot still writes to its own `values[field.id]`
 * key, so the submit payload keeps the standard per-field shape the
 * backend expects.
 */
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../lib/colors';
import WorkerPicker, { type WorkerCompanyFilter } from './WorkerPicker';

type FieldDef = {
  id: string;
  label: string;
  required?: boolean;
  config?: {
    group?: string;
    group_label?: string;
    inline_company_toggle?: boolean;
    company_options?: Array<{ label: string; simpro_id: string }>;
    multi?: boolean;
    [k: string]: any;
  };
  [k: string]: any;
};

type Props = {
  fields: FieldDef[];
  values: Record<string, any>;
  setVal: (fieldId: string, value: any) => void;
  submitAttempted: boolean;
  missingIds: Set<string>;
  onFieldLayout?: (fieldId: string, y: number) => void;
};

export default function CrewGroupCard({
  fields, values, setVal, submitAttempted, missingIds, onFieldLayout,
}: Props) {
  // Derive company options from the first field's config (all share the same).
  const opts: Array<{ label: string; simpro_id: string }> =
    fields[0]?.config?.company_options?.length
      ? fields[0].config.company_options
      : [{ label: 'Paneltec Civil', simpro_id: '2' }, { label: 'Viatec', simpro_id: '3' }];

  const [selectedCompany, setSelectedCompany] = useState(opts[0]);

  const groupLabel = fields[0]?.config?.group_label || 'Crew';

  const companyFilter: WorkerCompanyFilter = {
    simpro_company_id: selectedCompany.simpro_id,
    name: selectedCompany.label,
  };

  const flip = () => {
    const other = opts.find((o) => o.simpro_id !== selectedCompany.simpro_id) || opts[0];
    setSelectedCompany(other);
    // Clear all crew worker values when company flips — prevents
    // cross-company ghost selections.
    for (const f of fields) {
      const v = values[f.id];
      if (f.config?.multi ? (Array.isArray(v) && v.length > 0) : !!v) {
        setVal(f.id, f.config?.multi ? [] : null);
      }
    }
  };

  return (
    <View
      testID="crew-group-card"
      style={s.card}
      onLayout={(e) => {
        // Register layout offset for every field in the group so
        // the missing-fields scroll-to still works.
        if (onFieldLayout) {
          for (const f of fields) {
            onFieldLayout(f.id, e.nativeEvent.layout.y);
          }
        }
      }}
    >
      {/* ── Header row: group label + company toggle ── */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Ionicons name="people" size={16} color={Colors.imBronze} />
          <Text testID="crew-group-label" style={s.groupLabel}>
            {groupLabel.toUpperCase()}
          </Text>
        </View>
        <TouchableOpacity
          testID="crew-company-toggle"
          onPress={flip}
          activeOpacity={0.7}
          style={s.companyToggle}
        >
          <Ionicons name="business" size={13} color={Colors.imInk} />
          <Text testID="crew-company-label" style={s.companyText}>
            {selectedCompany.label}
          </Text>
          <View style={s.divider} />
          <Ionicons name="swap-horizontal" size={13} color={Colors.imInk} />
        </TouchableOpacity>
      </View>

      {/* ── Stacked worker pickers ── */}
      {fields.map((f, idx) => {
        const hasErr = submitAttempted && missingIds.has(f.id);
        return (
          <View
            key={f.id}
            testID={`crew-slot-${f.id}`}
            style={[
              s.slot,
              idx < fields.length - 1 && s.slotDivider,
              hasErr && s.slotError,
            ]}
          >
            <View style={s.slotLabelRow}>
              <Text style={s.slotLabel}>{f.label}</Text>
              {f.required && <Text style={s.reqStar}>*</Text>}
            </View>
            {f.config?.multi ? (
              <WorkerPicker
                label=""
                multi={true}
                value={Array.isArray(values[f.id]) ? values[f.id] : []}
                companyFilter={companyFilter}
                onChange={(ids: string[]) => setVal(f.id, ids)}
                testID={`field-${f.id}`}
              />
            ) : (
              <WorkerPicker
                label=""
                value={values[f.id] || null}
                companyFilter={companyFilter}
                onChange={(wid: string | null) => setVal(f.id, wid)}
                testID={`field-${f.id}`}
              />
            )}
            {hasErr && (
              <View testID={`field-error-${f.id}`} style={s.errorRow}>
                <Ionicons name="alert-circle" size={13} color={Colors.imError} />
                <Text style={s.errorText}>This field is required</Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderWidth: 2,
    borderColor: Colors.imBronze,
    borderRadius: 14,
    backgroundColor: Colors.imSurface,
    marginBottom: 20,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(192,128,64,0.10)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.imBorder,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  groupLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: Colors.imBronze,
  },
  companyToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.orange,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 2,
    borderColor: Colors.orangeLight,
  },
  companyText: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.imInk,
  },
  divider: {
    width: 1,
    height: 12,
    backgroundColor: Colors.imInk,
    opacity: 0.4,
  },
  slot: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  slotDivider: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  slotError: {
    backgroundColor: 'rgba(139,58,58,0.05)',
    borderLeftWidth: 3,
    borderLeftColor: Colors.imError,
  },
  slotLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  slotLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.imInk,
  },
  reqStar: {
    fontSize: 14,
    color: Colors.imError,
    fontWeight: '700',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.imError,
  },
});
