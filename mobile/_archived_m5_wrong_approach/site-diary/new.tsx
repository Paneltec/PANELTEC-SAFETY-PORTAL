/**
 * New Site Diary Entry — v58.13.132e
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Colors } from '../../src/theme/colors';
import { createItem } from '../../src/services/capture';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function NewSiteDiary() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState(today);
  const [rawNotes, setRawNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async (asDraft: boolean) => {
    if (!asDraft && !rawNotes.trim()) {
      Alert.alert('Required', 'Please enter diary notes');
      return;
    }
    setSubmitting(true);
    try {
      const userRaw = await AsyncStorage.getItem('paneltec_user');
      const user = userRaw ? JSON.parse(userRaw) : {};
      await createItem('site-diary', {
        workspace_id: user.active_company_id || '',
        date,
        raw_notes: rawNotes.trim() || 'N/A',
        status: asDraft ? 'draft' : 'submitted',
      });
      qc.invalidateQueries({ queryKey: ['capture', 'site-diary'] });
      Alert.alert(asDraft ? 'Draft saved' : 'Diary entry submitted', '', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.detail || 'Failed to save');
    }
    setSubmitting(false);
  }, [date, rawNotes, qc, router]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View testID="new-sitediary-screen" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity testID="new-diary-back" onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={22} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>New Diary Entry</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
          <View style={s.field}>
            <Text style={s.label}>Date</Text>
            <TextInput testID="diary-date-input" style={s.input} value={date}
              onChangeText={setDate} placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.placeholder} />
          </View>

          <View style={s.field}>
            <Text style={s.label}>Site Diary Notes *</Text>
            <TextInput testID="diary-notes-input" style={[s.input, s.inputLarge]} value={rawNotes}
              onChangeText={setRawNotes}
              placeholder="Weather conditions, work completed, visitors, deliveries, delays, safety observations..."
              multiline numberOfLines={8} placeholderTextColor={Colors.placeholder} />
          </View>

          <View style={{ height: 32 }} />
        </ScrollView>

        <View style={s.footer}>
          <TouchableOpacity testID="diary-save-draft" style={s.draftBtn}
            onPress={() => handleSubmit(true)} disabled={submitting}>
            <Text style={s.draftText}>Save as Draft</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="diary-submit-btn" style={[s.submitBtn, submitting && s.disabled]}
            onPress={() => handleSubmit(false)} disabled={submitting}>
            {submitting ? <ActivityIndicator color={Colors.white} /> :
              <Text style={s.submitText}>Submit Entry</Text>}
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
  form: { padding: 20 },
  field: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 6 },
  input: {
    backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1,
    borderColor: Colors.border, padding: 14, fontSize: 15, color: Colors.ink,
  },
  inputLarge: { minHeight: 200, textAlignVertical: 'top' },
  footer: {
    flexDirection: 'row', gap: 12, padding: 20,
    backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  draftBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 14,
    borderRadius: 12, borderWidth: 2, borderColor: Colors.border,
  },
  draftText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  submitBtn: {
    flex: 2, alignItems: 'center', paddingVertical: 14,
    borderRadius: 12, backgroundColor: '#2563EB',
  },
  disabled: { opacity: 0.5 },
  submitText: { fontSize: 15, fontWeight: '700', color: Colors.white },
});
