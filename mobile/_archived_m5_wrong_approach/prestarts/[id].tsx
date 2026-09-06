/**
 * Pre-Start detail — v58.13.132e
 */
import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '../../src/theme/colors';
import { getItem } from '../../src/services/capture';

export default function PreStartDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: item, isLoading } = useQuery({
    queryKey: ['capture', 'pre-starts', id],
    queryFn: () => getItem('pre-starts', id!),
    enabled: !!id,
  });

  if (isLoading || !item) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.center}><ActivityIndicator size="large" color={Colors.orange} /></View>
      </View>
    );
  }

  return (
    <View testID="prestart-detail-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Pre-Start Check</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <Text testID="prestart-detail-title" style={s.title}>{item.crew_lead || 'Pre-Start'}</Text>
        <View style={s.metaRow}>
          <View style={s.datePill}>
            <Ionicons name="calendar-outline" size={14} color={Colors.orange} />
            <Text style={s.dateText}>{item.date}</Text>
          </View>
          <View style={[s.statusPill, { backgroundColor: item.status === 'submitted' ? '#DBEAFE' : '#F1F5F9' }]}>
            <Text style={s.statusText}>{item.status || 'draft'}</Text>
          </View>
        </View>
        <Section label="Work Summary" text={item.work_summary} />
        {item.hazards_discussed ? <Section label="Hazards Discussed" text={item.hazards_discussed} /> : null}
        {item.notes ? <Section label="Notes" text={item.notes} /> : null}
        {item.asset_label ? <Section label="Asset" text={`${item.asset_label} ${item.asset_rego ? `(${item.asset_rego})` : ''}`} /> : null}
        {item.source === 'form_submission' && (
          <View style={s.sourceTag}>
            <Text style={s.sourceText}>Submitted via phone form</Text>
          </View>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function Section({ label, text }: { label: string; text: string }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionLabel}>{label}</Text>
      <Text style={s.sectionText}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.ink },
  content: { padding: 20 },
  title: { fontSize: 22, fontWeight: '800', color: Colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 16 },
  datePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.orangeSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  dateText: { fontSize: 12, fontWeight: '600', color: Colors.orange },
  statusPill: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: '700', color: '#2563EB', textTransform: 'capitalize' },
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 0.5, marginBottom: 4, textTransform: 'uppercase' },
  sectionText: { fontSize: 15, color: Colors.ink, lineHeight: 22 },
  sourceTag: { backgroundColor: '#DBEAFE', borderRadius: 8, padding: 10, marginTop: 8 },
  sourceText: { fontSize: 12, color: '#2563EB', fontWeight: '500' },
});
