import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getUser, signOut, initials } from '../../src/lib/auth';
import { Colors } from '../../src/lib/colors';

export default function SettingsScreen() {
  const router = useRouter();
  const { setAuth } = useAuth();
  const [user, setUser] = useState<any>(null);

  useEffect(() => { getUser().then(setUser); }, []);

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out', style: 'destructive',
        onPress: async () => {
          await signOut();
          setAuth(false);
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView testID="settings-page" style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.overline}>SETTINGS</Text>
        <Text style={styles.heading}>Settings</Text>

        {user && (
          <View style={styles.profileCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(user)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.profileName}>{user.name || 'User'}</Text>
              <Text style={styles.profileEmail}>{user.email}</Text>
              <Text style={styles.profileRole}>{(user.role || '').toUpperCase()}</Text>
            </View>
          </View>
        )}

        <View style={styles.section}>
          {[
            { label: 'Organisation', icon: 'business' as const },
            { label: 'Workspaces', icon: 'layers' as const },
            { label: 'Integrations', icon: 'extension-puzzle' as const },
            { label: 'Users', icon: 'people' as const },
          ].map((item) => (
            <TouchableOpacity key={item.label} style={styles.row} activeOpacity={0.7}>
              <Ionicons name={item.icon} size={20} color={Colors.textSecondary} />
              <Text style={styles.rowText}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity testID="sign-out-btn" style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.7}>
          <Ionicons name="log-out" size={20} color={Colors.red} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  overline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.blue },
  heading: { fontSize: 28, fontWeight: '700', color: Colors.ink, marginTop: 4, letterSpacing: -0.5, marginBottom: 20 },
  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 16, padding: 16, marginBottom: 20,
  },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.blue, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  profileName: { fontSize: 18, fontWeight: '600', color: Colors.ink },
  profileEmail: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  profileRole: { fontSize: 10, fontWeight: '700', color: Colors.blue, letterSpacing: 0.8, marginTop: 4 },
  section: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 16, overflow: 'hidden', marginBottom: 20,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  rowText: { flex: 1, fontSize: 15, color: Colors.text },
  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#FFF5F5',
  },
  signOutText: { fontSize: 15, fontWeight: '600', color: Colors.red },
});
