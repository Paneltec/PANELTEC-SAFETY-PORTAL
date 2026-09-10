/**
 * Category detail — shows forms filtered to a single category.
 * v58.13.132j
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

export default function CategoryDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();
  const meta = getCategoryMeta(key || 'general');

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
      <View style={s.header}>
        <TouchableOpacity testID="cat-back-btn" style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={Colors.white} />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text testID="cat-detail-title" style={s.headerTitle}>{meta.label}</Text>
        </View>
        <View style={[s.countChip, { backgroundColor: meta.bgColor }]}>
          <Text style={[s.countChipText, { color: meta.color }]}>{forms.length}</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={s.center}><ActivityIndicator size="large" color={Colors.orange} /></View>
      ) : forms.length === 0 ? (
        <View style={s.center}>
          <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={40} color={Colors.textTertiary} />
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
                // v58.13.132l — SWMS rows open the existing viewer at
                // /profile/swms/[id], not the standard form runner.
                if (t.is_swms) {
                  router.push({ pathname: '/profile/swms/[id]', params: { id: t.id } } as never);
                } else {
                  router.push({ pathname: '/forms/[id]', params: { id: t.id } } as never);
                }
              }}
              activeOpacity={0.7}
            >
              <View style={[s.accent, { backgroundColor: meta.color }]} />
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
                        <Text style={s.subCount}>{t.swms_status}</Text>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <Text style={s.fieldCount}>{t.fields?.length || 0} fields</Text>
                      {t.submission_count > 0 && (
                        <Text style={s.subCount}>{t.submission_count} submitted</Text>
                      )}
                    </>
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

  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.navy, paddingHorizontal: 8, paddingVertical: 14,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.white },
  countChip: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, marginRight: 8 },
  countChipText: { fontSize: 12, fontWeight: '700' },

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
  subCount: { fontSize: 11, color: Colors.orange, fontWeight: '600' },
});
