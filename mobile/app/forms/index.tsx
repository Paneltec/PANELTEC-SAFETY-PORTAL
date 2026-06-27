import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../../src/lib/api';
import { Colors } from '../../src/lib/colors';

const CATEGORIES = [
  { key: 'all',        label: 'All',        bg: '#f1f5f9', ink: '#334155' },
  { key: 'incident',   label: 'Incident',   bg: '#fbe4e7', ink: '#7a1f33' },
  { key: 'inspection', label: 'Inspection', bg: '#ece6f4', ink: '#4f3a8c' },
  { key: 'toolbox',    label: 'Toolbox',    bg: '#f7eed1', ink: '#8c6a1a' },
  { key: 'near_miss',  label: 'Near Miss',  bg: '#f8d7c3', ink: '#9c4f1a' },
  { key: 'general',    label: 'General',    bg: '#f1f5f9', ink: '#334155' },
];
const CAT_MAP: Record<string, typeof CATEGORIES[0]> = {};
CATEGORIES.forEach((c) => { CAT_MAP[c.key] = c; });

export default function FormsListScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/forms/templates');
      setRows(data || []);
    } catch { /* silent */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    CATEGORIES.forEach((cat) => { if (cat.key !== 'all') c[cat.key] = 0; });
    rows.forEach((r) => { if (c[r.category] !== undefined) c[r.category]++; });
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => filter === 'all' || r.category === filter)
      .filter((r) => !q || `${r.name} ${r.description || ''}`.toLowerCase().includes(q))
      .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
  }, [rows, filter, search]);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header banner */}
      <View testID="forms-header" style={s.header}>
        <TouchableOpacity testID="forms-back" onPress={() => router.back()} style={{ padding: 4 }}>
          <Ionicons name="arrow-back" size={20} color="#1e4a8c" />
        </TouchableOpacity>
        <Ionicons name="clipboard" size={20} color="#1e4a8c" />
        <View style={{ flex: 1 }}>
          <Text style={s.headerOverline}>COMPLIANCE</Text>
          <Text style={s.headerTitle}>Forms</Text>
          <Text style={s.headerSub}>Fillable templates — inspection, incident, toolbox &amp; more</Text>
        </View>
      </View>

      {/* Search */}
      <View style={s.searchRow}>
        <Ionicons name="search" size={14} color={Colors.textTertiary} />
        <TextInput testID="forms-search" style={s.searchInput} value={search}
          onChangeText={setSearch} placeholder="Search by name…"
          placeholderTextColor={Colors.textTertiary} />
      </View>

      {/* Category chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.chipRow}>
        {CATEGORIES.map((c) => {
          const active = filter === c.key;
          return (
            <TouchableOpacity key={c.key} testID={`filter-${c.key}`}
              style={[s.chip, { backgroundColor: c.bg, borderColor: active ? c.ink : 'transparent', borderWidth: active ? 1.5 : 0 }]}
              onPress={() => setFilter(c.key)}>
              <Text style={[s.chipText, { color: c.ink }]}>{c.label}</Text>
              <Text style={[s.chipCount, { color: c.ink }]}>{counts[c.key] ?? 0}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* List */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        {loading ? (
          <ActivityIndicator testID="forms-loading" style={{ marginTop: 40 }} color={Colors.blue} />
        ) : filtered.length === 0 ? (
          <View testID="forms-empty" style={s.empty}>
            <Ionicons name="document-text" size={32} color={Colors.textTertiary} />
            <Text style={s.emptyTitle}>No templates yet</Text>
            <Text style={s.emptyHint}>Templates are created on the web by admins.</Text>
          </View>
        ) : filtered.map((t) => {
          const cat = CAT_MAP[t.category] || CAT_MAP.general;
          return (
            <TouchableOpacity key={t.id} testID={`template-card-${t.id}`}
              style={s.card} activeOpacity={0.7}
              onPress={() => router.push(`/forms/${t.id}`)}>
              <View style={s.cardTop}>
                <View style={[s.catBadge, { backgroundColor: cat.bg }]}>
                  <Text style={[s.catBadgeText, { color: cat.ink }]}>{cat.label}</Text>
                </View>
                {(t.submission_count ?? 0) > 0 && (
                  <View style={[s.catBadge, { backgroundColor: '#d8ecdd' }]}>
                    <Text style={[s.catBadgeText, { color: '#1f7a3f' }]}>{t.submission_count} sent</Text>
                  </View>
                )}
              </View>
              <Text style={s.cardName} numberOfLines={1}>{t.name}</Text>
              <Text style={s.cardDesc} numberOfLines={2}>{t.description || '—'}</Text>
              <Text style={s.cardFields}>{(t.fields || []).length} fields</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: '#e6eff9', borderBottomWidth: 1, borderBottomColor: '#b9d2ec',
  },
  headerOverline: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2, color: '#1e4a8c' },
  headerTitle: { fontSize: 20, fontWeight: '700', color: Colors.ink },
  headerSub: { fontSize: 11, color: '#1e4a8c', marginTop: 2, opacity: 0.8 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 12,
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 12,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 13, color: Colors.text },
  chipRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
  },
  chipText: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  chipCount: { fontSize: 10, fontWeight: '700', opacity: 0.7 },
  card: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 14, padding: 14, marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  catBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  catBadgeText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardName: { fontSize: 15, fontWeight: '700', color: Colors.ink },
  cardDesc: { fontSize: 12, color: Colors.textSecondary, marginTop: 3, lineHeight: 17 },
  cardFields: { fontSize: 11, color: Colors.textTertiary, marginTop: 6 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 6 },
  emptyTitle: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  emptyHint: { fontSize: 12, color: Colors.textTertiary },
});
