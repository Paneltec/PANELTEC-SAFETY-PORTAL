/**
 * Visitor Step 2 — Induction video + acknowledgements.
 * v58.13.132c
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../../src/theme/colors';

const INDUCTION_ITEMS = [
  'I have watched and understood the site induction video',
  'I understand the emergency evacuation procedures',
  'I agree to follow all site safety rules and signage',
];

export default function VisitorStep2() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const [checks, setChecks] = useState<boolean[]>(INDUCTION_ITEMS.map(() => false));

  const toggle = (i: number) => {
    const next = [...checks];
    next[i] = !next[i];
    setChecks(next);
  };
  const allChecked = checks.every(Boolean);

  return (
    <View testID="visitor-step2" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity testID="visitor-step2-back" onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Site Induction</Text>
        <Text style={s.step}>2 / 4</Text>
      </View>

      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.title}>Induction</Text>
        <Text style={s.sub}>Complete the site induction before proceeding</Text>

        {/* Video placeholder */}
        <View style={s.videoPlaceholder}>
          <Ionicons name="videocam" size={40} color={Colors.textTertiary} />
          <Text style={s.videoText}>Site induction video</Text>
          <Text style={s.videoSub}>No video configured — please review items below</Text>
        </View>

        {/* Checkboxes */}
        <Text style={s.checkTitle}>ACKNOWLEDGEMENTS</Text>
        {INDUCTION_ITEMS.map((item, i) => (
          <TouchableOpacity
            key={i}
            testID={`induction-check-${i}`}
            style={s.checkRow}
            onPress={() => toggle(i)}
          >
            <View style={[s.checkbox, checks[i] && s.checkboxChecked]}>
              {checks[i] && <Ionicons name="checkmark" size={16} color={Colors.white} />}
            </View>
            <Text style={s.checkLabel}>{item}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={s.footer}>
        <TouchableOpacity testID="visitor-back-step2" style={s.backBtnFooter} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={18} color={Colors.textSecondary} />
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="visitor-next-step2"
          style={[s.nextBtn, !allChecked && s.nextDisabled]}
          disabled={!allChecked}
          onPress={() => router.push({ pathname: '/visitor/[siteId]/step3', params: { siteId: siteId || '' } } as any)}
        >
          <Text style={s.nextText}>Next</Text>
          <Ionicons name="arrow-forward" size={18} color={Colors.white} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.ink },
  step: { fontSize: 14, fontWeight: '600', color: Colors.textTertiary },
  content: { padding: 24 },
  title: { fontSize: 22, fontWeight: '800', color: Colors.ink },
  sub: { fontSize: 14, color: Colors.textSecondary, marginTop: 4, marginBottom: 24 },
  videoPlaceholder: {
    backgroundColor: Colors.borderLight, borderRadius: 16, padding: 32,
    alignItems: 'center', gap: 8, marginBottom: 24,
    borderWidth: 1, borderColor: Colors.border,
  },
  videoText: { fontSize: 16, fontWeight: '600', color: Colors.textSecondary },
  videoSub: { fontSize: 12, color: Colors.textTertiary, textAlign: 'center' },
  checkTitle: {
    fontSize: 12, fontWeight: '700', color: Colors.textTertiary,
    letterSpacing: 1, marginBottom: 12,
  },
  checkRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  checkbox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 2,
    borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  checkLabel: { flex: 1, fontSize: 14, color: Colors.ink, lineHeight: 20 },
  footer: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, backgroundColor: Colors.surface,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  backBtnFooter: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 12 },
  backText: { fontSize: 15, color: Colors.textSecondary, fontWeight: '500' },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.orange, borderRadius: 12,
    paddingHorizontal: 24, paddingVertical: 12,
  },
  nextDisabled: { opacity: 0.4 },
  nextText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
});
