/**
 * Leave request detail — status timeline, cancel, add certificate.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import { Screen, BackHeader, Panel, KV, Chip, Loading, SectionLabel, Hint } from '../../src/components/ui';
import PrimaryButton from '../../src/components/PrimaryButton';
import PhotoCapture from '../../src/components/PhotoCapture';
import {
  fetchMyLeave, cancelLeave, uploadCertificate, apiMessage, niceDate, CATEGORIES, type MyLeave,
} from '../../src/services/leave';
import { STATUS_TONE } from '../../src/components/LeaveCard';

type StepState = 'done' | 'now' | 'todo' | 'bad';

function Step({ state, title, sub, last }: { state: StepState; title: string; sub?: string; last?: boolean }) {
  const color = state === 'done' ? Colors.green : state === 'now' ? Colors.orange : state === 'bad' ? '#F87171' : Colors.onScreenSubtle;
  const icon = state === 'done' ? 'checkmark-circle' : state === 'now' ? 'time' : state === 'bad' ? 'close-circle' : 'ellipse-outline';
  return (
    <View style={s.step}>
      <View style={{ alignItems: 'center' }}>
        <Ionicons name={icon as any} size={24} color={color} />
        {!last && <View style={[s.line, { backgroundColor: state === 'done' ? Colors.green : Colors.onScreenSubtle }]} />}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : 18 }}>
        <Text style={[s.stepTitle, state === 'todo' && { color: Colors.onScreenSubtle }]}>{title}</Text>
        {!!sub && <Text style={s.stepSub}>{sub}</Text>}
      </View>
    </View>
  );
}

export default function LeaveDetailScreen() {
  const { id, justSent } = useLocalSearchParams<{ id: string; justSent?: string }>();
  const router = useRouter();
  const [r, setR] = useState<MyLeave | null>(null);
  const [cert, setCert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(async () => {
    try { const d = await fetchMyLeave(); setR(d.requests.find((x) => x.id === id) ?? null); }
    catch (e) { Alert.alert('Offline', apiMessage(e)); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!r) return <Screen><BackHeader title="Leave Request" /><Loading /></Screen>;

  const cat = CATEGORIES.find((c) => c.key === r.category) ?? CATEGORIES[4];
  const sentAt = new Date(r.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  const decided = r.decided_at ? new Date(r.decided_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : undefined;

  const reviewStep: StepState =
    r.status === 'approved' ? 'done' : r.status === 'rejected' ? 'bad' : r.status === 'cancelled' ? 'todo' : 'now';
  const reviewTitle =
    r.status === 'approved' ? 'Approved by supervisor' :
    r.status === 'rejected' ? 'Not approved' :
    r.status === 'info_requested' ? 'Supervisor needs more info' : 'Waiting for supervisor';
  const reviewSub =
    r.status === 'info_requested' ? 'Have a chat with your supervisor about this request.' :
    r.status === 'rejected' ? 'Talk to your supervisor if you have questions.' : decided;

  const doCancel = async () => {
    setBusy(true);
    try { setR(await cancelLeave(r.id)); setConfirmCancel(false); }
    catch (e) { Alert.alert('Not cancelled', apiMessage(e)); }
    finally { setBusy(false); }
  };
  const sendCert = async () => {
    if (!cert) return;
    setBusy(true);
    try { await uploadCertificate(r.id, cert); setCert(null); await load(); }
    catch (e) { Alert.alert('Not sent', apiMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <Screen testID="leave-detail-screen">
      <BackHeader title="Leave Request" right={<Chip text={r.status_label.toUpperCase()} tone={STATUS_TONE[r.status]} />} />

      {justSent === '1' && r.status === 'pending' && (
        <View style={s.sent}>
          <Ionicons name="checkmark-circle" size={22} color={Colors.green} />
          <Text style={s.sentText}>Request sent. Your supervisor has been told.</Text>
        </View>
      )}

      <Panel>
        <KV first k="TYPE" v={cat.label} />
        <KV k="FROM" v={niceDate(r.start_date)} />
        <KV k="TO" v={niceDate(r.end_date)} />
        <KV k="HOURS" v={`${r.hours} h`} />
        {!!r.reason && <KV k="REASON" v={r.reason} />}
        {r.category === 'sick' && <KV k="CERTIFICATE" v={r.has_certificate ? 'Sent to office' : 'Not added'} />}
      </Panel>

      <SectionLabel style={{ marginTop: 20 }}>PROGRESS</SectionLabel>
      {r.status === 'cancelled' ? (
        <Step state="bad" title="Cancelled" last />
      ) : (
        <View>
          <Step state="done" title="Request sent" sub={sentAt} />
          <Step state={reviewStep} title={reviewTitle} sub={reviewSub} />
          <Step state={r.in_payroll ? 'done' : r.status === 'approved' ? 'now' : 'todo'}
            title={r.in_payroll ? 'Entered in payroll' : 'Payroll processes it'}
            sub={r.status === 'approved' && !r.in_payroll ? 'The pay officer has been emailed.' : undefined} last />
        </View>
      )}

      {r.category === 'sick' && !r.has_certificate && r.status !== 'cancelled' && (
        <>
          <SectionLabel style={{ marginTop: 20 }}>ADD MEDICAL CERTIFICATE</SectionLabel>
          <PhotoCapture imageUri={cert} onImageCaptured={setCert} onClear={() => setCert(null)} label="Take a photo of your certificate" />
          {cert && <PrimaryButton title="SEND CERTIFICATE" variant="green" loading={busy} style={{ marginTop: 10 }} onPress={sendCert} />}
        </>
      )}

      {r.can_cancel && !confirmCancel && (
        <PrimaryButton testID="cancel-leave" title="CANCEL THIS REQUEST" variant="grey" style={{ marginTop: 24 }}
          onPress={() => setConfirmCancel(true)} />
      )}
      {confirmCancel && (
        <View style={s.confirm}>
          <Text style={s.confirmText}>Cancel this leave?{r.status === 'approved' ? ' Payroll will be told to remove it.' : ''}</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <PrimaryButton title="KEEP IT" variant="grey" style={{ flex: 1 }} onPress={() => setConfirmCancel(false)} />
            <PrimaryButton testID="confirm-cancel" title="YES, CANCEL" variant="orange" loading={busy} style={{ flex: 1 }} onPress={doCancel} />
          </View>
        </View>
      )}

      <PrimaryButton title="BACK TO MY LEAVE" variant="outline" style={{ marginTop: 12 }}
        onPress={() => router.replace('/leave' as never)} />
      <Hint>Questions? Talk to your supervisor or the office.</Hint>
    </Screen>
  );
}

const s = StyleSheet.create({
  sent: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: Colors.greenSoft, marginBottom: 12 },
  sentText: { flex: 1, color: Colors.onScreen, fontSize: 14, fontWeight: '600' },
  step: { flexDirection: 'row', gap: 12 },
  line: { width: 2, flex: 1, marginTop: 2, opacity: 0.6 },
  stepTitle: { fontSize: 15, fontWeight: '700', color: Colors.onScreen, marginTop: 2 },
  stepSub: { fontSize: 12, color: Colors.onScreenMuted, marginTop: 3, lineHeight: 17 },
  confirm: { marginTop: 24, padding: 14, borderRadius: 14, backgroundColor: Colors.screenCard, gap: 12 },
  confirmText: { color: Colors.onScreen, fontSize: 14, fontWeight: '600' },
});
