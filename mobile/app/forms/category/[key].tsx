/**
 * Category detail — shows forms filtered to a single category.
 * v58.13.132p2f — Option B header with SVG icon + colour tint.
 */
import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '../../../src/theme/colors';
import {
  fetchFormTemplates,
  getCategoryMeta,
  type FormTemplate,
} from '../../../src/services/forms';
import { categoryPalette } from '../../../src/lib/categoryColors';
import { CategoryIcon } from '../../../src/components/CategoryIcon';

export default function CategoryDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();
  const meta = getCategoryMeta(key || 'general');
  const palette = categoryPalette(key || 'general');

  const { data: allTemplates, isLoading } = useQuery<FormTemplate[]>({
    queryKey: ['form-templates'],
    queryFn: fetchFormTemplates,
    staleTime: 60_000,
  });

  const forms = (allTemplates || [])
    .filter((t) => (t.category || 'general') === key)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <View testID="category-detail-screen" style={[s.container, { paddingTop: insets.top }]}>
      {/* Header with category colour accent */}
      <View style={s.header}>
        <TouchableOpacity testID="cat-back-btn" style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={Colors.white} />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <View style={s.headerRow}>
            {/* Tinted icon badge */}
            <View style={[s.headerIconWrap, { backgroundColor: palette.iconBg }]}>
              <CategoryIcon category={key || 'general'} size={18} color={palette.chipText} />
            </View>
            <Text testID="cat-detail-title" style={s.headerTitle}>{meta.label}</Text>
          </View>
        </View>
        <View style={[s.countChip, { backgroundColor: palette.iconBg }]}>
          <Text style={[s.countChipText, { color: palette.chipText }]}>{forms.length}</Text>
        </View>
      </View>
      {/* Thin accent bar under header */}
      <View style={[s.accentBar, { backgroundColor: palette.stripe }]} />

      {isLoading ? (
        <View style={s.center}><ActivityIndicator size="large" color={Colors.orange} /></View>
      ) : forms.length === 0 ? (
        <View style={s.center}>
          <View style={[s.emptyIconWrap, { backgroundColor: palette.iconBg }]}>
            <CategoryIcon category={key || 'general'} size={32} color={palette.chipText} />
          </View>
          <Text style={s.emptyText}>No forms in this category yet.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          {forms.map((t) => (
            <TouchableOpacity
              key={t.id}
              testID={`cat-form-${t.id}`}
              style={s.formCard}
              onPress={() => {
                if (t.is_swms) {
                  router.push({ pathname: '/swms/[id]', params: { id: t.id } } as never);
                } else {
                  router.push({ pathname: '/forms/[id]', params: { id: t.id } } as never);
                }
              }}
              activeOpacity={0.7}
            >
              <View style={[s.accent, { backgroundColor: palette.stripe }]} />
              <View style={s.formBody}>
                <Text style={s.formName} numberOfLines={1}>{t.name}</Text>
                {t.description ? (
                  <Text style={s.formDesc} numberOfLines={2}>{t.description}</Text>
                ) : null}
                <View style={s.formMeta}>
                  {t.is_swms ? (
                    <>
                      {t.swms_version ? (
                        <Text style={s.fieldCount}>v{t.swms_version}</Text>
                      ) : null}
                      {t.swms_status ? (
                        <Text style={[s.subCount, { color: palette.stripe }]}>{t.swms_status}</Text>
                      ) : null}
                    </>
                  ) : (
                    <Text style={s.fieldCount}>{t.fields?.length || 0} fields</Text>
                  )}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  scroll: { paddingBottom: 40 },
  emptyText: { fontSize: 15, color: Colors.textTertiary },
  emptyIconWrap: { width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.navy, paddingHorizontal: 8, paddingVertical: 14,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIconWrap: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.white },
  countChip: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, marginRight: 8 },
  countChipText: { fontSize: 13, fontWeight: '700' },

  accentBar: { height: 3 },

  formCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, marginHorizontal: 16, marginTop: 8,
    borderRadius: 14, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  accent: { width: 4, alignSelf: 'stretch' },
  formBody: { flex: 1, paddingHorizontal: 14, paddingVertical: 12 },
  formName: { fontSize: 15, fontWeight: '700', color: Colors.ink },
  formDesc: { fontSize: 12, color: Colors.textTertiary, marginTop: 3, lineHeight: 17 },
  formMeta: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  fieldCount: { fontSize: 11, color: Colors.textTertiary, fontWeight: '500' },
  subCount: { fontSize: 11, fontWeight: '600' },
});
