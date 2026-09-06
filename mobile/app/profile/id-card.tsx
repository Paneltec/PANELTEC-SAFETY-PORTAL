/**
 * My ID Card — digital worker ID with QR code.
 * v58.13.132i — Renders the wallet card natively (same data as the PDF).
 */
import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '../../src/theme/colors';
import { fetchWorkerProfile } from '../../src/services/profile';
import { fetchQrPngBase64 } from '../../src/services/profileExtended';

export default function IdCardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data: profileData, isLoading } = useQuery({
    queryKey: ['worker-profile'],
    queryFn: fetchWorkerProfile,
    staleTime: 60_000,
  });

  const w = profileData?.worker;
  const workerId = w?.id;

  const { data: qrBase64 } = useQuery({
    queryKey: ['worker-qr', workerId],
    queryFn: () => fetchQrPngBase64(workerId || ''),
    enabled: !!workerId,
    staleTime: 300_000,
    retry: 2,
  });

  if (isLoading || !w) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <Header onBack={() => router.back()} />
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.orange} />
        </View>
      </View>
    );
  }

  const fullName = `${w.first_name || ''} ${w.last_name || ''}`.trim() || 'Worker';
  const role = w.position || 'Field Worker';
  const company = w.company_label || 'Paneltec';
  const initials = `${(w.first_name || '')[0] || ''}${(w.last_name || '')[0] || ''}`.toUpperCase();

  return (
    <View testID="id-card-screen" style={[s.container, { paddingTop: insets.top }]}>
      <Header onBack={() => router.back()} />
      <ScrollView contentContainerStyle={s.scroll}>
        {/* ── FRONT — Wallet Card ── */}
        <Text style={s.sectionLabel}>FRONT</Text>
        <View testID="id-card-front" style={s.walletCard}>
          {/* Slate header band */}
          <View style={s.cardHeader}>
            <View style={s.orangeChevron} />
            <Text style={s.cardHeaderText}>WORKER ID</Text>
          </View>

          <View style={s.cardBody}>
            <View style={s.cardLeft}>
              {/* Avatar */}
              <View style={s.cardAvatar}>
                <Text style={s.cardAvatarText}>{initials}</Text>
              </View>
              <View style={s.cardInfo}>
                <Text testID="id-card-name" style={s.cardName} numberOfLines={1}>{fullName}</Text>
                <Text style={s.cardRole} numberOfLines={1}>{role}</Text>
                <Text style={s.cardCompany} numberOfLines={1}>{company}</Text>
              </View>
            </View>
          </View>

          {/* Token */}
          <View style={s.cardTokenRow}>
            <Text style={s.cardToken}>EMP #{w.simpro_employee_id || '—'}</Text>
          </View>
        </View>

        {/* ── BACK — QR Code ── */}
        <Text style={s.sectionLabel}>BACK</Text>
        <View testID="id-card-back" style={s.lanyardCard}>
          {/* Slate header band */}
          <View style={s.lanyardHeader}>
            <View style={s.orangeChevron} />
            <Text style={s.lanyardHeaderText}>SITE WORKER ID</Text>
          </View>

          <View style={s.lanyardBody}>
            <Text style={s.lanyardName}>{fullName}</Text>
            <Text style={s.lanyardRole}>{role}</Text>
            <Text style={s.lanyardCompany}>{company}</Text>

            {/* QR */}
            <View testID="id-card-qr" style={s.qrWrap}>
              {qrBase64 ? (
                <Image source={{ uri: qrBase64 }} style={s.qrImage} resizeMode="contain" />
              ) : (
                <View style={s.qrPlaceholder}>
                  <ActivityIndicator size="small" color={Colors.orange} />
                  <Text style={s.qrLoadingText}>Loading QR...</Text>
                </View>
              )}
            </View>

            <Text style={s.scanText}>Scan this QR to view profile, certifications and site sign-in.</Text>
          </View>
        </View>

        {/* Info line */}
        <View testID="id-card-info" style={s.infoBox}>
          <Ionicons name="information-circle-outline" size={16} color={Colors.info} />
          <Text style={s.infoText}>
            Physical card printing is done by the office. Ask your supervisor if you need a replacement.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={s.header}>
      <TouchableOpacity testID="idcard-back-btn" style={s.backBtn} onPress={onBack}>
        <Ionicons name="chevron-back" size={24} color={Colors.white} />
      </TouchableOpacity>
      <Text style={s.headerTitle}>My ID Card</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, paddingBottom: 40 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.navy, paddingHorizontal: 8, paddingVertical: 14,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.white },

  sectionLabel: {
    fontSize: 11, fontWeight: '800', color: Colors.textTertiary,
    letterSpacing: 1.2, marginTop: 16, marginBottom: 10,
  },

  // ── Wallet card (front) ──
  walletCard: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 5,
  },
  cardHeader: {
    backgroundColor: Colors.navy,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  orangeChevron: {
    position: 'absolute', right: 0, top: 0, bottom: 0, width: 40,
    backgroundColor: Colors.orange,
    borderTopLeftRadius: 20,
    borderBottomLeftRadius: 20,
  },
  cardHeaderText: {
    color: Colors.white, fontSize: 9, fontWeight: '800', letterSpacing: 1.5,
  },
  cardBody: {
    flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12,
  },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  cardAvatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: Colors.orange,
    alignItems: 'center', justifyContent: 'center',
  },
  cardAvatarText: { color: Colors.white, fontSize: 18, fontWeight: '800' },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 16, fontWeight: '800', color: Colors.ink },
  cardRole: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  cardCompany: { fontSize: 12, color: Colors.textTertiary, marginTop: 1 },
  cardTokenRow: {
    paddingHorizontal: 14, paddingBottom: 10,
  },
  cardToken: { fontSize: 10, fontWeight: '700', color: Colors.orange, letterSpacing: 0.5 },

  // ── Lanyard card (back) ──
  lanyardCard: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 5,
  },
  lanyardHeader: {
    backgroundColor: Colors.navy,
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  lanyardHeaderText: {
    color: Colors.white, fontSize: 10, fontWeight: '800', letterSpacing: 1.5,
  },
  lanyardBody: { padding: 16, alignItems: 'center' },
  lanyardName: { fontSize: 20, fontWeight: '800', color: Colors.ink, textAlign: 'center' },
  lanyardRole: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  lanyardCompany: { fontSize: 13, color: Colors.textTertiary, marginTop: 2 },

  qrWrap: {
    marginVertical: 20,
    width: 200, height: 200,
    alignItems: 'center', justifyContent: 'center',
  },
  qrImage: { width: 200, height: 200 },
  qrPlaceholder: { alignItems: 'center', gap: 8 },
  qrLoadingText: { fontSize: 12, color: Colors.textTertiary },

  scanText: {
    fontSize: 11, color: Colors.textTertiary, textAlign: 'center',
    lineHeight: 16, paddingHorizontal: 20,
  },

  // Info box
  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: Colors.infoSoft, borderRadius: 12, padding: 14, marginTop: 16,
  },
  infoText: { fontSize: 12, color: Colors.info, fontWeight: '500', flex: 1, lineHeight: 18 },
});
