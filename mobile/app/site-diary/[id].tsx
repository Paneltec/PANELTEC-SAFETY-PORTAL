import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../src/lib/api';
import { Colors } from '../../src/lib/colors';
import { useCan } from '../../src/lib/AuthContext';
import PdfActions from '../../src/components/PdfActions';
import EmailButton from '../../src/components/EmailButton';
import ReadOnlyBanner from '../../src/components/ReadOnlyBanner';

export default function SiteDiaryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const can = useCan();
  const [doc, setDoc] = useState<any>(null);

  useEffect(() => {
    api.get(`/site-diary/${id}`).then(r => setDoc(r.data)).catch(() => { Alert.alert('Not found'); router.back(); });
  }, [id]);

  if (!doc) return <View style={s.center}><ActivityIndicator color={Colors.blue} /></View>;

  const canEdit = can('site_diary', 'edit');
  const canView = can('site_diary', 'view');
  const canEmail = can('site_diary', 'email');
  const sl = doc.structured_log;

  return (
    <ScrollView testID="diary-detail" style={s.scroll} contentContainerStyle={s.content}>
      {!canEdit && <ReadOnlyBanner />}
      <View style={s.topRow}>
        <Text style={s.heading}>Site Diary</Text>
        {sl && <View style={s.aiBadge}><Text style={s.aiBadgeText}>AI STRUCTURED</Text></View>}
      </View>
      <Text style={s.date}>{doc.date}</Text>

      <View testID="diary-actions" style={s.actionRow}>
        {canView && <PdfActions resourceKind="site_diary" recordId={id!} title={`Site Diary ${doc.date}`} />}
        {canEmail && (
          <EmailButton
            resourceKind="site_diary"
            recordId={id!}
            subject={`Site Diary — ${doc.date}`}
            body={`Site diary entry for ${doc.date}.\n\n${doc.raw_notes || ''}`}
          />
        )}
      </View>

      <Section title="Raw notes">
        <Text style={s.bodyText}>{doc.raw_notes || 'No notes'}</Text>
      </Section>

      {sl && (
        <Section title="AI structured log">
          {([
            ['Activities', sl.activities],
            ['Delays', sl.delays],
            ['Deliveries', sl.deliveries],
            ['Visitors', sl.visitors],
            ['Safety observations', sl.safety_observations],
          ] as [string, string[]][]).map(([k, v]) => (
            <View key={k} style={s.slGroup}>
              <Text style={s.slLabel}>{k}</Text>
              {Array.isArray(v) && v.length > 0
                ? v.map((x, i) => <Text key={i} style={s.slItem}>· {x}</Text>)
                : <Text style={s.empty}>none</Text>}
            </View>
          ))}
          <View style={s.slGroup}>
            <Text style={s.slLabel}>Weather</Text>
            <Text style={s.bodyText}>{sl.weather || '—'}</Text>
          </View>
        </Section>
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
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heading: { fontSize: 24, fontWeight: '700', color: Colors.ink },
  date: { fontSize: 13, color: Colors.textTertiary, marginTop: 4 },
  aiBadge: { backgroundColor: Colors.violetSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  aiBadgeText: { fontSize: 9, fontWeight: '700', color: Colors.violet, letterSpacing: 0.5 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 16 },
  section: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, marginBottom: 10 },
  sectionTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: Colors.textTertiary, textTransform: 'uppercase', marginBottom: 8 },
  bodyText: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  empty: { fontSize: 12, color: Colors.textTertiary, fontStyle: 'italic' },
  slGroup: { marginBottom: 10 },
  slLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: Colors.textTertiary, textTransform: 'uppercase', marginBottom: 4 },
  slItem: { fontSize: 14, color: Colors.text, marginBottom: 2, lineHeight: 20 },
});
