/**
 * Forms tab — Category-first navigation.
 * v58.13.132jm — coloured category icons + LH stripe on tiles.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, TextInput, Image,
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
import { categoryPalette } from '../../src/lib/categoryColors';

export default function FormsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [userRole, setUserRole] = useState<string>('worker');

  React.useEffect(() => {
    getStoredUser().then((u) => {
      const role = u?.role_id || u?.role;
      if (role) setUserRole(role);
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

  const isSearching = search.trim().length > 0;

  const searchResults = useMemo(() => {
    if (!templates || !isSearching) return [];
    const q = search.trim().toLowerCase();
    return templates.filter(
      (t) => t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q),
    );
  }, [templates, search, isSearching]);

  const grouped = useMemo(
    () => groupByCategory(templates || [], userRole),
    [templates, userRole],
  );

  const totalCount = templates?.length || 0;

  return (
    <View testID="forms-screen" style={[s.container, { paddingTop: insets.top }]}>
      {/* Navy header */}
      <View style={s.header}>
        <Text testID="forms-title" style={s.headerTitle}>Forms</Text>
        <Text style={s.headerSub}>{totalCount} templates across {grouped.length} categories</Text>
      </View>

      {/* Search bar */}
      <View style={s.searchWrap}>
        <Ionicons name="search-outline" size={18} color={Colors.textTertiary} />
        <TextInput
          testID="forms-search-input"
          style={s.searchInput}
          placeholder="Search all forms..."
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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.orange} />}
        >
          {isSearching ? (
            searchResults.length === 0 ? (
              <View testID="forms-search-empty" style={s.emptyCard}>
                <Ionicons name="search" size={32} color={Colors.textTertiary} />
                <Text style={s.emptyTitle}>No results</Text>
                <Text style={s.emptyText}>{"No forms match \u201c"}{search}{"\u201d"}</Text>
              </View>
            ) : (
              <View style={s.searchResults}>
                <Text style={s.searchLabel}>{searchResults.length} result{searchResults.length !== 1 ? 's' : ''}</Text>
                {searchResults.map((t) => (
                  <SearchResultCard
                    key={t.id}
                    template={t}
                    onPress={() => {
                      router.push({ pathname: '/forms/[id]', params: { id: t.id } } as never);
                    }}
                  />
                ))}
              </View>
            )
          ) : (
            grouped.length === 0 ? (
              <View testID="forms-empty" style={s.emptyCard}>
                <Ionicons name="document-text-outline" size={32} color={Colors.textTertiary} />
                <Text style={s.emptyTitle}>No forms available</Text>
              </View>
            ) : (
              <View style={s.catGrid}>
                {grouped.map(({ meta, forms }) => (
                  <CategoryCard
                    key={meta.key}
                    meta={meta}
                    formCount={forms.length}
                    onPress={() =>
                      router.push({ pathname: '/forms/category/[key]', params: { key: meta.key } } as never)
                    }
                  />
                ))}
              </View>
            )
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}

// ── Category Card with LH stripe + coloured icon ──

function CategoryCard({ meta, formCount, onPress }: {
  meta: CategoryMeta; formCount: number; onPress: () => void;
}) {
  const palette = categoryPalette(meta.key);

  return (
    <TouchableOpacity
      testID={`cat-card-${meta.key}`}
      style={s.catCard}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* LH colour stripe */}
      <View style={[s.catStripe, { backgroundColor: palette.stripe }]} />

      {/* Content area */}
      <View style={s.catContent}>
        <Image source={palette.icon} style={s.catIcon} />
        <View style={s.catTextWrap}>
          <Text style={[s.catName, { color: palette.chipText }]}>{meta.label}</Text>
          <Text style={s.catCount}>{formCount} form{formCount !== 1 ? 's' : ''}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
      </View>
    </TouchableOpacity>
  );
}

// ── Search Result Card with LH stripe ──

function SearchResultCard({ template, onPress }: {
  template: FormTemplate; onPress: () => void;
}) {
  const palette = categoryPalette(template.category);

  return (
    <TouchableOpacity testID={`search-result-${template.id}`} style={s.resultCard} onPress={onPress} activeOpacity={0.7}>
      {/* LH stripe */}
      <View style={[s.resultStripe, { backgroundColor: palette.stripe }]} />
      <View style={s.resultContent}>
        <View style={s.resultInfo}>
          <Text style={s.resultName} numberOfLines={1}>{template.name}</Text>
          {template.description ? (
            <Text style={s.resultDesc} numberOfLines={1}>{template.description}</Text>
          ) : null}
          <Text style={[s.resultCat, { color: palette.chipText }]}>{template.category.replace('_', ' ')}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.navyLight },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  scroll: { paddingBottom: 32 },

  header: { backgroundColor: Colors.navy, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 18 },
  headerTitle: { color: Colors.white, fontSize: 26, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: '500', marginTop: 2 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surface, borderRadius: 14,
    marginHorizontal: 16, marginTop: 12, marginBottom: 8,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  searchInput: { flex: 1, fontSize: 16, color: Colors.ink, padding: 0 },

  emptyCard: { alignItems: 'center', padding: 40, gap: 8, marginHorizontal: 16, marginTop: 20 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.white },
  emptyText: { fontSize: 13, color: 'rgba(255,255,255,0.55)', textAlign: 'center' },

  // Category grid
  catGrid: { paddingHorizontal: 16, paddingTop: 8 },
  catCard: {
    flexDirection: 'row', alignItems: 'stretch',
    backgroundColor: Colors.surface, borderRadius: 16, marginBottom: 10,
    minHeight: 72, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  catStripe: { width: 8, borderTopLeftRadius: 16, borderBottomLeftRadius: 16 },
  catContent: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, paddingHorizontal: 16,
  },
  catIcon: { width: 48, height: 48, borderRadius: 12 },
  catTextWrap: { flex: 1 },
  catName: { fontSize: 17, fontWeight: '800' },
  catCount: { fontSize: 13, color: Colors.textTertiary, fontWeight: '500', marginTop: 2 },

  // Search results
  searchResults: { paddingHorizontal: 16, paddingTop: 4 },
  searchLabel: { fontSize: 12, color: 'rgba(255,255,255,0.55)', fontWeight: '600', marginBottom: 8, letterSpacing: 0.5 },
  resultCard: {
    flexDirection: 'row', alignItems: 'stretch',
    backgroundColor: Colors.surface, borderRadius: 14, marginBottom: 8,
    minHeight: 64, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  resultStripe: { width: 6, borderTopLeftRadius: 14, borderBottomLeftRadius: 14 },
  resultContent: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 14,
  },
  resultInfo: { flex: 1 },
  resultName: { fontSize: 15, fontWeight: '700', color: Colors.ink },
  resultDesc: { fontSize: 13, color: Colors.textTertiary, marginTop: 2 },
  resultCat: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize', marginTop: 4 },
});
