import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/lib/colors';
import { useCan, useAuth } from '../../src/lib/AuthContext';
import type { ModuleId } from '../../src/lib/modules';

const TOOLS: { key: string; moduleKey: ModuleId | null; title: string; desc: string; icon: any; route: string }[] = [
  { key: 'swms', moduleKey: 'swms', title: 'AI SWMS Generator', desc: 'Draft Safe Work Method Statements from a job brief in minutes.', icon: 'document-text', route: '/swms' },
  { key: 'pre-starts', moduleKey: 'pre_start', title: 'Daily Pre-Starts', desc: 'Crew pre-start checks captured on mobile, signed at the gate.', icon: 'clipboard', route: '/pre-starts' },
  { key: 'site-diary', moduleKey: 'site_diary', title: 'Site Diary AI', desc: 'Auto-summarise voice notes and photos into a daily site diary.', icon: 'book', route: '/site-diary' },
  { key: 'hazards', moduleKey: 'hazard', title: 'Hazard Reports from Photos', desc: 'Snap a hazard — AI classifies risk and drafts the report.', icon: 'warning', route: '/hazards' },
  { key: 'incidents', moduleKey: 'incident', title: 'Incident Reports', desc: 'Structured incident capture with witness statements and evidence.', icon: 'alert-circle', route: '/incidents' },
  { key: 'inspections', moduleKey: 'inspection', title: 'Inspection Reports', desc: 'Plant, scaffold and site walk inspections with pass/fail items.', icon: 'checkmark-circle', route: '/inspections' },
  { key: 'forms', moduleKey: 'forms', title: 'Forms Library', desc: 'Fillable templates — incident, toolbox, inspection & permit forms.', icon: 'clipboard', route: '/forms' },
];

export default function CaptureScreen() {
  const router = useRouter();
  const { modules } = useAuth();
  const visibleTools = TOOLS.filter(t => !t.moduleKey || modules[t.moduleKey]);

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView testID="capture-page" style={s.scroll} contentContainerStyle={s.content}>
        <Text style={s.overline}>CAPTURE</Text>
        <Text style={s.heading}>CREATE & CAPTURE</Text>
        <Text style={s.sub}>Choose a capture tool to start a new record.</Text>

        {visibleTools.length === 0 ? (
          <View style={s.emptyBox}>
            <Ionicons name="lock-closed" size={24} color={Colors.textTertiary} />
            <Text style={s.emptyText}>No capture tools available for your role.</Text>
          </View>
        ) : visibleTools.map((t) => (
          <TouchableOpacity key={t.key} testID={`capture-tool-${t.key}`} style={s.card}
            onPress={() => router.push(t.route as any)} activeOpacity={0.7}>
            <View style={s.iconWrap}>
              <Ionicons name={t.icon} size={22} color={Colors.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{t.title}</Text>
              <Text style={s.cardDesc}>{t.desc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  overline: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: Colors.orange },
  heading: { fontSize: 26, fontWeight: '800', color: Colors.ink, marginTop: 4, letterSpacing: 1 },
  sub: { fontSize: 14, color: Colors.textSecondary, marginTop: 4, marginBottom: 20 },
  emptyBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 8 },
  emptyText: { fontSize: 14, color: Colors.textTertiary },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, marginBottom: 10 },
  iconWrap: { width: 44, height: 44, borderRadius: 12, backgroundColor: Colors.orangeSoft, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 16, fontWeight: '600', color: Colors.ink },
  cardDesc: { fontSize: 13, color: Colors.textSecondary, marginTop: 3, lineHeight: 18 },
});
