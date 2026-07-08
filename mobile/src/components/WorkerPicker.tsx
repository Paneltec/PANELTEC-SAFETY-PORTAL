/**
 * WorkerPicker — searchable dropdown that lists workers from
 * `GET /api/workers`. Non-privileged callers only see their own worker
 * (v160.0.8 scoping), so admins/HSEQ operators actually see the crew.
 *
 * Single-select by default. Pass `multi` to enable multi-select for
 * pre-start crew rosters.
 *
 * v160.0.10.1 — introduced for Hazard/Pre-Start/Incident/Plant Inspection.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Modal, FlatList,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../lib/api';
import { Colors } from '../lib/colors';

type Worker = {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  trade?: string;
  role?: string;
  company?: string;
  company_label?: string;
  simpro_company_id?: string | number;
  active?: boolean;
};

/** v160.0.12.2 — When set, only workers whose `simpro_company_id` (or
 *  `company_label`) match the filter are shown. Used by the Heavy
 *  Equipment Pre-Op form's Operator / Reported To pickers to scope the
 *  crew list to the currently-selected trading company. */
export type WorkerCompanyFilter = {
  simpro_company_id?: string | null;
  name?: string | null;
};

type SingleProps = {
  label: string;
  required?: boolean;
  value: string | null;
  onChange: (workerId: string | null, worker?: Worker) => void;
  testID?: string;
  multi?: false;
  companyFilter?: WorkerCompanyFilter | null;
  hint?: string | null;
};
type MultiProps = {
  label: string;
  required?: boolean;
  value: string[];
  onChange: (workerIds: string[], workers?: Worker[]) => void;
  testID?: string;
  multi: true;
  companyFilter?: WorkerCompanyFilter | null;
  hint?: string | null;
};

export default function WorkerPicker(props: SingleProps | MultiProps) {
  const [open, setOpen] = useState(false);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let ok = true;
    setBusy(true);
    api.get('/workers').then(({ data }) => {
      if (!ok) return;
      // Only ever include active workers to keep the picker clean.
      setWorkers((data || []).filter((w: Worker) => w.active !== false));
    }).catch((e) => {
      if (ok) setErr(apiError(e));
    }).finally(() => { if (ok) setBusy(false); });
    return () => { ok = false; };
  }, []);

  // v160.0.12.2 — pre-filter by company (if provided) BEFORE applying the
  // search term. Match by simpro_company_id first (exact), otherwise fall
  // back to a case-insensitive `company_label` compare (Simpro name).
  const companyScoped = useMemo(() => {
    const cf = props.companyFilter;
    if (!cf || (!cf.simpro_company_id && !cf.name)) return workers;
    const cid = cf.simpro_company_id != null ? String(cf.simpro_company_id) : null;
    const nm = (cf.name || '').trim().toLowerCase();
    return workers.filter((w) => {
      if (cid && String(w.simpro_company_id ?? '') === cid) return true;
      const label = (w.company_label || w.company || '').toLowerCase();
      if (nm && (label === nm || label.includes(nm) || nm.includes(label))) return true;
      return false;
    });
  }, [workers, props.companyFilter]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return companyScoped;
    return companyScoped.filter((w) => {
      const name = `${w.first_name || ''} ${w.last_name || ''}`.toLowerCase();
      const company = (w.company_label || w.company || '').toLowerCase();
      const trade = (w.trade || w.role || '').toLowerCase();
      return name.includes(term) || company.includes(term) || trade.includes(term);
    });
  }, [q, companyScoped]);

  const nameOf = (w?: Worker) =>
    w ? `${w.first_name || ''} ${w.last_name || ''}`.trim() || (w.email || 'Unknown') : '';

  // Compute label text for the trigger button
  const triggerText = (() => {
    if (props.multi) {
      const ids = props.value || [];
      if (ids.length === 0) return `Select workers · ${companyScoped.length}`;
      if (ids.length === 1) return nameOf(workers.find(w => w.id === ids[0])) || '1 worker';
      return `${ids.length} workers`;
    }
    const found = workers.find(w => w.id === props.value);
    if (found) return nameOf(found);
    return `Select worker · ${companyScoped.length}`;
  })();

  const isSelected = (id: string) =>
    props.multi ? (props.value || []).includes(id) : props.value === id;

  const toggle = (w: Worker) => {
    if (props.multi) {
      const cur = props.value || [];
      const next = cur.includes(w.id) ? cur.filter(x => x !== w.id) : [...cur, w.id];
      const wobjs = workers.filter(x => next.includes(x.id));
      props.onChange(next, wobjs);
    } else {
      props.onChange(w.id, w);
      setOpen(false);
    }
  };

  return (
    <View>
      <Text style={s.label}>{props.label}{props.required ? ' *' : ''}</Text>
      <TouchableOpacity
        testID={props.testID || 'worker-picker-trigger'}
        style={s.trigger}
        onPress={() => setOpen(true)}
        activeOpacity={0.75}
      >
        <Ionicons name="person" size={16} color={Colors.orangeLight} />
        <Text style={[s.triggerText, !props.value && s.triggerPlaceholder]}>{triggerText}</Text>
        <Ionicons name="chevron-down" size={16} color={Colors.textTertiary} />
      </TouchableOpacity>
      {props.hint ? (
        <Text testID={(props.testID || 'worker-picker') + '-hint'} style={s.hint}>{props.hint}</Text>
      ) : null}

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{props.label}</Text>
              <TouchableOpacity testID="worker-picker-close" onPress={() => setOpen(false)}>
                <Ionicons name="close" size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={s.searchWrap}>
              <Ionicons name="search" size={16} color={Colors.textTertiary} />
              <TextInput
                testID="worker-picker-search"
                style={s.searchInput}
                value={q}
                onChangeText={setQ}
                placeholder="Search by name, trade or company"
                placeholderTextColor={Colors.placeholder}
                autoFocus
              />
            </View>
            {busy && <ActivityIndicator style={{ margin: 24 }} color={Colors.orange} />}
            {err && <Text style={s.err}>{err}</Text>}
            {!busy && !err && filtered.length === 0 && (
              <Text style={s.empty}>No matching workers.</Text>
            )}
            <FlatList
              data={filtered}
              keyExtractor={(w) => w.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  testID={`worker-option-${item.id}`}
                  style={[s.row, isSelected(item.id) && s.rowSelected]}
                  onPress={() => toggle(item)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowName}>{nameOf(item)}</Text>
                    {/* v160.0.12.4 — company suffix dropped; the top toggle
                        already scopes the list. Meta hidden if empty. */}
                    {(item.trade || item.role) ? (
                      <Text style={s.rowMeta}>{item.trade || item.role}</Text>
                    ) : null}
                  </View>
                  {isSelected(item.id) && (
                    <Ionicons name="checkmark" size={20} color={Colors.orange} />
                  )}
                </TouchableOpacity>
              )}
            />
            {props.multi && (
              <TouchableOpacity
                testID="worker-picker-done"
                style={s.doneBtn}
                onPress={() => setOpen(false)}
              >
                <Text style={s.doneBtnText}>Done</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '500', color: Colors.textSecondary, marginBottom: 6, marginTop: 12 },
  hint: { fontSize: 11, color: Colors.textTertiary, marginTop: 6, fontStyle: 'italic' },
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    backgroundColor: Colors.surfaceLight,
    paddingHorizontal: 12, paddingVertical: 12,
  },
  triggerText: { flex: 1, fontSize: 14, color: Colors.ink, fontWeight: '500' },
  triggerPlaceholder: { color: Colors.placeholder, fontWeight: '400' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(2,6,23,0.72)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: 16, maxHeight: '85%',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: Colors.ink },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    backgroundColor: Colors.surfaceLight, paddingHorizontal: 12, marginBottom: 8,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: Colors.ink },
  err: { color: Colors.red, padding: 12, fontSize: 13 },
  empty: { color: Colors.textTertiary, padding: 20, textAlign: 'center', fontSize: 13 },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight, minHeight: 44,
  },
  rowSelected: { backgroundColor: Colors.orangeSoft, borderRadius: 8 },
  rowName: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  rowMeta: { fontSize: 11, color: Colors.textTertiary, marginTop: 1 },
  doneBtn: {
    backgroundColor: Colors.orange, paddingVertical: 12, borderRadius: 10,
    alignItems: 'center', marginTop: 10,
  },
  doneBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 }, // linter-ok: pure white on brand orange
});
