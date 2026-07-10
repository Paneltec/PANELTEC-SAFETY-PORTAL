// v160.0.15 — Forms Level 1: six category cards.
// Tapping a category → /forms/category/[key] which lists only that
// category's templates. Level 3 (fill-out) unchanged at /forms/fill/[id].
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../../src/lib/api';
import { Colors } from '../../src/lib/colors';
import { toast } from '../../src/lib/toast';
type Template = { id: string; name: string; category?: string; description?: string };

const CATEGORIES: Array<{ key: string; label: string; icon: any; blurb: string }> = [
  { key: 'general',    label: 'General',    icon: 'clipboard',            blurb: 'Permits · sign-on · site safety' },
  { key: 'pre_start',  label: 'Pre-Start',  icon: 'construct',            blurb: 'Plant & crew pre-op checks' },
  { key: 'inspection', label: 'Inspection', icon: 'checkmark-circle',     blurb: 'Site walks · plant · scaffold' },
  { key: 'near_miss',  label: 'Near Miss',  icon: 'warning',              blurb: 'Log a near-miss observation' },
  { key: 'incident',   label: 'Incident',   icon: 'alert-circle',         blurb: 'Reportable incidents & injuries' },
  { key: 'toolbox',    label: 'Toolbox',    icon: 'chatbubbles',          blurb: 'Toolbox talks · pre-shift briefings' },
];

export default function FormsCategoriesScreen() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/forms/templates');
      setTemplates(Array.isArray(data) ? data : []);
    } catch (e: any) {
      toast.error(apiError(e) || 'Could not load forms');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = () => { setRefreshing(true); load(); };

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of templates) {
      const c = (t.category || 'general').toLowerCase();
      map[c] = (map[c] || 0) + 1;
    }
    return map;
  }, [templates]);

  const totalEnabled = templates.length;

  return (
    <SafeAreaView edges={['top']} style={s.safe}>
      {/* v160.0.19 — Back button lives OUTSIDE the ScrollView as a sticky
          sibling so it stays visible while the grid scrolls. */}
      <View style={s.stickyHeader}>
        <TouchableOpacity testID="library-back-btn" style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color={Colors.orange} />
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        testID="forms-categories-page"
        style={s.scroll}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.orange} />}
      >
        {loading ? (
          <View style={s.emptyBox}>
            <ActivityIndicator color={Colors.orange} />
            <Text style={s.emptyText}>Loading…</Text>
          </View>
        ) : totalEnabled === 0 ? (
          <View style={s.emptyBox}>
            <Ionicons name="document-outline" size={28} color={Colors.textTertiary} />
            <Text style={s.emptyText}>No forms enabled for your role — contact your admin.</Text>
          </View>
        ) : (
          <View style={s.grid}>
            {CATEGORIES.map((cat) => {
              const n = counts[cat.key] || 0;
              const dimmed = n === 0;
              return (
                <TouchableOpacity
                  key={cat.key}
                  testID={`cat-card-${cat.key}`}
                  disabled={dimmed}
                  onPress={() => router.push(`/forms/category/${cat.key}` as any)}
                  activeOpacity={0.75}
                  style={[s.card, dimmed && s.cardDim]}
                >
                  <View style={[s.iconWrap, dimmed && s.iconWrapDim]}>
                    <Ionicons name={cat.icon} size={22} color={dimmed ? Colors.textTertiary : Colors.orange} />
                  </View>
                  <Text style={[s.cardTitle, dimmed && s.dimText]}>{cat.label}</Text>
                  <Text style={[s.cardBlurb, dimmed && s.dimText]} numberOfLines={2}>{cat.blurb}</Text>
                  <View style={s.cardFoot}>
                    <Text style={[s.cardCount, dimmed && s.dimText]}>
                      {n} {n === 1 ? 'form' : 'forms'}
                    </Text>
                    {!dimmed && <Ionicons name="chevron-forward" size={14} color={Colors.textTertiary} />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.libraryBg },
  stickyHeader: {
    // v160.0.19 — Sibling above the ScrollView, so it never scrolls away.
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  scroll: { flex: 1 },
  content: { paddingTop: 12, paddingBottom: 32 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { fontSize: 14, fontWeight: '700', color: Colors.orange },
  overline: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: Colors.orange },
  heading: { fontSize: 26, fontWeight: '800', color: Colors.ink, marginTop: 4 },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 4, marginBottom: 18 },
  emptyBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 14, color: Colors.textTertiary, textAlign: 'center', paddingHorizontal: 24 },
  grid: {
    // v160.0.19 — exact spec from user brief. `space-between` + width 48%
    // guarantees a 2-column layout regardless of viewport.
    flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  card: {
    width: '48%',
    minHeight: 120,
    marginBottom: 12,
    backgroundColor: Colors.tileWarm,
    borderWidth: 1, borderColor: Colors.border,
    borderRadius: 16, padding: 14, gap: 6,
  },
  cardDim: { opacity: 0.4 },
  iconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: Colors.orangeSoft, alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  iconWrapDim: { backgroundColor: Colors.surfaceLight },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Colors.ink },
  cardBlurb: { fontSize: 11, color: Colors.textSecondary, lineHeight: 15 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 8 },
  cardCount: { fontSize: 11, fontWeight: '700', color: Colors.orange, letterSpacing: 0.5 },
  dimText: { color: Colors.textTertiary },
});
