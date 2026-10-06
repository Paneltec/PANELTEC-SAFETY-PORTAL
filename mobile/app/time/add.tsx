/**
 * Add / edit time — two steps on one screen:
 *   1. Select client (recent first, search, Simpro jobs, internal codes)
 *   2. Day + start / finish / break (big ± buttons, no tiny pickers)
 * Saves the whole day back with the new block included.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import { Screen, BackHeader, SectionLabel, FieldLabel, Input, Hint } from '../../src/components/ui';
import PrimaryButton from '../../src/components/PrimaryButton';
import {
  fetchClients, fetchMyWeek, saveDay, apiMessage, dayLabel, fmt12, fmtHours, lineHours, toMin, fromMin, shiftIso,
  type Client, type ClientJob, type TimeLine, type MyWeek,
} from '../../src/services/timesheet';

const BREAKS = [0, 15, 30, 45, 60];

export default function AddTimeScreen() {
  const router = useRouter();
  const p = useLocalSearchParams<{ day: string; edit?: string }>();
  const editIdx = p.edit != null ? Number(p.edit) : null;

  const [day, setDay] = useState<string>(p.day);
  const [week, setWeek] = useState<MyWeek | null>(null);
  const [step, setStep] = useState<1 | 2>(editIdx != null ? 2 : 1);

  // Step 1 — client
  const [q, setQ] = useState('');
  const [clients, setClients] = useState<Client[] | null>(null);
  const [internal, setInternal] = useState<Client[]>([]);
  const [client, setClient] = useState<{ id?: string | null; name: string } | null>(null);
  const [jobs, setJobs] = useState<ClientJob[]>([]);
  const [job, setJob] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 2 — times
  const [start, setStart] = useState('07:00');
  const [finish, setFinish] = useState('15:30');
  const [brk, setBrk] = useState(30);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Load the week once: defaults, existing blocks on this day, and the line being edited.
  useEffect(() => {
    (async () => {
      try {
        const w = await fetchMyWeek(p.day);
        setWeek(w);
        const existing = w.entries.find((e) => e.date === p.day)?.lines ?? [];
        if (editIdx != null && existing[editIdx]) {
          const l = existing[editIdx];
          setClient({ id: l.client_id, name: l.client_name }); setJob(l.job_ref || null);
          setStart(l.start); setFinish(l.finish); setBrk(l.break_minutes || 0); setNotes(l.notes || '');
        } else if (existing.length) {
          // Next block starts where the last one finished.
          const last = [...existing].sort((a, b) => a.finish.localeCompare(b.finish)).pop()!;
          setStart(last.finish); setFinish(fromMin(Math.max(toMin(last.finish) + 60, toMin(w.defaults.finish)))); setBrk(0);
        } else {
          setStart(w.defaults.start); setFinish(w.defaults.finish); setBrk(w.defaults.break_minutes);
        }
      } catch (e) { Alert.alert('Could not load', apiMessage(e)); }
    })();
  }, [p.day, editIdx]);

  const search = useCallback((text: string) => {
    setQ(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { const r = await fetchClients(text.trim() || undefined); setClients(r.clients); setInternal(r.internal); }
      catch (e) { setClients([]); }
    }, text ? 300 : 0);
  }, []);
  useEffect(() => { if (step === 1) search(''); }, [step, search]);

  const pick = (c: Client) => {
    setClient({ id: c.id, name: c.name }); setJobs(c.jobs || []); setJob(null);
    if (!(c.jobs || []).length) setStep(2);
  };

  const hours = lineHours({ start, finish, break_minutes: brk });
  const bad = toMin(finish) <= toMin(start) ? 'Finish must be after start' : hours <= 0 ? 'Break is longer than the time worked' : '';
  const recent = useMemo(() => (clients ?? []).filter((c) => c.recent), [clients]);
  const others = useMemo(() => (clients ?? []).filter((c) => !c.recent), [clients]);
  const dayLocked = !!week?.entries.find((e) => e.date === day && ['submitted', 'approved', 'locked'].includes(e.status));

  const save = async () => {
    if (!client || bad) return;
    setSaving(true);
    try {
      // Re-read the target day so we never overwrite blocks added elsewhere.
      const w = day === p.day && week ? week : await fetchMyWeek(day);
      const existing: TimeLine[] = [...(w.entries.find((e) => e.date === day)?.lines ?? [])];
      const line: TimeLine = {
        client_id: client.id || null, client_name: client.name, job_ref: job, start, finish,
        break_minutes: brk, notes: notes.trim() || null,
      };
      if (editIdx != null && day === p.day && existing[editIdx]) {
        existing[editIdx] = { ...existing[editIdx], ...line };
      } else {
        if (editIdx != null && day !== p.day) {
          // Moving a block to another day: remove it from the original day first.
          const orig = (week?.entries.find((e) => e.date === p.day)?.lines ?? []).filter((_, i) => i !== editIdx);
          await saveDay(p.day, orig);
        }
        existing.push(line);
      }
      await saveDay(day, existing);
      router.replace({ pathname: '/time', params: { day } } as never);
    } catch (e) { Alert.alert('Not saved', apiMessage(e)); }
    finally { setSaving(false); }
  };

  // ── Step 1: client ────────────────────────────────────────────
  if (step === 1) {
    return (
      <Screen testID="time-select-client">
        <BackHeader title="Select client" />
        <StepDots step={1} />
        <Input testID="client-search" value={q} onChangeText={search} placeholder="Search clients or jobs…"
          autoCorrect={false} returnKeyType="search" />

        {client && jobs.length > 0 && (
          <>
            <SectionLabel style={{ marginTop: 18 }}>{client.name.toUpperCase()} · WHICH JOB?</SectionLabel>
            <ClientTile icon="remove-circle-outline" title="No particular job" onPress={() => { setJob(null); setStep(2); }} />
            {jobs.map((j) => (
              <ClientTile key={j.ref} icon="construct-outline" title={`Job ${j.ref}${j.name ? ` · ${j.name}` : ''}`} sub={j.site || undefined}
                onPress={() => { setJob(j.ref); setStep(2); }} />
            ))}
          </>
        )}

        {!(client && jobs.length) && (
          <>
            {clients == null && <View style={{ padding: 30 }}><ActivityIndicator color={Colors.orange} /></View>}
            {recent.length > 0 && <SectionLabel style={{ marginTop: 18 }}>RECENT</SectionLabel>}
            {recent.map((c) => <ClientTile key={c.id} icon="time-outline" title={c.name} sub={c.jobs.length ? `${c.jobs.length} open job${c.jobs.length === 1 ? '' : 's'}` : undefined} onPress={() => pick(c)} />)}

            {internal.length > 0 && <SectionLabel style={{ marginTop: 18 }}>NOT FOR A CLIENT</SectionLabel>}
            {internal.map((c) => <ClientTile key={c.id} icon="home-outline" title={c.name} onPress={() => pick(c)} />)}

            {others.length > 0 && <SectionLabel style={{ marginTop: 18 }}>CLIENTS</SectionLabel>}
            {others.map((c) => <ClientTile key={c.id} icon="business-outline" title={c.name} sub={c.jobs.length ? `${c.jobs.length} open job${c.jobs.length === 1 ? '' : 's'}` : undefined} onPress={() => pick(c)} />)}

            {clients != null && !recent.length && !others.length && !!q.trim() && (
              <>
                <Hint>No client called “{q.trim()}”.</Hint>
                <ClientTile icon="add-circle-outline" title={`Use “${q.trim()}”`} sub="The office can match it up later"
                  onPress={() => { setClient({ id: null, name: q.trim() }); setJobs([]); setStep(2); }} />
              </>
            )}
          </>
        )}
      </Screen>
    );
  }

  // ── Step 2: day + time ────────────────────────────────────────
  return (
    <Screen testID="time-entry">
      <BackHeader title={editIdx != null ? 'Edit time' : 'Add time'} />
      <StepDots step={2} />

      <TouchableOpacity testID="change-client" style={s.chosen} onPress={() => setStep(1)} activeOpacity={0.8}>
        <View style={s.tileIcon}><Ionicons name="business-outline" size={20} color={Colors.orange} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.tileTitle} numberOfLines={1}>{client?.name}</Text>
          <Text style={s.tileSub}>{job ? `Job ${job}` : 'Tap to change client'}</Text>
        </View>
        <Text style={s.change}>Change</Text>
      </TouchableOpacity>

      <FieldLabel>DAY</FieldLabel>
      <View style={s.dayRow}>
        <TouchableOpacity testID="day-prev" style={s.round} onPress={() => setDay(shiftIso(day, -1))}><Ionicons name="chevron-back" size={22} color={Colors.onCard} /></TouchableOpacity>
        <Text style={s.dayText}>{dayLabel(day, 'long')}</Text>
        <TouchableOpacity testID="day-next" style={s.round} onPress={() => setDay(shiftIso(day, 1))}><Ionicons name="chevron-forward" size={22} color={Colors.onCard} /></TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <TimeBox label="START" value={start} onChange={setStart} testID="start" />
        <TimeBox label="FINISH" value={finish} onChange={setFinish} testID="finish" />
      </View>

      <FieldLabel>BREAK</FieldLabel>
      <View style={s.breaks}>
        {BREAKS.map((b) => (
          <TouchableOpacity key={b} testID={`break-${b}`} onPress={() => setBrk(b)} style={[s.brk, brk === b && s.brkOn]}>
            <Text style={[s.brkText, brk === b && s.brkTextOn]}>{b === 0 ? 'None' : `${b} min`}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FieldLabel>NOTES (OPTIONAL)</FieldLabel>
      <Input testID="time-notes" value={notes} onChangeText={setNotes} placeholder="What you did, plant used…" multiline />

      <View style={s.total}>
        <Text style={s.totalLabel}>Hours</Text>
        <Text testID="time-total" style={[s.totalHrs, !!bad && { color: '#F87171' }]}>{bad || fmtHours(hours)}</Text>
      </View>

      {dayLocked
        ? <Hint>That day has already been sent to the office — pick another day or ask the office.</Hint>
        : <PrimaryButton testID="save-time-btn" title={editIdx != null ? 'SAVE CHANGES' : 'SAVE TIME'} variant="green"
            loading={saving} disabled={!!bad || saving || !client} onPress={save} style={{ marginTop: 14 }} />}
    </Screen>
  );
}

function StepDots({ step }: { step: 1 | 2 }) {
  return (
    <View style={s.steps}>
      {['Client', 'Time'].map((t, i) => (
        <View key={t} style={s.stepItem}>
          <View style={[s.stepDot, i + 1 <= step && s.stepDotOn]}><Text style={s.stepNum}>{i + 1}</Text></View>
          <Text style={[s.stepText, i + 1 === step && { color: Colors.onScreen }]}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

function ClientTile({ icon, title, sub, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub?: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.tile} onPress={onPress} activeOpacity={0.8}>
      <View style={s.tileIcon}><Ionicons name={icon} size={20} color={Colors.orange} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.tileTitle} numberOfLines={1}>{title}</Text>
        {!!sub && <Text style={s.tileSub} numberOfLines={1}>{sub}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={16} color={Colors.onCardSubtle} />
    </TouchableOpacity>
  );
}

/** Big glove-friendly time control: ±15 min buttons, tap the time for ±1 hour. */
function TimeBox({ label, value, onChange, testID }: { label: string; value: string; onChange: (v: string) => void; testID: string }) {
  const step = (d: number) => onChange(fromMin(toMin(value) + d));
  return (
    <View style={s.timeBox}>
      <Text style={s.timeLabel}>{label}</Text>
      <Text testID={`${testID}-value`} style={s.timeValue}>{fmt12(value)}</Text>
      <View style={s.timeBtns}>
        <TouchableOpacity testID={`${testID}-minus`} style={s.timeBtn} onPress={() => step(-15)} onLongPress={() => step(-60)}>
          <Ionicons name="remove" size={22} color={Colors.onCard} />
        </TouchableOpacity>
        <TouchableOpacity testID={`${testID}-plus`} style={s.timeBtn} onPress={() => step(15)} onLongPress={() => step(60)}>
          <Ionicons name="add" size={22} color={Colors.onCard} />
        </TouchableOpacity>
      </View>
      <Text style={s.timeHint}>hold for 1 hour</Text>
    </View>
  );
}

const s = StyleSheet.create({
  steps: { flexDirection: 'row', gap: 18, marginBottom: 14 },
  stepItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.faintPanel, alignItems: 'center', justifyContent: 'center' },
  stepDotOn: { backgroundColor: Colors.orange },
  stepNum: { color: Colors.white, fontSize: 12, fontWeight: '800' },
  stepText: { color: Colors.onScreenMuted, fontSize: 13, fontWeight: '700' },
  tile: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card,
    borderRadius: 16, padding: 14, marginBottom: 10, minHeight: 60,
  },
  tileIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(249,115,22,0.14)', alignItems: 'center', justifyContent: 'center' },
  tileTitle: { fontSize: 16, fontWeight: '700', color: Colors.onCard },
  tileSub: { fontSize: 13, color: Colors.onCardMuted, marginTop: 2 },
  chosen: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card,
    borderRadius: 16, padding: 14, borderWidth: 2, borderColor: Colors.orange,
  },
  change: { color: Colors.orange, fontWeight: '800', fontSize: 13 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.card, borderRadius: 16, padding: 8, marginBottom: 6 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(15,23,42,0.06)', alignItems: 'center', justifyContent: 'center' },
  dayText: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '800', color: Colors.onCard },
  timeBox: { flex: 1, backgroundColor: Colors.card, borderRadius: 16, padding: 14, alignItems: 'center', marginTop: 14 },
  timeLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: Colors.onCardSubtle },
  timeValue: { fontSize: 26, fontWeight: '800', color: Colors.onCard, marginVertical: 8 },
  timeBtns: { flexDirection: 'row', gap: 10 },
  timeBtn: { width: 54, height: 48, borderRadius: 12, backgroundColor: 'rgba(15,23,42,0.07)', alignItems: 'center', justifyContent: 'center' },
  timeHint: { fontSize: 10, color: Colors.onCardSubtle, marginTop: 6 },
  breaks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  brk: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.card, minHeight: 44 },
  brkOn: { backgroundColor: Colors.orange },
  brkText: { fontSize: 14, fontWeight: '700', color: Colors.onCard },
  brkTextOn: { color: Colors.white },
  total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, paddingHorizontal: 4 },
  totalLabel: { color: Colors.onScreenMuted, fontSize: 14, fontWeight: '700' },
  totalHrs: { color: Colors.onScreen, fontSize: 22, fontWeight: '800' },
});
