/**
 * CaptureList — reusable list screen for all 5 capture modules.
 * v58.13.132e — Filter chips, pull-to-refresh, item cards, FAB.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Colors } from '../theme/colors';
import {
  listItems, MODULE_CONFIG,
  type CaptureModuleKey, type CaptureItem,
} from '../services/capture';

interface Props {
  moduleKey: CaptureModuleKey;
  newRoute: string;
  detailRoute: string;
}

const STATUS_FILTERS = ['all', 'draft', 'open', 'submitted', 'in_progress', 'closed'];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft:       { bg: '#F1F5F9', text: '#64748B' },
  open:        { bg: '#FEF3C7', text: '#D97706' },
  submitted:   { bg: '#DBEAFE', text: '#2563EB' },
  in_progress: { bg: '#FFF7ED', text: '#F97316' },
  closed:      { bg: '#D1FAE5', text: '#059669' },
  queued:      { bg: '#FEE2E2', text: '#EF4444' },
};

export default function CaptureList({ moduleKey, newRoute, detailRoute }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const config = MODULE_CONFIG[moduleKey];

  const [filter, setFilter] = useState('all');
  const [refreshing, setRefreshing] = useState(false);

  const { data: items, isLoading } = useQuery({
    queryKey: ['capture', moduleKey, filter],
    queryFn: () => listItems(moduleKey, {
      status: filter !== 'all' ? filter : undefined,
      limit: 50,
    }),
    staleTime: 30_000,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: ['capture', moduleKey] });
    setRefreshing(false);
  }, [qc, moduleKey]);

  const formatDate = (d?: string) => {
    if (!d) return '';
    try {
      const dt = new Date(d);
      return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return d.slice(0, 10); }
  };

  const getTitle = (item: CaptureItem) => {
    const val = item[config.titleField];
    if (typeof val === 'string') return val.slice(0, 80) || config.label;
    return config.label;
  };

  const getSubtitle = (item: CaptureItem) => {
    const val = item[config.subtitleField];
    if (typeof val === 'string') return val.slice(0, 120);
    return '';
  };

  const getStatus = (item: CaptureItem) => {
    return item[config.statusField] || item.status || 'open';
  };

  return (
    <View testID={`capture-list-${moduleKey}`} style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>{config.labelPlural}</Text>
      </View>

      {/* Filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
        {STATUS_FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            testID={`filter-${f}`}
            style={[s.filterChip, filter === f && { backgroundColor: config.color }]}
            onPress={() => setFilter(f)}
          >
            <Text style={[s.filterText, filter === f && s.filterTextActive]}>
              {f === 'all' ? 'All' : f.replace('_', ' ')}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* List */}
      {isLoading && !items ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={config.color} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={config.color} />}
        >
          {(items || []).length === 0 ? (
            <View style={s.emptyWrap}>
              <Ionicons name={(config.icon + '-outline') as any} size={48} color={Colors.textTertiary} />
              <Text style={s.emptyTitle}>No {config.labelPlural.toLowerCase()}</Text>
              <Text style={s.emptySub}>Tap + to create one</Text>
            </View>
          ) : (
            (items || []).map((item) => {
              const status = getStatus(item);
              const sc = STATUS_COLORS[status] || STATUS_COLORS.open;
              return (
                <TouchableOpacity
                  key={item.id}
                  testID={`capture-item-${item.id}`}
                  style={s.card}
                  onPress={() => router.push({ pathname: detailRoute, params: { id: item.id } } as any)}
                  activeOpacity={0.7}
                >
                  <View style={[s.cardIcon, { backgroundColor: config.color + '18' }]}>
                    <Ionicons name={config.icon as any} size={20} color={config.color} />
                  </View>
                  <View style={s.cardBody}>
                    <Text style={s.cardTitle} numberOfLines={1}>{getTitle(item)}</Text>
                    {getSubtitle(item) ? (
                      <Text style={s.cardSub} numberOfLines={1}>{getSubtitle(item)}</Text>
                    ) : null}
                    <Text style={s.cardDate}>{formatDate(item[config.dateField] || item.created_at)}</Text>
                  </View>
                  <View style={[s.statusPill, { backgroundColor: sc.bg }]}>
                    <Text style={[s.statusText, { color: sc.text }]}>{status}</Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
          <View style={{ height: 100 }} />
        </ScrollView>
      )}

      {/* FAB */}
      <TouchableOpacity
        testID={`capture-fab-${moduleKey}`}
        style={[s.fab, { backgroundColor: config.color }]}
        onPress={() => router.push(newRoute as any)}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={28} color={Colors.white} />
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    paddingHorizontal: 20, paddingVertical: 14,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: Colors.ink },
  filterRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterChip: {
    backgroundColor: Colors.surface, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1, borderColor: Colors.border, marginRight: 8,
  },
  filterText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, textTransform: 'capitalize' },
  filterTextActive: { color: Colors.white },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 16 },
  emptyWrap: { alignItems: 'center', paddingTop: 80, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: Colors.textSecondary },
  emptySub: { fontSize: 14, color: Colors.textTertiary },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 10, gap: 12,
  },
  cardIcon: {
    width: 40, height: 40, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Colors.ink },
  cardSub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  cardDate: { fontSize: 11, color: Colors.textTertiary, marginTop: 3 },
  statusPill: {
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  statusText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  fab: {
    position: 'absolute', bottom: 100, right: 20,
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25, shadowRadius: 6,
  },
});
