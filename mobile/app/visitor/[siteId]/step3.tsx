/**
 * Visitor Step 3 — PPE requirements checklist.
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

const DEFAULT_PPE = ['Hard hat', 'Hi-vis vest', 'Steel-cap boots', 'Safety glasses'];

export default function VisitorStep3() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { siteId } = useLocalSearchParams<{ siteId: string }>();

  const ppeItems = DEFAULT_PPE; // TODO: fetch from site data
  const [checks, setChecks] = useState<boolean[]>(ppeItems.map(() => false));

  const toggle = (i: number) => {
    const next = [...checks];
    next[i] = !next[i];
    setChecks(next);
  };
  const allChecked = checks.every(Boolean);

  const ppeIconMap: Record<string, string> = {
    'Hard hat': 'construct',
    'Hi-vis vest': 'shirt',
    'Steel-cap boots': 'footsteps',
    'Safety glasses': 'glasses',
    'Traffic wand': 'flashlight',
  };

  return (
    <View testID="visitor-step3" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity testID="visitor-step3-back" onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>PPE Check</Text>
        <Text style={s.step}>3 / 4</Text>
      </View>

      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.title}>PPE Requirements</Text>
        <Text style={s.sub}>Confirm the visitor has all required PPE</Text>

        {ppeItems.map((item, i) => (
          <TouchableOpacity
            key={i}
            testID={`ppe-check-${i}`}
            style={s.ppeRow}
            onPress={() => toggle(i)}
          >
            <View style={[s.ppeIcon, checks[i] && s.ppeIconChecked]}>
              <Ionicons
                name={(ppeIconMap[item] || 'shield-checkmark') as any}
                size={20}
                color={checks[i] ? Colors.white : Colors.textTertiary}
              />
            </View>
            <Text style={[s.ppeLabel, checks[i] && s.ppeLabelChecked]}>{item}</Text>
            <View style={[s.checkbox, checks[i] && s.checkboxChecked]}>
              {checks[i] && <Ionicons name="checkmark" size={16} color={Colors.white} />}
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={s.footer}>
        <TouchableOpacity testID="visitor-back-step3" style={s.backBtnFooter} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={18} color={Colors.textSecondary} />
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="visitor-next-step3"
          style={[s.nextBtn, !allChecked && s.nextDisabled]}
          disabled={!allChecked}
          onPress={() => router.push({ pathname: '/visitor/[siteId]/step4', params: { siteId: siteId || '' } } as any)}
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
  ppeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 10,
  },
  ppeIcon: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.borderLight,
    alignItems: 'center', justifyContent: 'center',
  },
  ppeIconChecked: { backgroundColor: Colors.success },
  ppeLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.ink },
  ppeLabelChecked: { color: Colors.success },
  checkbox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 2,
    borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: Colors.orange, borderColor: Colors.orange },
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
