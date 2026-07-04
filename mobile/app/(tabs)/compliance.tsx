import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/lib/colors';
import { useAuth } from '../../src/lib/AuthContext';
import type { ModuleId } from '../../src/lib/modules';

// v158.1 — Each tile carries a `moduleKey`; if the admin has turned that
// module off for the user's role, the tile is hidden from this hub.
// `renewals` and `audit_exports` don't have their own module toggle
// (web-only workflows) and are shown to everyone who can reach the tab.
const ITEMS: { key: string; title: string; desc: string; icon: any; route: string; moduleKey: ModuleId | null }[] = [
  { key: 'forms',             title: 'Forms Library',      desc: 'Fillable templates — incident, toolbox, inspection & permit forms.', icon: 'clipboard' as const,   route: '/forms',            moduleKey: 'forms' },
  { key: 'suppliers',         title: 'Suppliers',          desc: 'Live from Simpro — org-local notes, tasks, folders and members.',    icon: 'business' as const,    route: '/suppliers',        moduleKey: 'suppliers' },
  { key: 'document-library',  title: 'Document Library',   desc: 'All risk & compliance documents, organised and AI-tagged.',           icon: 'folder-open' as const, route: '/document-library', moduleKey: 'document_library' },
  { key: 'contractors-legacy', title: 'Contractors (Legacy)', desc: 'Companies, ABNs, insurances and licences.',                        icon: 'people' as const,      route: '/contractors',      moduleKey: 'contractors' },
  { key: 'renewals',          title: 'Renewal Links',      desc: 'Single-use links for contractor document uploads.',                   icon: 'link' as const,        route: '/contractors',      moduleKey: null },
  { key: 'audit-exports',     title: 'Audit Exports',      desc: 'Generate signed evidence packs for audits.',                          icon: 'download' as const,    route: '/contractors',      moduleKey: null },
];

export default function ComplianceScreen() {
  const router = useRouter();
  const { modules } = useAuth();
  const visibleItems = useMemo(() => ITEMS.filter(it => it.moduleKey == null || modules[it.moduleKey]), [modules]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView testID="compliance-page" style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.overline}>COMPLIANCE</Text>
        <Text style={styles.heading}>Compliance Hub</Text>
        <Text style={styles.sub}>Suppliers, documents, contractor management and audit packs.</Text>

        {visibleItems.map((item) => (
          <TouchableOpacity
            key={item.key}
            testID={`compliance-${item.key}`}
            style={styles.card}
            onPress={() => router.push(item.route as any)}
            activeOpacity={0.7}
          >
            <View style={styles.iconWrap}>
              <Ionicons name={item.icon} size={22} color={Colors.orange} />
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
  overline: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: Colors.orange },
  heading: { fontSize: 26, fontWeight: '800', color: Colors.ink, marginTop: 4, letterSpacing: 1 },
  sub: { fontSize: 14, color: Colors.textSecondary, marginTop: 4, marginBottom: 20 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 16, padding: 16, marginBottom: 10,
  },
  iconWrap: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: Colors.orangeSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: Colors.ink },
  cardDesc: { fontSize: 13, color: Colors.textSecondary, marginTop: 3, lineHeight: 18 },
});
