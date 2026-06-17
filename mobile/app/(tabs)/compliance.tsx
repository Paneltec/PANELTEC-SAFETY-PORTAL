import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/lib/colors';

const ITEMS = [
  { key: 'contractors', title: 'Contractor Register', desc: 'Companies, ABNs, insurances and licences.', icon: 'people' as const, route: '/contractors' },
  { key: 'renewals', title: 'Renewal Links', desc: 'Single-use links for contractor document uploads.', icon: 'link' as const, route: '/contractors' },
  { key: 'audit-exports', title: 'Audit Exports', desc: 'Generate signed evidence packs for audits.', icon: 'download' as const, route: '/contractors' },
];

export default function ComplianceScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView testID="compliance-page" style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.overline}>COMPLIANCE</Text>
        <Text style={styles.heading}>Compliance Hub</Text>
        <Text style={styles.sub}>Contractor management, renewals and audit packs.</Text>

        {ITEMS.map((item) => (
          <TouchableOpacity
            key={item.key}
            testID={`compliance-${item.key}`}
            style={styles.card}
            onPress={() => router.push(item.route as any)}
            activeOpacity={0.7}
          >
            <View style={styles.iconWrap}>
              <Ionicons name={item.icon} size={22} color={Colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardDesc}>{item.desc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  overline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.blue },
  heading: { fontSize: 28, fontWeight: '700', color: Colors.ink, marginTop: 4, letterSpacing: -0.5 },
  sub: { fontSize: 14, color: Colors.textSecondary, marginTop: 4, marginBottom: 20 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 16, padding: 16, marginBottom: 10,
  },
  iconWrap: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: Colors.blueSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: Colors.ink },
  cardDesc: { fontSize: 13, color: Colors.textSecondary, marginTop: 3, lineHeight: 18 },
});
