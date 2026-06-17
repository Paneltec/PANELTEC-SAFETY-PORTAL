import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
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

  // Persist selected tags
  useEffect(() => {
    AsyncStorage.setItem(TAG_FILTER_KEY, JSON.stringify([...selected])).catch(() => {});
  }, [selected]);

  // Load tags
  useEffect(() => {
    (async () => {
      try {
        const persisted = await AsyncStorage.getItem(TAG_FILTER_KEY);
        if (persisted) {
          const arr = JSON.parse(persisted);
          if (Array.isArray(arr)) setSelected(new Set(arr));
        }
      } catch {}
      try {
        const { data } = await api.get('/integrations/navixy/tags');
        setTags(data.tags || []);
      } catch {}
      setLoading(false);
    })();
  }, []);

  // Load vehicles when tags change
  useEffect(() => {
    if (selected.size === 0) { setVehicles([]); setTotal(0); return; }
    const t = setTimeout(() => loadVehicles(), 250);
    return () => clearTimeout(t);
  }, [selected]);

  const loadVehicles = async () => {
    setRefreshing(true); setError('');
    try {
      const qs = selected.size ? `?tag_ids=${[...selected].join(',')}` : '';
      const { data } = await api.get(`/integrations/navixy/vehicles${qs}`);
      setVehicles(data.vehicles || []);
      setTotal(data.total ?? (data.vehicles || []).length);
    } catch (e) { setError(apiError(e)); setVehicles([]); }
    finally { setLoading(false); setRefreshing(false); }
  };

  const toggleTag = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const tagCounts = useMemo(() => {
    const m: Record<number, number> = {};
    for (const v of vehicles) for (const t of v.tags || []) m[t.id] = (m[t.id] || 0) + 1;
    return m;
  }, [vehicles]);

  if (loading) return <View style={s.center}><ActivityIndicator color={Colors.blue} /></View>;

  if (error && !vehicles.length) {
    return (
      <SafeAreaView style={s.safe}>
        <ScrollView testID="vehicles-not-connected" contentContainerStyle={s.content}>
          <Text style={s.overline}>COMPLIANCE</Text>
          <Text style={s.heading}>Vehicles</Text>
          <View style={s.errorCard}>
            <Ionicons name="radio" size={28} color={Colors.blue} />
            <Text style={s.errorTitle}>Connect Navixy to see your fleet</Text>
            <Text style={s.errorBody}>Navixy GPS integration is not connected yet. An administrator can connect it from Settings → Integrations → Navixy.</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        testID="vehicles-page"
        style={s.scroll}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadVehicles} tintColor={Colors.blue} />}
      >
        <Text style={s.overline}>COMPLIANCE</Text>
        <Text style={s.heading}>Vehicles</Text>
        <Text style={s.sub}>Live fleet from Navixy GPS.</Text>

        {/* Tag chips */}
        <Text style={s.sectionLabel}>TAGS{selected.size > 0 ? ` · ${selected.size} selected` : ''}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tagScroll}>
          {selected.size > 0 && (
            <TouchableOpacity testID="vehicles-clear-filters" style={s.clearChip} onPress={() => setSelected(new Set())}>
              <Ionicons name="close" size={12} color={Colors.red} />
              <Text style={s.clearText}>Clear</Text>
            </TouchableOpacity>
          )}
          {tags.map(t => {
            const isActive = selected.has(t.id);
            const c = '#' + (t.color || '2C6BFF').replace('#', '');
            return (
              <TouchableOpacity
                key={t.id}
                testID={`tag-toggle-${t.id}`}
                style={[
                  s.tagChip,
                  isActive ? { backgroundColor: c, borderColor: c } : { borderColor: c + '55' },
                ]}
                onPress={() => toggleTag(t.id)}
              >
                <View style={[s.tagDot, { backgroundColor: isActive ? '#fff' : c }]} />
                <Text style={[s.tagText, { color: isActive ? '#fff' : c }]}>
                  {t.name}{tagCounts[t.id] ? ` (${tagCounts[t.id]})` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Fleet header */}
        <View style={s.fleetHeader}>
          <Text style={s.fleetTitle}>Fleet</Text>
          <Text style={s.fleetCount}>
            {selected.size > 0 ? `${vehicles.length} of ${total}` : `${total}`} vehicles
          </Text>
        </View>

        {/* Vehicle list */}
        {vehicles.length === 0 ? (
          <View testID="vehicles-empty-state" style={s.emptyBox}>
            {selected.size === 0 ? (
              <>
                <View style={s.emptyIcon}><Ionicons name="pricetag" size={22} color={Colors.blue} /></View>
                <Text style={s.emptyTitle}>Select one or more tags to view your fleet</Text>
                <Text style={s.emptyBody}>Use the tag chips above to filter your vehicles.</Text>
              </>
            ) : (
              <Text style={s.emptyBody}>No vehicles match the selected tags.</Text>
            )}
          </View>
        ) : (
          vehicles.map((v, idx) => {
            const isOnline = v.status !== 'offline';
            const primary = v.tags?.[0];
            const moreCount = (v.tags?.length || 0) - 1;
            const rowBg = idx % 2 === 0 ? '#EAF3FB' : '#F2F8FC';
            return (
              <View key={v.id} testID={`vehicle-${v.id}`} style={[s.vehicleRow, { backgroundColor: rowBg }]}>
                <View style={s.vehicleTop}>
                  <Text style={s.vehicleLabel} numberOfLines={1}>{v.label}</Text>
                  <TouchableOpacity
                    testID={`vehicle-pin-${v.id}`}
                    style={s.pinBtn}
                    onPress={() => setActiveVehicle(v)}
                  >
                    <Ionicons name="location" size={14} color={Colors.blue} />
                  </TouchableOpacity>
                  <View testID={`vehicle-util-${v.id}`} style={s.freeBadge}>
                    <Text style={s.freeText}>Free</Text>
                  </View>
                </View>

                <View style={s.metaRow}>
                  {isOnline ? (
                    <View style={s.statusRow}>
                      <View style={[s.dot, { backgroundColor: Colors.emerald }]} />
                      <Text style={s.liveText}>Live</Text>
                    </View>
                  ) : (
                    <View style={s.statusRow}>
                      <View style={[s.dot, { backgroundColor: Colors.red }]} />
                      <Text style={s.offlineText}>Offline</Text>
                    </View>
                  )}
                  {v.speed_kph != null && v.speed_kph > 0 && (
                    <Text style={s.speed}>{v.speed_kph} km/h</Text>
                  )}
                  {primary && (() => {
                    const c = '#' + (primary.color || '2C6BFF').replace('#', '');
                    return (
                      <View testID={`vehicle-tag-${v.id}`} style={[s.inlineTag, { backgroundColor: c + '1A', borderColor: c + '55' }]}>
                        <View style={[s.tagDotSmall, { backgroundColor: c }]} />
                        <Text style={[s.inlineTagText, { color: c }]}>{primary.name}</Text>
                      </View>
                    );
                  })()}
                  {moreCount > 0 && (
                    <View style={s.moreBadge}>
                      <Text style={s.moreText}>+{moreCount} more</Text>
                    </View>
                  )}
                </View>

                <Text style={s.plateRow}>
                  {v.plate || '—'} · {relTime(v.last_seen)}
                  {v.movement_status ? ` · ${v.movement_status}` : ''}
                </Text>
                {v.address ? <Text style={s.address} numberOfLines={1}>{v.address}</Text> : null}
              </View>
            );
          })
        )}
      </ScrollView>

      <VehicleMapModal
        vehicle={activeVehicle}
        visible={!!activeVehicle}
        onClose={() => setActiveVehicle(null)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  overline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.blue },
  heading: { fontSize: 26, fontWeight: '700', color: Colors.ink, marginTop: 4, letterSpacing: -0.5 },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: Colors.textTertiary, marginTop: 16, marginBottom: 8 },
  tagScroll: { flexGrow: 0, marginBottom: 16 },
  clearChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 10, borderWidth: 1, borderColor: Colors.redSoft, backgroundColor: Colors.redSoft, marginRight: 8,
  },
  clearText: { fontSize: 12, fontWeight: '600', color: Colors.red },
  tagChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 10, borderWidth: 1.5, marginRight: 8,
  },
  tagDot: { width: 6, height: 6, borderRadius: 3 },
  tagText: { fontSize: 12, fontWeight: '600' },
  fleetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border, marginBottom: 4,
  },
  fleetTitle: { fontSize: 14, fontWeight: '700', color: Colors.ink },
  fleetCount: { fontSize: 11, color: Colors.textTertiary },
  emptyBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  emptyIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: Colors.blueSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: Colors.ink, textAlign: 'center' },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 6, maxWidth: 280 },
  vehicleRow: { borderRadius: 14, padding: 14, marginBottom: 6 },
  vehicleTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  vehicleLabel: { flex: 1, fontSize: 16, fontWeight: '700', color: Colors.blue },
  pinBtn: {
    width: 28, height: 28, borderRadius: 6, backgroundColor: Colors.white,
    borderWidth: 1, borderColor: '#BCD8F5', alignItems: 'center', justifyContent: 'center',
  },
  freeBadge: { backgroundColor: '#D5EFE3', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: '#A8DEC5' },
  freeText: { fontSize: 10, fontWeight: '700', color: '#0F7A4F', textTransform: 'uppercase', letterSpacing: 0.5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 11, fontWeight: '700', color: '#047857', textTransform: 'uppercase', letterSpacing: 0.5 },
  offlineText: { fontSize: 11, fontWeight: '700', color: Colors.red, textTransform: 'uppercase', letterSpacing: 0.5 },
  speed: { fontSize: 11, color: Colors.textTertiary },
  inlineTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  tagDotSmall: { width: 5, height: 5, borderRadius: 3 },
  inlineTagText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  moreBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border },
  moreText: { fontSize: 10, fontWeight: '600', color: Colors.textTertiary },
  plateRow: { fontSize: 11, color: Colors.textTertiary, marginTop: 4 },
  address: { fontSize: 11, color: '#94A3B8', marginTop: 1 },
  errorCard: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, paddingHorizontal: 20, backgroundColor: '#F5EFE0', borderWidth: 1, borderColor: '#D8CFB8', borderRadius: 16, marginTop: 16 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: Colors.ink, textAlign: 'center', marginTop: 12 },
  errorBody: { fontSize: 13, color: '#475569', textAlign: 'center', marginTop: 8, maxWidth: 300 },
});
