import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/lib/colors';
import { useCan } from '../../src/lib/AuthContext';
import { ROUTE_TO_RESOURCE } from '../../src/lib/permissions';

const TOOLS = [
  { key: 'swms', resource: 'swms', title: 'AI SWMS Generator', desc: 'Draft Safe Work Method Statements from a job brief in minutes.', icon: 'document-text' as const, route: '/swms' },
  { key: 'pre-starts', resource: 'pre_starts', title: 'Daily Pre-Starts', desc: 'Crew pre-start checks captured on mobile, signed at the gate.', icon: 'clipboard' as const, route: '/pre-starts' },
  { key: 'site-diary', resource: 'site_diary', title: 'Site Diary AI', desc: 'Auto-summarise voice notes and photos into a daily site diary.', icon: 'book' as const, route: '/site-diary' },
  { key: 'hazards', resource: 'hazards', title: 'Hazard Reports from Photos', desc: 'Snap a hazard — AI classifies risk and drafts the report.', icon: 'warning' as const, route: '/hazards' },
  { key: 'incidents', resource: 'incidents', title: 'Incident Reports', desc: 'Structured incident capture with witness statements and evidence.', icon: 'alert-circle' as const, route: '/incidents' },
  { key: 'inspections', resource: 'inspections', title: 'Inspection Reports', desc: 'Plant, scaffold and site walk inspections with pass/fail items.', icon: 'checkmark-circle' as const, route: '/inspections' },
];

export default function CaptureScreen() {
  const router = useRouter();
  const can = useCan();

  const visibleTools = TOOLS.filter(t => can(t.resource, 'open'));

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView testID="capture-page" style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.overline}>CAPTURE</Text>
        <Text style={styles.heading}>Create & Capture</Text>
        <Text style={styles.sub}>Choose a capture tool to start a new record.</Text>

        {visibleTools.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="lock-closed" size={24} color={Colors.textTertiary} />
            <Text style={styles.emptyText}>No capture tools available for your role.</Text>
          </View>
        ) : visibleTools.map((t) => (
          <TouchableOpacity
            key={t.key}
            testID={`capture-tool-${t.key}`}
            style={styles.card}
            onPress={() => router.push(t.route as any)}
            activeOpacity={0.7}
          >
            <View style={styles.iconWrap}>
              <Ionicons name={t.icon} size={22} color={Colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{t.title}</Text>
              <Text style={styles.cardDesc}>{t.desc}</Text>
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
  emptyBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 8 },
  emptyText: { fontSize: 14, color: Colors.textTertiary },
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
