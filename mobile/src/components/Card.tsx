/**
 * Card — white with soft shadow, rounded corners.
 */
import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Colors } from '../theme/colors';
import { Spacing } from '../theme/spacing';

type Props = {
  children: React.ReactNode;
  style?: ViewStyle;
  testID?: string;
};

export default function Card({ children, style, testID }: Props) {
  return (
    <View testID={testID} style={[s.card, style]}>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.border,
    boxShadow: '0px 1px 3px rgba(0,0,0,0.06)',
    elevation: 2,
  },
});
