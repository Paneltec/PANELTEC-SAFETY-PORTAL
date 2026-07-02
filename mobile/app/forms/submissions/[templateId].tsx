import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../../../src/lib/api';
import { Colors } from '../../../src/lib/colors';

const CAT_COLORS: Record<string, { bg: string; ink: string }> = {
  incident:   { bg: '#fbe4e7', ink: '#7a1f33' },
  inspection: { bg: '#ece6f4', ink: '#4f3a8c' },
  toolbox:    { bg: '#f7eed1', ink: '#8c6a1a' },
  near_miss:  { bg: '#f8d7c3', ink: '#9c4f1a' },
  general:    { bg: '#f1f5f9', ink: '#334155' },
};

function timeAgo(d: string) {
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function SubmissionsListScreen() {
  const router = useRouter();
  const { templateId } = useLocalSearchParams<{ templateId: string }>();
  const [tpl, setTpl] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([
        api.get(`/forms/templates/${templateId}`),
        api.get(`/forms/templates/${templateId}/submissions`),
      ]);
      setTpl(t.data);
      setRows(s.data || []);
    } catch { /* silent */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [templateId]);

  useEffect(() => { load(); }, [load]);

  const cat = CAT_COLORS[tpl?.category] || CAT_COLORS.general;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View testID="subs-header" style={[s.header, { backgroundColor: cat.bg, borderBottomColor: cat.ink + '30' }]}>
        <TouchableOpacity testID="subs-back" onPress={() => router.back()} style={{ padding: 4 }}>
          <Ionicons name="arrow-back" size={20} color={cat.ink} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[s.headerTitle, { color: cat.ink }]} numberOfLines={1}>{tpl?.name || '…'}</Text>
          <Text style={[s.headerSub, { color: cat.ink }]}>Submissions</Text>
        </View>
        <View style={[s.countBadge, { borderColor: cat.ink + '40' }]}>
          <Text style={[s.countBadgeText, { color: cat.ink }]}>{rows.length} total</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        {loading ? (
          <ActivityIndicator testID="subs-loading" style={{ marginTop: 40 }} color={Colors.blue} />
        ) : rows.length === 0 ? (
          <View testID="subs-empty" style={s.empty}>
            <Ionicons name="document-text" size={32} color={Colors.textTertiary} />
            <Text style={s.emptyTitle}>No submissions yet</Text>
            <Text style={s.emptyHint}>Fill out this form to create your first submission.</Text>
          </View>
        ) : rows.map((r) => (
          <TouchableOpacity key={r.id} testID={`submission-card-${r.id}`} style={s.card}
            onPress={() => router.push(`/forms/submission/${r.id}`)}>
            <View style={s.cardTop}>
              <View style={[s.statusBadge, r.status === 'complete' ? s.statusComplete : s.statusDraft]}>
                <Ionicons name={r.status === 'complete' ? 'checkmark-circle' : 'ellipse-outline'} size={10}
                  color={r.status === 'complete' ? '#1f7a3f' : '#8c6a1a'} />
                <Text style={[s.statusText, { color: r.status === 'complete' ? '#1f7a3f' : '#8c6a1a' }]}>
                  {r.status === 'complete' ? 'Complete' : 'Draft'}
                </Text>
              </View>
              <Text style={s.cardTime}>{r.submitted_at ? timeAgo(r.submitted_at) : '—'}</Text>
            </View>
            <Text style={s.cardName}>{r.submitted_by_name || '—'}</Text>
            <View style={s.cardMeta}>
              <View style={s.metaChip}><Ionicons name="image" size={11} color={Colors.textTertiary} /><Text style={s.metaText}>{r.photo_count || 0}</Text></View>
              <View style={s.metaChip}><Ionicons name="pencil" size={11} color={r.has_signature ? '#1f7a3f' : Colors.textTertiary} /><Text style={s.metaText}>{r.has_signature ? 'Signed' : 'Unsigned'}</Text></View>
              <View style={s.metaChip}><Ionicons name="location" size={11} color={r.has_gps ? '#1f7a3f' : Colors.textTertiary} /><Text style={s.metaText}>{r.has_gps ? 'Geo' : 'No geo'}</Text></View>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Floating add button */}
      <TouchableOpacity testID="subs-fillout" style={s.fab}
        onPress={() => router.push(`/forms/fill/${templateId}`)}>
        <Ionicons name="add" size={22} color="#fff" />
        <Text style={s.fabText}>Fill out new</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  headerSub: { fontSize: 11, opacity: 0.8 },
  countBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12,
    borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.6)',
  },
  countBadgeText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  card: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 14, padding: 14, marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12,
  },
  statusComplete: { backgroundColor: '#d8ecdd' },
  statusDraft: { backgroundColor: '#f7eed1' },
  statusText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardTime: { fontSize: 11, color: Colors.textTertiary },
  cardName: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  cardMeta: { flexDirection: 'row', gap: 10, marginTop: 6 },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 11, color: Colors.textTertiary },
  empty: { alignItems: 'center', paddingTop: 60, gap: 6 },
  emptyTitle: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  emptyHint: { fontSize: 12, color: Colors.textTertiary },
  fab: {
    position: 'absolute', bottom: 24, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#1e4a8c', borderRadius: 28, paddingHorizontal: 20, paddingVertical: 14,
    boxShadow: '0px 2px 6px rgba(0,0,0,0.15)', elevation: 4,
  },
  fabText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
