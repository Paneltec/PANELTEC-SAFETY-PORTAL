/**
 * SWMS detail screen — v58.13.132g M6
 */
import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '../../../src/theme/colors';
import { fetchMySwms, type SwmsDoc } from '../../../src/services/profile';
import { fetchWorkerProfile } from '../../../src/services/profile';

export default function SwmsDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  // Get worker ID first, then fetch SWMS
  const { data: profileData } = useQuery({
    queryKey: ['worker-profile'],
    queryFn: fetchWorkerProfile,
    staleTime: 60_000,
  });

  const workerId = profileData?.worker?.id || '';

  const { data: swmsList, isLoading } = useQuery({
    queryKey: ['my-swms', workerId],
    queryFn: () => fetchMySwms(workerId),
    enabled: !!workerId,
    staleTime: 60_000,
  });

  const doc = swmsList?.find((s: SwmsDoc) => s.id === id);

  if (isLoading) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.center}><ActivityIndicator size="large" color={Colors.orange} /></View>
      </View>
    );
  }

  if (!doc) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <Header onBack={() => router.back()} />
        <View style={s.center}>
          <Ionicons name="alert-circle-outline" size={40} color={Colors.textTertiary} />
          <Text style={s.emptyText}>SWMS document not found</Text>
        </View>
      </View>
    );
  }

  const statusColor = doc.status === 'approved' ? Colors.success
    : doc.status === 'draft' ? Colors.warning : Colors.textTertiary;

  return (
    <View testID="swms-detail-screen" style={[s.container, { paddingTop: insets.top }]}>
      <Header onBack={() => router.back()} />
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Title block */}
        <View testID="swms-title-card" style={s.card}>
          <View style={s.titleRow}>
            <View style={[s.iconCircle, { backgroundColor: Colors.infoSoft }]}>
              <Ionicons name="document-text" size={22} color={Colors.info} />
            </View>
            <View style={s.titleInfo}>
              {doc.code && <Text style={s.codeText}>{doc.code} {doc.version || ''}</Text>}
              <Text style={s.docTitle}>{doc.title}</Text>
            </View>
          </View>

          <View style={[s.statusBadge, { backgroundColor: statusColor + '20' }]}>
            <View style={[s.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[s.statusText, { color: statusColor }]}>
              {(doc.status || 'draft').charAt(0).toUpperCase() + (doc.status || 'draft').slice(1)}
            </Text>
          </View>
        </View>

        {/* Details */}
        <View testID="swms-details-card" style={s.card}>
          <Text style={s.sectionLabel}>DETAILS</Text>
          {doc.scope && <DetailRow label="Scope" value={doc.scope} />}
          {doc.job_description && <DetailRow label="Description" value={doc.job_description} />}
          {doc.review_date && <DetailRow label="Review Date" value={doc.review_date} />}
        </View>

        {/* PPE */}
        {doc.ppe && doc.ppe.length > 0 && (
          <View testID="swms-ppe-card" style={s.card}>
            <Text style={s.sectionLabel}>PPE REQUIREMENTS</Text>
            <View style={s.ppeGrid}>
              {doc.ppe.map((item: string, i: number) => (
                <View key={i} style={s.ppePill}>
                  <Ionicons name="shield-checkmark-outline" size={12} color={Colors.success} />
                  <Text style={s.ppeText}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={s.header}>
      <TouchableOpacity testID="swms-back-btn" style={s.backBtn} onPress={onBack}>
        <Ionicons name="chevron-back" size={24} color={Colors.white} />
      </TouchableOpacity>
      <Text style={s.headerTitle}>SWMS Document</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  scroll: { padding: 16, paddingBottom: 40 },
  emptyText: { fontSize: 15, color: Colors.textTertiary },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.navy, paddingHorizontal: 8, paddingVertical: 14,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.white },

  card: {
    backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  iconCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  titleInfo: { flex: 1 },
  codeText: { fontSize: 12, fontWeight: '700', color: Colors.orange, marginBottom: 4, letterSpacing: 0.5 },
  docTitle: { fontSize: 18, fontWeight: '800', color: Colors.ink, lineHeight: 24 },

  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, alignSelf: 'flex-start',
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: '700' },

  sectionLabel: {
    fontSize: 11, fontWeight: '800', color: Colors.textTertiary,
    letterSpacing: 1.2, marginBottom: 12,
  },
  detailRow: {
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  detailLabel: { fontSize: 12, color: Colors.textTertiary, fontWeight: '500', marginBottom: 4 },
  detailValue: { fontSize: 14, color: Colors.ink, lineHeight: 20 },

  ppeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ppePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.successSoft, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  ppeText: { fontSize: 12, color: Colors.success, fontWeight: '500' },
});
