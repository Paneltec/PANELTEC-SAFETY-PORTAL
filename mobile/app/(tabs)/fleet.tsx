/**
 * Fleet tab — vehicles, plant and equipment from the Fleet & Service Register.
 * Tap an asset → /profile/fleet/[id] (existing detail screen).
 */
import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Screen, PageHeader, SectionLabel, Tile, Input, Loading, Empty } from '../../src/components/ui';
import { fetchFleetRegister, type FleetAsset } from '../../src/services/profile';

function iconFor(a: FleetAsset): any {
  const t = `${a.kind} ${a.asset_type ?? ''} ${a.sub_type ?? ''}`.toLowerCase();
  if (t.includes('excavat') || t.includes('plant') || t.includes('loader')) return 'construct';
  if (t.includes('trailer')) return 'git-commit';
  if (t.includes('truck') || t.includes('tipper')) return 'bus';
  if (t.includes('tool') || t.includes('equip')) return 'hammer';
  return 'car';
}

function groupOf(a: FleetAsset): string {
  const k = (a.kind || '').toLowerCase();
  if (k.includes('vehicle')) return 'VEHICLES';
  if (k.includes('plant')) return 'PLANT';
  return 'EQUIPMENT';
}

export default function FleetScreen() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['fleet-register'],
    queryFn: fetchFleetRegister,
    staleTime: 5 * 60_000,
  });

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = (data ?? []).filter((a) => !needle ||
      [a.name, a.rego_serial, a.make, a.model].some((v) => (v || '').toLowerCase().includes(needle)));
    const out: Record<string, FleetAsset[]> = {};
    rows.forEach((a) => { (out[groupOf(a)] ||= []).push(a); });
    return ['VEHICLES', 'PLANT', 'EQUIPMENT'].filter((g) => out[g]?.length).map((g) => [g, out[g]] as const);
  }, [data, q]);

  return (
    <Screen testID="fleet-screen" refreshing={isRefetching} onRefresh={refetch}>
      <PageHeader overline="PANELTEC GROUP" title="FLEET" sub="Vehicles, plant and equipment" />
      <Input testID="fleet-search" value={q} onChangeText={setQ} placeholder="Search rego, name, make…" />

      {isLoading && <Loading text="Loading fleet…" />}
      {!isLoading && groups.length === 0 && (
        <Empty icon="car-outline" title={q ? 'No matches' : 'No fleet to show'}
          body={q ? 'Try a different rego or name.' : "Ask the office if you should be able to see vehicles and plant here."} />
      )}

      {groups.map(([g, items]) => (
        <View key={g}>
          <SectionLabel style={{ marginTop: 18 }}>{g}</SectionLabel>
          <View style={s.list}>
            {items.map((a) => (
              <Tile
                key={a.id}
                testID={`fleet-${a.id}`}
                icon={iconFor(a)}
                title={a.name || a.rego_serial || 'Unnamed asset'}
                desc={[a.rego_serial && a.name ? a.rego_serial : null, [a.make, a.model].filter(Boolean).join(' ') || null,
                  a.odo_km ? `${Math.round(a.odo_km).toLocaleString()} km` : a.hours_meter ? `${Math.round(a.hours_meter).toLocaleString()} h` : null]
                  .filter(Boolean).join(' · ')}
                badge={a.status && a.status.toLowerCase() !== 'active' ? a.status.toUpperCase() : undefined}
                onPress={() => router.push({ pathname: '/profile/fleet/[id]', params: { id: a.id } } as never)}
              />
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({ list: { gap: 8 } });
