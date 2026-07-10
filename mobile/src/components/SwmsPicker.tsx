/**
 * SwmsPicker — searchable picker for the `swms_picker` field type
 * (v160.2.4). Same UX as WorkerPicker: single-select closes on tap,
 * multi keeps the modal open and shows chips above the trigger.
 *
 * Data source: `GET /api/swms` (existing endpoint). Workers only see
 * SWMS documents their role permits — access control is inherited
 * from the existing permission matrix, not enforced here.
 * Superseded entries are filtered client-side so pickers never surface
 * an old revision.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Modal, FlatList,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../lib/api';
import { Colors } from '../lib/colors';

type SwmsDoc = {
  id: string;
  title?: string;
  version?: number | string;
  status?: string;
  scope?: string;
};

type SingleProps = {
  required?: boolean;
  value: string | null;
  onChange: (swmsId: string | null) => void;
  testID?: string;
  multi?: false;
};

type MultiProps = {
  required?: boolean;
  value: string[];
  onChange: (swmsIds: string[]) => void;
  testID?: string;
  multi: true;
};

const STATUS_STYLE: Record<string, { bg: string; ink: string }> = {
  approved: { bg: 'rgba(107,127,92,0.15)', ink: Colors.imSuccess },
  submitted: { bg: 'rgba(192,128,64,0.15)', ink: Colors.imWarning },
  draft:    { bg: Colors.imConcrete, ink: Colors.imInkMuted },
  rejected: { bg: 'rgba(139,58,58,0.12)', ink: Colors.imError },
};

function statusStyle(status?: string) {
  return STATUS_STYLE[(status || 'draft').toLowerCase()] || STATUS_STYLE.draft;
}

function swmsLabel(s: SwmsDoc): string {
  const title = (s.title || 'Untitled SWMS').trim();
  const rev = s.version != null ? ` · v${s.version}` : '';
  return `${title}${rev}`;
}

export default function SwmsPicker(props: SingleProps | MultiProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SwmsDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    setBusy(true);
    api.get('/swms').then(({ data }) => {
      if (!alive) return;
      const docs = (Array.isArray(data) ? data : []).filter((s: SwmsDoc) => {
        const st = (s.status || '').toLowerCase();
        return st !== 'superseded' && st !== 'deleted';
      });
      setRows(docs);
    }).catch((e) => {
      if (alive) setErr(apiError(e));
    }).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, []);

  const byId = useMemo(() => {
    const m: Record<string, SwmsDoc> = {};
    rows.forEach((r) => { m[r.id] = r; });
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((s) =>
      (s.title || '').toLowerCase().includes(needle) ||
      String(s.version || '').toLowerCase().includes(needle)
    );
  }, [rows, q]);

  const multi = !!props.multi;
  const value = props.value;
  const selectedIds: string[] = multi
    ? (Array.isArray(value) ? value : [])
    : (value ? [value as string] : []);
  const selectedDocs = selectedIds.map((id) => byId[id]).filter(Boolean) as SwmsDoc[];

  const toggle = (id: string) => {
    if (multi) {
      const set = new Set(selectedIds);
      if (set.has(id)) set.delete(id); else set.add(id);
      (props.onChange as MultiProps['onChange'])([...set]);
    } else {
      (props.onChange as SingleProps['onChange'])(id);
      setOpen(false);
    }
  };

  const remove = (id: string) => {
    if (multi) {
      (props.onChange as MultiProps['onChange'])(selectedIds.filter((x) => x !== id));
    } else {
      (props.onChange as SingleProps['onChange'])(null);
    }
  };

  const triggerLabel = (() => {
    if (selectedDocs.length === 0) {
      return multi ? 'Select SWMS' : 'Select a SWMS';
    }
    if (!multi) return swmsLabel(selectedDocs[0]);
    return `${selectedDocs.length} SWMS selected`;
  })();

  return (
    <View testID={props.testID}>
      <TouchableOpacity
        testID={`${props.testID}-open`}
        style={s.trigger}
        onPress={() => setOpen(true)}
        activeOpacity={0.75}
      >
        <Ionicons name="document-text" size={16} color={Colors.imBronze} />
        <Text
          style={[s.triggerText, selectedDocs.length === 0 && { color: Colors.textTertiary }]}
          numberOfLines={1}
        >
          {triggerLabel}
        </Text>
        <Ionicons name="chevron-down" size={14} color={Colors.textTertiary} />
      </TouchableOpacity>

      {multi && selectedDocs.length > 0 && (
        <View style={s.chipsRow}>
          {selectedDocs.map((d) => {
            const st = statusStyle(d.status);
            return (
              <View key={d.id} testID={`swms-chip-${d.id}`} style={s.chip}>
                <View style={[s.chipDot, { backgroundColor: st.ink }]} />
                <Text style={s.chipText} numberOfLines={1}>{swmsLabel(d)}</Text>
                <TouchableOpacity
                  testID={`swms-chip-remove-${d.id}`}
                  onPress={() => remove(d.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={14} color={Colors.textTertiary} />
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      <Modal
        visible={open}
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        transparent={false}
      >
        <View style={s.modalRoot}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>{multi ? 'Select SWMS · multiple' : 'Select a SWMS'}</Text>
            <TouchableOpacity testID={`${props.testID}-close`} onPress={() => setOpen(false)}>
              <Ionicons name="close" size={22} color={Colors.textTertiary} />
            </TouchableOpacity>
          </View>
          <View style={s.searchRow}>
            <Ionicons name="search" size={14} color={Colors.textTertiary} />
            <TextInput
              testID={`${props.testID}-search`}
              value={q}
              onChangeText={setQ}
              placeholder="Search SWMS title or revision…"
              placeholderTextColor={Colors.textTertiary}
              style={s.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {q.length > 0 && (
              <TouchableOpacity onPress={() => setQ('')}>
                <Ionicons name="close-circle" size={14} color={Colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>

          {busy ? (
            <View style={s.center}>
              <ActivityIndicator color={Colors.imBronze} />
              <Text style={s.hint}>Loading SWMS…</Text>
            </View>
          ) : err ? (
            <View style={s.center}>
              <Ionicons name="alert-circle" size={18} color={Colors.imError} />
              <Text style={[s.hint, { color: Colors.imError }]}>{err}</Text>
            </View>
          ) : filtered.length === 0 ? (
            <View style={s.center}>
              <Text style={s.hint}>
                {q ? 'No SWMS match that search.' : 'No SWMS documents accessible to your account.'}
              </Text>
            </View>
          ) : (
            <FlatList
              testID={`${props.testID}-list`}
              data={filtered}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingBottom: 24 }}
              renderItem={({ item }) => {
                const st = statusStyle(item.status);
                const picked = selectedIds.includes(item.id);
                return (
                  <TouchableOpacity
                    testID={`swms-row-${item.id}`}
                    style={[s.row, picked && s.rowPicked]}
                    onPress={() => toggle(item.id)}
                    activeOpacity={0.75}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowTitle} numberOfLines={1}>{item.title || 'Untitled'}</Text>
                      <View style={s.rowMeta}>
                        {item.version != null && (
                          <Text style={s.rowRev}>v{item.version}</Text>
                        )}
                        <View style={[s.statusPill, { backgroundColor: st.bg }]}>
                          <Text style={[s.statusText, { color: st.ink }]}>
                            {(item.status || '—').toUpperCase()}
                          </Text>
                        </View>
                      </View>
                    </View>
                    {picked && (
                      <Ionicons name="checkmark-circle" size={22} color={Colors.imBronze} />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          )}
          {multi && (
            <View style={s.modalFooter}>
              <TouchableOpacity
                testID={`${props.testID}-done`}
                onPress={() => setOpen(false)}
                style={s.doneBtn}
                activeOpacity={0.8}
              >
                <Text style={s.doneText}>Done · {selectedIds.length}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.imSurface, borderWidth: 1, borderColor: Colors.imBorder,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12,
  },
  triggerText: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.imInk },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.imConcrete, borderWidth: 1, borderColor: Colors.imBorder,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, maxWidth: '100%',
  },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { fontSize: 12, fontWeight: '600', color: Colors.imInk, maxWidth: 220 },
  modalRoot: { flex: 1, backgroundColor: Colors.bg },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.imBorder,
    backgroundColor: Colors.imSurface,
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: Colors.imInk, letterSpacing: -0.2 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: Colors.imSurface,
    borderBottomWidth: 1, borderBottomColor: Colors.imBorder,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.imInk, paddingVertical: 4 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 8 },
  hint: { fontSize: 13, color: Colors.textTertiary, textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
    backgroundColor: Colors.imSurface,
  },
  rowPicked: { backgroundColor: 'rgba(192,128,64,0.08)' },
  rowTitle: { fontSize: 14, fontWeight: '700', color: Colors.imInk },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  rowRev: { fontSize: 11, fontWeight: '700', color: Colors.imBronze, letterSpacing: 0.5 },
  statusPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  modalFooter: {
    padding: 12, borderTopWidth: 1, borderTopColor: Colors.imBorder,
    backgroundColor: Colors.imSurface,
  },
  doneBtn: {
    backgroundColor: Colors.imBronze, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  doneText: { color: Colors.imSurface, fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
});
