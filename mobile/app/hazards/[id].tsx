/**
 * Hazard detail/edit — v58.13.132e
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

const SEV_COLORS: Record<string, { bg: string; text: string }> = {
  low: { bg: '#D1FAE5', text: '#059669' },
  medium: { bg: '#FEF3C7', text: '#D97706' },
  high: { bg: '#FFF7ED', text: '#F97316' },
  critical: { bg: '#FEE2E2', text: '#EF4444' },
};

export default function HazardDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const API = process.env.EXPO_PUBLIC_BACKEND_URL;

  const { data: item, isLoading } = useQuery({
    queryKey: ['capture', 'hazards', id],
    queryFn: () => getItem('hazards', id!),
    enabled: !!id,
  });

  if (isLoading || !item) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.center}><ActivityIndicator size="large" color="#EF4444" /></View>
      </View>
    );
  }

  const sev = item.severity || 'medium';
  const sevC = SEV_COLORS[sev] || SEV_COLORS.medium;

  return (
    <View testID="hazard-detail-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity testID="hazard-detail-back" onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Hazard Report</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        {item.photo_url && (
          <Image source={{ uri: `${API}${item.photo_url}` }} style={s.photo} resizeMode="cover" />
        )}
        <Text testID="hazard-detail-title" style={s.title}>{item.title}</Text>
        <View style={s.metaRow}>
          <View style={[s.sevPill, { backgroundColor: sevC.bg }]}>
            <Text style={[s.sevText, { color: sevC.text }]}>{sev}</Text>
          </View>
          <View style={[s.statusPill, { backgroundColor: item.status === 'closed' ? '#D1FAE5' : '#FEF3C7' }]}>
            <Text style={s.statusText}>{item.status || 'open'}</Text>
          </View>
          <Text style={s.dateText}>{item.date || (item.created_at || '').slice(0, 10)}</Text>
        </View>
        {item.description ? (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Description</Text>
            <Text style={s.sectionText}>{item.description}</Text>
          </View>
        ) : null}
        {item.location ? (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Location</Text>
            <Text style={s.sectionText}>{item.location}</Text>
          </View>
        ) : null}
        {item.controls && item.controls.length > 0 ? (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Controls</Text>
            <View style={s.tagsWrap}>
              {item.controls.map((c: string, i: number) => (
                <View key={i} style={s.tag}>
                  <Text style={s.tagText}>{c}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
        {item.ai_analysis ? (
          <View style={s.section}>
            <Text style={s.sectionLabel}>AI Analysis</Text>
            {item.ai_analysis.identified_hazards?.map((h: string, i: number) => (
              <Text key={i} style={s.aiItem}>⚠️ {h}</Text>
            ))}
          </View>
        ) : null}
        {item.reported_by ? (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Reported by</Text>
            <Text style={s.sectionText}>{item.reported_by}</Text>
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
  photo: { width: '100%', height: 200, borderRadius: 14, marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '800', color: Colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 16 },
  sevPill: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  sevText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  statusPill: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: '700', color: '#D97706', textTransform: 'capitalize' },
  dateText: { fontSize: 12, color: Colors.textTertiary },
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 0.5, marginBottom: 4, textTransform: 'uppercase' },
  sectionText: { fontSize: 15, color: Colors.ink, lineHeight: 22 },
  tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { backgroundColor: Colors.successSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  tagText: { fontSize: 13, color: '#059669', fontWeight: '600' },
  aiItem: { fontSize: 14, color: Colors.ink, marginBottom: 4 },
});
