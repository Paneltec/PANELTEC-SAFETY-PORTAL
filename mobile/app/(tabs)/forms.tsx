/**
 * Forms Library tab — v58.13.132h M6-reset
 * Categorised form template list, permission-gated.
 * Replaces the M5 fragmented tabs (hazards, pre-starts, etc.)
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '../../src/theme/colors';
import {
  fetchFormTemplates,
  groupByCategory,
  type FormTemplate,
  type CategoryMeta,
} from '../../src/services/forms';
import { getStoredUser } from '../../src/services/auth';

export default function FormsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [userRole, setUserRole] = useState<string>('worker');

  // Load user role on mount
  React.useEffect(() => {
    getStoredUser().then((u) => {
      if (u?.role) setUserRole(u.role);
    });
  }, []);

  const { data: templates, isLoading, refetch } = useQuery<FormTemplate[]>({
    queryKey: ['form-templates'],
    queryFn: fetchFormTemplates,
    staleTime: 60_000,
    retry: 2,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // Filter by search
  const filteredTemplates = useMemo(() => {
    if (!templates) return [];
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) => t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q),
    );
  }, [templates, search]);

  // Group by category
  const grouped = useMemo(
    () => groupByCategory(filteredTemplates, userRole),
    [filteredTemplates, userRole],
  );

  const totalCount = templates?.length || 0;

  return (
    <View testID="forms-screen" style={[s.container, { paddingTop: insets.top }]}>
      {/* Navy header */}
      <View style={s.header}>
        <Text testID="forms-title" style={s.headerTitle}>Forms</Text>
        <Text style={s.headerSub}>{totalCount} templates available</Text>
      </View>

      {/* Search bar */}
      <View style={s.searchWrap}>
        <Ionicons name="search-outline" size={18} color={Colors.textTertiary} />
        <TextInput
          testID="forms-search-input"
          style={s.searchInput}
          placeholder="Search forms..."
          placeholderTextColor={Colors.textTertiary}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          autoCorrect={false}
        />
        {search.length > 0 && (
          <TouchableOpacity testID="forms-search-clear" onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={Colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {isLoading && !templates ? (
        <View testID="forms-loading" style={s.center}>
          <ActivityIndicator size="large" color={Colors.orange} />
          <Text style={s.loadingText}>Loading forms...</Text>
        </View>
      ) : (
        <ScrollView
          testID="forms-scroll"
          contentContainerStyle={s.scroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.orange} />
          }
        >
          {grouped.length === 0 ? (
            <View testID="forms-empty" style={s.emptyCard}>
              <Ionicons name="document-text-outline" size={32} color={Colors.textTertiary} />
              <Text style={s.emptyTitle}>No forms found</Text>
              <Text style={s.emptyText}>
                {search ? 'Try a different search term' : 'No form templates available'}
              </Text>
            </View>
          ) : (
            grouped.map(({ meta, forms }) => (
              <CategorySection
                key={meta.key}
                meta={meta}
                forms={forms}
                onFormPress={(t) =>
                  router.push({ pathname: '/forms/[id]', params: { id: t.id } } as never)
                }
              />
            ))
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}

// ── Category Section ──

function CategorySection({
  meta,
  forms,
  onFormPress,
}: {
  meta: CategoryMeta;
  forms: FormTemplate[];
  onFormPress: (t: FormTemplate) => void;
}) {
  return (
    <View testID={`forms-category-${meta.key}`} style={s.categoryBlock}>
      {/* Category header */}
      <View style={s.catHeaderRow}>
        <View style={[s.catIconCircle, { backgroundColor: meta.bgColor }]}>
          <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={16} color={meta.color} />
        </View>
        <Text style={s.catTitle}>{meta.label}</Text>
        <View style={[s.catCountBadge, { backgroundColor: meta.bgColor }]}>
          <Text style={[s.catCountText, { color: meta.color }]}>{forms.length}</Text>
        </View>
      </View>

      {/* Form cards */}
      {forms.map((t) => (
        <FormCard key={t.id} template={t} meta={meta} onPress={() => onFormPress(t)} />
      ))}
    </View>
  );
}

// ── Form Card ──

function FormCard({
  template,
  meta,
  onPress,
}: {
  template: FormTemplate;
  meta: CategoryMeta;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      testID={`form-card-${template.id}`}
      style={s.formCard}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[s.formCardAccent, { backgroundColor: meta.color }]} />
      <View style={s.formCardBody}>
        <Text testID={`form-name-${template.id}`} style={s.formName} numberOfLines={1}>
          {template.name}
        </Text>
        {template.description ? (
          <Text style={s.formDesc} numberOfLines={1}>{template.description}</Text>
        ) : null}
        <View style={s.formMeta}>
          <Text style={s.formFieldCount}>
            {template.fields?.length || 0} fields
          </Text>
          {template.submission_count > 0 && (
            <Text style={s.formSubmissions}>
              {template.submission_count} submitted
            </Text>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
    </TouchableOpacity>
  );
}

// ── Styles ──
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary, marginTop: 4 },
  scroll: { paddingBottom: 32 },

  // Header
  header: {
    backgroundColor: Colors.navy,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 18,
  },
  headerTitle: { color: Colors.white, fontSize: 26, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '500', marginTop: 2 },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.ink,
    padding: 0,
  },

  // Empty
  emptyCard: {
    alignItems: 'center',
    padding: 40,
    gap: 8,
    marginHorizontal: 16,
    marginTop: 20,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.ink },
  emptyText: { fontSize: 13, color: Colors.textTertiary, textAlign: 'center' },

  // Category section
  categoryBlock: { marginTop: 16, paddingHorizontal: 16 },
  catHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  catIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catTitle: { fontSize: 16, fontWeight: '800', color: Colors.ink, flex: 1 },
  catCountBadge: {
    borderRadius: 10,
    minWidth: 24,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  catCountText: { fontSize: 11, fontWeight: '700' },

  // Form card
  formCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    marginBottom: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  formCardAccent: { width: 4, alignSelf: 'stretch' },
  formCardBody: { flex: 1, paddingHorizontal: 14, paddingVertical: 12 },
  formName: { fontSize: 14, fontWeight: '700', color: Colors.ink },
  formDesc: { fontSize: 12, color: Colors.textTertiary, marginTop: 2 },
  formMeta: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  formFieldCount: { fontSize: 11, color: Colors.textTertiary, fontWeight: '500' },
  formSubmissions: { fontSize: 11, color: Colors.orange, fontWeight: '600' },
});
