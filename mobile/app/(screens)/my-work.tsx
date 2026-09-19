/**
 * My Work / My Records — v58.13.132dc
 * Wired to GET /api/mobile/records/mine (real endpoint).
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import { clearSession } from '../../src/services/auth';
import { authGet } from '../../src/services/apiClient';

interface RecordItem {
  id: string;
  title: string;
  date: string;
  status: string;
}

interface RecordGroup {
  category: string;
  label: string;
  count: number;
  items: RecordItem[];
}

interface RecordsResponse {
  groups: RecordGroup[];
}

const CATEGORY_ICONS: Record<string, { icon: string; color: string }> = {
  pre_start:  { icon: 'checkbox-outline', color: '#10B981' },
  toolbox:    { icon: 'people-outline', color: '#3B82F6' },
  incident:   { icon: 'alert-circle-outline', color: '#EF4444' },
  inspection: { icon: 'clipboard-outline', color: '#3B82F6' },
  general:    { icon: 'document-text-outline', color: '#64748B' },
  near_miss:  { icon: 'warning-outline', color: '#F59E0B' },
  hazard:     { icon: 'warning-outline', color: '#F59E0B' },
  swms:       { icon: 'shield-checkmark-outline', color: '#8B5CF6' },
};

export default function MyWorkScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [groups, setGroups] = useState<RecordGroup[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadRecords = useCallback(async () => {
    const res = await authGet<RecordsResponse>('/api/mobile/records/mine');
    if (res.ok) {
      setGroups(res.data.groups || []);
      setError('');
    } else if ('expired' in res && res.expired) {
      await clearSession();
      router.replace('/(auth)/pin-entry');
      return;
    } else {
      setError('error' in res ? res.error : 'Failed to load records');
    }
    setLoading(false);
  }, [router]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRecords();
    setRefreshing(false);
  }, [loadRecords]);

  const toggleGroup = (cat: string) => {
    setExpanded((prev) => (prev === cat ? null : cat));
  };

  const totalRecords = groups.reduce((sum, g) => sum + g.count, 0);

  return (
    <View testID="my-work-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>My Records</Text>
      </View>
      <Text style={s.headerSub}>All your submissions grouped by type</Text>

      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.orange} />
          <Text style={s.loadingText}>Loading records...</Text>
        </View>
      ) : error ? (
        <View style={s.errorWrap}>
          <Ionicons name="cloud-offline-outline" size={32} color={Colors.error} />
          <Text style={s.errorText}>{error}</Text>
          <TouchableOpacity testID="records-retry-btn" style={s.retryBtn} onPress={loadRecords}>
            <Text style={s.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.orange]} />}
        >
          {groups.map((group) => {
            const isExpanded = expanded === group.category;
            const meta = CATEGORY_ICONS[group.category] || { icon: 'folder-outline', color: '#64748B' };
            return (
              <View key={group.category}>
                <TouchableOpacity
                  testID={`record-group-${group.category}`}
                  style={s.groupCard}
                  onPress={() => toggleGroup(group.category)}
                  activeOpacity={0.7}
                >
                  <View style={[s.groupIcon, { backgroundColor: meta.color + '18' }]}>
                    <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={22} color={meta.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.groupLabel}>{group.label}</Text>
                    <Text style={s.groupCount}>{group.count} record{group.count !== 1 ? 's' : ''}</Text>
                  </View>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={Colors.textTertiary}
                  />
                </TouchableOpacity>

                {isExpanded && (
                  <View style={s.itemsContainer}>
                    {group.items.slice(0, 10).map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        testID={`record-item-${item.id}`}
                        style={s.itemRow}
                        onPress={() => {}}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={s.itemTitle} numberOfLines={1}>{item.title}</Text>
                          <Text style={s.itemMeta}>
                            {new Date(item.date).toLocaleDateString()}
                          </Text>
                        </View>
                        <View style={[s.statusPill, {
                          backgroundColor: item.status === 'open' || item.status === 'draft' ? Colors.warningSoft
                            : item.status === 'submitted' || item.status === 'completed' ? Colors.successSoft
                            : Colors.infoSoft,
                        }]}>
                          <Text style={[s.statusText, {
                            color: item.status === 'open' || item.status === 'draft' ? Colors.warning
                              : item.status === 'submitted' || item.status === 'completed' ? Colors.success
                              : Colors.info,
                          }]}>{item.status}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                    {group.items.length > 10 && (
                      <Text style={s.moreText}>
                        + {group.count - 10} more
                      </Text>
                    )}
                    {group.items.length < group.count && group.items.length <= 10 && (
                      <Text style={s.moreText}>
                        + {group.count - group.items.length} more in backend
                      </Text>
                    )}
                  </View>
                )}
              </View>
            );
          })}

          {/* Summary card */}
          <View style={s.summaryCard}>
            <Text style={s.summaryTitle}>Total Records</Text>
            <Text style={s.summaryCount}>{totalRecords}</Text>
            <Text style={s.summaryTypes}>
              across {groups.length} categories
            </Text>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.navy },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingTop: 16,
  },
  headerTitle: { color: Colors.white, fontSize: 22, fontWeight: '800' },
  headerSub: {
    color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: '500',
    paddingHorizontal: 20, marginTop: 2, marginBottom: 8,
  },
  scrollContent: { padding: 16, paddingBottom: 32 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  errorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  errorText: { color: Colors.error, fontSize: 13, textAlign: 'center' },
  retryBtn: {
    backgroundColor: Colors.orange, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10,
  },
  retryBtnText: { color: Colors.white, fontSize: 14, fontWeight: '700' },

  groupCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 16, padding: 18, marginBottom: 8,
    minHeight: 72,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  groupIcon: {
    width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
  },
  groupLabel: { fontSize: 16, fontWeight: '700', color: Colors.ink },
  groupCount: { fontSize: 13, color: Colors.textTertiary, marginTop: 2 },

  itemsContainer: {
    marginLeft: 20, marginBottom: 8, paddingLeft: 16,
    borderLeftWidth: 2, borderLeftColor: Colors.border,
  },
  itemRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14, marginBottom: 4,
    minHeight: 56,
  },
  itemTitle: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  itemMeta: { fontSize: 12, color: Colors.textTertiary, marginTop: 2 },
  statusPill: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  moreText: {
    fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: '600',
    paddingVertical: 8, paddingLeft: 12,
  },

  summaryCard: {
    backgroundColor: 'rgba(249,115,22,0.08)', borderRadius: 16, padding: 20,
    alignItems: 'center', marginTop: 12,
    borderWidth: 1, borderColor: 'rgba(249,115,22,0.2)',
  },
  summaryTitle: { fontSize: 12, fontWeight: '700', color: Colors.orange, letterSpacing: 0.5, textTransform: 'uppercase' },
  summaryCount: { fontSize: 36, fontWeight: '900', color: Colors.white, marginVertical: 4 },
  summaryTypes: { fontSize: 12, color: 'rgba(255,255,255,0.5)' },
});
