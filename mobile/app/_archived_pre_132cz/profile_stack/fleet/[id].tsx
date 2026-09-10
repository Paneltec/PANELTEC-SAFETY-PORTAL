/**
 * Fleet asset detail screen — v58.13.132g M6
 * Shows asset info + Navixy counters + service history.
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
import { fetchFleetAssetDetail, type FleetAssetDetail } from '../../../src/services/profile';

export default function FleetDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading, isError } = useQuery<FleetAssetDetail>({
    queryKey: ['fleet-asset', id],
    queryFn: () => fetchFleetAssetDetail(id || ''),
    enabled: !!id,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.center}><ActivityIndicator size="large" color={Colors.orange} /></View>
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <Header onBack={() => router.back()} />
        <View style={s.center}>
          <Ionicons name="alert-circle-outline" size={40} color={Colors.textTertiary} />
          <Text style={s.emptyText}>Asset not found</Text>
        </View>
      </View>
    );
  }

  const { asset, counters, history } = data;
  const label = asset.name || asset.rego_serial || asset.id.slice(0, 8);
  const subtitle = [asset.make, asset.model].filter(Boolean).join(' ');

  return (
    <View testID="fleet-detail-screen" style={[s.container, { paddingTop: insets.top }]}>
      <Header onBack={() => router.back()} />
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Asset header card */}
        <View testID="fleet-asset-header" style={s.card}>
          <View style={s.assetRow}>
            <View style={[s.iconCircle, { backgroundColor: Colors.orangeSoft }]}>
              <Ionicons name="car" size={24} color={Colors.orange} />
            </View>
            <View style={s.assetInfo}>
              <Text style={s.assetName}>{label}</Text>
              {subtitle ? <Text style={s.assetSub}>{subtitle}</Text> : null}
              {asset.kind ? (
                <View style={s.kindPill}>
                  <Text style={s.kindText}>{asset.kind}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Status */}
          {asset.status && (
            <View style={[s.statusRow, { backgroundColor: asset.status === 'active' ? Colors.successSoft : Colors.warningSoft }]}>
              <View style={[s.statusDot, { backgroundColor: asset.status === 'active' ? Colors.success : Colors.warning }]} />
              <Text style={[s.statusText, { color: asset.status === 'active' ? Colors.success : Colors.warning }]}>
                {asset.status.charAt(0).toUpperCase() + asset.status.slice(1)}
              </Text>
            </View>
          )}
        </View>

        {/* Counters / Navixy data */}
        <View testID="fleet-counters" style={s.countersGrid}>
          <CounterTile icon="speedometer-outline" label="Odometer" value={asset.odo_km != null ? `${Math.round(asset.odo_km).toLocaleString()} km` : '—'} />
          <CounterTile icon="time-outline" label="Hours" value={asset.hours_meter != null ? `${Math.round(asset.hours_meter).toLocaleString()} hrs` : '—'} />
          <CounterTile icon="construct-outline" label="Services" value={String(counters.total_records)} />
          <CounterTile icon="cash-outline" label="Total Spend" value={`$${counters.total_spend.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`} />
        </View>

        {/* Compliance */}
        <View testID="fleet-compliance" style={s.card}>
          <Text style={s.sectionLabel}>COMPLIANCE</Text>
          <ComplianceRow icon="warning-outline" label="Open Hazards" count={counters.open_hazards} color={counters.open_hazards > 0 ? Colors.warning : Colors.success} />
          <ComplianceRow icon="alert-circle-outline" label="Open Incidents" count={counters.open_incidents} color={counters.open_incidents > 0 ? Colors.error : Colors.success} />
          <ComplianceRow icon="calendar-outline" label="Last Service" count={null} value={counters.last_service_date || '—'} color={Colors.textSecondary} />
        </View>

        {/* Asset details */}
        <View testID="fleet-details" style={s.card}>
          <Text style={s.sectionLabel}>DETAILS</Text>
          {asset.rego_serial && <DetailRow label="Rego / Serial" value={asset.rego_serial} />}
          {asset.asset_type && <DetailRow label="Type" value={asset.asset_type} />}
          {asset.sub_type && <DetailRow label="Sub-type" value={asset.sub_type} />}
          {asset.navixy_device_id && <DetailRow label="Navixy Device" value={`#${asset.navixy_device_id}`} />}
          {asset.last_known_lat != null && asset.last_known_lng != null && (
            <DetailRow label="Last Position" value={`${asset.last_known_lat.toFixed(4)}, ${asset.last_known_lng.toFixed(4)}`} />
          )}
        </View>

        {/* Recent service history */}
        {history.length > 0 && (
          <View testID="fleet-history" style={s.card}>
            <Text style={s.sectionLabel}>RECENT SERVICE HISTORY</Text>
            {history.slice(0, 5).map((rec: any, i: number) => (
              <View key={rec.id || i} style={s.historyRow}>
                <View style={s.historyDot} />
                <View style={s.historyInfo}>
                  <Text style={s.historyType}>{rec.maintenance_type || 'Service'}</Text>
                  <Text style={s.historyDate}>{rec.date_completed || '—'}</Text>
                </View>
                <Text style={s.historyCost}>
                  {rec.cost != null ? `$${Number(rec.cost).toLocaleString()}` : '—'}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={s.header}>
      <TouchableOpacity testID="fleet-back-btn" style={s.backBtn} onPress={onBack}>
        <Ionicons name="chevron-back" size={24} color={Colors.white} />
      </TouchableOpacity>
      <Text style={s.headerTitle}>Fleet Asset</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

function CounterTile({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View testID={`counter-${label.toLowerCase().replace(' ', '-')}`} style={s.counterTile}>
      <Ionicons name={icon as any} size={20} color={Colors.orange} />
      <Text style={s.counterValue}>{value}</Text>
      <Text style={s.counterLabel}>{label}</Text>
    </View>
  );
}

function ComplianceRow({ icon, label, count, value, color }: {
  icon: string; label: string; count: number | null; value?: string; color: string;
}) {
  return (
    <View style={s.complianceRow}>
      <Ionicons name={icon as any} size={18} color={color} />
      <Text style={s.complianceLabel}>{label}</Text>
      <Text style={[s.complianceValue, { color }]}>{value ?? String(count)}</Text>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  scroll: { padding: 16, paddingBottom: 40 },
  emptyText: { fontSize: 15, color: Colors.textTertiary },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.navy, paddingHorizontal: 8, paddingVertical: 14,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.white },

  card: {
    backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },

  // Asset header
  assetRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  iconCircle: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  assetInfo: { flex: 1 },
  assetName: { fontSize: 20, fontWeight: '800', color: Colors.ink },
  assetSub: { fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
  kindPill: {
    backgroundColor: Colors.borderLight, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3, marginTop: 6, alignSelf: 'flex-start',
  },
  kindText: { fontSize: 11, fontWeight: '600', color: Colors.textTertiary, textTransform: 'capitalize' },

  statusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, alignSelf: 'flex-start',
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: '700' },

  // Counters
  countersGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12,
  },
  counterTile: {
    width: '47%', flexGrow: 1,
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  counterValue: { fontSize: 18, fontWeight: '800', color: Colors.ink, marginTop: 6 },
  counterLabel: { fontSize: 11, color: Colors.textTertiary, fontWeight: '500', marginTop: 2 },

  // Section label
  sectionLabel: {
    fontSize: 11, fontWeight: '800', color: Colors.textTertiary,
    letterSpacing: 1.2, marginBottom: 12,
  },

  // Compliance
  complianceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  complianceLabel: { fontSize: 14, color: Colors.ink, flex: 1 },
  complianceValue: { fontSize: 14, fontWeight: '700' },

  // Details
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  detailLabel: { fontSize: 13, color: Colors.textTertiary, fontWeight: '500' },
  detailValue: { fontSize: 14, color: Colors.ink, fontWeight: '600', maxWidth: '60%', textAlign: 'right' },

  // History
  historyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  historyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.orange },
  historyInfo: { flex: 1 },
  historyType: { fontSize: 13, fontWeight: '600', color: Colors.ink },
  historyDate: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  historyCost: { fontSize: 13, fontWeight: '700', color: Colors.ink },
});
