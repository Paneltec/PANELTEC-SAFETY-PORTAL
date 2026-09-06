/**
 * Pre-Start tab — placeholder for M5.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../src/theme/colors';
import Wordmark from '../../src/components/Wordmark';

export default function PrestartScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View testID="prestart-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Pre-Start</Text>
      </View>
      <View style={s.placeholder}>
        <Text style={s.title}>Pre-Start</Text>
        <View style={s.badge}>
          <Text style={s.badgeText}>Coming in Phase M-5</Text>
        </View>
        <Text style={s.desc}>Daily pre-start checklists for vehicles and equipment before operations begin.</Text>
      </View>
      <View style={s.watermark}>
        <Wordmark size="sm" color={Colors.border} showSubtitle={false} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.ink },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.ink },
  badge: { backgroundColor: Colors.orangeSoft, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  badgeText: { fontSize: 12, fontWeight: '700', color: Colors.orange },
  desc: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22, maxWidth: 280 },
  watermark: { position: 'absolute', bottom: 100, alignSelf: 'center', opacity: 0.3 },
});
