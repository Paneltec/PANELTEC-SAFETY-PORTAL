/**
 * My Certifications list — v58.13.132i
 */
import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '../../src/theme/colors';
import { fetchWorkerProfile } from '../../src/services/profile';

function statusColor(key: string): { bg: string; fg: string } {
  switch (key) {
    case 'valid':         return { bg: Colors.successSoft, fg: Colors.success };
    case 'expiring_soon': return { bg: Colors.warningSoft, fg: Colors.warning };
    case 'expired':       return { bg: Colors.errorSoft, fg: Colors.error };
    case 'missing_file':  return { bg: Colors.errorSoft, fg: Colors.error };
    default:              return { bg: Colors.borderLight, fg: Colors.textTertiary };
  }
}

export default function CertificationsListScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ['worker-profile'],
    queryFn: fetchWorkerProfile,
    staleTime: 60_000,
  });

  const certs = data?.certifications || [];

  return (
    <View testID="certs-list-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity testID="certs-back-btn" style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={Colors.white} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>My Certifications</Text>
        <View style={s.countBadge}>
          <Text style={s.countText}>{certs.length}</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={s.center}><ActivityIndicator size="large" color={Colors.orange} /></View>
      ) : certs.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="ribbon-outline" size={40} color={Colors.textTertiary} />
          <Text style={s.emptyText}>No certifications found</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          {certs.map((cert) => {
            const color = statusColor(cert.status.key);
            return (
              <TouchableOpacity
                key={cert.id}
                testID={`cert-row-${cert.id}`}
                style={s.certRow}
                onPress={() => router.push({ pathname: '/profile/certifications/[id]', params: { id: cert.id } } as never)}
                activeOpacity={0.7}
              >
                <View style={[s.statusDot, { backgroundColor: color.fg }]} />
                <View style={s.certInfo}>
                  <Text style={s.certName} numberOfLines={1}>{cert.name}</Text>
                  {cert.issuer ? <Text style={s.certIssuer} numberOfLines={1}>{cert.issuer}</Text> : null}
                  {cert.expiry_date ? <Text style={s.certExpiry}>Expires: {cert.expiry_date}</Text> : null}
                </View>
                <View style={[s.statusPill, { backgroundColor: color.bg }]}>
                  <Text style={[s.statusText, { color: color.fg }]}>{cert.status.label}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  scroll: { paddingBottom: 40 },
  emptyText: { fontSize: 15, color: Colors.textTertiary },

  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.navy, paddingHorizontal: 8, paddingVertical: 14,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.white, flex: 1 },
  countBadge: {
    backgroundColor: 'rgba(249,115,22,0.2)', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3, marginRight: 8,
  },
  countText: { fontSize: 12, fontWeight: '700', color: Colors.orange },

  certRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.surface, paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  certInfo: { flex: 1 },
  certName: { fontSize: 14, fontWeight: '700', color: Colors.ink },
  certIssuer: { fontSize: 12, color: Colors.textTertiary, marginTop: 2 },
  certExpiry: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  statusPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '600' },
});
