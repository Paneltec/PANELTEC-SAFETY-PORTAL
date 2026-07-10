import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../lib/api';
import { Colors } from '../lib/colors';
import MiniSparkline from './MiniSparkline';

function fmtHours(v: any) { return v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 }); }
function fmtKm(v: any) { return v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }); }
function fmtSigned(n: any, d = 1) {
  if (n == null || isNaN(n)) return '—';
  const v = Number(n);
  if (v === 0) return '0';
  return `${v > 0 ? '+' : ''}${v.toLocaleString(undefined, { maximumFractionDigits: d })}`;
}

function relTime(iso: string | undefined) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (isNaN(mins)) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

const srcLabel = (s: string | undefined) => {
  if (!s) return 'Synced from Navixy';
  if (s === 'panel' || s === 'navixy' || s === 'navixy_counters_v2') return 'Synced from Navixy · panel counter';
  if (s === 'navixy_report') return 'Synced from Navixy · mileage report';
  if (s === 'navixy_tracks_lifetime') return 'GPS-derived · sum of all trips';
  if (s.includes('tracks')) return 'GPS-derived (no panel counter)';
  if (s === 'manual') return 'Manually entered';
  return `Synced from Navixy · ${s}`;
};

const TABS = [
  { k: 'total', label: 'Total' },
  { k: 'week', label: 'This Week' },
  { k: 'month', label: 'Last Month' },
] as const;

export default function LiveCountersCard({ asset }: { asset: any }) {
  if (!asset || (asset.kind !== 'vehicle' && asset.kind !== 'plant')) return null;
  const isNavixy = !!asset.navixy_device_id;
  return isNavixy ? <NavixyCounters asset={asset} /> : <ManualCounters asset={asset} />;
}

function NavixyCounters({ asset }: { asset: any }) {
  const [tab, setTab] = useState('total');
  const [trends, setTrends] = useState<any>(null);

  useEffect(() => {
    api.get(`/assets/${asset.id}/meter-trends`)
      .then(r => setTrends(r.data))
      .catch(() => setTrends({ error: true }));
  }, [asset.id]);

  const hoursAgo = relTime(asset.hours_meter_updated_at);
  const kmAgo = relTime(asset.odo_km_updated_at);

  return (
    <View testID="live-counters-navixy" style={s.card}>
      <View style={s.headerRow}>
        <View style={s.liveTag}><Text style={s.liveTagText}>LIVE</Text></View>
        <Text style={s.headerLabel}>Live counters · Navixy</Text>
      </View>

      {/* Tab strip */}
      <View style={s.tabStrip}>
        {TABS.map(t => (
          <TouchableOpacity key={t.k} testID={`meter-tab-${t.k}`}
            style={[s.tab, tab === t.k && s.tabActive]}
            onPress={() => setTab(t.k)}>
            <Text style={[s.tabText, tab === t.k && s.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'total' && (
        <View style={s.grid}>
          <CounterCard icon="pulse" label="Engine hours" value={fmtHours(asset.hours_meter)} unit="hrs"
            sub={`${srcLabel(asset.hours_meter_source)}${hoursAgo ? ' · ' + hoursAgo : ''}`} />
          {asset.lifetime_unreliable ? (
            <View style={s.unreliableCard}>
              <Ionicons name="speedometer" size={16} color={Colors.imBronze} />
              <Text style={s.unreliableTitle}>Odometer</Text>
              <Text style={s.unreliableText}>Lifetime not available — Add a historical reading</Text>
            </View>
          ) : (
            <CounterCard icon="speedometer" label="Odometer" value={fmtKm(asset.odo_km)} unit="km"
              sub={`${srcLabel(asset.odo_km_source)}${kmAgo ? ' · ' + kmAgo : ''}`} />
          )}
        </View>
      )}

      {(tab === 'week' || tab === 'month') && (
        <DeltaView trends={trends} slot={tab} />
      )}

      <Text style={s.footerNote}>
        {tab === 'total' ? 'Values from the Navixy tracker. Manual edits disabled.' : 'Deltas computed from daily snapshots.'}
      </Text>
    </View>
  );
}

function DeltaView({ trends, slot }: { trends: any; slot: string }) {
  if (!trends || trends.error) {
    return <Text style={s.emptyHint}>Collecting data — try again in a few minutes.</Text>;
  }
  const d = trends[slot];
  if (!d) return <Text style={s.emptyHint}>No data yet.</Text>;
  const total = slot === 'week' ? 7 : 30;
  const collecting = (d.days_available || 0) < total;
  const sparkHours = (d.sparkline || []).map((p: any) => p.engine_hours).filter((v: any) => v != null);
  const sparkKm = (d.sparkline || []).map((p: any) => p.odometer_km).filter((v: any) => v != null);

  return (
    <View>
      <View style={s.grid}>
        <View style={s.deltaCard}>
          <View style={s.deltaHeader}>
            <Ionicons name="pulse" size={12} color={Colors.imInkMuted} />
            <Text style={s.deltaLabel}>ENGINE HOURS</Text>
          </View>
          <Text style={s.deltaValue}>{fmtSigned(d.engine_hours_delta, 1)} <Text style={s.deltaUnit}>hrs</Text></Text>
          <Text style={s.deltaAvg}>Daily avg: {d.daily_avg_hours} hrs · {d.daily_avg_km} km</Text>
          <MiniSparkline data={sparkHours} color={Colors.imSuccess} />
        </View>
        <View style={s.deltaCard}>
          <View style={s.deltaHeader}>
            <Ionicons name="speedometer" size={12} color={Colors.imInkMuted} />
            <Text style={s.deltaLabel}>ODOMETER</Text>
          </View>
          <Text style={s.deltaValue}>{fmtSigned(d.odometer_km_delta, 0)} <Text style={s.deltaUnit}>km</Text></Text>
          <Text style={s.deltaAvg}>Daily avg: {d.daily_avg_hours} hrs · {d.daily_avg_km} km</Text>
          <MiniSparkline data={sparkKm} color={Colors.imBronze} />
        </View>
      </View>
      {collecting && (
        <Text testID={`trends-${slot}-collecting`} style={s.collectingHint}>
          Collecting data — {d.days_available} of {total} days available
        </Text>
      )}
    </View>
  );
}

function ManualCounters({ asset }: { asset: any }) {
  const hoursAgo = relTime(asset.hours_meter_updated_at);
  const kmAgo = relTime(asset.odo_km_updated_at);
  return (
    <View testID="live-counters-manual" style={[s.card, { borderColor: Colors.border, backgroundColor: Colors.imConcrete }]}>
      <Text style={[s.headerLabel, { color: Colors.textSecondary }]}>Live counters · Manual</Text>
      <View style={s.grid}>
        <CounterCard icon="pulse" label="Engine hours" value={fmtHours(asset.hours_meter)} unit="hrs"
          sub={hoursAgo ? `Updated ${hoursAgo}` : 'Not yet recorded'} />
        <CounterCard icon="speedometer" label="Odometer" value={fmtKm(asset.odo_km)} unit="km"
          sub={kmAgo ? `Updated ${kmAgo}` : 'Not yet recorded'} />
      </View>
    </View>
  );
}

function CounterCard({ icon, label, value, unit, sub }: { icon: string; label: string; value: string; unit: string; sub: string }) {
  return (
    <View style={s.counterBox}>
      <View style={s.counterIconRow}>
        <View style={s.counterIcon}><Ionicons name={icon as any} size={14} color={Colors.imSuccess} /></View>
        <Text style={s.counterLabel}>{label.toUpperCase()}</Text>
      </View>
      <Text style={s.counterValue}>{value} <Text style={s.counterUnit}>{unit}</Text></Text>
      <Text style={s.counterSub} numberOfLines={2}>{sub}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, borderColor: Colors.emerald, backgroundColor: Colors.imConcrete, padding: 12, marginBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  liveTag: { backgroundColor: Colors.imSuccess, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  liveTagText: { fontSize: 8, fontWeight: '800', color: Colors.imSurface, letterSpacing: 0.5 },
  headerLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: Colors.imSuccess, textTransform: 'uppercase' },

  tabStrip: { flexDirection: 'row', gap: 2, backgroundColor: Colors.surface, borderRadius: 10, borderWidth: 1, borderColor: Colors.emerald, padding: 2, marginBottom: 10, alignSelf: 'flex-start' },
  tab: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  tabActive: { backgroundColor: Colors.imBronze },
  tabText: { fontSize: 11, fontWeight: '600', color: Colors.textTertiary },
  tabTextActive: { color: Colors.imSurface },

  grid: { flexDirection: 'row', gap: 8 },
  counterBox: { flex: 1, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.emerald, borderRadius: 12, padding: 10 },
  counterIconRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  counterIcon: { width: 24, height: 24, borderRadius: 6, backgroundColor: Colors.imConcrete, alignItems: 'center', justifyContent: 'center' },
  counterLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.6, color: Colors.textTertiary },
  counterValue: { fontSize: 22, fontWeight: '700', color: Colors.ink },
  counterUnit: { fontSize: 12, fontWeight: '600', color: Colors.imInkSubtle },
  counterSub: { fontSize: 9, color: Colors.imInkSubtle, marginTop: 2 },

  deltaCard: { flex: 1, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.emerald, borderRadius: 12, padding: 10 },
  deltaHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  deltaLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, color: Colors.textTertiary },
  deltaValue: { fontSize: 22, fontWeight: '700', color: Colors.ink },
  deltaUnit: { fontSize: 12, fontWeight: '600', color: Colors.imInkSubtle },
  deltaAvg: { fontSize: 10, color: Colors.textTertiary, marginTop: 2, marginBottom: 4 },

  emptyHint: { fontSize: 12, color: Colors.textTertiary, textAlign: 'center', paddingVertical: 20 },
  collectingHint: { fontSize: 10, color: Colors.imInk, marginTop: 6 },
  footerNote: { fontSize: 9, color: Colors.imInkSubtle, marginTop: 8, lineHeight: 13 },

  unreliableCard: { flex: 1, backgroundColor: Colors.imConcrete, borderWidth: 1, borderColor: Colors.imConcrete, borderRadius: 12, padding: 10 },
  unreliableTitle: { fontSize: 10, fontWeight: '700', color: Colors.imInk, marginTop: 4 },
  unreliableText: { fontSize: 10, color: Colors.imBronze, marginTop: 2 },
});
