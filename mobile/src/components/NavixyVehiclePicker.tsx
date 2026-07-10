/**
 * NavixyVehiclePicker — searchable dropdown for the `vehicle_navixy`
 * form-field type. Fetches the Paneltec fleet from
 * `GET /api/forms/fleet/vehicles` (a lightweight worker-safe proxy over
 * the Navixy vehicle list — see `backend/forms.py:list_fleet_for_forms`).
 *
 * Deliberately mirrors `WorkerPicker` UX so any operator already
 * familiar with picking their name from a form recognises the flow:
 *   • Tight rows (44px tap targets, per v160.0.12.3 density spec)
 *   • Free-text search filters client-side by rego / label / vehicle_type
 *   • Single-select — writes the selected vehicle id into the form state
 *
 * v160.1.3 — introduced for the Vehicle Pre-Use Inspection rework. The
 * autofill map in `forms/fill/[id].tsx` already writes into
 * `vehicle_navixy` fields when a Vehicle QR is scanned, so this picker
 * automatically picks up the scanned vehicle id as its `value`.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Modal, FlatList,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../lib/api';
import { Colors } from '../lib/colors';

type Vehicle = {
  id: string | number;
  label?: string;
  plate?: string;
  registration?: string;
  vehicle_type?: string;
  tags?: { name?: string }[];
};

type Props = {
  label: string;
  required?: boolean;
  value: string | null;
  onChange: (vehicleId: string | null, vehicle?: Vehicle) => void;
  testID?: string;
  placeholder?: string;
};

export default function NavixyVehiclePicker(props: Props) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    let ok = true;
    setBusy(true);
    setErr(null);
    api.get('/forms/fleet/vehicles')
      .then(({ data }) => {
        if (!ok) return;
        const list: Vehicle[] = (data?.vehicles || []).map((v: Vehicle) => ({
          ...v,
          id: String(v.id),
        }));
        setVehicles(list);
      })
      .catch((e) => { if (ok) setErr(apiError(e)); })
      .finally(() => { if (ok) setBusy(false); });
    return () => { ok = false; };
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return vehicles;
    return vehicles.filter((v) => {
      const rego = (v.registration || v.plate || '').toLowerCase();
      const label = (v.label || '').toLowerCase();
      const vt = (v.vehicle_type || '').toLowerCase();
      return rego.includes(term) || label.includes(term) || vt.includes(term);
    });
  }, [q, vehicles]);

  const displayOf = (v?: Vehicle) => {
    if (!v) return '';
    const rego = v.registration || v.plate || '';
    const lbl = v.label || '';
    if (rego && lbl && lbl !== rego) return `${rego} · ${lbl}`;
    return rego || lbl || String(v.id);
  };

  const selected = vehicles.find((v) => String(v.id) === String(props.value));
  const triggerText = selected
    ? displayOf(selected)
    : `Select vehicle · ${vehicles.length}`;

  const isSelected = (id: string | number) => String(id) === String(props.value);

  const pick = (v: Vehicle) => {
    props.onChange(String(v.id), v);
    setOpen(false);
    setQ('');
  };

  return (
    <View>
      <Text style={s.label}>{props.label}{props.required ? ' *' : ''}</Text>
      <TouchableOpacity
        testID={props.testID || 'vehicle-picker-trigger'}
        style={s.trigger}
        onPress={() => setOpen(true)}
        activeOpacity={0.75}
      >
        <Ionicons name="car-sport" size={16} color={Colors.orangeLight} />
        <Text style={[s.triggerText, !props.value && s.triggerPlaceholder]}>
          {triggerText}
        </Text>
        <Ionicons name="chevron-down" size={16} color={Colors.textTertiary} />
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{props.label}</Text>
              <TouchableOpacity testID="vehicle-picker-close" onPress={() => setOpen(false)}>
                <Ionicons name="close" size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={s.searchWrap}>
              <Ionicons name="search" size={16} color={Colors.textTertiary} />
              <TextInput
                testID="vehicle-picker-search"
                style={s.searchInput}
                value={q}
                onChangeText={setQ}
                placeholder="Search by rego, label or type"
                placeholderTextColor={Colors.placeholder}
                autoFocus
              />
            </View>
            {busy && <ActivityIndicator style={{ margin: 24 }} color={Colors.orange} />}
            {err && <Text style={s.err}>{err}</Text>}
            {!busy && !err && filtered.length === 0 && (
              <Text style={s.empty}>No matching vehicles.</Text>
            )}
            <FlatList
              data={filtered}
              keyExtractor={(v) => String(v.id)}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const rego = item.registration || item.plate || '';
                const lbl = item.label || '';
                return (
                  <TouchableOpacity
                    testID={`vehicle-option-${item.id}`}
                    style={[s.row, isSelected(item.id) && s.rowSelected]}
                    onPress={() => pick(item)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowName}>{rego || lbl || String(item.id)}</Text>
                      {(lbl && lbl !== rego) || item.vehicle_type ? (
                        <Text style={s.rowMeta}>
                          {[lbl && lbl !== rego ? lbl : null, item.vehicle_type]
                            .filter(Boolean).join(' · ')}
                        </Text>
                      ) : null}
                    </View>
                    {isSelected(item.id) && (
                      <Ionicons name="checkmark" size={20} color={Colors.orange} />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '500', color: Colors.textSecondary, marginBottom: 6, marginTop: 12 },
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
});
