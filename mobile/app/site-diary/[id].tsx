/**
 * Site Diary detail — v58.13.132e
 */
import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '../../src/theme/colors';
import { getItem } from '../../src/services/capture';

export default function SiteDiaryDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: item, isLoading } = useQuery({
    queryKey: ['capture', 'site-diary', id],
    queryFn: () => getItem('site-diary', id!),
    enabled: !!id,
  });

  if (isLoading || !item) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.center}><ActivityIndicator size="large" color="#2563EB" /></View>
      </View>
    );
  }

  return (
    <View testID="diary-detail-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Site Diary</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.metaRow}>
          <View style={s.datePill}>
            <Ionicons name="calendar-outline" size={14} color="#2563EB" />
            <Text style={s.dateText}>{item.date}</Text>
          </View>
          <View style={[s.statusPill, { backgroundColor: item.status === 'draft' ? '#F1F5F9' : '#DBEAFE' }]}>
            <Text style={[s.statusText, { color: item.status === 'draft' ? '#64748B' : '#2563EB' }]}>
              {item.status || 'submitted'}
            </Text>
          </View>
        </View>
        <View style={s.notesCard}>
          <Text testID="diary-detail-notes" style={s.notesText}>{item.raw_notes || 'No notes'}</Text>
        </View>
        {item.structured_log && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Structured Log</Text>
            <Text style={s.sectionText}>{JSON.stringify(item.structured_log, null, 2)}</Text>
          </View>
        )}
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
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  datePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#DBEAFE', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  dateText: { fontSize: 12, fontWeight: '600', color: '#2563EB' },
  statusPill: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  notesCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 20,
    borderWidth: 1, borderColor: Colors.border,
  },
  notesText: { fontSize: 15, color: Colors.ink, lineHeight: 24 },
  section: { marginTop: 16 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 0.5, marginBottom: 4, textTransform: 'uppercase' },
  sectionText: { fontSize: 13, color: Colors.textSecondary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
