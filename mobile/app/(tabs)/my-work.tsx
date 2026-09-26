/**
 * My Work tab — v58.13.132n5m3
 * Light scaffold: 5 collapsible record categories with counts, last 3 entries, + New button.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, C } from '../../src/theme/colors';
import { clearSession } from '../../src/services/auth';
import { authGet } from '../../src/services/apiClient';

interface RecordEntry {
  id: string;
  title: string;
  date: string;
  status: string;
}

interface CategoryConfig {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  endpoint: string;
  newRoute: string;
  newParams?: Record<string, string>;
  mapItem: (item: any) => RecordEntry;
}

const CATEGORIES: CategoryConfig[] = [
  {
    key: 'pre_start',
    label: 'Daily Pre-Starts',
    icon: 'checkbox-outline',
    color: C.green.base,
    endpoint: '/api/pre-starts',
    newRoute: '/forms/picker',
    newParams: { category: 'pre_start', title: 'Pre-Start' },
    mapItem: (r) => ({
      id: r.id,
      title: r.crew_lead ? `Led by ${r.crew_lead}` : 'Pre-Start',
      date: r.date || r.created_at || '',
      status: r.status || 'submitted',
    }),
  },
  {
    key: 'hazard',
    label: 'Hazard Reports',
    icon: 'warning-outline',
    color: '#F59E0B',
    endpoint: '/api/hazards',
    newRoute: '/forms/picker',
    newParams: { category: 'hazard', title: 'Hazard' },
    mapItem: (r) => ({
      id: r.id,
      title: r.title || 'Hazard Report',
      date: r.created_at || '',
      status: r.status || 'open',
    }),
  },
  {
    key: 'incident',
    label: 'Incident Reports',
    icon: 'alert-circle-outline',
    color: '#EF4444',
    endpoint: '/api/incidents',
    newRoute: '/forms/picker',
    newParams: { category: 'incident', title: 'Incident' },
    mapItem: (r) => ({
      id: r.id,
      title: r.title || 'Incident',
      date: r.occurred_at || r.created_at || '',
      status: r.follow_up_status || r.status || 'open',
    }),
  },
  {
    key: 'site_diary',
    label: 'Site Diary',
    icon: 'book-outline',
    color: '#3B82F6',
    endpoint: '/api/site-diary',
    newRoute: '/forms/picker',
    newParams: { category: 'diary', title: 'Site Diary' },
    mapItem: (r) => ({
      id: r.id,
      title: r.raw_notes?.slice(0, 60) || 'Diary Entry',
      date: r.date || r.created_at || '',
      status: r.status || 'submitted',
    }),
  },
  {
    key: 'inspection',
    label: 'Inspections',
    icon: 'clipboard-outline',
    color: '#8B5CF6',
    endpoint: '/api/inspections',
    newRoute: '/forms/picker',
    newParams: { category: 'inspection', title: 'Inspection' },
    mapItem: (r) => ({
      id: r.id,
      title: r.template_name || 'Inspection',
      date: r.date || r.created_at || '',
      status: r.status || 'completed',
    }),
  },
];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  open:       { bg: '#FEF3C7', text: '#D97706' },
  draft:      { bg: '#FEF3C7', text: '#D97706' },
  in_progress: { bg: '#DBEAFE', text: '#2563EB' },
  submitted:  { bg: '#D1FAE5', text: '#059669' },
  completed:  { bg: '#D1FAE5', text: '#059669' },
  closed:     { bg: '#E2E8F0', text: '#64748B' },
};

export default function MyWorkTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [data, setData] = useState<Record<string, RecordEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const results: Record<string, RecordEntry[]> = {};
    await Promise.all(
      CATEGORIES.map(async (cat) => {
        const res = await authGet<any[]>(cat.endpoint);
        if (res.ok && Array.isArray(res.data)) {
          results[cat.key] = res.data.map(cat.mapItem);
        } else if ('expired' in res && res.expired) {
          await clearSession();
          router.replace('/(auth)/pin-entry');
          return;
        } else {
          results[cat.key] = [];
        }
      }),
    );
    setData(results);
    setLoading(false);
  }, [router]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  const formatDate = (iso: string) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return iso; }
  };

  const totalRecords = Object.values(data).reduce((s, arr) => s + arr.length, 0);

  return (
    <View testID="my-work-tab" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>My Work</Text>
        <View style={s.headerBadge}>
          <Text style={s.headerBadgeText}>{loading ? '…' : totalRecords}</Text>
        </View>
      </View>
      <Text style={s.headerSub}>Your submissions grouped by type</Text>

      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.orange} />
          <Text style={s.loadingText}>Loading records…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.orange]} />}
        >
          {CATEGORIES.map((cat) => {
            const items = data[cat.key] || [];
            const isOpen = expanded === cat.key;
            const sc = STATUS_COLORS;

            return (
              <View key={cat.key} style={s.catWrap}>
                {/* Card header */}
                <TouchableOpacity
                  testID={`mywork-card-${cat.key}`}
                  style={s.catCard}
                  onPress={() => setExpanded(isOpen ? null : cat.key)}
                  activeOpacity={0.7}
                >
                  <View style={[s.catIcon, { backgroundColor: cat.color + '18' }]}>
                    <Ionicons name={cat.icon} size={22} color={cat.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.catLabel}>{cat.label}</Text>
                    <Text style={s.catCount}>
                      {items.length} record{items.length !== 1 ? 's' : ''}
                    </Text>
                  </View>
                  <TouchableOpacity
                    testID={`mywork-new-${cat.key}`}
                    style={[s.newBtn, { borderColor: cat.color + '40' }]}
                    onPress={() => {
                      router.push({ pathname: cat.newRoute, params: cat.newParams } as never);
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="add" size={16} color={cat.color} />
                    <Text style={[s.newBtnText, { color: cat.color }]}>New</Text>
                  </TouchableOpacity>
                  <Ionicons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={Colors.textTertiary}
                    style={{ marginLeft: 6 }}
                  />
                </TouchableOpacity>

                {/* Expanded items (last 3) */}
                {isOpen && (
                  <View style={s.itemsWrap}>
                    {items.length === 0 ? (
                      <View style={s.emptyRow}>
                        <Ionicons name="folder-open-outline" size={20} color={Colors.textTertiary} />
                        <Text style={s.emptyText}>
                          Nothing yet — tap New to capture your first {cat.label.toLowerCase().replace(/s$/, '')}
                        </Text>
                      </View>
                    ) : (
                      <>
                        {items.slice(0, 3).map((item) => {
                          const pal = sc[item.status] || sc.open;
                          return (
                            <TouchableOpacity
                              key={item.id}
                              testID={`mywork-item-${item.id}`}
                              style={s.itemRow}
                              onPress={() => {}}
                              activeOpacity={0.7}
                            >
                              <View style={{ flex: 1 }}>
                                <Text style={s.itemTitle} numberOfLines={1}>{item.title}</Text>
                                <Text style={s.itemDate}>{formatDate(item.date)}</Text>
                              </View>
                              <View style={[s.statusPill, { backgroundColor: pal.bg }]}>
                                <Text style={[s.statusText, { color: pal.text }]}>{item.status.replace('_', ' ')}</Text>
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                        {items.length > 3 && (
                          <Text style={s.moreText}>+ {items.length - 3} more</Text>
                        )}
                      </>
                    )}
                  </View>
                )}
              </View>
            );
          })}

          {/* Summary */}
          <View style={s.summaryCard}>
            <Text style={s.summaryLabel}>TOTAL RECORDS</Text>
            <Text style={s.summaryCount}>{totalRecords}</Text>
            <Text style={s.summarySub}>across {CATEGORIES.length} categories</Text>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.screen.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingTop: 16, backgroundColor: C.screen.bg, paddingBottom: 4,
  },
  headerTitle: { color: C.textOnNavy.main, fontSize: 22, fontWeight: '800' },
  headerBadge: {
    backgroundColor: Colors.orange, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 3,
  },
  headerBadgeText: { color: C.textOnNavy.main, fontSize: 12, fontWeight: '800' },
  headerSub: {
    color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: '500',
    paddingHorizontal: 20, paddingBottom: 10, backgroundColor: C.screen.bg,
  },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  scrollContent: { padding: 16, paddingBottom: 32 },

  catWrap: { marginBottom: 8 },
  catCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.card.bg, borderRadius: 16, padding: 16,
    minHeight: 72,
    shadowColor: C.misc.shadow, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  catIcon: {
    width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  catLabel: { fontSize: 15, fontWeight: '700', color: C.card.textMain },
  catCount: { fontSize: 12, color: C.textOnNavy.faint, marginTop: 2 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1.5, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6, minHeight: 34,
  },
  newBtnText: { fontSize: 13, fontWeight: '700' },

  itemsWrap: {
    marginLeft: 22, paddingLeft: 14, marginTop: 2, marginBottom: 4,
    borderLeftWidth: 2, borderLeftColor: Colors.border,
  },
  itemRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card.bg, borderRadius: 12, padding: 14, marginBottom: 4,
    minHeight: 52,
  },
  itemTitle: { fontSize: 13, fontWeight: '600', color: C.card.textMain },
  itemDate: { fontSize: 11, color: C.textOnNavy.faint, marginTop: 2 },
  statusPill: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  moreText: {
    fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: '600',
    paddingVertical: 8, paddingLeft: 12,
  },
  emptyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.card.bg, borderRadius: 12, padding: 16, marginBottom: 4,
  },
  emptyText: { fontSize: 13, color: C.textOnNavy.faint, flex: 1 },

  summaryCard: {
    backgroundColor: 'rgba(249,115,22,0.08)', borderRadius: 16, padding: 20,
    alignItems: 'center', marginTop: 12,
    borderWidth: 1, borderColor: 'rgba(249,115,22,0.2)',
  },
  summaryLabel: {
    fontSize: 11, fontWeight: '700', color: Colors.orange,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  summaryCount: { fontSize: 36, fontWeight: '900', color: C.textOnNavy.main, marginVertical: 4 },
  summarySub: { fontSize: 12, color: 'rgba(255,255,255,0.5)' },
});
