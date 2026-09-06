/**
 * CompanyPill — segmented control for Paneltec / Viatec toggle.
 * v58.13.132b — API-driven: shows toggle when can_switch_company,
 * otherwise renders a static company chip.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';

type Company = {
  id: string;
  name: string;
};

type Props = {
  companies?: Company[];
  activeId?: string;
  canSwitch?: boolean;
  onSwitch?: (id: string) => void;
};

function companyIcon(id: string): keyof typeof Ionicons.glyphMap {
  return id === '3' ? 'construct' : 'hardware-chip';
}

function companyShortName(name: string): string {
  if (name.toLowerCase().includes('viatec')) return 'Viatec';
  if (name.toLowerCase().includes('paneltec')) return 'Paneltec';
  return name.split(' ')[0] || name;
}

export default function CompanyPill({ companies = [], activeId, canSwitch = false, onSwitch }: Props) {
  // Static chip — single company
  if (!canSwitch || companies.length <= 1) {
    const active = companies.find(c => c.id === activeId) || companies[0];
    if (!active) return null;
    return (
      <View testID="company-chip-static" style={s.staticChip}>
        <Ionicons name={companyIcon(active.id)} size={14} color={Colors.orange} />
        <Text style={s.staticText}>{companyShortName(active.name)}</Text>
      </View>
    );
  }

  // Toggle pill — dual company
  return (
    <View testID="company-pill" style={s.container}>
      {companies.map(c => {
        const isActive = c.id === activeId;
        return (
          <TouchableOpacity
            key={c.id}
            testID={`company-pill-${c.id}`}
            style={[s.pill, isActive && s.pillActive]}
            onPress={() => onSwitch?.(c.id)}
          >
            <Ionicons
              name={companyIcon(c.id)}
              size={14}
              color={isActive ? Colors.white : Colors.textTertiary}
            />
            <Text style={[s.text, isActive && s.textActive]}>
              {companyShortName(c.name)}
            </Text>
          </TouchableOpacity>
        );
      })}
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
  pillActive: { backgroundColor: Colors.orange },
  text: { fontSize: 13, fontWeight: '600', color: Colors.textTertiary },
  textActive: { color: Colors.white },
  staticChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.orangeSoft,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  staticText: { fontSize: 13, fontWeight: '600', color: Colors.orange },
});
