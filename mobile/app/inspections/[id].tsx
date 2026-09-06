/**
 * Inspection detail — v58.13.132e
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

const RESP_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  pass: { bg: '#D1FAE5', text: '#059669', icon: 'checkmark-circle' },
  fail: { bg: '#FEE2E2', text: '#EF4444', icon: 'close-circle' },
  na:   { bg: '#F1F5F9', text: '#64748B', icon: 'remove-circle' },
};

export default function InspectionDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: item, isLoading } = useQuery({
    queryKey: ['capture', 'inspections', id],
    queryFn: () => getItem('inspections', id!),
    enabled: !!id,
  });

  if (isLoading || !item) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.center}><ActivityIndicator size="large" color="#7C3AED" /></View>
      </View>
    );
  }

  const checklistItems = item.checklist_items || [];
  const passCount = checklistItems.filter((c: any) => c.response === 'pass').length;
  const failCount = checklistItems.filter((c: any) => c.response === 'fail').length;

  return (
    <View testID="inspection-detail-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Inspection</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <Text testID="inspection-detail-title" style={s.title}>{item.template_name || 'Inspection'}</Text>
        <View style={s.metaRow}>
          <View style={s.datePill}>
            <Ionicons name="calendar-outline" size={14} color="#7C3AED" />
            <Text style={s.dateText}>{item.date}</Text>
          </View>
          <View style={s.scorePill}>
            <Text style={s.scoreText}>{passCount}/{checklistItems.length} pass</Text>
          </View>
          {failCount > 0 && (
            <View style={s.failPill}>
              <Text style={s.failText}>{failCount} fail</Text>
            </View>
          )}
        </View>
        {item.operator && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Inspector</Text>
            <Text style={s.sectionText}>{item.operator}</Text>
          </View>
        )}
        <Text style={s.sectionTitle}>CHECKLIST</Text>
        {checklistItems.map((c: any, idx: number) => {
          const rc = RESP_COLORS[c.response] || RESP_COLORS.na;
          return (
            <View key={idx} style={s.checkRow}>
              <View style={[s.checkIcon, { backgroundColor: rc.bg }]}>
                <Ionicons name={rc.icon as any} size={18} color={rc.text} />
              </View>
              <View style={s.checkBody}>
                <Text style={s.checkLabel}>{c.label}</Text>
                {c.notes ? <Text style={s.checkNotes}>{c.notes}</Text> : null}
              </View>
            </View>
          );
        })}
        {item.notes ? (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Notes</Text>
            <Text style={s.sectionText}>{item.notes}</Text>
          </View>
        ) : null}
        <View style={{ height: 40 }} />
      </ScrollView>
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
  datePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F3E8FF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  dateText: { fontSize: 12, fontWeight: '600', color: '#7C3AED' },
  scorePill: { backgroundColor: '#D1FAE5', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  scoreText: { fontSize: 12, fontWeight: '700', color: '#059669' },
  failPill: { backgroundColor: '#FEE2E2', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  failText: { fontSize: 12, fontWeight: '700', color: '#EF4444' },
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 0.5, marginBottom: 4, textTransform: 'uppercase' },
  sectionText: { fontSize: 15, color: Colors.ink, lineHeight: 22 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 1, marginBottom: 12, marginTop: 8 },
  checkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 8,
  },
  checkIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  checkBody: { flex: 1 },
  checkLabel: { fontSize: 14, fontWeight: '600', color: Colors.ink },
  checkNotes: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
});
