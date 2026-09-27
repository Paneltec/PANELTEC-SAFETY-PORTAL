/**
 * My Work tab — v58.13.132p2d
 * 5 collapsible record categories — compact tiles (~60px), single-line titles,
 * solid green "+ New" buttons.
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
    label: 'Pre-Starts',
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
    label: 'Hazards',
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
    label: 'Incidents',
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
  open:        { bg: '#FEF3C7', text: '#D97706' },
  draft:       { bg: '#FEF3C7', text: '#D97706' },
  in_progress: { bg: '#DBEAFE', text: '#2563EB' },
  submitted:   { bg: C.green.softBg, text: C.green.base },
  completed:   { bg: C.green.softBg, text: C.green.base },
  closed:      { bg: C.card.bg, text: C.textOnNavy.faint },
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
          router.replace({ pathname: '/(auth)/pin-entry', params: { reason: 'session_expired' } } as never);
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

  const totalRecords = Object.values(data).reduce((sum, arr) => sum + arr.length, 0);

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
                {/* Compact tile header */}
                <TouchableOpacity
                  testID={`mywork-card-${cat.key}`}
                  style={s.catCard}
                  onPress={() => setExpanded(isOpen ? null : cat.key)}
                  activeOpacity={0.7}
                >
                  <View style={[s.catIcon, { backgroundColor: cat.color + '18' }]}>
                    <Ionicons name={cat.icon} size={18} color={cat.color} />
                  </View>
                  <View style={s.catTextWrap}>
                    <Text style={s.catLabel} numberOfLines={1} ellipsizeMode="tail">{cat.label}</Text>
                    <Text style={s.catCount}>{items.length} record{items.length !== 1 ? 's' : ''}</Text>
                  </View>
                  <TouchableOpacity
                    testID={`mywork-new-${cat.key}`}
                    style={s.newBtn}
                    onPress={() => {
                      router.push({ pathname: cat.newRoute, params: cat.newParams } as never);
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="add" size={14} color={C.green.buttonText} />
                    <Text style={s.newBtnText}>New</Text>
                  </TouchableOpacity>
                  <Ionicons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color={C.textOnNavy.faint}
                    style={{ marginLeft: 4 }}
                  />
                </TouchableOpacity>

                {/* Expanded items (last 3) */}
                {isOpen && (
                  <View style={s.itemsWrap}>
                    {items.length === 0 ? (
                      <View style={s.emptyRow}>
                        <Ionicons name="folder-open-outline" size={18} color={C.textOnNavy.faint} />
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
    color: C.textOnNavy.faint, fontSize: 12, fontWeight: '500',
    paddingHorizontal: 20, paddingBottom: 10, backgroundColor: C.screen.bg,
  },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: C.textOnNavy.faint, fontSize: 13 },
  scrollContent: { padding: 16, paddingBottom: 32 },

  // ── Compact tile (~60px) ──
  catWrap: { marginBottom: 6 },
  catCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.card.bg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    minHeight: 56,
  },
  catIcon: {
    width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
  },
  catTextWrap: { flex: 1 },
  catLabel: { fontSize: 14, fontWeight: '700', color: C.card.textMain },
  catCount: { fontSize: 11, color: C.card.textLabel, marginTop: 1 },

  // ── Solid green "+ New" button ──
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: C.green.base, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5, minHeight: 28,
  },
  newBtnText: { fontSize: 12, fontWeight: '700', color: C.green.buttonText },

  // ── Expanded items ──
  itemsWrap: {
    marginLeft: 18, paddingLeft: 12, marginTop: 2, marginBottom: 2,
    borderLeftWidth: 2, borderLeftColor: C.card.border,
  },
  itemRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card.bg, borderRadius: 10, padding: 12, marginBottom: 3,
    minHeight: 46,
  },
  itemTitle: { fontSize: 13, fontWeight: '600', color: C.card.textMain },
  itemDate: { fontSize: 10, color: C.card.textLabel, marginTop: 1 },
  statusPill: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  statusText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  moreText: {
    fontSize: 11, color: C.textOnNavy.faint, fontWeight: '600',
    paddingVertical: 6, paddingLeft: 12,
  },
  emptyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.card.bg, borderRadius: 10, padding: 12, marginBottom: 3,
  },
  emptyText: { fontSize: 12, color: C.textOnNavy.faint, flex: 1 },

  summaryCard: {
    backgroundColor: C.orange.softBg, borderRadius: 14, padding: 18,
    alignItems: 'center', marginTop: 10,
    borderWidth: 1, borderColor: C.orange.softBg,
  },
  summaryLabel: {
    fontSize: 11, fontWeight: '700', color: Colors.orange,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  summaryCount: { fontSize: 32, fontWeight: '900', color: C.textOnNavy.main, marginVertical: 2 },
  summarySub: { fontSize: 12, color: C.textOnNavy.faint },
});
