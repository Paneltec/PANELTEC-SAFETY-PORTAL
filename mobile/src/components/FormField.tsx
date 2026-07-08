import React from 'react';
import { View, Text, TextInput, StyleSheet, TextInputProps } from 'react-native';
import { Colors } from '../lib/colors';

interface Props extends TextInputProps {
  label: string;
  required?: boolean;
  hint?: string;
  testID?: string;
}

export default function FormField({ label, required, hint, testID, style, ...rest }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>
        {label}
        {required && <Text style={styles.required}> *</Text>}
      </Text>
      <TextInput
        testID={testID}
        style={[styles.input, style]}
        placeholderTextColor={Colors.textTertiary}
        {...rest}
      />
      {hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

export const inputStyles = StyleSheet.create({
  input: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.text,
  },
});

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  required: {
    color: Colors.red,
  },
  input: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.text,
  },
  hint: {
    marginTop: 4,
    fontSize: 12,
    color: Colors.textTertiary,
  },
});
