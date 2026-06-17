import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../src/lib/api';
import StatusBadge from '../../src/components/StatusBadge';
import { Colors } from '../../src/lib/colors';
import { useCan } from '../../src/lib/AuthContext';
import PdfActions from '../../src/components/PdfActions';
import EmailButton from '../../src/components/EmailButton';
import ReadOnlyBanner from '../../src/components/ReadOnlyBanner';

const CATS: Record<string, string> = {
  near_miss: 'Near miss', first_aid: 'First aid', medical: 'Medical',
  ltc: 'Lost-time', env: 'Environmental', property: 'Property',
};

export default function IncidentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const can = useCan();
  const [doc, setDoc] = useState<any>(null);

  useEffect(() => {
    api.get(`/incidents/${id}`).then(r => setDoc(r.data)).catch(() => { Alert.alert('Not found'); router.back(); });
  }, [id]);

  if (!doc) return <View style={s.center}><ActivityIndicator color={Colors.blue} /></View>;

  const canEdit = can('incidents', 'edit');
  const canView = can('incidents', 'view');
  const canEmail = can('incidents', 'email');

  return (
    <ScrollView testID="incident-detail" style={s.scroll} contentContainerStyle={s.content}>
      {!canEdit && <ReadOnlyBanner />}
      <Text style={s.heading}>{doc.title}</Text>
      <View style={s.metaRow}>
        <View style={s.catBadge}><Text style={s.catText}>{CATS[doc.category] || doc.category}</Text></View>
        <StatusBadge value={doc.follow_up_status} />
        <Text style={s.meta}>{(doc.occurred_at || '').slice(0, 10)}</Text>
      </View>

      <View testID="incident-actions" style={s.actionRow}>
        {canView && <PdfActions resourceKind="incidents" recordId={id!} title={doc.title} />}
        {canEmail && (
          <EmailButton
            resourceKind="incidents"
            recordId={id!}
            subject={`Incident Summary: ${doc.title}`}
            body={`Incident report.\n\nCategory: ${doc.category}\nDescription: ${doc.description || ''}\nOccurred at: ${doc.occurred_at || ''}`}
          />
        )}
      </View>

      <Section title="Description">
        <Text style={s.bodyText}>{doc.description || 'N/A'}</Text>
      </Section>

      {doc.location ? (
        <Section title="Location">
          <Text style={s.bodyText}>{doc.location}</Text>
        </Section>
      ) : null}

      {doc.immediate_actions ? (
        <Section title="Immediate actions taken">
          <Text style={s.bodyText}>{doc.immediate_actions}</Text>
        </Section>
      ) : null}

      <Section title={`Follow-up actions · ${(doc.follow_up_actions || []).length}`}>
        {(doc.follow_up_actions || []).length === 0 ? <Text style={s.empty}>None</Text> :
          (doc.follow_up_actions || []).map((a: any, i: number) => (
            <View key={i} style={s.actionCard}>
              <Text style={s.actionText}>{a.action}</Text>
              <View style={s.actionMeta}>
                {a.owner ? <Text style={s.actionOwner}>{a.owner}</Text> : null}
                {a.due ? <Text style={s.actionDue}>Due: {a.due}</Text> : null}
              </View>
            </View>
          ))}
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
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
  catBadge: { backgroundColor: Colors.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  catText: { fontSize: 11, color: Colors.text },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 16 },
  section: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, marginBottom: 10 },
  sectionTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: Colors.textTertiary, textTransform: 'uppercase', marginBottom: 8 },
  bodyText: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  empty: { fontSize: 13, color: Colors.textTertiary, fontStyle: 'italic' },
  actionCard: { backgroundColor: Colors.bg, borderRadius: 10, padding: 10, marginBottom: 6 },
  actionText: { fontSize: 14, color: Colors.text },
  actionMeta: { flexDirection: 'row', gap: 12, marginTop: 4 },
  actionOwner: { fontSize: 12, color: Colors.textSecondary },
  actionDue: { fontSize: 12, color: Colors.textTertiary },
});
