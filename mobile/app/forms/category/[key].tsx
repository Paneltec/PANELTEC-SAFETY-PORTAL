// v160.0.15 — Forms Level 2: templates in ONE category.
// Reached by tapping a category card on the Forms tab. Tap a row → fill.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
    <SafeAreaView style={s.safe}>
      <ScrollView
        testID={`category-page-${catKey}`}
        style={s.scroll}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.orange} />}
      >
        <TouchableOpacity testID="back-btn" style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color={Colors.orange} />
          <Text style={s.backText}>Forms</Text>
        </TouchableOpacity>

        <Text style={s.heading}>{catLabel}</Text>

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
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 },
  backText: { fontSize: 13, fontWeight: '700', color: Colors.orange },
  overline: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: Colors.orange },
  heading: { fontSize: 20, fontWeight: '800', color: Colors.ink, marginTop: 2, marginBottom: 14 },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 4, marginBottom: 18 },
  emptyBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 14, color: Colors.textTertiary, textAlign: 'center', paddingHorizontal: 24 },
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
