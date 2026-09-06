/**
 * My Fleet — placeholder for M5.
 * v58.13.132b
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';

export default function MyFleetScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View testID="my-fleet-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity
          testID="my-fleet-back-btn"
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/home')}
          style={s.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>My Fleet</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={s.placeholder}>
        <Ionicons name="car-outline" size={48} color={Colors.textTertiary} />
        <Text style={s.title}>My Fleet</Text>
        <View style={s.badge}>
          <Text style={s.badgeText}>Coming in Phase M-5</Text>
        </View>
        <Text style={s.desc}>
          View your assigned vehicles, pre-starts, and fleet status at a glance.
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.ink },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  title: { fontSize: 24, fontWeight: '800', color: Colors.ink },
  badge: { backgroundColor: Colors.orangeSoft, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  badgeText: { fontSize: 12, fontWeight: '700', color: Colors.orange },
  desc: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22, maxWidth: 280 },
});
