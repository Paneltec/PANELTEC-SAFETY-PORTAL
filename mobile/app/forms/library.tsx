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
                    <Ionicons name={cat.icon} size={22} color={dimmed ? Colors.textTertiary : Colors.tileLightAccentIcon} />
                  </View>
                  <Text style={[s.cardTitle, dimmed && s.dimText]}>{cat.label}</Text>
                  <Text style={[s.cardBlurb, dimmed && s.dimText]} numberOfLines={2}>{cat.blurb}</Text>
                  <View style={s.cardFoot}>
                    <Text style={[s.cardCount, dimmed && s.dimText]}>
                      {n} {n === 1 ? 'form' : 'forms'}
                    </Text>
                    {!dimmed && <Ionicons name="chevron-forward" size={14} color={Colors.tileLightMuted} />}
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
    // v160.0.22 — LIGHT paper card on darker library background. High
    // contrast on-device; matches user brief "lighter tiles please".
    backgroundColor: Colors.tileLight,
    borderWidth: 1, borderColor: Colors.tileLightBorder,
    borderRadius: 16, padding: 14, gap: 6,
    // Soft lift shadow so the light tile visually detaches from the
    // dark library background.
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardDim: { opacity: 0.4 },
  iconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: Colors.tileLightAccentBg, alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  iconWrapDim: { backgroundColor: Colors.surfaceLight },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Colors.tileLightInk },
  cardBlurb: { fontSize: 11, color: Colors.tileLightMuted, lineHeight: 15 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 8 },
  cardCount: { fontSize: 11, fontWeight: '700', color: Colors.tileLightAccentIcon, letterSpacing: 0.5 },
  dimText: { color: Colors.textTertiary },
});
