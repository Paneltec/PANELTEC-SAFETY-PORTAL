import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../src/lib/api';
import { Colors } from '../../src/lib/colors';
import { useCan } from '../../src/lib/AuthContext';
import PdfActions from '../../src/components/PdfActions';
import EmailButton from '../../src/components/EmailButton';
import ReadOnlyBanner from '../../src/components/ReadOnlyBanner';

export default function InspectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const can = useCan();
  const [doc, setDoc] = useState<any>(null);

  useEffect(() => {
    api.get(`/inspections/${id}`).then(r => setDoc(r.data)).catch(() => { Alert.alert('Not found'); router.back(); });
  }, [id]);

  if (!doc) return <View style={s.center}><ActivityIndicator color={Colors.blue} /></View>;

  const canEdit = can('inspections', 'edit');
  const canView = can('inspections', 'view');
  const canEmail = can('inspections', 'email');
  const items = doc.checklist_items || [];
  const passed = items.filter((c: any) => c.response === 'pass').length;
  const failed = items.filter((c: any) => c.response === 'fail').length;
  const na = items.length - passed - failed;

  return (
    <ScrollView testID="inspection-detail" style={s.scroll} contentContainerStyle={s.content}>
      {!canEdit && <ReadOnlyBanner />}
      <Text style={s.heading}>{doc.template_name || 'Inspection'}</Text>
      <Text style={s.date}>{doc.date}</Text>

      <View testID="inspection-results" style={s.resultsRow}>
        <View style={[s.resBadge, { backgroundColor: Colors.mint }]}>
          <Text style={[s.resText, { color: Colors.emeraldDark }]}>{passed} pass</Text>
        </View>
        <View style={[s.resBadge, { backgroundColor: failed > 0 ? Colors.redSoft : Colors.bg }]}>
          <Text style={[s.resText, { color: failed > 0 ? Colors.red : Colors.textTertiary }]}>{failed} fail</Text>
        </View>
        <View style={[s.resBadge, { backgroundColor: Colors.bg }]}>
          <Text style={[s.resText, { color: Colors.textTertiary }]}>{na} N/A</Text>
        </View>
      </View>

      <View testID="inspection-actions" style={s.actionRow}>
        {canView && <PdfActions resourceKind="inspections" recordId={id!} title={doc.template_name || 'Inspection'} />}
        {canEmail && (
          <EmailButton
            resourceKind="inspections"
            recordId={id!}
            subject={`Inspection Report: ${doc.template_name} — ${doc.date}`}
            body={`Inspection report.\n\nTemplate: ${doc.template_name}\nDate: ${doc.date}\nResults: ${passed} pass · ${failed} fail`}
          />
        )}
      </View>

      <View style={s.checklist}>
        {items.map((item: any, i: number) => (
          <View key={i} testID={`inspection-item-${i}`} style={s.checkItem}>
            <View style={{ flex: 1 }}>
              <Text style={s.checkLabel}>{item.label}</Text>
              {item.notes ? <Text style={s.checkNotes}>{item.notes}</Text> : null}
            </View>
            <View style={[
              s.respBadge,
              item.response === 'pass' ? s.passBg :
              item.response === 'fail' ? s.failBg : s.naBg
            ]}>
              <Text style={[
                s.respText,
                item.response === 'pass' ? s.passText :
                item.response === 'fail' ? s.failText : s.naText
              ]}>{item.response === 'na' ? 'N/A' : item.response}</Text>
            </View>
          </View>
        ))}
      </View>

      {doc.notes ? (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Inspector notes</Text>
          <Text style={s.bodyText}>{doc.notes}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 24, fontWeight: '700', color: Colors.ink },
  date: { fontSize: 13, color: Colors.textTertiary, marginTop: 4 },
  resultsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  resBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
  resText: { fontSize: 13, fontWeight: '600' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 16 },
  checklist: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, overflow: 'hidden', marginBottom: 10 },
  checkItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  checkLabel: { fontSize: 14, fontWeight: '500', color: Colors.text },
  checkNotes: { fontSize: 12, color: Colors.textTertiary, marginTop: 2 },
  respBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  passBg: { backgroundColor: Colors.mint, borderColor: Colors.emerald },
  failBg: { backgroundColor: Colors.redSoft, borderColor: Colors.red },
  naBg: { backgroundColor: Colors.bg, borderColor: Colors.border },
  respText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  passText: { color: Colors.emeraldDark },
  failText: { color: Colors.red },
  naText: { color: Colors.textTertiary },
  section: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, marginBottom: 10 },
  sectionTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: Colors.textTertiary, textTransform: 'uppercase', marginBottom: 8 },
  bodyText: { fontSize: 14, color: Colors.text, lineHeight: 20 },
});
