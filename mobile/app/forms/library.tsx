// v160.0.15 — Forms Level 1: six category cards.
// Tapping a category → /forms/category/[key] which lists only that
// category's templates. Level 3 (fill-out) unchanged at /forms/fill/[id].
// v160.0.22 — Tiles switched to LIGHT paper cards (Colors.tileLight)
// on the dark library background, and the sticky header padTop now
// reads `useSafeAreaInsets()` explicitly so the Android status bar
// no longer covers the "Back" chevron.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, StatusBar as RNStatusBar, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();
  // v160.0.23 — BRUTE-FORCE notch pad. Hard floor of 44 so title cannot
  // sit within 44px of physical top on any Android device.
  const androidExtra = Platform.OS === 'android' ? (RNStatusBar.currentHeight || 0) + 16 : 24;
  const headerTopPad = Math.max(insets.top, androidExtra, 44);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // v160.0.23 — Verification log per user brief. Prints real values so
  // we can eyeball what insets.top / StatusBar.currentHeight actually
  // are on the device the user is testing on.
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[v160.0.23 notch-debug]', {
      platform: Platform.OS,
      insets_top: insets.top,
      statusBar_currentHeight: RNStatusBar.currentHeight,
      headerTopPad,
    });
  }, [insets.top, headerTopPad]);

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
    <View style={s.safe}>
      {/* v160.0.23 — Solid opaque header wrapper. `stickyHeader` already
          uses an opaque bg — we split the padding out of the header row
          and instead render an explicit spacer View ABOVE the back button
          so the notch backdrop is a distinct visual element and the
          content sits cleanly below it. */}
      <View style={s.stickyHeader}>
        <View style={{ height: headerTopPad }} />
        <View style={s.headerRow}>
          <TouchableOpacity testID="library-back-btn" style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={20} color={Colors.brandSurface} />
            <Text style={s.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>Forms Library</Text>
          <View style={{ width: 56 }} />
        </View>
      </View>
      <ScrollView
        testID="forms-categories-page"
        style={s.scroll}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.brandOrange} />}
      >
        {loading ? (
          <View style={s.emptyBox}>
            <ActivityIndicator color={Colors.brandOrange} />
            <Text style={s.emptyText}>Loading…</Text>
          </View>
        ) : totalEnabled === 0 ? (
          <View style={s.emptyBox}>
            <Ionicons name="document-outline" size={28} color={Colors.brandInkMuted} />
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
                    <Ionicons name={cat.icon} size={22} color={dimmed ? Colors.textTertiary : Colors.brandSurface} />
                  </View>
                  <Text style={[s.cardTitle, dimmed && s.dimText]}>{cat.label}</Text>
                  <Text style={[s.cardBlurb, dimmed && s.dimText]} numberOfLines={2}>{cat.blurb}</Text>
                  <View style={s.cardFoot}>
                    <Text style={[s.cardCount, dimmed && s.dimText]}>
                      {n} {n === 1 ? 'form' : 'forms'}
                    </Text>
                    {!dimmed && <Ionicons name="chevron-forward" size={14} color={Colors.brandInkMuted} />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  // v160.0.24 — Brand palette applied to Forms Library ONLY.
  safe: { flex: 1, backgroundColor: Colors.brandBgLight },
  stickyHeader: {
    // Sibling above the ScrollView, so it never scrolls away.
    backgroundColor: Colors.brandNavy,
    paddingHorizontal: 16, paddingBottom: 14,
  },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 32,
  },
  scroll: { flex: 1 },
  content: { paddingTop: 12, paddingBottom: 32 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 56 },
  backText: { fontSize: 14, fontWeight: '700', color: Colors.brandSurface },
  headerTitle: {
    fontSize: 16, fontWeight: '700', color: Colors.brandSurface,
    letterSpacing: 0.2,
  },
  overline: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: Colors.brandOrange },
  heading: { fontSize: 26, fontWeight: '800', color: Colors.brandInk, marginTop: 4 },
  sub: { fontSize: 13, color: Colors.brandInkMuted, marginTop: 4, marginBottom: 18 },
  emptyBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 14, color: Colors.brandInkMuted, textAlign: 'center', paddingHorizontal: 24 },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  card: {
    width: '48%',
    minHeight: 128,
    marginBottom: 12,
    backgroundColor: Colors.brandSurface,
    borderWidth: 1, borderColor: '#CBD5E1',
    borderRadius: 16, padding: 14, gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardDim: { opacity: 0.4 },
  iconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: Colors.brandOrange, alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  iconWrapDim: { backgroundColor: Colors.surfaceLight },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Colors.brandInk },
  cardBlurb: { fontSize: 11, color: Colors.brandInkMuted, lineHeight: 15 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 8 },
  cardCount: { fontSize: 11, fontWeight: '700', color: Colors.brandOrange, letterSpacing: 0.5 },
  dimText: { color: Colors.textTertiary },
});
