/**
 * Fleet tab — Asset register with Navixy tag filter.
 * v58.13.132jn — tag dropdown, 2-line asset names, unified navy bg.
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator, TextInput, Modal, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '../../src/theme/colors';
import { authGet } from '../../src/services/apiClient';
import { clearSession } from '../../src/services/auth';
import { fetchFormTemplates, type FormTemplate } from '../../src/services/forms';

// ── Types ──

interface FleetAsset {
  id: string;
  asset_id?: string;
  name: string;
  rego?: string;
  rego_serial?: string;
  make?: string;
  model?: string;
  year?: number;
  category?: string;
  asset_type?: string;
  sub_type?: string;
  status?: string;
  site?: string;
  last_prestart?: string;
  next_service?: string;
  navixy_device_id?: string | number | null;
  // Enriched by tag mapping
  tag?: string;
  [key: string]: unknown;
}

interface TagItem {
  vehicle_id: string;
  tag_label: string;
  source: string;
}

interface NavixyTagsResponse {
  items: TagItem[];
  connected: boolean;
  error: string | null;
  distinct_tags: string[];
  tag_list_source: string;
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active:  { bg: '#D1FAE5', text: '#059669' },
  idle:    { bg: '#FEF3C7', text: '#D97706' },
  service: { bg: '#DBEAFE', text: '#2563EB' },
  retired: { bg: '#E2E8F0', text: '#64748B' },
};

const TAG_STORAGE_KEY = 'paneltec_fleet_selected_tag';

// ── Data fetching ──

async function fetchFleet(): Promise<FleetAsset[]> {
  const res = await authGet<{ items?: FleetAsset[]; assets?: FleetAsset[] } | FleetAsset[]>(
    '/api/fleet/register?limit=200&page=1',
  );
  if (!res.ok) {
    if ('expired' in res && res.expired) throw new Error('SESSION_EXPIRED');
    throw new Error('error' in res ? res.error : 'Failed to load fleet');
  }
  const d = res.data;
  if (Array.isArray(d)) return d;
  return d.items || d.assets || [];
}

async function fetchNavixyTags(): Promise<NavixyTagsResponse> {
  const res = await authGet<NavixyTagsResponse>('/api/fleet/navixy/tags');
  if (!res.ok) return { items: [], connected: false, error: 'Failed', distinct_tags: [], tag_list_source: 'none' };
  return res.data;
}

// ── Screen ──

export default function FleetScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { openAssetId } = useLocalSearchParams<{ openAssetId?: string }>();
  const [search, setSearch] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<FleetAsset | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showTagPicker, setShowTagPicker] = useState(false);

  // Load persisted tag on mount
  useEffect(() => {
    AsyncStorage.getItem(TAG_STORAGE_KEY).then((v) => {
      if (v) setSelectedTag(v);
    });
  }, []);

  // Persist tag selection
  const selectTag = useCallback((tag: string | null) => {
    setSelectedTag(tag);
    if (tag) AsyncStorage.setItem(TAG_STORAGE_KEY, tag);
    else AsyncStorage.removeItem(TAG_STORAGE_KEY);
  }, []);

  // .132jt — Auto-open asset detail when navigated from QR scanner
  useEffect(() => {
    if (openAssetId && assets && assets.length > 0) {
      const match = assets.find((a) => a.id === openAssetId);
      if (match) {
        setSelectedAsset(match);
        // Clear the param to prevent re-triggering
        router.setParams({ openAssetId: '' });
      }
    }
  }, [openAssetId, assets, router]);

  const { data: assets, isLoading, refetch, isRefetching, error } = useQuery<FleetAsset[]>({
    queryKey: ['fleet-register'],
    queryFn: fetchFleet,
    staleTime: 60_000,
    retry: 2,
  });

  const { data: tagsData } = useQuery<NavixyTagsResponse>({
    queryKey: ['fleet-navixy-tags'],
    queryFn: fetchNavixyTags,
    staleTime: 120_000,
    retry: 1,
  });

  // Build tag → vehicle_id mapping
  const tagMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (tagsData?.items) {
      for (const it of tagsData.items) {
        map[it.vehicle_id] = it.tag_label;
      }
    }
    return map;
  }, [tagsData]);

  // Enrich assets with tags
  const enrichedAssets = useMemo(() => {
    if (!assets) return [];
    return assets.map((a) => ({ ...a, tag: tagMap[a.id] || a.tag || undefined }));
  }, [assets, tagMap]);

  // Distinct tags with counts (from enriched data)
  const tagOptions = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of enrichedAssets) {
      if (a.tag) counts[a.tag] = (counts[a.tag] || 0) + 1;
    }
    return Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, count]) => ({ label, count }));
  }, [enrichedAssets]);

  // Filter by tag + search
  const filtered = useMemo(() => {
    let list = enrichedAssets;
    if (selectedTag) {
      list = list.filter((a) => a.tag === selectedTag);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          (a.name || '').toLowerCase().includes(q) ||
          (a.rego || a.rego_serial || '').toLowerCase().includes(q) ||
          (a.make || '').toLowerCase().includes(q) ||
          (a.tag || '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [enrichedAssets, selectedTag, search]);

  const onRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const handleExpired = useCallback(async () => {
    await clearSession();
    router.replace('/(auth)/pin-entry');
  }, [router]);

  if (error?.message === 'SESSION_EXPIRED') {
    handleExpired();
    return null;
  }

  const renderAsset = ({ item }: { item: FleetAsset }) => {
    const statusKey = (item.status || 'active').toLowerCase();
    const sc = STATUS_COLORS[statusKey] || STATUS_COLORS.active;
    return (
      <TouchableOpacity
        testID={`fleet-asset-${item.id}`}
        style={s.assetRow}
        onPress={() => setSelectedAsset(item)}
        activeOpacity={0.7}
      >
        <View style={s.assetIconWrap}>
          <Ionicons
            name={(item.asset_type || item.category || '').toLowerCase().includes('vehicle') ? 'car' : 'construct'}
            size={22}
            color={Colors.orange}
          />
        </View>
        <View style={s.assetInfo}>
          <Text style={s.assetName} numberOfLines={2} ellipsizeMode="tail">
            {item.name}
          </Text>
          <Text style={s.assetMeta} numberOfLines={1}>
            {[item.rego || item.rego_serial, item.tag, item.site].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <View style={[s.statusPill, { backgroundColor: sc.bg }]}>
          <Text style={[s.statusText, { color: sc.text }]}>{item.status || 'Active'}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} style={{ marginLeft: 4 }} />
      </TouchableOpacity>
    );
  };

  return (
    <View testID="fleet-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text testID="fleet-title" style={s.headerTitle}>Fleet</Text>
        <Text style={s.headerSub}>
          {enrichedAssets.length > 0
            ? `${filtered.length}${selectedTag ? ` of ${enrichedAssets.length}` : ''} asset${filtered.length !== 1 ? 's' : ''}`
            : 'Loading...'}
        </Text>
      </View>

      {/* Tag filter dropdown */}
      {tagOptions.length > 0 && (
        <TouchableOpacity
          testID="fleet-tag-filter"
          style={s.tagFilterBtn}
          onPress={() => setShowTagPicker(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="pricetag-outline" size={16} color={selectedTag ? Colors.orange : Colors.textTertiary} />
          <Text
            style={[s.tagFilterText, selectedTag && { color: Colors.orange, fontWeight: '700' }]}
            numberOfLines={1}
          >
            {selectedTag || `All tags (${enrichedAssets.length})`}
          </Text>
          <Ionicons name="chevron-down" size={14} color={Colors.textTertiary} />
          {selectedTag && (
            <TouchableOpacity
              testID="fleet-tag-clear"
              onPress={(e) => {
                e.stopPropagation?.();
                selectTag(null);
              }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={{ marginLeft: 4 }}
            >
              <Ionicons name="close-circle" size={18} color={Colors.textTertiary} />
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      )}

      {/* Search */}
      <View style={s.searchWrap}>
        <Ionicons name="search-outline" size={18} color={Colors.textTertiary} />
        <TextInput
          testID="fleet-search-input"
          style={s.searchInput}
          placeholder="Search assets, rego, tag..."
          placeholderTextColor={Colors.textTertiary}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          autoCorrect={false}
        />
        {search.length > 0 && (
          <TouchableOpacity testID="fleet-search-clear" onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={Colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {isLoading && !assets ? (
        <View testID="fleet-loading" style={s.center}>
          <ActivityIndicator size="large" color={Colors.orange} />
          <Text style={s.loadingText}>Loading fleet...</Text>
        </View>
      ) : error ? (
        <View testID="fleet-error" style={s.center}>
          <Ionicons name="cloud-offline-outline" size={36} color={Colors.error} />
          <Text style={s.errorText}>{error.message || 'Failed to load fleet'}</Text>
          <TouchableOpacity testID="fleet-retry" style={s.retryBtn} onPress={() => refetch()}>
            <Text style={s.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : filtered.length === 0 ? (
        <View testID="fleet-empty" style={s.center}>
          <Ionicons name="car-outline" size={48} color={Colors.textTertiary} />
          <Text style={s.emptyTitle}>{search || selectedTag ? 'No matches' : 'No fleet assets'}</Text>
          <Text style={s.emptyText}>
            {search
              ? `Nothing matches "${search}"`
              : selectedTag
                ? `No assets tagged "${selectedTag}"`
                : 'Equipment will appear here once added'}
          </Text>
        </View>
      ) : (
        <FlatList
          testID="fleet-list"
          data={filtered}
          keyExtractor={(item, index) => item.id || `fleet-${index}`}
          renderItem={renderAsset}
          contentContainerStyle={s.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={onRefresh}
              tintColor={Colors.orange}
              colors={[Colors.orange]}
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
        />
      )}

      {/* Tag Picker Modal */}
      <Modal visible={showTagPicker} animationType="fade" transparent onRequestClose={() => setShowTagPicker(false)}>
        <TouchableOpacity
          style={s.tagModalBackdrop}
          activeOpacity={1}
          onPress={() => setShowTagPicker(false)}
        >
          <View style={s.tagModalCard}>
            <Text style={s.tagModalTitle}>Filter by tag</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              <TouchableOpacity
                testID="tag-option-all"
                style={[s.tagOption, !selectedTag && s.tagOptionActive]}
                onPress={() => { selectTag(null); setShowTagPicker(false); }}
              >
                <Text style={[s.tagOptionText, !selectedTag && s.tagOptionTextActive]}>
                  All tags ({enrichedAssets.length})
                </Text>
                {!selectedTag && <Ionicons name="checkmark" size={18} color={Colors.orange} />}
              </TouchableOpacity>
              {tagOptions.map((t) => (
                <TouchableOpacity
                  key={t.label}
                  testID={`tag-option-${t.label}`}
                  style={[s.tagOption, selectedTag === t.label && s.tagOptionActive]}
                  onPress={() => { selectTag(t.label); setShowTagPicker(false); }}
                >
                  <Text style={[s.tagOptionText, selectedTag === t.label && s.tagOptionTextActive]}>
                    {t.label} ({t.count})
                  </Text>
                  {selectedTag === t.label && <Ionicons name="checkmark" size={18} color={Colors.orange} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Asset Detail Modal */}
      <Modal
        visible={!!selectedAsset}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedAsset(null)}
      >
        {selectedAsset && (
          <AssetDetailSheet
            asset={selectedAsset}
            onClose={() => setSelectedAsset(null)}
            router={router}
          />
        )}
      </Modal>
    </View>
  );
}

// ── Action definitions ──

interface AssetAction {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  category?: string;       // filter by category
  nameFilter?: string;     // regex filter by name
  pickerTitle: string;
}

const ASSET_ACTIONS: AssetAction[] = [
  { key: 'pre_start',  label: 'Start Pre-Start',       icon: 'clipboard-outline', color: '#3B82F6', category: 'pre_start',  pickerTitle: 'Pre-Start' },
  { key: 'service',    label: 'Start a Service',        icon: 'construct-outline', color: '#10B981', nameFilter: 'service|maintenance|equipment|pre-operation|pre-use', pickerTitle: 'Service / Equipment Check' },
  { key: 'inspection', label: 'Conduct Inspection',     icon: 'search-outline',    color: '#06B6D4', category: 'inspection', pickerTitle: 'Inspection' },
  { key: 'incident',   label: 'Report a Hazard',        icon: 'warning-outline',   color: '#EF4444', category: 'incident',   pickerTitle: 'Hazard / Incident' },
  { key: 'site_diary', label: 'Add Site Diary Entry',   icon: 'book-outline',      color: '#F59E0B', category: 'site_diary', pickerTitle: 'Site Diary' },
];

// ── Asset Detail Sheet ──

function AssetDetailSheet({ asset, onClose, router: nav }: {
  asset: FleetAsset;
  onClose: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const insets = useSafeAreaInsets();
  const statusKey = (asset.status || 'active').toLowerCase();
  const sc = STATUS_COLORS[statusKey] || STATUS_COLORS.active;

  // Check which actions have matching templates
  const { data: templates } = useQuery<FormTemplate[]>({
    queryKey: ['form-templates'],
    queryFn: fetchFormTemplates,
    staleTime: 60_000,
  });

  const availableActions = useMemo(() => {
    if (!templates) return ASSET_ACTIONS; // Show all while loading
    return ASSET_ACTIONS.filter((action) => {
      if (action.category) {
        return templates.some((t) => t.category === action.category);
      }
      if (action.nameFilter) {
        const re = new RegExp(action.nameFilter, 'i');
        return templates.some((t) => re.test(t.name) || re.test(t.description || ''));
      }
      return true;
    });
  }, [templates]);

  const assetParams = {
    assetId: asset.id,
    assetName: asset.name,
    assetRego: asset.rego || asset.rego_serial || '',
    assetTag: asset.tag || '',
    assetNavixyId: String(asset.navixy_device_id || ''),
  };

  const openPicker = (action: AssetAction) => {
    onClose();
    nav.push({
      pathname: '/forms/picker',
      params: {
        ...assetParams,
        category: action.category || '',
        nameFilter: action.nameFilter || '',
        title: action.pickerTitle,
      },
    } as never);
  };

  return (
    <View testID="fleet-detail-sheet" style={[sd.container, { paddingTop: insets.top + 8 }]}>
      <View style={sd.handle} />
      <View style={sd.topBar}>
        <Text style={sd.title}>Asset Detail</Text>
        <TouchableOpacity testID="fleet-detail-close" onPress={onClose} style={sd.closeBtn}>
          <Ionicons name="close" size={24} color={Colors.ink} />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={sd.content}>
        <View style={sd.heroCard}>
          <View style={sd.heroIcon}>
            <Ionicons name="construct" size={32} color={Colors.orange} />
          </View>
          <Text style={sd.heroName}>{asset.name}</Text>
          <View style={[sd.heroPill, { backgroundColor: sc.bg }]}>
            <Text style={[sd.heroPillText, { color: sc.text }]}>{asset.status || 'Active'}</Text>
          </View>
        </View>

        <View style={sd.detailCard}>
          {(asset.rego || asset.rego_serial) && <DetailRow label="Rego" value={asset.rego || asset.rego_serial || ''} />}
          {asset.tag && <DetailRow label="Tag" value={asset.tag} />}
          {asset.category && <DetailRow label="Category" value={asset.category} />}
          {asset.make && <DetailRow label="Make" value={asset.make} />}
          {asset.model && <DetailRow label="Model" value={asset.model} />}
          {asset.year && <DetailRow label="Year" value={String(asset.year)} />}
          {asset.site && <DetailRow label="Site" value={asset.site} />}
          {asset.last_prestart && <DetailRow label="Last Pre-Start" value={new Date(asset.last_prestart).toLocaleDateString()} />}
          {asset.next_service && <DetailRow label="Next Service" value={new Date(asset.next_service).toLocaleDateString()} />}
        </View>

        {/* Action tiles */}
        <Text style={sd.actionsTitle}>ACTIONS</Text>
        {availableActions.map((action) => (
          <TouchableOpacity
            key={action.key}
            testID={`asset-action-${action.key}`}
            style={sd.actionTile}
            onPress={() => openPicker(action)}
            activeOpacity={0.7}
          >
            <View style={[sd.actionStripe, { backgroundColor: action.color }]} />
            <View style={sd.actionContent}>
              <View style={[sd.actionIconWrap, { backgroundColor: action.color + '18' }]}>
                <Ionicons name={action.icon} size={20} color={action.color} />
              </View>
              <Text style={[sd.actionLabel, { color: action.color }]}>{action.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={sd.row}>
      <Text style={sd.rowLabel}>{label}</Text>
      <Text style={sd.rowValue}>{value}</Text>
    </View>
  );
}

// ── Styles ──

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.navyLight },
  header: { backgroundColor: Colors.navy, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 18 },
  headerTitle: { color: Colors.white, fontSize: 26, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: '500', marginTop: 2 },

  tagFilterBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surface, borderRadius: 12,
    marginHorizontal: 16, marginTop: 12,
    paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, borderColor: Colors.border,
  },
  tagFilterText: { flex: 1, fontSize: 14, color: Colors.textSecondary, fontWeight: '500' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surface, borderRadius: 14,
    marginHorizontal: 16, marginTop: 8, marginBottom: 8,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  searchInput: { flex: 1, fontSize: 16, color: Colors.ink, padding: 0 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  loadingText: { fontSize: 15, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  errorText: { fontSize: 14, color: Colors.error, textAlign: 'center' },
  retryBtn: { backgroundColor: Colors.orange, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  retryBtnText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.white },
  emptyText: { fontSize: 14, color: 'rgba(255,255,255,0.55)', textAlign: 'center' },

  listContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  assetRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14,
    minHeight: 72,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  assetIconWrap: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: Colors.orangeSoft, alignItems: 'center', justifyContent: 'center',
  },
  assetInfo: { flex: 1 },
  assetName: { fontSize: 14, fontWeight: '700', color: Colors.ink, lineHeight: 19 },
  assetMeta: { fontSize: 12, color: Colors.textTertiary, marginTop: 3 },
  statusPill: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },

  // Tag picker modal
  tagModalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  tagModalCard: {
    backgroundColor: Colors.surface, borderRadius: 20, padding: 20,
    width: '100%', maxWidth: 380,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15, shadowRadius: 24, elevation: 10,
  },
  tagModalTitle: { fontSize: 18, fontWeight: '800', color: Colors.ink, marginBottom: 12 },
  tagOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 13, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  tagOptionActive: { backgroundColor: Colors.orangeSoft, borderRadius: 10, paddingHorizontal: 10 },
  tagOptionText: { fontSize: 15, color: Colors.ink, fontWeight: '500' },
  tagOptionTextActive: { color: Colors.orange, fontWeight: '700' },
});

const sd = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.navyLight },
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border,
    alignSelf: 'center', marginBottom: 8,
  },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  title: { fontSize: 18, fontWeight: '800', color: Colors.ink },
  closeBtn: { padding: 4 },
  content: { padding: 20 },
  heroCard: { alignItems: 'center', marginBottom: 20 },
  heroIcon: {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: Colors.orangeSoft, alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  heroName: { fontSize: 22, fontWeight: '800', color: Colors.ink, textAlign: 'center' },
  heroPill: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 4, marginTop: 8 },
  heroPillText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  detailCard: {
    backgroundColor: Colors.surface, borderRadius: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.border, marginBottom: 20,
  },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  rowLabel: { fontSize: 14, color: Colors.textTertiary, fontWeight: '500' },
  rowValue: { fontSize: 15, color: Colors.ink, fontWeight: '600' },
  // Action tiles
  actionsTitle: {
    fontSize: 12, fontWeight: '800', color: Colors.textTertiary,
    letterSpacing: 1, marginBottom: 10,
  },
  actionTile: {
    flexDirection: 'row', alignItems: 'stretch',
    backgroundColor: Colors.surface, borderRadius: 14, marginBottom: 8,
    minHeight: 56, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.border,
  },
  actionStripe: { width: 8, borderTopLeftRadius: 14, borderBottomLeftRadius: 14 },
  actionContent: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  actionIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  actionLabel: { flex: 1, fontSize: 15, fontWeight: '700' },
});
