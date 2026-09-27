/**
 * My Leave — list of the worker's leave requests + balances + "Request leave".
 */
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import { Screen, BackHeader, SectionLabel, Loading, Empty, Hint } from '../../src/components/ui';
import { LeaveCard } from '../../src/components/LeaveCard';
import PrimaryButton from '../../src/components/PrimaryButton';
import { fetchMyLeave, apiMessage, toIso, type MyLeaveResponse } from '../../src/services/leave';

export default function MyLeaveScreen() {
  const router = useRouter();
  const [data, setData] = useState<MyLeaveResponse | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setData(await fetchMyLeave()); setError(''); } catch (e) { setError(apiMessage(e)); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const today = toIso(new Date());
  const upcoming = (data?.requests ?? []).filter((r) => r.end_date >= today && r.status !== 'cancelled' && r.status !== 'rejected')
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const past = (data?.requests ?? []).filter((r) => !upcoming.includes(r));
  const annual = data?.balances?.annual;
  const sick = data?.balances?.sick;

  return (
    <Screen testID="my-leave-screen" refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      <BackHeader title="My Leave" />

      <View style={s.balances}>
        <View style={s.bal}>
          <Text style={s.balLabel}>ANNUAL LEAVE</Text>
          <Text style={s.balValue}>{annual ? `${annual.hours.toFixed(1)} h` : '—'}</Text>
          <Text style={s.balSub}>{annual ? `≈ ${(annual.hours / (data?.hours_per_day || 7.6)).toFixed(1)} days` : 'Not known yet'}</Text>
        </View>
        <View style={s.bal}>
          <Text style={s.balLabel}>SICK / CARER'S</Text>
          <Text style={s.balValue}>{sick ? `${sick.hours.toFixed(1)} h` : '—'}</Text>
          <Text style={s.balSub}>{sick ? `≈ ${(sick.hours / (data?.hours_per_day || 7.6)).toFixed(1)} days` : 'Not known yet'}</Text>
        </View>
      </View>
      <Hint>Balances come from payroll and update when a request is processed.</Hint>

      <PrimaryButton testID="request-leave-btn" title="REQUEST LEAVE" variant="green" style={{ marginTop: 16 }}
        onPress={() => router.push('/leave/new' as never)} />

      {!data && !error && <Loading text="Loading your leave…" />}
      {!!error && (
        <View style={s.err}><Ionicons name="cloud-offline-outline" size={16} color={Colors.onScreenMuted} /><Text style={s.errText}>{error}</Text></View>
      )}

      {data && data.requests.length === 0 && (
        <Empty icon="calendar-outline" title="No leave requests yet" body="Tap Request Leave to ask for time off. Your supervisor gets it straight away." />
      )}

      {upcoming.length > 0 && <SectionLabel style={{ marginTop: 22 }}>UPCOMING</SectionLabel>}
      <View style={s.list}>
        {upcoming.map((r) => <LeaveCard key={r.id} r={r} onPress={() => router.push({ pathname: '/leave/[id]', params: { id: r.id } } as never)} />)}
      </View>

      {past.length > 0 && <SectionLabel style={{ marginTop: 22 }}>PAST &amp; CLOSED</SectionLabel>}
      <View style={s.list}>
        {past.map((r) => <LeaveCard key={r.id} r={r} onPress={() => router.push({ pathname: '/leave/[id]', params: { id: r.id } } as never)} />)}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  balances: { flexDirection: 'row', gap: 10 },
  bal: { flex: 1, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 14, padding: 14 },
  balLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: Colors.onCardSubtle },
  balValue: { fontSize: 24, fontWeight: '800', color: Colors.onCard, marginTop: 4, fontVariant: ['tabular-nums'] },
  balSub: { fontSize: 12, color: Colors.onCardMuted, marginTop: 2 },
  list: { gap: 8 },
  err: { flexDirection: 'row', gap: 8, marginTop: 16, alignItems: 'flex-start' },
  errText: { flex: 1, fontSize: 12, color: Colors.onScreenMuted, lineHeight: 17 },
});
