/**
 * Certification detail screen — v58.13.132dc
 * Restored from archive.
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
import { fetchWorkerProfile, type Certification } from '../../../src/services/profile';

function statusColor(key: string): { bg: string; fg: string } {
  switch (key) {
    case 'valid':         return { bg: Colors.successSoft, fg: Colors.success };
    case 'expiring_soon': return { bg: Colors.warningSoft, fg: Colors.warning };
    case 'expired':       return { bg: Colors.errorSoft, fg: Colors.error };
    case 'missing_file':  return { bg: Colors.errorSoft, fg: Colors.error };
    default:              return { bg: Colors.borderLight, fg: Colors.textTertiary };
  }
}

export default function CertDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['worker-profile'],
    queryFn: fetchWorkerProfile,
    staleTime: 60_000,
  });

  const cert = data?.certifications?.find((c: Certification) => c.id === id);

  if (isLoading) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.center}><ActivityIndicator size="large" color={Colors.orange} /></View>
      </View>
    );
  }

  if (!cert) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <Header onBack={() => router.back()} title="Certification" />
        <View style={s.center}>
          <Ionicons name="alert-circle-outline" size={40} color={Colors.textTertiary} />
          <Text style={s.emptyText}>Certification not found</Text>
        </View>
      </View>
    );
  }

  const color = statusColor(cert.status.key);

  return (
    <View testID="cert-detail-screen" style={[s.container, { paddingTop: insets.top }]}>
      <Header onBack={() => router.back()} title="Certification" />
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Status banner */}
        <View testID="cert-status-banner" style={[s.statusBanner, { backgroundColor: color.bg }]}>
          <Ionicons
            name={cert.status.key === 'valid' ? 'checkmark-circle' : 'alert-circle'}
            size={20}
            color={color.fg}
          />
          <Text style={[s.statusLabel, { color: color.fg }]}>{cert.status.label}</Text>
          {cert.status.days != null && (
            <Text style={[s.statusDays, { color: color.fg }]}>
              {cert.status.days > 0 ? `${cert.status.days} days remaining` : ''}
            </Text>
          )}
        </View>

        {/* Details card */}
        <View testID="cert-details-card" style={s.card}>
          <Text style={s.certName}>{cert.name}</Text>

          <DetailRow label="Issuer" value={cert.issuer || '—'} />
          <DetailRow label="Issue Date" value={cert.issue_date || '—'} />
          <DetailRow label="Expiry Date" value={cert.expiry_date || '—'} />
          <DetailRow label="Category" value={cert.doc_seed_folder || '—'} />

          {cert.notes ? (
            <View style={s.notesBlock}>
              <Text style={s.notesLabel}>Notes</Text>
              <Text style={s.notesValue}>{cert.notes}</Text>
            </View>
          ) : null}
        </View>

        {/* Document status */}
        <View testID="cert-doc-status" style={s.card}>
          <View style={s.docRow}>
            <Ionicons
              name={cert.doc_file_id ? 'document-attach' : 'document-outline'}
              size={20}
              color={cert.doc_file_id ? Colors.success : Colors.textTertiary}
            />
            <Text style={s.docText}>
              {cert.doc_file_id ? 'Document attached' : 'No document attached'}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <View style={s.header}>
      <TouchableOpacity testID="cert-back-btn" style={s.backBtn} onPress={onBack}>
        <Ionicons name="chevron-back" size={24} color={Colors.white} />
      </TouchableOpacity>
      <Text style={s.headerTitle}>{title}</Text>
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

  statusBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 14, padding: 16, marginBottom: 12,
  },
  statusLabel: { fontSize: 15, fontWeight: '700', flex: 1 },
  statusDays: { fontSize: 12, fontWeight: '500' },

  card: {
    backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  certName: { fontSize: 20, fontWeight: '800', color: Colors.ink, marginBottom: 16 },

  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  detailLabel: { fontSize: 13, color: Colors.textTertiary, fontWeight: '500' },
  detailValue: { fontSize: 14, color: Colors.ink, fontWeight: '600', maxWidth: '60%' as any, textAlign: 'right' },

  notesBlock: { marginTop: 14 },
  notesLabel: { fontSize: 12, color: Colors.textTertiary, fontWeight: '600', marginBottom: 4 },
  notesValue: { fontSize: 14, color: Colors.ink, lineHeight: 20 },

  docRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  docText: { fontSize: 14, color: Colors.ink, fontWeight: '500' },
});
