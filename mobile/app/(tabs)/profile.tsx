/**
 * Profile tab — placeholder for M6.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import Wordmark from '../../src/components/Wordmark';
import { logout } from '../../src/services/auth';
import { MOBILE_BUNDLE_VERSION } from '../../src/lib/version';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    router.replace('/');
  };

  return (
    <View testID="profile-screen" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Profile</Text>
      </View>
      <View style={s.placeholder}>
        <Text style={s.title}>Profile</Text>
        <View style={s.badge}>
          <Text style={s.badgeText}>Coming in Phase M-6</Text>
        </View>
        <Text style={s.desc}>Your profile, certifications, settings, and team management.</Text>

        <TouchableOpacity testID="logout-btn" style={s.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color={Colors.error} />
          <Text style={s.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
      <View style={s.footer}>
        <Wordmark size="sm" color={Colors.border} showSubtitle={false} />
        <Text style={s.version}>{MOBILE_BUNDLE_VERSION}</Text>
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
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 24,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.errorSoft,
  },
  logoutText: { fontSize: 15, fontWeight: '600', color: Colors.error },
  footer: { alignItems: 'center', paddingBottom: 100, gap: 8, opacity: 0.3 },
  version: { fontSize: 10, color: Colors.textTertiary },
});
