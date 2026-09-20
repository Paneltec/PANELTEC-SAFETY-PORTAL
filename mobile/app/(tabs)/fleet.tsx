/**
 * Fleet tab — v58.13.132jb
 * Real fleet register from GET /api/fleet/register.
 * Pull-to-refresh, search, tap for detail.
 */
import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator, TextInput, Modal, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '../../src/theme/colors';
import { authGet } from '../../src/services/apiClient';
import { clearSession } from '../../src/services/auth';

interface FleetAsset {
  asset_id: string;
  id?: string;
  name: string;
  rego?: string;
  category?: string;
  make?: string;
  model?: string;
  year?: number;
  status?: string;
  site?: string;
  last_prestart?: string;
  next_service?: string;
  [key: string]: unknown;
}

interface FleetResponse {
  total?: number;
  items?: FleetAsset[];
  assets?: FleetAsset[];
}

async function fetchFleet(): Promise<FleetAsset[]> {
  const res = await authGet<FleetResponse>('/api/fleet/register');
  if (res.ok) {
    const items = res.data.items || res.data.assets || [];
    // Log for debugging the "only Cat 320" issue
    console.log(`[fleet] Fetched ${items.length} assets from /api/fleet/register`);
    return Array.isArray(items) ? items : [];
  }
  if ('expired' in res && res.expired) throw new Error('SESSION_EXPIRED');
  throw new Error('error' in res ? res.error : 'Failed to load fleet');
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active: { bg: Colors.successSoft, text: Colors.success },
  operational: { bg: Colors.successSoft, text: Colors.success },
  maintenance: { bg: Colors.warningSoft, text: Colors.warning },
  due: { bg: Colors.warningSoft, text: Colors.warning },
  overdue: { bg: Colors.errorSoft, text: Colors.error },
  inactive: { bg: '#E2E8F0', text: '#64748B' },
  retired: { bg: '#E2E8F0', text: '#64748B' },
};

export default function FleetScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<FleetAsset | null>(null);

  const { data: assets, isLoading, refetch, isRefetching, error } = useQuery<FleetAsset[]>({
    queryKey: ['fleet-register'],
    queryFn: fetchFleet,
    staleTime: 60_000,
    retry: 2,
  });

  const onRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const filtered = useMemo(() => {
    if (!assets) return [];
    if (!search.trim()) return assets;
    const q = search.toLowerCase();
    return assets.filter(a =>
      (a.name || '').toLowerCase().includes(q) ||
      (a.rego || '').toLowerCase().includes(q) ||
      (a.category || '').toLowerCase().includes(q) ||
      (a.make || '').toLowerCase().includes(q)
    );
  }, [assets, search]);

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
        testID={`fleet-asset-${item.asset_id}`}
        style={s.assetRow}
        onPress={() => setSelectedAsset(item)}
        activeOpacity={0.7}
      >
        <View style={s.assetIconWrap}>
          <Ionicons
            name={item.category?.toLowerCase().includes('vehicle') ? 'car' : 'construct'}
            size={22}
            color={Colors.orange}
          />
        </View>
        <View style={s.assetInfo}>
          <Text style={s.assetName} numberOfLines={1}>{item.name}</Text>
          <Text style={s.assetMeta}>
            {[item.rego, item.category, item.site].filter(Boolean).join(' · ')}
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
          {assets ? `${assets.length} asset${assets.length !== 1 ? 's' : ''}` : 'Loading...'}
        </Text>
      </View>

      <View style={s.searchWrap}>
        <Ionicons name="search-outline" size={18} color={Colors.textTertiary} />
        <TextInput
          testID="fleet-search-input"
          style={s.searchInput}
          placeholder="Search assets, rego, category..."
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
          <Text style={s.emptyTitle}>
            {search ? 'No matches' : 'No fleet assets'}
          </Text>
          <Text style={s.emptyText}>
            {search ? `Nothing matches "${search}"` : 'Equipment will appear here once added'}
          </Text>
        </View>
      ) : (
        <FlatList
          testID="fleet-list"
          data={filtered}
          keyExtractor={(item, index) => item.asset_id || item.id || `fleet-${index}`}
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
            onStartPrestart={() => {
              setSelectedAsset(null);
              router.push('/(screens)/qr-scan');
            }}
          />
        )}
      </Modal>
    </View>
  );
}

function AssetDetailSheet({ asset, onClose, onStartPrestart }: {
  asset: FleetAsset;
  onClose: () => void;
  onStartPrestart: () => void;
}) {
  const insets = useSafeAreaInsets();
  const statusKey = (asset.status || 'active').toLowerCase();
  const sc = STATUS_COLORS[statusKey] || STATUS_COLORS.active;

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
          {asset.rego && <DetailRow label="Rego" value={asset.rego} />}
          {asset.category && <DetailRow label="Category" value={asset.category} />}
          {asset.make && <DetailRow label="Make" value={asset.make} />}
          {asset.model && <DetailRow label="Model" value={asset.model} />}
          {asset.year && <DetailRow label="Year" value={String(asset.year)} />}
          {asset.site && <DetailRow label="Site" value={asset.site} />}
          {asset.last_prestart && <DetailRow label="Last Pre-Start" value={new Date(asset.last_prestart).toLocaleDateString()} />}
          {asset.next_service && <DetailRow label="Next Service" value={new Date(asset.next_service).toLocaleDateString()} />}
        </View>

        <TouchableOpacity testID="fleet-start-prestart" style={sd.prestartBtn} onPress={onStartPrestart}>
          <Ionicons name="clipboard-outline" size={20} color={Colors.white} />
          <Text style={sd.prestartBtnText}>Start Pre-Start on This</Text>
        </TouchableOpacity>
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

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.navyLight },
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
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16,
    minHeight: 72,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  assetIconWrap: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: Colors.orangeSoft, alignItems: 'center', justifyContent: 'center',
  },
  assetInfo: { flex: 1 },
  assetName: { fontSize: 16, fontWeight: '700', color: Colors.ink },
  assetMeta: { fontSize: 13, color: Colors.textTertiary, marginTop: 3 },
  statusPill: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
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
  prestartBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: Colors.orange, borderRadius: 14, paddingVertical: 16,
  },
  prestartBtnText: { color: Colors.white, fontSize: 16, fontWeight: '700' },
});
