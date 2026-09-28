/**
 * PrimaryButton — safety-orange full-width CTA.
 */
import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';
import { Colors } from '../theme/colors';

type Props = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'orange' | 'navy' | 'outline' | 'green' | 'grey';
  style?: ViewStyle;
  testID?: string;
};

export default function PrimaryButton({ title, onPress, disabled, loading, variant = 'orange', style, testID }: Props) {
  const bg = variant === 'orange' ? Colors.orange : variant === 'navy' ? Colors.navy : variant === 'green' ? Colors.green : variant === 'grey' ? Colors.card : 'transparent';
  const textColor = variant === 'outline' ? Colors.orange : variant === 'green' ? Colors.onGreen : variant === 'grey' ? Colors.onCardMuted : Colors.white;
  const borderColor = variant === 'outline' ? Colors.orange : variant === 'grey' ? Colors.cardBorder : bg;

  return (
    <TouchableOpacity
      testID={testID}
      style={[s.btn, { backgroundColor: bg, borderColor }, (disabled || loading) && s.disabled, style]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <Text style={[s.text, { color: textColor }]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  btn: {
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    paddingHorizontal: 24,
  },
  text: { fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
  disabled: { opacity: 0.5 },
});
