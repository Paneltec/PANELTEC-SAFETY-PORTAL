/**
 * Home tab — placeholder for M2.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../src/theme/colors';
import Wordmark from '../../src/components/Wordmark';
import CompanyPill from '../../src/components/CompanyPill';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View testID="home-screen" style={[s.container, { paddingTop: insets.top + 12 }]}>
      <View style={s.header}>
        <Wordmark size="sm" color={Colors.navy} showSubtitle={false} />
        <CompanyPill />
      </View>
      <View style={s.placeholder}>
        <Text style={s.title}>Home</Text>
        <View style={s.badge}>
          <Text style={s.badgeText}>Coming in Phase M-2</Text>
        </View>
        <Text style={s.desc}>
          Dashboard with today&apos;s briefing, compliance snapshot, active sites, and quick actions.
        </Text>
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
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.ink },
  badge: {
    backgroundColor: Colors.orangeSoft, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  badgeText: { fontSize: 12, fontWeight: '700', color: Colors.orange },
  desc: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22, maxWidth: 280 },
  watermark: { position: 'absolute', bottom: 100, alignSelf: 'center', opacity: 0.3 },
});
