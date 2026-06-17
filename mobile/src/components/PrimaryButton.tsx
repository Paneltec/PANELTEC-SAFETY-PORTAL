import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Colors } from '../lib/colors';

interface Props {
  children: React.ReactNode;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  testID?: string;
  color?: string;
}

export default function PrimaryButton({ children, onPress, busy, disabled, testID, color }: Props) {
  return (
    <TouchableOpacity
      testID={testID}
      style={[styles.btn, { backgroundColor: color || Colors.blue }, (busy || disabled) && styles.disabled]}
      onPress={onPress}
      disabled={busy || disabled}
      activeOpacity={0.7}
    >
      {busy && <ActivityIndicator size="small" color="#fff" style={{ marginRight: 6 }} />}
      <Text style={styles.text}>{children}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 10,
    minHeight: 48,
  },
  disabled: {
    opacity: 0.6,
  },
  text: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
