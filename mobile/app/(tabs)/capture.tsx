// v160.0.14 — Categorised forms list.
// Renamed from "Create & Capture" tile grid → "Forms" category list.
// Workers pick a template, tap, fill. Server-side (`/api/forms/templates`)
// already intersects with the caller's role's `role_form_allowlist`
// (v160.0.13), so this screen never shows a form the worker can't submit.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../../src/lib/api';
import { Colors } from '../../src/lib/colors';
import { toast } from '../../src/lib/toast';

type Template = {
  id: string;
  name: string;
  category?: string;
  description?: string;
};

const CATEGORY_ORDER: Array<{ key: string; label: string }> = [
  { key: 'general',    label: 'General'     },
  { key: 'pre_start',  label: 'Pre-Start'   },
  { key: 'inspection', label: 'Inspection'  },
  { key: 'near_miss',  label: 'Near Miss'   },
  { key: 'incident',   label: 'Incident'    },
  { key: 'toolbox',    label: 'Toolbox'     },
];

export default function FormsCaptureScreen() {
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

  const grouped = useMemo(() => {
    const buckets: Record<string, Template[]> = {};
    for (const t of templates) {
      const c = (t.category || 'general').toLowerCase();
      const bucket = CATEGORY_ORDER.find((x) => x.key === c) ? c : 'general';
      (buckets[bucket] ||= []).push(t);
    }
    for (const arr of Object.values(buckets)) arr.sort((a, b) => a.name.localeCompare(b.name));
    return buckets;
  }, [templates]);

  const hasAny = templates.length > 0;

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        testID="forms-capture-page"
        style={s.scroll}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.orange} />}
      >
        <Text style={s.overline}>CAPTURE</Text>
        <Text style={s.heading}>Forms</Text>
        <Text style={s.sub}>Tap a form to fill it in. Enabled forms are curated by your admin per role.</Text>

        {loading ? (
          <View style={s.emptyBox}>
            <ActivityIndicator color={Colors.orange} />
            <Text style={s.emptyText}>Loading…</Text>
          </View>
        ) : !hasAny ? (
          <View style={s.emptyBox}>
            <Ionicons name="document-outline" size={28} color={Colors.textTertiary} />
            <Text style={s.emptyText}>No forms enabled for your role — contact your admin.</Text>
          </View>
        ) : (
          CATEGORY_ORDER.map(({ key, label }) => {
            const rows = grouped[key];
            if (!rows?.length) return null;
            return (
              <View key={key} testID={`cat-${key}`} style={s.catBlock}>
                <View style={s.catHeader}>
                  <View style={s.catDot} />
                  <Text style={s.catLabel}>{label.toUpperCase()}</Text>
                  <Text style={s.catCount}>· {rows.length}</Text>
                </View>
                {rows.map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    testID={`form-row-${t.id}`}
                    style={s.row}
                    onPress={() => router.push(`/forms/fill/${t.id}` as any)}
                    activeOpacity={0.7}
                  >
                    <View style={s.rowIcon}>
                      <Ionicons name="document-text" size={18} color={Colors.orange} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowTitle} numberOfLines={1}>{t.name}</Text>
                      {t.description ? (
                        <Text style={s.rowDesc} numberOfLines={2}>{t.description}</Text>
                      ) : null}
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
                  </TouchableOpacity>
                ))}
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
  overline: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: Colors.orange },
  heading: { fontSize: 26, fontWeight: '800', color: Colors.ink, marginTop: 4, letterSpacing: 0.5 },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 4, marginBottom: 18 },
  emptyBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 14, color: Colors.textTertiary, textAlign: 'center', paddingHorizontal: 24 },
  catBlock: { marginBottom: 18 },
  catHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, marginBottom: 6 },
  catDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.orange },
  catLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: Colors.orange },
  catCount: { fontSize: 11, fontWeight: '600', color: Colors.textTertiary },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    minHeight: 44, marginBottom: 6,
  },
  rowIcon: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.orangeSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  rowDesc: { fontSize: 11, color: Colors.textSecondary, marginTop: 2, lineHeight: 15 },
});
