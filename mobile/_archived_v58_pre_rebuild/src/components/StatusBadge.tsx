import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { StatusColors } from '../lib/colors';

interface Props {
  value: string;
  testID?: string;
}

export default function StatusBadge({ value, testID }: Props) {
  const colors = StatusColors[value] || StatusColors.draft;
  return (
    <View
      testID={testID}
      style={[styles.badge, { backgroundColor: colors.bg, borderColor: colors.border }]}
    >
      <Text style={[styles.text, { color: colors.text }]}>
        {String(value || '').replace(/_/g, ' ').toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
