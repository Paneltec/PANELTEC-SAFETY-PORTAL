/**
 * PinPad — 3×4 numeric grid for PIN entry.
 * Big touch targets (≥ 64pt), haptic feedback ready.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { Spacing } from '../theme/spacing';

type Props = {
  value: string;
  maxLength?: number;
  onChangeValue: (v: string) => void;
  disabled?: boolean;
};

const KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'del'],
];

export default function PinPad({ value, maxLength = 4, onChangeValue, disabled }: Props) {
  const press = (k: string) => {
    if (disabled) return;
    if (k === 'del') {
      onChangeValue(value.slice(0, -1));
    } else if (k && value.length < maxLength) {
      onChangeValue(value + k);
    }
  };

  return (
    <View testID="pin-pad" style={s.grid}>
      {KEYS.map((row, ri) => (
        <View key={ri} style={s.row}>
          {row.map((k, ci) => (
            <TouchableOpacity
              key={ci}
              testID={k ? `pin-key-${k}` : `pin-key-empty-${ci}`}
              style={[s.key, !k && s.keyEmpty]}
              onPress={() => press(k)}
              disabled={disabled || !k}
              activeOpacity={0.6}
            >
              {k === 'del' ? (
                <Ionicons name="backspace-outline" size={26} color={Colors.white} />
              ) : (
                <Text style={[s.keyText, disabled && { opacity: 0.4 }]}>{k}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  grid: { gap: Spacing.md },
  row: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.md },
  key: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  keyEmpty: { backgroundColor: 'transparent' },
  keyText: {
    fontSize: 28,
    fontWeight: '600',
    color: Colors.white,
  },
});
