/**
 * Incident detail — v58.13.132e
 */
import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '../../src/theme/colors';
import { getItem } from '../../src/services/capture';

export default function IncidentDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const API = process.env.EXPO_PUBLIC_BACKEND_URL;

  const { data: item, isLoading } = useQuery({
    queryKey: ['capture', 'incidents', id],
    queryFn: () => getItem('incidents', id!),
    enabled: !!id,
  });

  if (isLoading || !item) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.center}><ActivityIndicator size="large" color="#DC2626" /></View>
      </View>
    );
  }

  return (
    <View testID="incident-detail-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Incident Report</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        {item.evidence_photos?.[0] && (
          <Image source={{ uri: `${API}${item.evidence_photos[0]}` }} style={s.photo} resizeMode="cover" />
        )}
        <Text testID="incident-detail-title" style={s.title}>{item.title}</Text>
        <View style={s.metaRow}>
          <View style={s.catPill}>
            <Text style={s.catText}>{(item.category || 'near_miss').replace('_', ' ')}</Text>
          </View>
          <View style={[s.statusPill, { backgroundColor: item.follow_up_status === 'closed' ? '#D1FAE5' : '#FEF3C7' }]}>
            <Text style={s.statusText}>{item.follow_up_status || 'open'}</Text>
          </View>
          <Text style={s.dateText}>{(item.occurred_at || '').slice(0, 10)}</Text>
        </View>
        {item.description ? <Section label="Description" text={item.description} /> : null}
        {item.location ? <Section label="Location" text={item.location} /> : null}
        {item.person_involved ? <Section label="Person involved" text={item.person_involved} /> : null}
        {item.immediate_actions ? <Section label="Immediate actions" text={item.immediate_actions} /> : null}
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
  photo: { width: '100%', height: 200, borderRadius: 14, marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '800', color: Colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 16 },
  catPill: { backgroundColor: '#FEE2E2', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  catText: { fontSize: 12, fontWeight: '700', color: '#DC2626', textTransform: 'capitalize' },
  statusPill: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: '700', color: '#D97706', textTransform: 'capitalize' },
  dateText: { fontSize: 12, color: Colors.textTertiary },
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 0.5, marginBottom: 4, textTransform: 'uppercase' },
  sectionText: { fontSize: 15, color: Colors.ink, lineHeight: 22 },
});
