/**
 * Form template picker — filtered by category + asset context.
 * v58.13.132jr — created for asset detail multi-action flow.
 *
 * Route: /forms/picker?category=pre_start&assetId=...&assetName=...&assetRego=...&assetTag=...
 */
import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '../../src/theme/colors';
import { fetchFormTemplates, type FormTemplate } from '../../src/services/forms';
import { categoryPalette } from '../../src/lib/categoryColors';

export default function FormPickerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    category?: string;
    nameFilter?: string;
    assetId?: string;
    assetName?: string;
    assetRego?: string;
    assetTag?: string;
    assetNavixyId?: string;
    title?: string;
  }>();

  const [search, setSearch] = useState('');
  const { data: templates, isLoading } = useQuery<FormTemplate[]>({
    queryKey: ['form-templates'],
    queryFn: fetchFormTemplates,
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    if (!templates) return [];
    let list = templates;

    // Filter by category
    if (params.category) {
      list = list.filter((t) => t.category === params.category);
    }

    // Filter by name pattern (for service-like search)
    if (params.nameFilter) {
      const re = new RegExp(params.nameFilter, 'i');
      list = list.filter((t) => re.test(t.name) || re.test(t.description || ''));
    }

    // Search within filtered
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) => t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q),
      );
    }

    return list;
  }, [templates, params.category, params.nameFilter, search]);

  const palette = categoryPalette(params.category);
  const screenTitle = params.title || (params.category ? params.category.replace(/_/g, ' ') : 'Select Form');

  const openForm = (template: FormTemplate) => {
    router.push({
      pathname: '/forms/[id]',
      params: {
        id: template.id,
        assetId: params.assetId || '',
        assetName: params.assetName || '',
        assetRego: params.assetRego || '',
        assetTag: params.assetTag || '',
        assetNavixyId: params.assetNavixyId || '',
      },
    } as never);
  };

  const renderItem = ({ item }: { item: FormTemplate }) => {
    const p = categoryPalette(item.category);
    return (
      <TouchableOpacity
        testID={`picker-template-${item.id}`}
        style={s.card}
        onPress={() => openForm(item)}
        activeOpacity={0.7}
      >
        <View style={[s.stripe, { backgroundColor: p.stripe }]} />
        <View style={s.cardContent}>
          <View style={s.cardInfo}>
            <Text style={s.cardName} numberOfLines={2}>{item.name}</Text>
            {item.description ? (
              <Text style={s.cardDesc} numberOfLines={1}>{item.description}</Text>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View testID="form-picker-screen" style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity testID="picker-back" onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.white} />
        </TouchableOpacity>
        <View style={s.headerText}>
          <Text style={s.headerTitle} numberOfLines={1}>{screenTitle}</Text>
          {params.assetName ? (
            <Text style={s.headerSub} numberOfLines={1}>
              for {params.assetName}{params.assetRego ? ` (${params.assetRego})` : ''}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Asset context banner */}
      {params.assetName ? (
        <View style={[s.assetBanner, { borderLeftColor: palette.stripe }]}>
          <Ionicons name="car" size={16} color={palette.stripe} />
          <Text style={s.assetBannerText} numberOfLines={1}>
            {params.assetName}{params.assetRego ? ` · ${params.assetRego}` : ''}{params.assetTag ? ` · ${params.assetTag}` : ''}
          </Text>
        </View>
      ) : null}

      {/* Search */}
      {filtered.length > 3 && (
        <View style={s.searchWrap}>
          <Ionicons name="search-outline" size={16} color={Colors.textTertiary} />
          <TextInput
            testID="picker-search"
            style={s.searchInput}
            placeholder="Search templates..."
            placeholderTextColor={Colors.textTertiary}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
          />
        </View>
      )}

      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.orange} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="document-text-outline" size={36} color={Colors.textTertiary} />
          <Text style={s.emptyTitle}>No templates found</Text>
          <Text style={s.emptyText}>
            {search ? `Nothing matches "${search}"` : 'No templates available for this category'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={s.list}
          ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.navyLight },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.white },
  emptyText: { fontSize: 13, color: 'rgba(255,255,255,0.55)', textAlign: 'center' },

  header: {
    backgroundColor: Colors.navy, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, gap: 12,
  },
  backBtn: { padding: 4 },
  headerText: { flex: 1 },
  headerTitle: { color: Colors.white, fontSize: 22, fontWeight: '800', textTransform: 'capitalize' },
  headerSub: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '500', marginTop: 2 },

  assetBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surface, marginHorizontal: 16, marginTop: 10,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
    borderLeftWidth: 4,
  },
  assetBannerText: { flex: 1, fontSize: 13, color: Colors.ink, fontWeight: '600' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surface, borderRadius: 12,
    marginHorizontal: 16, marginTop: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.ink, padding: 0 },

  list: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32 },
  card: {
    flexDirection: 'row', alignItems: 'stretch',
    backgroundColor: Colors.surface, borderRadius: 14, overflow: 'hidden',
    minHeight: 60,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  stripe: { width: 6, borderTopLeftRadius: 14, borderBottomLeftRadius: 14 },
  cardContent: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 14,
  },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: '700', color: Colors.ink },
  cardDesc: { fontSize: 12, color: Colors.textTertiary, marginTop: 2 },
});
