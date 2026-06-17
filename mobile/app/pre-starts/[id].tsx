import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../../src/lib/api';
import { Colors } from '../../src/lib/colors';
import { useCan } from '../../src/lib/AuthContext';
import PdfActions from '../../src/components/PdfActions';
import EmailButton from '../../src/components/EmailButton';
import ReadOnlyBanner from '../../src/components/ReadOnlyBanner';

export default function PreStartDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const can = useCan();
  const [doc, setDoc] = useState<any>(null);

  useEffect(() => {
    api.get(`/pre-starts/${id}`).then(r => setDoc(r.data)).catch(() => { Alert.alert('Not found'); router.back(); });
  }, [id]);

  if (!doc) return <View style={s.center}><ActivityIndicator color={Colors.blue} /></View>;

  const canEdit = can('pre_starts', 'edit');
  const canView = can('pre_starts', 'view');
  const canEmail = can('pre_starts', 'email');

  return (
    <ScrollView testID="prestart-detail" style={s.scroll} contentContainerStyle={s.content}>
      {!canEdit && <ReadOnlyBanner />}
      <Text style={s.heading}>{doc.crew_lead || 'Pre-Start'}</Text>
      <Text style={s.date}>{doc.date}</Text>

      <View testID="prestart-actions" style={s.actionRow}>
        {canView && <PdfActions resourceKind="pre_starts" recordId={id!} title={`Pre-Start ${doc.date}`} />}
        {canEmail && (
          <EmailButton
            resourceKind="pre_starts"
            recordId={id!}
            subject={`Daily Pre-Start — ${doc.date}${doc.crew_lead ? ` — ${doc.crew_lead}` : ''}`}
            body={`Daily pre-start summary.\n\nDate: ${doc.date}\nCrew lead: ${doc.crew_lead || ''}\nWork: ${doc.work_summary || ''}`}
          />
        )}
      </View>

      <Section title="Work summary">
        <Text style={s.bodyText}>{doc.work_summary || 'N/A'}</Text>
      </Section>

      <Section title="Hazards discussed">
        <Text style={s.bodyText}>{doc.hazards_discussed || 'N/A'}</Text>
      </Section>

      {doc.notes ? (
        <Section title="Notes">
          <Text style={s.bodyText}>{doc.notes}</Text>
        </Section>
      ) : null}

      <Section title={`Crew sign-ons · ${doc.sign_ons?.length || 0}`}>
        {(doc.sign_ons || []).length === 0 ? <Text style={s.empty}>No sign-ons</Text> :
          (doc.sign_ons || []).map((s2: any, i: number) => (
            <View key={i} style={s.signRow}>
              <View style={s.signAvatar}>
                <Text style={s.signInitial}>{(s2.name || '?')[0]?.toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.signName}>{s2.name}</Text>
                {s2.role ? <Text style={s.signRole}>{s2.role}</Text> : null}
              </View>
              {s2.signature_ts ? (
                <View style={s.signedBadge}>
                  <Ionicons name="checkmark-circle" size={12} color={Colors.emeraldDark} />
                  <Text style={s.signedText}>Signed</Text>
                </View>
              ) : (
                <Text style={s.unsignedText}>Not signed</Text>
              )}
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
  date: { fontSize: 13, color: Colors.textTertiary, marginTop: 4 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 16 },
  section: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, marginBottom: 10 },
  sectionTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: Colors.textTertiary, textTransform: 'uppercase', marginBottom: 8 },
  bodyText: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  empty: { fontSize: 13, color: Colors.textTertiary, fontStyle: 'italic' },
  signRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  signAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.blueSoft, alignItems: 'center', justifyContent: 'center' },
  signInitial: { fontSize: 13, fontWeight: '700', color: Colors.blue },
  signName: { fontSize: 14, fontWeight: '500', color: Colors.text },
  signRole: { fontSize: 12, color: Colors.textTertiary },
  signedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.mint, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  signedText: { fontSize: 11, fontWeight: '600', color: Colors.emeraldDark },
  unsignedText: { fontSize: 11, color: Colors.textTertiary },
});
