// v160.0.15 — Forms Level 2: templates in ONE category.
// Reached by tapping a category card on the Forms tab. Tap a row → fill.
// v160.0.22 — Rows switched to LIGHT paper cards on the darker library
// background. Sticky header padTop now reads useSafeAreaInsets() so the
// Android status bar can never re-cover the back chevron.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, StatusBar as RNStatusBar, Platform, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../../../src/lib/api';
import { Colors } from '../../../src/lib/colors';
import { toast } from '../../../src/lib/toast';

type Template = { id: string; name: string; category?: string; description?: string };

const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  pre_start: 'Pre-Start',
  inspection: 'Inspection',
  near_miss: 'Near Miss',
  incident: 'Incident',
  toolbox: 'Toolbox',
};

export default function CategoryFormsScreen() {
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();
  const insets = useSafeAreaInsets();
  // v160.0.23 — BRUTE-FORCE notch pad, hard floor 44.
  const androidExtra = Platform.OS === 'android' ? (RNStatusBar.currentHeight || 0) + 16 : 24;
  const headerTopPad = Math.max(insets.top, androidExtra, 44);
  const catKey = (key || 'general').toLowerCase();
  const catLabel = CATEGORY_LABELS[catKey] || 'Forms';
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // v160.2.5b — In-category search input.
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/forms/templates', { params: { category: catKey } });
      setTemplates(Array.isArray(data) ? data.filter((t) => (t.category || 'general').toLowerCase() === catKey) : []);
    } catch (e: any) {
      toast.error(apiError(e) || 'Could not load forms');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [catKey]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = () => { setRefreshing(true); load(); };

  // v160.2.5b — Filter the current category's templates by search term.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return templates;
    return templates.filter((t) =>
      (t.name || '').toLowerCase().includes(needle) ||
      (t.description || '').toLowerCase().includes(needle)
    );
  }, [q, templates]);

  return (
    <View style={s.safe}>
      {/* v160.0.23 — Solid opaque sticky header. Explicit spacer above
          the back button so the notch/punch-hole zone is fully covered. */}
      <View style={s.stickyHeader}>
        <View style={{ height: headerTopPad }} />
        <TouchableOpacity testID="back-btn" style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={20} color={Colors.hvOrange} />
          <Text style={s.backText}>Forms</Text>
        </TouchableOpacity>
        <Text style={s.heading}>{catLabel}</Text>
        {/* v160.2.5b — In-category search. */}
        <View style={s.searchRow}>
          <Ionicons name="search" size={16} color={Colors.brandInkMuted} />
          <TextInput
            testID="category-search-input"
            style={s.searchInput}
            value={q}
            onChangeText={setQ}
            placeholder="Search in this category…"
            placeholderTextColor={Colors.brandInkMuted}
            underlineColorAndroid="transparent"
            selectionColor={Colors.hvOrange}
          />
          {q.length > 0 && (
            <TouchableOpacity testID="category-search-clear" onPress={() => setQ('')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={16} color={Colors.brandInkMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>
      <ScrollView
        testID={`category-page-${catKey}`}
        style={s.scroll}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.brandOrange} />}
      >

        {loading ? (
          <View style={s.emptyBox}>
            <ActivityIndicator color={Colors.brandOrange} />
            <Text style={s.emptyText}>Loading…</Text>
          </View>
        ) : templates.length === 0 ? (
          <View style={s.emptyBox}>
            <Ionicons name="document-outline" size={28} color={Colors.brandInkMuted} />
            <Text style={s.emptyText}>No forms in this category for your role.</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={s.emptyBox}>
            <Ionicons name="search" size={28} color={Colors.brandInkMuted} />
            <Text style={s.emptyText}>No forms match “{q.trim()}”.</Text>
          </View>
        ) : (
          filtered.map((t) => (
            <TouchableOpacity
              key={t.id}
              testID={`form-row-${t.id}`}
              style={s.row}
              onPress={() => router.push(`/forms/fill/${t.id}` as any)}
              activeOpacity={0.7}
            >
              <View style={s.rowIcon}>
                <Ionicons name="document-text" size={18} color={Colors.brandSurface} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle} numberOfLines={1}>{t.name}</Text>
                {t.description ? (
                  <Text style={s.rowDesc} numberOfLines={2}>{t.description}</Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.brandInkMuted} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  // v160.0.24 — Brand palette applied to Forms/Category ONLY.
  safe: { flex: 1, backgroundColor: Colors.brandBgLight },
  stickyHeader: {
    backgroundColor: Colors.bg,
    paddingHorizontal: 16, paddingBottom: 14,
  },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 4 },
  backText: { fontSize: 13, fontWeight: '700', color: Colors.hvOrange },
  overline: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: Colors.brandOrange },
  heading: { fontSize: 20, fontWeight: '800', color: Colors.ink, marginTop: 2 },
  sub: { fontSize: 13, color: Colors.brandInkMuted, marginTop: 4, marginBottom: 18 },
  emptyBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 14, color: Colors.brandInkMuted, textAlign: 'center', paddingHorizontal: 24 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.brandSurface,
    borderWidth: 1, borderColor: Colors.imBorder,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    minHeight: 48, marginBottom: 8,
    boxShadow: '0px 1px 4px rgba(0,0,0,0.06)',
    elevation: 1,
  },
  rowIcon: {
    width: 34, height: 34, borderRadius: 8, backgroundColor: Colors.brandOrange,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { fontSize: 14, fontWeight: '700', color: Colors.brandInk },
  rowDesc: { fontSize: 11, color: Colors.brandInkMuted, marginTop: 2, lineHeight: 15 },
  // v160.2.5b — In-category search input styling (dark header context).
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface,
    borderRadius: 10, paddingHorizontal: 10,
    marginTop: 10,
  },
  searchInput: {
    flex: 1, paddingVertical: 8, fontSize: 14,
    color: Colors.ink,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none', outlineWidth: 0 } as any : {}),
  },
});
