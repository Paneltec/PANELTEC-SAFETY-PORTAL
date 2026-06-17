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

export default function HazardDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const can = useCan();
  const [doc, setDoc] = useState<any>(null);

  useEffect(() => {
    api.get(`/hazards/${id}`).then(r => setDoc(r.data)).catch(() => { Alert.alert('Not found'); router.back(); });
  }, [id]);

  if (!doc) return <View style={s.center}><ActivityIndicator color={Colors.blue} /></View>;

  const canEdit = can('hazards', 'edit');
  const canView = can('hazards', 'view');
  const canEmail = can('hazards', 'email');

  return (
    <ScrollView testID="hazard-detail" style={s.scroll} contentContainerStyle={s.content}>
      {!canEdit && <ReadOnlyBanner />}
      <Text style={s.heading}>{doc.title}</Text>
      <View style={s.metaRow}>
        <StatusBadge value={doc.severity} />
        <StatusBadge value={doc.status} />
        <Text style={s.meta}>{(doc.created_at || '').slice(0, 10)}</Text>
      </View>

      <View testID="hazard-actions" style={s.actionRow}>
        {canView && <PdfActions resourceKind="hazards" recordId={id!} title={doc.title} />}
        {canEmail && (
          <EmailButton
            resourceKind="hazards"
            recordId={id!}
            subject={`Hazard Report: ${doc.title} (severity: ${doc.severity})`}
            body={`A hazard has been reported.\n\nTitle: ${doc.title}\nSeverity: ${doc.severity}\nDescription: ${doc.description || ''}`}
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

      <Section title={`Controls · ${(doc.controls || []).length}`}>
        {(doc.controls || []).length === 0 ? <Text style={s.empty}>None</Text> :
          (doc.controls || []).map((c: string, i: number) => (
            <Text key={i} style={s.listItem}>· {c}</Text>
          ))}
      </Section>

      {doc.ai_analysis && (
        <View testID="hazard-ai" style={s.aiCard}>
          <Text style={s.aiLabel}>AI ANALYSIS</Text>
          <Text style={s.aiText}>Identified: {(doc.ai_analysis.identified_hazards || []).join(' · ') || '—'}</Text>
          <Text style={s.aiText}>Severity: {doc.ai_analysis.severity}</Text>
          <Text style={s.aiSummary}>{doc.ai_analysis.summary}</Text>
        </View>
      )}
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
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 16 },
  section: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, marginBottom: 10 },
  sectionTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: Colors.textTertiary, textTransform: 'uppercase', marginBottom: 8 },
  bodyText: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  empty: { fontSize: 13, color: Colors.textTertiary, fontStyle: 'italic' },
  listItem: { fontSize: 14, color: Colors.text, marginBottom: 4, lineHeight: 20 },
  aiCard: { backgroundColor: Colors.violetSoft, borderWidth: 1, borderColor: '#DDD6FE', borderRadius: 16, padding: 16, marginBottom: 10 },
  aiLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: Colors.violet, marginBottom: 6 },
  aiText: { fontSize: 12, color: Colors.text, marginBottom: 2 },
  aiSummary: { fontSize: 13, color: '#475569', marginTop: 4, lineHeight: 18 },
});
