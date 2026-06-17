import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/lib/api';
import StatusBadge from '../../src/components/StatusBadge';
import EmptyState from '../../src/components/EmptyState';
import { Colors } from '../../src/lib/colors';

type RecordGroup = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  items: any[];
};

const GROUPS_CONFIG: Omit<RecordGroup, 'items'>[] = [
  { key: 'swms', label: 'SWMS', icon: 'document-text', route: '/swms' },
  { key: 'pre_starts', label: 'Pre-starts', icon: 'clipboard', route: '/pre-starts' },
  { key: 'site_diary', label: 'Site Diary', icon: 'book', route: '/site-diary' },
  { key: 'hazards', label: 'Hazards', icon: 'warning', route: '/hazards' },
  { key: 'incidents', label: 'Incidents', icon: 'alert-circle', route: '/incidents' },
  { key: 'inspections', label: 'Inspections', icon: 'checkmark-circle', route: '/inspections' },
];

export default function MyWorkScreen() {
  const router = useRouter();
  const [groups, setGroups] = useState<RecordGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const results = await Promise.allSettled(
        GROUPS_CONFIG.map(g =>
          api.get(`/${g.key.replace('_', '-')}`).then(r => ({ ...g, items: (r.data || []).slice(0, 5) }))
        )
      );
      const loaded: RecordGroup[] = results.map((r, i) =>
        r.status === 'fulfilled' ? r.value : { ...GROUPS_CONFIG[i], items: [] }
      );
      setGroups(loaded);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { load(); }, []);

  const totalRecords = groups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        testID="my-work-page"
        style={s.scroll}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.blue} />}
      >
        <Text style={s.overline}>MY WORK</Text>
        <Text style={s.heading}>My Records</Text>
        <Text style={s.sub}>All your safety records grouped by type.</Text>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={Colors.blue} />
        ) : totalRecords === 0 ? (
          <EmptyState title="No records yet" body="Start capturing safety records from the Capture tab." />
        ) : (
          groups.map(g => {
            if (g.items.length === 0) return null;
            return (
              <View key={g.key} style={s.groupCard}>
                <TouchableOpacity
                  testID={`my-work-group-${g.key}`}
                  style={s.groupHeader}
                  onPress={() => router.push(g.route as any)}
                  activeOpacity={0.7}
                >
                  <View style={s.groupIcon}>
                    <Ionicons name={g.icon as any} size={16} color={Colors.blue} />
                  </View>
                  <Text style={s.groupLabel}>{g.label}</Text>
                  <View style={s.countBadge}>
                    <Text style={s.countText}>{g.items.length}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
                </TouchableOpacity>
                {g.items.slice(0, 3).map((item, idx) => (
                  <View key={item.id || idx} style={[s.itemRow, idx > 0 && s.itemBorder]}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemTitle} numberOfLines={1}>
                        {item.title || item.template_name || item.job_title || item.date || `Record ${idx + 1}`}
                      </Text>
                      <Text style={s.itemDate}>
                        {(item.created_at || item.date || '').toString().slice(0, 10)}
                      </Text>
                    </View>
                    {(item.status || item.severity) && (
                      <StatusBadge value={item.status || item.severity} />
                    )}
                  </View>
                ))}
                {g.items.length > 3 && (
                  <TouchableOpacity style={s.viewAllRow} onPress={() => router.push(g.route as any)}>
                    <Text style={s.viewAllText}>View all {g.items.length} {g.label.toLowerCase()}</Text>
                    <Ionicons name="arrow-forward" size={14} color={Colors.blue} />
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  overline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.blue },
  heading: { fontSize: 26, fontWeight: '700', color: Colors.ink, marginTop: 4, letterSpacing: -0.5 },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 4, marginBottom: 20 },
  groupCard: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 16, overflow: 'hidden', marginBottom: 12,
  },
  groupHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12, backgroundColor: Colors.bg,
  },
  groupIcon: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.blueSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  groupLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.ink },
  countBadge: {
    backgroundColor: Colors.blueSoft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
  },
  countText: { fontSize: 12, fontWeight: '700', color: Colors.blue },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10 },
  itemBorder: { borderTopWidth: 1, borderTopColor: Colors.borderLight },
  itemTitle: { fontSize: 14, fontWeight: '500', color: Colors.text },
  itemDate: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  viewAllRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },
  viewAllText: { fontSize: 13, color: Colors.blue, fontWeight: '500' },
});
