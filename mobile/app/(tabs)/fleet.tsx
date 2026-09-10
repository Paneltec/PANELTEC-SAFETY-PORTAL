/**
 * Fleet — v58.13.132cz
 * Placeholder for fleet management screen.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';

export default function FleetScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View testID="fleet-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Fleet</Text>
        <Text style={s.headerSub}>Vehicles & equipment assigned to you</Text>
      </View>
      <View style={s.center}>
        <View style={s.iconCircle}>
          <Ionicons name="car-outline" size={40} color={Colors.orange} />
        </View>
        <Text style={s.title}>Fleet Register</Text>
        <Text style={s.subtitle}>
          Your assigned vehicles and their pre-start status will appear here.
        </Text>
        <View style={s.comingSoon}>
          <Text style={s.comingSoonText}>Coming soon</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.navy },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  headerTitle: { color: Colors.white, fontSize: 22, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: '500', marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  iconCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(249,115,22,0.12)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  title: { fontSize: 20, fontWeight: '800', color: Colors.white, marginBottom: 8 },
  subtitle: {
    fontSize: 13, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 20,
  },
  comingSoon: {
    marginTop: 16, backgroundColor: 'rgba(249,115,22,0.15)', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(249,115,22,0.3)',
  },
  comingSoonText: { fontSize: 12, fontWeight: '700', color: Colors.orange },
});
