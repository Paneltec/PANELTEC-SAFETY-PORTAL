/**
 * Phase 4 — My Work tab.
 * Lists records created by current user: pre-starts, hazards, inspections.
 */
import React, { useCallback, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { civilGet, getStoredCivilUser } from '../../src/services/civilApi';

const BLUE = '#2C6BFF';
const GREEN = '#10B981';
const AMBER = '#F59E0B';
const RED = '#EF4444';
const BG = '#F8FAFC';
const INK = '#0F172A';
const MUTED = '#64748B';

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-AU', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return iso; }
}

function StatusBadge({ status }: { status: string }) {
  const color = status === 'open' ? AMBER : status === 'resolved' ? GREEN : status === 'critical' ? RED : BLUE;
  const bg = status === 'open' ? '#FEF3C7' : status === 'resolved' ? '#D1FAE5' : status === 'critical' ? '#FEE2E2' : '#DBEAFE';
  return (
    <View style={[rs.badge, { backgroundColor: bg }]}>
      <Text style={[rs.badgeText, { color }]}>{status}</Text>
    </View>
  );
}

const rs = StyleSheet.create({
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
});

export default function MyWorkScreen() {
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState<any>(null);
  const [prestarts, setPrestarts] = useState<any[]>([]);
  const [hazards, setHazards] = useState<any[]>([]);
  const [inspections, setInspections] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    const u = await getStoredCivilUser();
    setUser(u);
    const userId = u?.id;

    const [pRes, hRes, iRes, incRes] = await Promise.all([
      civilGet<any[]>('/pre-starts'),
      civilGet<any[]>('/hazards'),
      civilGet<any[]>('/inspections'),
      civilGet<any[]>('/incidents'),
    ]);

    const filterByUser = (items: any[]) => {
      if (!userId) return items;
      return items.filter(r =>
        r.created_by === userId ||
        r.reported_by === userId ||
        r.crew_lead === userId
      );
    };

    if (pRes.ok && pRes.data) setPrestarts(filterByUser(pRes.data));
    if (hRes.ok && hRes.data) setHazards(filterByUser(hRes.data));
    if (iRes.ok && iRes.data) setInspections(filterByUser(iRes.data));
    if (incRes.ok && incRes.data) setIncidents(filterByUser(incRes.data));
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const renderSection = (title: string, icon: keyof typeof Ionicons.glyphMap, color: string, items: any[], type: string) => {
    if (items.length === 0) return null;
    return (
      <View key={type} style={s.section}>
        <View style={s.sectionHeader}>
          <Ionicons name={icon} size={18} color={color} />
          <Text style={s.sectionTitle}>{title}</Text>
          <View style={[s.countBadge, { backgroundColor: color + '20' }]}>
            <Text style={[s.countText, { color }]}>{items.length}</Text>
          </View>
        </View>
        {items.map((item, idx) => (
          <View key={item.id || idx} testID={`mywork-${type}-${idx}`} style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle} numberOfLines={1}>
                {item.title || item.template_name || item.work_summary || `${type} entry`}
              </Text>
              <Text style={s.rowDate}>
                {formatDate(item.created_at || item.date || item.occurred_at || '')}
              </Text>
            </View>
            {item.status && <StatusBadge status={item.status} />}
          </View>
        ))}
      </View>
    );
  };

  return (
    <View testID="mywork-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>My Work</Text>
        <Text style={s.headerSub}>Records you created</Text>
      </View>

      <ScrollView
        contentContainerStyle={s.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BLUE} colors={[BLUE]} />}
      >
        {loading ? (
          <ActivityIndicator testID="mywork-loading" color={BLUE} size="large" style={{ marginTop: 60 }} />
        ) : (
          <>
            {renderSection('Pre-Starts I Led', 'checkbox-outline', GREEN, prestarts, 'prestart')}
            {renderSection('Hazards I Reported', 'warning-outline', AMBER, hazards, 'hazard')}
            {renderSection('Inspections I Ran', 'clipboard-outline', BLUE, inspections, 'inspection')}
            {renderSection('Incidents I Reported', 'flash-outline', RED, incidents, 'incident')}

            {prestarts.length === 0 && hazards.length === 0 && inspections.length === 0 && incidents.length === 0 && (
              <View testID="mywork-empty" style={s.emptyWrap}>
                <Ionicons name="folder-open-outline" size={48} color="#CBD5E1" />
                <Text style={s.emptyTitle}>No records yet</Text>
                <Text style={s.emptySub}>Use the Capture tab to create your first entry.</Text>
              </View>
            )}
            <View style={{ height: 40 }} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    backgroundColor: '#FFFFFF', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: INK, letterSpacing: -0.5 },
  headerSub: { fontSize: 13, color: MUTED, fontWeight: '500', marginTop: 4 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: INK, flex: 1 },
  countBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  countText: { fontSize: 12, fontWeight: '700' },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, marginBottom: 8,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  rowTitle: { fontSize: 15, fontWeight: '600', color: INK },
  rowDate: { fontSize: 12, color: MUTED, marginTop: 3 },
  emptyWrap: { alignItems: 'center', paddingTop: 80, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: INK },
  emptySub: { fontSize: 14, color: MUTED, textAlign: 'center' },
});
