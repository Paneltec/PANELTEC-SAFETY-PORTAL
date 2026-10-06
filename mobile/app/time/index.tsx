/**
 * My Timesheet — pick a day, see the time booked to each client, add more.
 *
 *   week (‹ ›)  →  day strip  →  that day's client blocks  →  + Add time
 *
 * Saved straight to Paneltec Pay (backend /api/me/payroll). Hours roll up
 * per day for the office; each block keeps its own client + job.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import { Screen, BackHeader, SectionLabel, Loading, Empty, Hint, Chip } from '../../src/components/ui';
import PrimaryButton from '../../src/components/PrimaryButton';
import {
  fetchMyWeek, saveDay, submitWeek, apiMessage, dayLabel, fmt12, fmtHours, lineHours, toIso, shiftIso,
  type MyWeek, type DayEntry, type TimeLine,
} from '../../src/services/timesheet';

const STATUS: Record<string, { text: string; tone: 'orange' | 'green' | 'grey' | 'red' }> = {
  draft: { text: 'NOT SENT', tone: 'grey' },
  submitted: { text: 'SENT', tone: 'orange' },
  approved: { text: 'APPROVED', tone: 'green' },
  locked: { text: 'PAID', tone: 'green' },
  rejected: { text: 'SENT BACK', tone: 'red' },
};

export default function MyTimesheetScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ day?: string }>();
  const [periodId, setPeriodId] = useState<string | undefined>(undefined);
  const [week, setWeek] = useState<MyWeek | null>(null);
  const [day, setDay] = useState<string>(params.day || toIso(new Date()));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (pid?: string) => {
    try {
      const w = await fetchMyWeek(pid);
      setWeek(w); setError('');
      setDay((d) => (w.days.includes(d) ? d : (w.days.includes(toIso(new Date())) ? toIso(new Date()) : w.days[0])));
    } catch (e) { setError(apiMessage(e)); }
  }, []);
  useFocusEffect(useCallback(() => { load(periodId); }, [load, periodId]));

  const byDay = useMemo(() => {
    const m: Record<string, DayEntry> = {};
    (week?.entries ?? []).forEach((e) => { m[e.date] = e; });
    return m;
  }, [week]);

  const entry = byDay[day];
  const lines: TimeLine[] = entry?.lines ?? [];
  const legacy = entry && !lines.length && entry.kind === 'work' && entry.hours > 0;  // day entered before client blocks existed
  const locked = entry && ['approved', 'locked', 'submitted'].includes(entry.status);
  const weekTotal = (week?.entries ?? []).reduce((t, e) => t + (e.hours || 0), 0);
  const unsent = (week?.entries ?? []).filter((e) => ['draft', 'rejected'].includes(e.status) && e.hours > 0).length;

  const goWeek = (dir: -1 | 1) => {
    if (!week) return;
    const target = shiftIso(dir < 0 ? week.period.start : week.period.end, dir);
    setWeek(null); setPeriodId(target); setDay(target);
  };

  const removeLine = (idx: number) => {
    const l = lines[idx];
    Alert.alert('Remove time?', `${l.client_name}\n${fmt12(l.start)} – ${fmt12(l.finish)}`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          setBusy(true);
          try { await saveDay(day, lines.filter((_, i) => i !== idx), entry?.notes); await load(periodId); }
          catch (e) { Alert.alert('Not removed', apiMessage(e)); }
          finally { setBusy(false); }
        },
      },
    ]);
  };

  const send = () => {
    if (!week) return;
    Alert.alert('Send this week?', `${fmtHours(weekTotal)} across ${(week.entries.filter((e) => e.hours > 0)).length} days goes to the office for approval. You can't change sent days unless the office sends them back.`, [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Send', onPress: async () => {
          setBusy(true);
          try { const r = await submitWeek(week.period.id); await load(periodId); Alert.alert('Sent', `${r.submitted} day${r.submitted === 1 ? '' : 's'} sent to the office.`); }
          catch (e) { Alert.alert('Not sent', apiMessage(e)); }
          finally { setBusy(false); }
        },
      },
    ]);
  };

  return (
    <Screen testID="my-timesheet-screen" refreshing={refreshing}
      onRefresh={async () => { setRefreshing(true); await load(periodId); setRefreshing(false); }}>
      <BackHeader title="My Timesheet" />

      {!week && !error && <Loading text="Loading your week…" />}
      {!!error && (
        <View style={s.err}><Ionicons name="cloud-offline-outline" size={16} color={Colors.onScreenMuted} /><Text style={s.errText}>{error}</Text></View>
      )}

      {week && (
        <>
          {/* Week switcher */}
          <View style={s.weekBar}>
            <TouchableOpacity testID="week-prev" onPress={() => goWeek(-1)} style={s.weekBtn} hitSlop={8}>
              <Ionicons name="chevron-back" size={22} color={Colors.onScreen} />
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={s.weekTitle}>
                {new Date(week.period.start + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                {' – '}
                {new Date(week.period.end + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
              </Text>
              <Text style={s.weekSub}>{fmtHours(weekTotal)} this week</Text>
            </View>
            <TouchableOpacity testID="week-next" onPress={() => goWeek(1)} style={s.weekBtn} hitSlop={8}>
              <Ionicons name="chevron-forward" size={22} color={Colors.onScreen} />
            </TouchableOpacity>
          </View>

          {/* Day strip */}
          <View style={s.days}>
            {week.days.map((d) => {
              const e = byDay[d];
              const on = d === day;
              const isToday = d === toIso(new Date());
              return (
                <TouchableOpacity key={d} testID={`day-${d}`} onPress={() => setDay(d)}
                  style={[s.dayPill, on && s.dayPillOn]} activeOpacity={0.8}>
                  <Text style={[s.dayName, on && s.dayTextOn]}>{dayLabel(d)}</Text>
                  <Text style={[s.dayNum, on && s.dayTextOn]}>{Number(d.slice(8))}</Text>
                  <Text style={[s.dayHrs, on && s.dayTextOn, !(e?.hours) && { opacity: 0.4 }]}>
                    {e?.hours ? `${Math.round(e.hours * 10) / 10}h` : '—'}
                  </Text>
                  {isToday && <View style={[s.todayDot, on && { backgroundColor: Colors.white }]} />}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Selected day */}
          <View style={s.dayHead}>
            <Text style={s.dayTitle}>{dayLabel(day, 'long')}</Text>
            {entry && STATUS[entry.status] && <Chip text={STATUS[entry.status].text} tone={STATUS[entry.status].tone} />}
          </View>
          {entry?.status === 'rejected' && !!entry.rejected_reason && (
            <View style={s.reject}><Ionicons name="alert-circle" size={16} color="#F87171" /><Text style={s.rejectText}>{entry.rejected_reason}</Text></View>
          )}

          {lines.map((l, i) => (
            <View key={l.id || i} testID={`time-line-${i}`} style={s.tile}>
              <View style={s.tileIcon}><Ionicons name="business-outline" size={20} color={Colors.orange} /></View>
              <TouchableOpacity style={{ flex: 1 }} disabled={!!locked || busy}
                onPress={() => router.push({ pathname: '/time/add', params: { day, edit: String(i) } } as never)}>
                <Text style={s.tileTitle} numberOfLines={1}>{l.client_name}</Text>
                {!!l.job_ref && <Text style={s.tileSub} numberOfLines={1}>Job {l.job_ref}</Text>}
                <Text style={s.tileSub}>
                  {fmt12(l.start)} – {fmt12(l.finish)}{l.break_minutes ? ` · ${l.break_minutes} min break` : ''}
                </Text>
              </TouchableOpacity>
              <Text style={s.tileHrs}>{fmtHours(l.hours ?? lineHours(l))}</Text>
              {!locked && (
                <TouchableOpacity testID={`time-line-remove-${i}`} onPress={() => removeLine(i)} hitSlop={10} style={{ paddingLeft: 6 }}>
                  <Ionicons name="trash-outline" size={18} color={Colors.onCardSubtle} />
                </TouchableOpacity>
              )}
            </View>
          ))}

          {legacy && (
            <View style={s.tile}>
              <View style={s.tileIcon}><Ionicons name="time-outline" size={20} color={Colors.orange} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.tileTitle}>{entry.site_name || 'Hours'}</Text>
                <Text style={s.tileSub}>{entry.start && entry.finish ? `${fmt12(entry.start)} – ${fmt12(entry.finish)}` : 'Entered by the office'}</Text>
              </View>
              <Text style={s.tileHrs}>{fmtHours(entry.hours)}</Text>
            </View>
          )}

          {!lines.length && !legacy && (
            <Empty icon="time-outline" title="No time for this day" body="Tap Add Time, pick the client, then enter your start and finish." />
          )}

          {lines.length > 1 && (
            <View style={s.dayTotal}><Text style={s.dayTotalText}>Day total</Text><Text style={s.dayTotalHrs}>{fmtHours(entry?.hours || 0)}</Text></View>
          )}

          {!locked && (
            <PrimaryButton testID="add-time-btn" title="+ ADD TIME" style={{ marginTop: 14 }} disabled={busy}
              onPress={() => router.push({ pathname: '/time/add', params: { day } } as never)} />
          )}
          {locked && <Hint>This day has been sent. Ask the office if something needs changing.</Hint>}

          <SectionLabel style={{ marginTop: 26 }}>THIS WEEK</SectionLabel>
          <PrimaryButton testID="submit-week-btn" variant="green" loading={busy}
            title={unsent ? `SEND WEEK TO OFFICE (${unsent} DAY${unsent === 1 ? '' : 'S'})` : 'NOTHING TO SEND'}
            disabled={!unsent || busy} onPress={send} />
          <Hint>Send once your week is complete. The office approves it and it goes through to pay.</Hint>
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  err: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 14, borderRadius: 12, backgroundColor: Colors.faintPanel },
  errText: { flex: 1, color: Colors.onScreenMuted, fontSize: 13 },
  weekBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.faintPanel, borderRadius: 16, padding: 8 },
  weekBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  weekTitle: { color: Colors.onScreen, fontSize: 16, fontWeight: '800' },
  weekSub: { color: Colors.onScreenMuted, fontSize: 12, marginTop: 2 },
  days: { flexDirection: 'row', gap: 6, marginTop: 12 },
  dayPill: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 14,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, minHeight: 74,
  },
  dayPillOn: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  dayName: { fontSize: 11, fontWeight: '700', color: Colors.onCardMuted },
  dayNum: { fontSize: 18, fontWeight: '800', color: Colors.onCard, marginTop: 2 },
  dayHrs: { fontSize: 11, fontWeight: '700', color: Colors.onCardMuted, marginTop: 2 },
  dayTextOn: { color: Colors.white },
  todayDot: { position: 'absolute', top: 5, right: 6, width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.orange },
  dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 10 },
  dayTitle: { color: Colors.onScreen, fontSize: 18, fontWeight: '800', flex: 1 },
  reject: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: 12, backgroundColor: 'rgba(239,68,68,0.15)', marginBottom: 10 },
  rejectText: { flex: 1, color: '#FCA5A5', fontSize: 13 },
  tile: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card,
    borderRadius: 16, padding: 14, marginBottom: 10, minHeight: 64,
  },
  tileIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(249,115,22,0.14)', alignItems: 'center', justifyContent: 'center' },
  tileTitle: { fontSize: 16, fontWeight: '700', color: Colors.onCard },
  tileSub: { fontSize: 13, color: Colors.onCardMuted, marginTop: 2 },
  tileHrs: { fontSize: 16, fontWeight: '800', color: Colors.onCard },
  dayTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 6, paddingTop: 4 },
  dayTotalText: { color: Colors.onScreenMuted, fontSize: 13, fontWeight: '700' },
  dayTotalHrs: { color: Colors.onScreen, fontSize: 15, fontWeight: '800' },
});
