import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../lib/api';
import { Colors } from '../lib/colors';

const CLIENT_SRC_LABELS: Record<string, string> = {
  paneltec: 'Paneltec',
  viatec: 'Viatec',
  both: 'Both',
};

function CompanyChip({ label }: { label: string }) {
  const tints: Record<string, { bg: string; text: string }> = {
    Paneltec: { bg: '#e6eff9', text: '#1e4a8c' },
    Viatec:   { bg: '#ece6f4', text: '#4f3a8c' },
  };
  const c = tints[label] || { bg: '#F1F5F9', text: '#475569' };
  return (
    <View style={[st.chip, { backgroundColor: c.bg }]}>
      <Text style={[st.chipText, { color: c.text }]}>{label}</Text>
    </View>
  );
}

export default function ClientPickerModal({ company, selectedIds, onClose, onApply }: {
  company: string; selectedIds: string[]; onClose: () => void; onApply: (ids: string[]) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(selectedIds || []));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/integrations/simpro/customers?company=${company}`);
        if (!cancelled) setCustomers(data.customers || []);
      } catch (e: any) {
        if (!cancelled) Alert.alert('Error', apiError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [company]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q));
  }, [customers, search]);

  const toggle = (id: string) => {
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const selectAll = () => setPicked(new Set([...picked, ...filtered.map((c) => c.simpro_customer_id)]));
  const clearAll = () => setPicked(new Set());

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
        {/* Header */}
        <View testID="client-picker" style={st.header}>
          <View style={{ flex: 1 }}>
            <Text style={st.headerOverline}>SIMPRO CUSTOMERS</Text>
            <Text style={st.headerTitle}>Pick clients ({CLIENT_SRC_LABELS[company] || company})</Text>
          </View>
          <TouchableOpacity testID="client-picker-close" onPress={onClose} style={{ padding: 6 }}>
            <Ionicons name="close" size={22} color={Colors.textTertiary} />
          </TouchableOpacity>
        </View>

        {/* Search + actions */}
        <View style={st.searchRow}>
          <View style={st.searchBox}>
            <Ionicons name="search" size={13} color={Colors.textTertiary} />
            <TextInput
              testID="client-picker-search"
              style={st.searchInput}
              placeholder="Search customers…"
              placeholderTextColor={Colors.textTertiary}
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
            />
          </View>
          <Text testID="client-picker-count" style={st.countText}>
            {picked.size} of {customers.length}
          </Text>
        </View>
        <View style={st.actionRow}>
          <TouchableOpacity testID="client-picker-select-all" style={[st.actionBtn, { backgroundColor: '#e6eff9' }]} onPress={selectAll}>
            <Text style={[st.actionBtnText, { color: '#1e4a8c' }]}>Select filtered</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="client-picker-clear-all" style={[st.actionBtn, { backgroundColor: '#F1F5F9' }]} onPress={clearAll}>
            <Text style={[st.actionBtnText, { color: '#475569' }]}>Clear all</Text>
          </TouchableOpacity>
        </View>

        {/* List */}
        {loading ? (
          <View style={st.loadingWrap}>
            <ActivityIndicator color="#1e4a8c" />
            <Text style={st.loadingText}>Loading customers from Simpro…</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={st.loadingWrap}>
            <Text style={st.loadingText}>No customers match.</Text>
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
            {filtered.slice(0, 500).map((c) => {
              const checked = picked.has(c.simpro_customer_id);
              return (
                <TouchableOpacity
                  key={`${c.simpro_company_id}-${c.simpro_customer_id}`}
                  testID={`client-row-${c.simpro_customer_id}`}
                  style={[st.row, checked && { backgroundColor: '#e6eff9' }]}
                  onPress={() => toggle(c.simpro_customer_id)}
                  activeOpacity={0.7}
                >
                  <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={18}
                    color={checked ? '#1e4a8c' : Colors.textTertiary} />
                  <Text style={st.rowName} numberOfLines={1}>{c.name}</Text>
                  <CompanyChip label={c.company_label} />
                </TouchableOpacity>
              );
            })}
            {filtered.length > 500 && (
              <Text style={{ paddingHorizontal: 16, paddingVertical: 8, fontSize: 11, color: Colors.textTertiary }}>
                Showing first 500 — refine search to narrow.
              </Text>
            )}
          </ScrollView>
        )}

        {/* Footer */}
        <View style={st.footer}>
          <TouchableOpacity testID="client-picker-cancel" style={st.cancelBtn} onPress={onClose}>
            <Text style={st.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="client-picker-apply" style={st.applyBtn}
            onPress={() => onApply([...picked])}>
            <Text style={st.applyBtnText}>Apply {picked.size} selection{picked.size === 1 ? '' : 's'}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const st = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#F8FAFC',
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerOverline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: Colors.textTertiary },
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.ink, marginTop: 2 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
  },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  searchInput: { flex: 1, fontSize: 13, color: Colors.text, padding: 0 },
  countText: { fontSize: 11, color: Colors.textTertiary },
  actionRow: {
    flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingBottom: 8,
  },
  actionBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  actionBtnText: { fontSize: 11, fontWeight: '600' },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8, padding: 32 },
  loadingText: { fontSize: 13, color: Colors.textTertiary },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  rowName: { flex: 1, fontSize: 13, color: Colors.text },
  chip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  chipText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  footer: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: '#F8FAFC',
  },
  cancelBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  cancelBtnText: { fontSize: 13, fontWeight: '500', color: Colors.textSecondary },
  applyBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: '#1e4a8c' },
  applyBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});
