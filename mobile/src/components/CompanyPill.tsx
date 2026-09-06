/**
 * CompanyPill — segmented control for Paneltec / Viatec toggle.
 * Visual only in M1 — does not switch anything.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '../theme/colors';

type Company = 'paneltec' | 'viatec';

type Props = {
  initial?: Company;
  onToggle?: (c: Company) => void;
};

export default function CompanyPill({ initial = 'paneltec', onToggle }: Props) {
  const [active, setActive] = useState<Company>(initial);

  const toggle = (c: Company) => {
    setActive(c);
    onToggle?.(c);
  };

  return (
    <View testID="company-pill" style={s.container}>
      <TouchableOpacity
        testID="company-pill-paneltec"
        style={[s.pill, active === 'paneltec' && s.pillActive]}
        onPress={() => toggle('paneltec')}
      >
        <View style={[s.dot, { backgroundColor: Colors.paneltec }]} />
        <Text style={[s.text, active === 'paneltec' && s.textActive]}>Paneltec</Text>
      </TouchableOpacity>
      <TouchableOpacity
        testID="company-pill-viatec"
        style={[s.pill, active === 'viatec' && s.pillActive]}
        onPress={() => toggle('viatec')}
      >
        <View style={[s.dot, { backgroundColor: Colors.viatec }]} />
        <Text style={[s.text, active === 'viatec' && s.textActive]}>Viatec</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: Colors.borderLight,
    borderRadius: 12,
    padding: 3,
    gap: 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  pillActive: { backgroundColor: Colors.surface },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontSize: 13, fontWeight: '600', color: Colors.textTertiary },
  textActive: { color: Colors.ink },
});
