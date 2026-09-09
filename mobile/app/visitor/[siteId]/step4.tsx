/**
 * Visitor Step 4 — Escort details + complete sign-in.
 * v58.13.132d — Reconciled to use existing visitor_signins.py endpoint.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Switch, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Colors } from '../../../src/theme/colors';
import { visitorSignIn } from '../../../src/services/sites';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function VisitorStep4() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { siteId, scanToken } = useLocalSearchParams<{ siteId: string; scanToken: string }>();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [purpose, setPurpose] = useState('');
  const [escort, setEscort] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hostName, setHostName] = useState('');

  // Load host from stored session
  React.useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('paneltec_user');
        if (raw) {
          const u = JSON.parse(raw);
          setHostName(u.name || u.email || 'Current user');
        }
      } catch { /* ok */ }
    })();
  }, []);

  const canSubmit = name.trim().length > 0 && !!scanToken;

  const handleComplete = useCallback(async () => {
    if (!canSubmit || !scanToken) return;
    setLoading(true);
    try {
      // Use the existing public visitor sign-in endpoint
      await visitorSignIn(scanToken, {
        name: name.trim(),
        company: company.trim() || undefined,
        phone: phone.trim() || undefined,
        purpose: purpose.trim() || undefined,
        visiting_person: hostName || undefined,
        induction_acknowledged: true,
      });
      qc.invalidateQueries({ queryKey: ['mobile-home'] });
      Alert.alert('Visitor signed in', `${name} has been signed in successfully`, [
        { text: 'OK', onPress: () => router.replace('/(tabs)/home') },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.detail || 'Failed to sign in visitor');
    }
    setLoading(false);
  }, [canSubmit, scanToken, name, company, phone, purpose, hostName, qc, router]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <View testID="visitor-step4" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity testID="visitor-step4-back" onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={22} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Escort Details</Text>
          <Text style={s.step}>4 / 4</Text>
        </View>

        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.title}>Visitor Details</Text>
          <Text style={s.sub}>Enter the visitor's information</Text>

          <View style={s.field}>
            <Text style={s.label}>Full name *</Text>
            <TextInput testID="visitor-name-input" style={s.input} value={name}
              onChangeText={setName} placeholder="John Smith" placeholderTextColor={Colors.placeholder} />
          </View>

          <View style={s.field}>
            <Text style={s.label}>Company</Text>
            <TextInput testID="visitor-company-input" style={s.input} value={company}
              onChangeText={setCompany} placeholder="Acme Inspections" placeholderTextColor={Colors.placeholder} />
          </View>

          <View style={s.field}>
            <Text style={s.label}>Phone</Text>
            <TextInput testID="visitor-phone-input" style={s.input} value={phone}
              onChangeText={setPhone} placeholder="0400 000 000" keyboardType="phone-pad"
              placeholderTextColor={Colors.placeholder} />
          </View>

          <View style={s.field}>
            <Text style={s.label}>Purpose of visit</Text>
            <TextInput testID="visitor-purpose-input" style={[s.input, s.inputMulti]} value={purpose}
              onChangeText={setPurpose} placeholder="Safety audit, delivery, inspection..."
              multiline numberOfLines={3} placeholderTextColor={Colors.placeholder} />
          </View>

          <View style={s.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.switchLabel}>Requires escort</Text>
              <Text style={s.switchSub}>Visitor must be accompanied at all times</Text>
            </View>
            <Switch testID="visitor-escort-toggle"
              value={escort} onValueChange={setEscort}
              trackColor={{ false: Colors.border, true: Colors.orange }}
              thumbColor={Colors.white} />
          </View>

          <View style={s.hostRow}>
            <Ionicons name="person-circle" size={20} color={Colors.orange} />
            <Text style={s.hostLabel}>Host: {hostName || 'Loading...'}</Text>
          </View>

          {!scanToken && (
            <View style={s.warnRow}>
              <Ionicons name="warning-outline" size={16} color={Colors.warning} />
              <Text style={s.warnText}>Missing scan token — visitor sign-in may not work. Ask your admin to generate a QR code for this site.</Text>
            </View>
          )}
        </ScrollView>

        <View style={s.footer}>
          <TouchableOpacity testID="visitor-back-step4" style={s.backBtnFooter} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={18} color={Colors.textSecondary} />
            <Text style={s.backText}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="visitor-complete-btn"
            style={[s.completeBtn, (!canSubmit || loading) && s.disabled]}
            disabled={!canSubmit || loading}
            onPress={handleComplete}
          >
            {loading ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color={Colors.white} />
                <Text style={s.completeText}>Complete sign-in</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
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
  step: { fontSize: 14, fontWeight: '600', color: Colors.textTertiary },
  content: { padding: 24 },
  title: { fontSize: 22, fontWeight: '800', color: Colors.ink },
  sub: { fontSize: 14, color: Colors.textSecondary, marginTop: 4, marginBottom: 24 },
  field: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 6 },
  input: {
    backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1,
    borderColor: Colors.border, padding: 14, fontSize: 15, color: Colors.ink,
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  switchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 16,
  },
  switchLabel: { fontSize: 15, fontWeight: '600', color: Colors.ink },
  switchSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  hostRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.orangeSoft, borderRadius: 10, padding: 12,
  },
  hostLabel: { fontSize: 14, fontWeight: '600', color: Colors.orange },
  warnRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.warningSoft, borderRadius: 10, padding: 12, marginTop: 12,
  },
  warnText: { fontSize: 12, color: Colors.warning, flex: 1 },
  footer: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, backgroundColor: Colors.surface,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  backBtnFooter: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 12 },
  backText: { fontSize: 15, color: Colors.textSecondary, fontWeight: '500' },
  completeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.orange, borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 12,
  },
  disabled: { opacity: 0.4 },
  completeText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
});
