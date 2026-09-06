import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Colors } from '../lib/colors';

interface Props {
  children: React.ReactNode;
  onPress: () => void;
  testID?: string;
}

export default function GhostButton({ children, onPress, testID }: Props) {
  return (
    <TouchableOpacity
      testID={testID}
      style={styles.btn}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={styles.text}>{children}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    minHeight: 48,
  },
  text: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
});
