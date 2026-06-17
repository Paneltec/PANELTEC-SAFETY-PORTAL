import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../lib/colors';

/** Inline read-only notice shown when user lacks edit permission */
export default function ReadOnlyBanner() {
  return (
    <View testID="read-only-banner" style={s.banner}>
      <Ionicons name="lock-closed" size={14} color="#B45309" />
      <Text style={s.text}>Read-only — contact your admin for edit access.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 12, backgroundColor: Colors.amberSoft,
    borderWidth: 1, borderColor: '#FDE68A', marginBottom: 12,
  },
  text: { fontSize: 13, color: '#B45309', flex: 1 },
});
