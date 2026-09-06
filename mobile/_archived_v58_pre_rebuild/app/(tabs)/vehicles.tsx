import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../../src/lib/api';
import { Colors } from '../../src/lib/colors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import VehicleMapModal from '../../src/components/VehicleMapModal';

const TAG_FILTER_KEY = 'paneltec_vehicle_tag_filter';

function relTime(iso: string | undefined) {
  if (!iso) return '—';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (isNaN(mins)) return iso;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export default function VehiclesScreen() {
  const [tags, setTags] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activeVehicle, setActiveVehicle] = useState<any>(null);

  useEffect(() => { AsyncStorage.setItem(TAG_FILTER_KEY, JSON.stringify([...selected])).catch(() => {}); }, [selected]);

  useEffect(() => {
    (async () => {
      try { const p = await AsyncStorage.getItem(TAG_FILTER_KEY); if (p) { const a = JSON.parse(p); if (Array.isArray(a)) setSelected(new Set(a)); } } catch {}
      try { const { data } = await api.get('/integrations/navixy/tags'); setTags(data.tags || []); } catch {}
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (selected.size === 0) { setVehicles([]); setTotal(0); return; }
    const t = setTimeout(() => loadVehicles(), 250); return () => clearTimeout(t);
  }, [selected]);

  const loadVehicles = async () => {
    setRefreshing(true); setError('');
    try {
      const qs = selected.size ? `?tag_ids=${[...selected].join(',')}` : '';
      const { data } = await api.get(`/integrations/navixy/vehicles${qs}`);
      setVehicles(data.vehicles || []); setTotal(data.total ?? (data.vehicles || []).length);
    } catch (e) { setError(apiError(e)); setVehicles([]); }
    finally { setLoading(false); setRefreshing(false); }
  };

  const toggleTag = (id: number) => { setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); };

  const tagCounts = useMemo(() => { const m: Record<number, number> = {}; for (const v of vehicles) for (const t of v.tags || []) m[t.id] = (m[t.id] || 0) + 1; return m; }, [vehicles]);

  if (loading) return <View style={vs.center}><ActivityIndicator color={Colors.orange} /></View>;

  if (error && !vehicles.length) {
    return (
      <SafeAreaView style={vs.safe}>
        <ScrollView testID="vehicles-not-connected" contentContainerStyle={vs.content}>
          <Text style={vs.overline}>COMPLIANCE</Text>
          <Text style={vs.heading}>VEHICLES</Text>
          <View style={vs.errorCard}>
            <Ionicons name="radio" size={28} color={Colors.orange} />
            <Text style={vs.errorTitle}>Connect Navixy to see your fleet</Text>
            <Text style={vs.errorBody}>Navixy GPS integration is not connected. An admin can connect it from Settings.</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={vs.safe}>
      <ScrollView testID="vehicles-page" style={vs.scroll} contentContainerStyle={vs.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadVehicles} tintColor={Colors.orange} />}>
        <Text style={vs.overline}>COMPLIANCE</Text>
        <Text style={vs.heading}>FLEET</Text>
        <Text style={vs.sub}>Live fleet from Navixy GPS.</Text>

        <Text style={vs.sectionLabel}>TAGS{selected.size > 0 ? ` · ${selected.size} SELECTED` : ''}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={vs.tagScroll}>
          {selected.size > 0 && (
            <TouchableOpacity testID="vehicles-clear-filters" style={vs.clearChip} onPress={() => setSelected(new Set())}>
              <Ionicons name="close" size={12} color={Colors.red} /><Text style={vs.clearText}>CLEAR</Text>
            </TouchableOpacity>
          )}
          {tags.map(t => {
            const isActive = selected.has(t.id);
            const c = '#' + (t.color || 'F97316').replace('#', '');
            return (
              <TouchableOpacity key={t.id} testID={`tag-toggle-${t.id}`}
                style={[vs.tagChip, isActive ? { backgroundColor: c, borderColor: c } : { borderColor: c + '55' }]}
                onPress={() => toggleTag(t.id)}>
                <View style={[vs.tagDot, { backgroundColor: isActive ? Colors.imSurface : c }]} />
                <Text style={[vs.tagText, { color: isActive ? Colors.imSurface : c }]}>{t.name}{tagCounts[t.id] ? ` (${tagCounts[t.id]})` : ''}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={vs.fleetHeader}>
          <Text style={vs.fleetTitle}>FLEET</Text>
          <Text style={vs.fleetCount}>{selected.size > 0 ? `${vehicles.length} of ${total}` : `${total}`} vehicles</Text>
        </View>

        {vehicles.length === 0 ? (
          <View testID="vehicles-empty-state" style={vs.emptyBox}>
            {selected.size === 0 ? (
              <><View style={vs.emptyIcon}><Ionicons name="pricetag" size={22} color={Colors.orange} /></View>
              <Text style={vs.emptyTitle}>Select one or more tags to view your fleet</Text>
              <Text style={vs.emptyBody}>Use the tag chips above to filter your vehicles.</Text></>
            ) : <Text style={vs.emptyBody}>No vehicles match the selected tags.</Text>}
          </View>
        ) : vehicles.map((v, idx) => {
          const isOnline = v.status !== 'offline';
          const primary = v.tags?.[0];
          const moreCount = (v.tags?.length || 0) - 1;
          return (
            <View key={v.id} testID={`vehicle-${v.id}`} style={vs.vehicleRow}>
              <View style={vs.vehicleTop}>
                <Text style={vs.vehicleLabel} numberOfLines={1}>{v.label}</Text>
                <TouchableOpacity testID={`vehicle-pin-${v.id}`} style={vs.pinBtn} onPress={() => setActiveVehicle(v)}>
                  <Ionicons name="location" size={14} color={Colors.orange} />
                </TouchableOpacity>
                <View testID={`vehicle-util-${v.id}`} style={vs.freeBadge}><Text style={vs.freeText}>FREE</Text></View>
              </View>
              <View style={vs.metaRow}>
                {isOnline ? (
                  <View style={vs.statusRow}><View style={[vs.dot, { backgroundColor: Colors.emerald }]} /><Text style={vs.liveText}>LIVE</Text></View>
                ) : (
                  <View style={vs.statusRow}><View style={[vs.dot, { backgroundColor: Colors.red }]} /><Text style={vs.offlineText}>OFFLINE</Text></View>
                )}
                {v.speed_kph != null && v.speed_kph > 0 && <Text style={vs.speed}>{v.speed_kph} km/h</Text>}
                {primary && (() => { const c = '#' + (primary.color || 'F97316').replace('#', ''); return (
                  <View testID={`vehicle-tag-${v.id}`} style={[vs.inlineTag, { backgroundColor: c + '1A', borderColor: c + '55' }]}>
                    <View style={[vs.tagDotSmall, { backgroundColor: c }]} /><Text style={[vs.inlineTagText, { color: c }]}>{primary.name}</Text>
                  </View>
                );})()}
                {moreCount > 0 && <View style={vs.moreBadge}><Text style={vs.moreText}>+{moreCount}</Text></View>}
              </View>
              <Text style={vs.plateRow}>{v.plate || '—'} · {relTime(v.last_seen)}{v.movement_status ? ` · ${v.movement_status}` : ''}</Text>
              {v.address ? <Text style={vs.address} numberOfLines={1}>{v.address}</Text> : null}
            </View>
          );
        })}
      </ScrollView>
      <VehicleMapModal vehicle={activeVehicle} visible={!!activeVehicle} onClose={() => setActiveVehicle(null)} />
    </SafeAreaView>
  );
}

const vs = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg },
  overline: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: Colors.orange },
  heading: { fontSize: 26, fontWeight: '800', color: Colors.ink, marginTop: 4, letterSpacing: 1 },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: Colors.textTertiary, marginTop: 16, marginBottom: 8 },
  tagScroll: { flexGrow: 0, marginBottom: 16 },
  clearChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', backgroundColor: Colors.redSoft, marginRight: 8 },
  clearText: { fontSize: 11, fontWeight: '700', color: Colors.red, letterSpacing: 0.5 },
  tagChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5, marginRight: 8 },
  tagDot: { width: 6, height: 6, borderRadius: 3 },
  tagText: { fontSize: 12, fontWeight: '600' },
  fleetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border, marginBottom: 4 },
  fleetTitle: { fontSize: 12, fontWeight: '800', color: Colors.ink, letterSpacing: 1 },
  fleetCount: { fontSize: 11, color: Colors.textTertiary },
  emptyBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  emptyIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: Colors.orangeSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: Colors.ink, textAlign: 'center' },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 6, maxWidth: 280 },
  vehicleRow: { borderRadius: 14, padding: 14, marginBottom: 6, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  vehicleTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  vehicleLabel: { flex: 1, fontSize: 16, fontWeight: '700', color: Colors.orange },
  pinBtn: { width: 28, height: 28, borderRadius: 6, backgroundColor: Colors.surfaceLight, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  freeBadge: { backgroundColor: 'rgba(16,185,129,0.12)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)' },
  freeText: { fontSize: 9, fontWeight: '800', color: Colors.emerald, letterSpacing: 0.8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 10, fontWeight: '800', color: Colors.emerald, letterSpacing: 0.8 },
  offlineText: { fontSize: 10, fontWeight: '800', color: Colors.red, letterSpacing: 0.8 },
  speed: { fontSize: 11, color: Colors.textTertiary },
  inlineTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  tagDotSmall: { width: 5, height: 5, borderRadius: 3 },
  inlineTagText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  moreBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, backgroundColor: Colors.surfaceLight, borderWidth: 1, borderColor: Colors.border },
  moreText: { fontSize: 10, fontWeight: '600', color: Colors.textTertiary },
  plateRow: { fontSize: 11, color: Colors.textTertiary, marginTop: 4 },
  address: { fontSize: 11, color: Colors.textTertiary, marginTop: 1 },
  errorCard: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, paddingHorizontal: 20, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, marginTop: 16 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: Colors.ink, textAlign: 'center', marginTop: 12 },
  errorBody: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 8, maxWidth: 300 },
});
