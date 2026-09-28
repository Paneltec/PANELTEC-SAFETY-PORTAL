/**
 * Request Leave — leave type, first/last day, hours (auto), reason, optional certificate.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Alert, KeyboardAvoidingView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Colors } from '../../src/theme/colors';
import { Screen, BackHeader, FieldLabel, Input, Hint } from '../../src/components/ui';
import PrimaryButton from '../../src/components/PrimaryButton';
import PhotoCapture from '../../src/components/PhotoCapture';
import {
  CATEGORIES, requestLeave, uploadCertificate, apiMessage, toIso, fromIso, niceDate, workingDays,
  type LeaveCategory,
} from '../../src/services/leave';

const HOURS_PER_DAY = 7.6;

function DateField({ label, value, onChange, min, testID }: {
  label: string; value: string; onChange: (v: string) => void; min?: string; testID?: string;
}) {
  const [iosOpen, setIosOpen] = useState(false);
  const minDate = min ? fromIso(min) : undefined;
  const pick = (d?: Date) => { if (d) onChange(toIso(d)); };

  if (Platform.OS === 'web') {
    return (
      <View style={{ flex: 1 }}>
        <FieldLabel>{label}</FieldLabel>
        <Input testID={testID} value={value} onChangeText={onChange} placeholder="YYYY-MM-DD" />
      </View>
    );
  }
  const open = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ value: fromIso(value), mode: 'date', minimumDate: minDate, onChange: (_e, d) => pick(d) });
    } else setIosOpen((o) => !o);
  };
  return (
    <View style={{ flex: 1 }}>
      <FieldLabel>{label}</FieldLabel>
      <TouchableOpacity testID={testID} style={s.dateBtn} onPress={open} activeOpacity={0.8}>
        <Ionicons name="calendar" size={18} color={Colors.orange} />
        <Text style={s.dateText}>{niceDate(value)}</Text>
      </TouchableOpacity>
      {iosOpen && (
        <DateTimePicker value={fromIso(value)} mode="date" display="inline" minimumDate={minDate}
          onChange={(_e, d) => { pick(d); setIosOpen(false); }} />
      )}
    </View>
  );
}

export default function RequestLeaveScreen() {
  const router = useRouter();
  const tomorrow = toIso(new Date(Date.now() + 864e5));
  const [category, setCategory] = useState<LeaveCategory>('annual');
  const [start, setStart] = useState(tomorrow);
  const [end, setEnd] = useState(tomorrow);
  const [partDay, setPartDay] = useState(false);
  const [hoursText, setHoursText] = useState('');
  const [reason, setReason] = useState('');
  const [cert, setCert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && end >= start;
  const days = valid ? workingDays(start, end) : 0;
  const hours = useMemo(() => {
    if (partDay) { const h = parseFloat(hoursText); return isFinite(h) && h > 0 ? h : 0; }
    return Math.round(days * HOURS_PER_DAY * 100) / 100;
  }, [partDay, hoursText, days]);

  const setStartAndEnd = (v: string) => { setStart(v); if (end < v) setEnd(v); };

  const submit = async () => {
    if (!valid) { Alert.alert('Check the dates', 'The last day must be on or after the first day.'); return; }
    if (!hours) { Alert.alert('How many hours?', 'Those dates are a weekend — turn on "Part day" and enter hours.'); return; }
    setBusy(true);
    try {
      const r = await requestLeave({
        category, start_date: start, end_date: end,
        hours: partDay ? hours : null, reason: reason.trim() || null,
      });
      if (cert) {
        try { await uploadCertificate(r.id, cert); }
        catch { Alert.alert('Certificate not sent', 'Your leave request was sent, but the photo failed. Open the request and try again.'); }
      }
      router.replace({ pathname: '/leave/[id]', params: { id: r.id, justSent: '1' } } as never);
    } catch (e) {
      Alert.alert('Not sent', apiMessage(e));
    } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen testID="request-leave-screen" bottomPad={48}>
        <BackHeader title="Request Leave" />

        <FieldLabel>TYPE OF LEAVE</FieldLabel>
        <View style={s.types}>
          {CATEGORIES.map((c) => {
            const on = c.key === category;
            return (
              <TouchableOpacity key={c.key} testID={`type-${c.key}`} onPress={() => setCategory(c.key)}
                style={[s.type, on && s.typeOn]} activeOpacity={0.8}>
                <Ionicons name={c.icon as any} size={20} color={on ? Colors.white : Colors.orange} />
                <Text style={[s.typeText, on && s.typeTextOn]}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={s.row}>
          <DateField testID="first-day" label="FIRST DAY" value={start} onChange={setStartAndEnd} />
          <DateField testID="last-day" label="LAST DAY" value={end} onChange={setEnd} min={start} />
        </View>

        <TouchableOpacity testID="part-day" style={s.toggle} onPress={() => setPartDay((p) => !p)} activeOpacity={0.8}>
          <Ionicons name={partDay ? 'checkbox' : 'square-outline'} size={22} color={partDay ? Colors.green : Colors.onScreenMuted} />
          <Text style={s.toggleText}>Part day / set my own hours</Text>
        </TouchableOpacity>
        {partDay && (
          <Input testID="hours-input" value={hoursText} onChangeText={setHoursText} keyboardType="decimal-pad" placeholder="Hours, e.g. 4" />
        )}

        <View style={s.summary}>
          <Ionicons name="time" size={20} color={Colors.orange} />
          <Text style={s.summaryText}>
            {valid
              ? `${hours ? hours : '—'} hours${!partDay ? ` · ${days} working day${days === 1 ? '' : 's'}` : ''}`
              : 'Pick your dates'}
          </Text>
        </View>

        <FieldLabel>REASON (OPTIONAL)</FieldLabel>
        <Input testID="reason" value={reason} onChangeText={setReason} multiline maxLength={500}
          placeholder={category === 'sick' ? 'e.g. Flu, doctor says 2 days off' : 'e.g. Family holiday'} />

        {category === 'sick' && (
          <>
            <FieldLabel>MEDICAL CERTIFICATE (IF YOU HAVE ONE)</FieldLabel>
            <PhotoCapture imageUri={cert} onImageCaptured={setCert} onClear={() => setCert(null)} label="Take a photo of your certificate" />
            <Hint>Only the office can see this. You can also add it later.</Hint>
          </>
        )}

        <PrimaryButton testID="send-request" title="SEND REQUEST" variant="green" loading={busy} disabled={!valid || !hours}
          style={{ marginTop: 22 }} onPress={submit} />
        <Hint>{"Your supervisor approves it, then payroll processes it. You'll see the status in My Leave."}</Hint>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  types: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  type: {
    flexBasis: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 50, paddingHorizontal: 12,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 12,
  },
  typeOn: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  typeText: { fontSize: 14, fontWeight: '600', color: Colors.onCard },
  typeTextOn: { color: Colors.white },
  row: { flexDirection: 'row', gap: 10 },
  dateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 50, paddingHorizontal: 12,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 10,
  },
  dateText: { fontSize: 15, fontWeight: '600', color: Colors.onCard },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, marginBottom: 8, minHeight: 44 },
  toggleText: { fontSize: 14, color: Colors.onScreen },
  summary: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, padding: 12, borderRadius: 12,
    backgroundColor: Colors.orangeSoftOnNavy,
  },
  summaryText: { fontSize: 15, fontWeight: '700', color: Colors.onScreen },
});
