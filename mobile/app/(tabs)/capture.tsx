/**
 * Phase 4 — Capture hub tab.
 * Large action tiles for field capture flows.
 */
import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const BLUE = '#2C6BFF';
const GREEN = '#10B981';
const VIOLET = '#7C3AED';
const AMBER = '#F59E0B';
const RED = '#EF4444';
const BG = '#F8FAFC';
const INK = '#0F172A';

const actions = [
  {
    id: 'hazard',
    title: 'New Hazard',
    subtitle: 'Photo + AI analysis',
    icon: 'camera-outline' as const,
    color: AMBER,
    bg: '#FEF3C7',
    route: '/(screens)/hazard-new',
  },
  {
    id: 'prestart',
    title: 'New Pre-Start',
    subtitle: 'Daily pre-start checklist',
    icon: 'checkbox-outline' as const,
    color: GREEN,
    bg: '#D1FAE5',
    route: '/(screens)/prestart-new',
  },
  {
    id: 'diary',
    title: 'Site Diary',
    subtitle: 'Daily notes + AI structure',
    icon: 'book-outline' as const,
    color: VIOLET,
    bg: '#F5F3FF',
    route: '/(screens)/diary-new',
  },
  {
    id: 'incident',
    title: 'New Incident',
    subtitle: 'Report with evidence photos',
    icon: 'flash-outline' as const,
    color: RED,
    bg: '#FEE2E2',
    route: '/(screens)/incident-new',
  },
  {
    id: 'inspection',
    title: 'New Inspection',
    subtitle: 'Template-based checklist',
    icon: 'clipboard-outline' as const,
    color: BLUE,
    bg: '#DBEAFE',
    route: '/(screens)/inspection-new',
  },
];

export default function CaptureScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View testID="capture-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Capture</Text>
        <Text style={s.headerSub}>Record safety events on-site</Text>
      </View>

      <ScrollView contentContainerStyle={s.scrollContent}>
        {actions.map((a) => (
          <TouchableOpacity
            key={a.id}
            testID={`capture-tile-${a.id}`}
            style={s.tile}
            onPress={() => router.push(a.route as any)}
            activeOpacity={0.7}
          >
            <View style={[s.tileIcon, { backgroundColor: a.bg }]}>
              <Ionicons name={a.icon} size={28} color={a.color} />
            </View>
            <View style={s.tileContent}>
              <Text style={s.tileTitle}>{a.title}</Text>
              <Text style={s.tileSub}>{a.subtitle}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#CBD5E1" />
          </TouchableOpacity>
        ))}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: INK, letterSpacing: -0.5 },
  headerSub: { fontSize: 13, color: '#64748B', fontWeight: '500', marginTop: 4 },
  scrollContent: { padding: 16 },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
    gap: 16,
    minHeight: 80,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  tileIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileContent: { flex: 1 },
  tileTitle: { fontSize: 16, fontWeight: '700', color: INK },
  tileSub: { fontSize: 13, color: '#64748B', marginTop: 3 },
});
