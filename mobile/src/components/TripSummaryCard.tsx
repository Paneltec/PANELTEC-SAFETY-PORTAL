import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../lib/api';
import { Colors } from '../lib/colors';
import MiniSparkline from './MiniSparkline';

function fmtSecs(s: number | null | undefined) {
  if (!s) return '0m';
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

const TABS = [
  { k: 'today', label: 'Today' },
  { k: 'week', label: 'This Week' },
  { k: 'month', label: 'Last Month' },
] as const;

export default function TripSummaryCard({ asset }: { asset: any }) {
  const [range, setRange] = useState<string>('today');
  const [data, setData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const load = (r: string) => {
    setLoading(prev => ({ ...prev, [r]: true }));
    api.get(`/assets/${asset.id}/trip-summary?range=${r}`)
      .then(res => setData(prev => ({ ...prev, [r]: res.data })))
      .catch(() => setData(prev => ({ ...prev, [r]: { error: true } })))
      .finally(() => setLoading(prev => ({ ...prev, [r]: false })));
  };

  useEffect(() => { if (!data[range]) load(range); }, [range, asset.id]);

  const d = data[range];
  const total = range === 'today' ? 1 : range === 'week' ? 7 : 30;
  const collecting = d && !d.error && range !== 'today' && (d.days_available || 0) < total;
  const sparkData = d?.sparkline?.map((p: any) => p.km).filter((v: any) => v != null) || [];

  return (
    <View testID="trip-summary-card" style={s.card}>
      <View style={s.headerRow}>
        <View style={s.tripTag}><Text style={s.tripTagText}>TRIP</Text></View>
        <Text style={s.headerLabel}>Today's trip · Navixy</Text>
        <View style={{ flex: 1 }} />
        <View style={s.tabStrip}>
          {TABS.map(t => (
            <TouchableOpacity key={t.k} testID={`trip-tab-${t.k}`}
              style={[s.tab, range === t.k && s.tabActive]}
              onPress={() => setRange(t.k)}>
              <Text style={[s.tabText, range === t.k && s.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {loading[range] && !d && (
        <View style={s.loadingWrap}><ActivityIndicator color="#F97316" /><Text style={s.loadingText}>Loading trip data…</Text></View>
      )}

      {d && d.error && (
        <Text testID="trip-error" style={s.errorText}>Could not load trip data — check Navixy connection.</Text>
      )}

      {d && !d.error && (
        <>
          <View style={s.tilesGrid}>
            <TripTile label="Distance" value={d.distance_km?.toLocaleString(undefined, { maximumFractionDigits: 1 }) ?? '0'} unit="km" testID="trip-distance" />
            <TripTile label="Drive time" value={fmtSecs(d.drive_seconds)} unit="" testID="trip-drive" />
            <TripTile label="Idle time" value={fmtSecs(d.idle_seconds)} unit="" testID="trip-idle" />
            <TripTile label="Max speed" value={String(d.max_speed_kmh ?? 0)} unit="km/h" testID="trip-max-speed" />
          </View>
          <View style={s.metaRow}>
            <Text testID="trip-meta" style={s.metaText}>
              {d.trip_count ?? 0} trip{d.trip_count === 1 ? '' : 's'}
              {range !== 'today' ? ` · ${d.days_available ?? 0} of ${total} days with activity` : ''}
            </Text>
          </View>
          {collecting && (
            <Text testID="trip-collecting" style={s.collectingText}>Collecting data — some days have no trips on file</Text>
          )}
          {sparkData.length > 1 && (
            <View style={s.sparkWrap}>
              <MiniSparkline data={sparkData} color="#F97316" width={200} height={20} />
              <Text style={s.sparkLabel}>Daily km · last {sparkData.length} days</Text>
            </View>
          )}
        </>
      )}

      <Text style={s.footerNote}>Trips aggregated from Navixy track records. Idle time approximated from inter-trip gaps &#60; 30 min.</Text>
    </View>
  );
}

function TripTile({ label, value, unit, testID }: { label: string; value: string; unit: string; testID: string }) {
  return (
    <View testID={testID} style={s.tile}>
      <Text style={s.tileLabel}>{label.toUpperCase()}</Text>
      <Text style={s.tileValue}>
        {value}
        {unit ? <Text style={s.tileUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, padding: 12, marginBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' },
  tripTag: { backgroundColor: '#EA580C', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  tripTagText: { fontSize: 8, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  headerLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: '#C2410C', textTransform: 'uppercase' },

  tabStrip: { flexDirection: 'row', gap: 2, backgroundColor: '#F8FAFC', borderRadius: 8, borderWidth: 1, borderColor: Colors.border, padding: 2 },
  tab: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  tabActive: { backgroundColor: '#F97316' },
  tabText: { fontSize: 10, fontWeight: '600', color: Colors.textTertiary },
  tabTextActive: { color: '#fff' },

  tilesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: { width: '48%' as any, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  tileLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, color: Colors.textTertiary },
  tileValue: { fontSize: 20, fontWeight: '700', color: Colors.ink, marginTop: 2 },
  tileUnit: { fontSize: 10, fontWeight: '500', color: '#94A3B8' },

  metaRow: { marginTop: 8 },
  metaText: { fontSize: 10, color: Colors.textTertiary },
  collectingText: { fontSize: 10, color: '#92400E', marginTop: 4 },

  sparkWrap: { marginTop: 6 },
  sparkLabel: { fontSize: 8, color: '#94A3B8', marginTop: 2 },

  footerNote: { fontSize: 9, color: '#94A3B8', marginTop: 8, lineHeight: 13 },
  loadingWrap: { alignItems: 'center', paddingVertical: 20 },
  loadingText: { fontSize: 12, color: Colors.textTertiary, marginTop: 4 },
  errorText: { fontSize: 12, color: '#E11D48', textAlign: 'center', paddingVertical: 20 },
});
