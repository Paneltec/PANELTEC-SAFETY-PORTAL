import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api, { apiError } from '../../src/lib/api';
import { getUser } from '../../src/lib/auth';
import StatusBadge from '../../src/components/StatusBadge';
import PrimaryButton from '../../src/components/PrimaryButton';
import GhostButton from '../../src/components/GhostButton';
import PdfActions from '../../src/components/PdfActions';
import EmailButton from '../../src/components/EmailButton';
import ReadOnlyBanner from '../../src/components/ReadOnlyBanner';
import { Colors } from '../../src/lib/colors';
import { useCan } from '../../src/lib/AuthContext';

export default function SwmsDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const can = useCan();
  const [doc, setDoc] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    api.get(`/swms/${id}`).then(r => setDoc(r.data)).catch(() => { Alert.alert('Not found'); router.back(); });
    getUser().then(setUser);
  }, [id]);

  const review = async (action: string) => {
    setBusy(true);
    try { const { data } = await api.post(`/swms/${id}/review`, { action }); setDoc(data); Alert.alert('Success', `SWMS ${action.replace('_', ' ')}d`); }
    catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setBusy(false); }
  };

  if (!doc) return <View style={s.center}><ActivityIndicator color={Colors.blue} /></View>;

  const isReviewer = ['hseq_lead', 'admin'].includes(user?.role);
  const canEdit = can('swms', 'edit');
  const canView = can('swms', 'view');
  const canEmail = can('swms', 'email');

  return (
    <ScrollView testID="swms-detail" style={s.scroll} contentContainerStyle={s.content}>
      {!canEdit && <ReadOnlyBanner />}
      <Text style={s.heading}>{doc.title}</Text>
      <View style={s.metaRow}>
        <StatusBadge value={doc.status} />
        <Text style={s.meta}>v{doc.version || 1} · {doc.created_at?.slice(0, 10)}</Text>
      </View>

      <View testID="swms-actions" style={s.actionRow}>
        {canView && <PdfActions resourceKind="swms" recordId={id!} title={doc.title} />}
        {canEmail && (
          <EmailButton
            resourceKind="swms"
            recordId={id!}
            subject={`SWMS for Review: ${doc.title} v${doc.version || 1}`}
            body={`Please review the attached SWMS.\n\nTitle: ${doc.title}\nStatus: ${doc.status}`}
          />
        )}
      </View>

      {canEdit && isReviewer && doc.status === 'submitted' && (
        <View style={s.reviewRow}>
          <GhostButton testID="swms-request-changes" onPress={() => review('request_changes')}>Changes</GhostButton>
          <GhostButton testID="swms-reject" onPress={() => review('reject')}>Reject</GhostButton>
          <PrimaryButton testID="swms-approve" onPress={() => review('approve')} busy={busy}>Approve</PrimaryButton>
        </View>
      )}

      <DetailSection title="Job description" items={[doc.job_description]} />
      <DetailSection title="Tasks" items={(doc.tasks || []).map((t: any) => `${t.step}. ${t.description}`)} />
      <DetailSection title="Hazards" items={(doc.hazards || []).map((h: any) => `${h.label} (${h.risk})`)} />
      <DetailSection title="Controls" items={(doc.controls || []).map((c: any) => `${c.label} — ${c.method}`)} />
      <DetailSection title="PPE" items={doc.ppe || []} />
    </ScrollView>
  );
}

function DetailSection({ title, items }: { title: string; items: string[] }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title} · {items.length}</Text>
      {items.length === 0 ? <Text style={s.empty}>None</Text> :
        items.map((it, i) => <Text key={i} style={s.sectionItem}>· {it}</Text>)}
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 24, fontWeight: '700', color: Colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  meta: { fontSize: 12, color: Colors.textTertiary },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 16 },
  reviewRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  section: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, marginBottom: 10 },
  sectionTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: Colors.textTertiary, textTransform: 'uppercase', marginBottom: 8 },
  sectionItem: { fontSize: 14, color: Colors.text, marginBottom: 4, lineHeight: 20 },
  empty: { fontSize: 13, color: Colors.textTertiary, fontStyle: 'italic' },
});
