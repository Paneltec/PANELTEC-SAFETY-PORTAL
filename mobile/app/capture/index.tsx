/**
 * Capture Hub — Phase 4.
 * Large action tiles for field capture flows.
 */
import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, C } from '../../src/theme/colors';

interface ActionTile {
  testID: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle: string;
  color: string;
  bgColor: string;
  route: string;
}

const ACTIONS: ActionTile[] = [
  {
    testID: 'capture-hazard',
    icon: 'camera',
    label: 'New Hazard',
    subtitle: 'Take photo → AI analysis',
    color: '#EF4444',
    bgColor: '#FEE2E2',
    route: '/capture/hazard',
  },
  {
    testID: 'capture-prestart',
    icon: 'checkbox-outline',
    label: 'New Pre-Start',
    subtitle: 'Daily pre-start checklist',
    color: C.green.base,
    bgColor: C.green.softBg,
    route: '/capture/prestart',
  },
  {
    testID: 'capture-diary',
    icon: 'book-outline',
    label: 'Site Diary Entry',
    subtitle: 'Notes + AI structuring',
    color: '#3B82F6',
    bgColor: '#DBEAFE',
    route: '/capture/diary',
  },
  {
    testID: 'capture-incident',
    icon: 'alert-circle-outline',
    label: 'New Incident',
    subtitle: 'Report an incident or near-miss',
    color: '#DC2626',
    bgColor: '#FEE2E2',
    route: '/capture/incident',
  },
  {
    testID: 'capture-inspection',
    icon: 'clipboard-outline',
    label: 'New Inspection',
    subtitle: 'Walk through checklist',
    color: '#7C3AED',
    bgColor: '#EDE9FE',
    route: '/capture/inspection',
  },
  {
    testID: 'capture-signon',
    icon: 'qr-code-outline',
    label: 'QR Sign-On',
    subtitle: 'Scan SWMS QR to sign on',
    color: Colors.orange,
    bgColor: C.orange.softBg,
    route: '/capture/signon',
  },
];

export default function CaptureHub() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View testID="capture-hub" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity
          testID="capture-hub-back"
          onPress={() => router.back()}
          style={s.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={Colors.white} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Capture</Text>
      </View>
      <Text style={s.headerSub}>What do you need to record?</Text>

      <ScrollView contentContainerStyle={s.scroll}>
        {ACTIONS.map((action) => (
          <TouchableOpacity
            key={action.testID}
            testID={action.testID}
            style={s.tile}
            onPress={() => router.push(action.route as never)}
            activeOpacity={0.7}
          >
            <View style={[s.tileIcon, { backgroundColor: action.bgColor }]}>
              <Ionicons name={action.icon} size={28} color={action.color} />
            </View>
            <View style={s.tileText}>
              <Text style={s.tileLabel}>{action.label}</Text>
              <Text style={s.tileSub}>{action.subtitle}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.textOnNavy.faint} />
          </TouchableOpacity>
        ))}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.screen.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.screen.bar, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14,
  },
  backBtn: { padding: 4, marginRight: 8 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: C.textOnNavy.main },
  headerSub: {
    color: C.textOnNavy.faint, fontSize: 13, fontWeight: '500',
    paddingHorizontal: 20, paddingBottom: 12, backgroundColor: C.screen.bar,
  },
  scroll: { padding: 16, paddingBottom: 32 },
  tile: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: C.card.bg, borderRadius: 16, padding: 18, marginBottom: 10,
    minHeight: 76,
  },
  tileIcon: {
    width: 52, height: 52, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  tileText: { flex: 1 },
  tileLabel: { fontSize: 16, fontWeight: '700', color: C.card.textMain },
  tileSub: { fontSize: 13, color: C.card.textLabel, marginTop: 2 },
});
