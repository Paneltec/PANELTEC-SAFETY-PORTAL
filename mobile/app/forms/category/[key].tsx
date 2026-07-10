// v160.0.15 — Forms Level 2: templates in ONE category.
// Reached by tapping a category card on the Forms tab. Tap a row → fill.
// v160.0.22 — Rows switched to LIGHT paper cards on the darker library
// background. Sticky header padTop now reads useSafeAreaInsets() so the
// Android status bar can never re-cover the back chevron.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, StatusBar as RNStatusBar, Platform } from 'react-native';
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

  return (
    <View style={s.safe}>
      {/* v160.0.23 — Solid opaque sticky header. Explicit spacer above
          the back button so the notch/punch-hole zone is fully covered. */}
      <View style={s.stickyHeader}>
        <View style={{ height: headerTopPad }} />
        <TouchableOpacity testID="back-btn" style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color={Colors.orange} />
          <Text style={s.backText}>Forms</Text>
        </TouchableOpacity>
        <Text style={s.heading}>{catLabel}</Text>
      </View>
      <ScrollView
        testID={`category-page-${catKey}`}
        style={s.scroll}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.orange} />}
      >

        {loading ? (
          <View style={s.emptyBox}>
            <ActivityIndicator color={Colors.orange} />
            <Text style={s.emptyText}>Loading…</Text>
          </View>
        ) : templates.length === 0 ? (
          <View style={s.emptyBox}>
            <Ionicons name="document-outline" size={28} color={Colors.textTertiary} />
            <Text style={s.emptyText}>No forms in this category for your role.</Text>
          </View>
        ) : (
          templates.map((t) => (
            <TouchableOpacity
              key={t.id}
              testID={`form-row-${t.id}`}
              style={s.row}
              onPress={() => router.push(`/forms/fill/${t.id}` as any)}
              activeOpacity={0.7}
            >
              <View style={s.rowIcon}>
                <Ionicons name="document-text" size={18} color={Colors.tileLightAccentIcon} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle} numberOfLines={1}>{t.name}</Text>
                {t.description ? (
                  <Text style={s.rowDesc} numberOfLines={2}>{t.description}</Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.tileLightMuted} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.libraryBg },
  stickyHeader: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  backText: { fontSize: 13, fontWeight: '700', color: Colors.orange },
  overline: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: Colors.orange },
  heading: { fontSize: 20, fontWeight: '800', color: Colors.ink, marginTop: 2 },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 4, marginBottom: 18 },
  emptyBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 14, color: Colors.textTertiary, textAlign: 'center', paddingHorizontal: 24 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    // v160.0.22 — Light paper row on dark library bg.
    backgroundColor: Colors.tileLight, borderWidth: 1, borderColor: Colors.tileLightBorder,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    minHeight: 44, marginBottom: 6,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  rowIcon: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.tileLightAccentBg,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { fontSize: 14, fontWeight: '600', color: Colors.tileLightInk },
  rowDesc: { fontSize: 11, color: Colors.tileLightMuted, marginTop: 2, lineHeight: 15 },
});
