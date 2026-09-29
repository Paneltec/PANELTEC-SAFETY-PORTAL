/**
 * Site Diary — Phase 4.
 * Raw notes + optional AI structuring → save.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, C } from '../../src/theme/colors';
import { createItem } from '../../src/services/capture';
import { authPost } from '../../src/services/apiClient';
import { getStoredUser } from '../../src/services/auth';

export default function DiaryCapture() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const today = new Date().toISOString().slice(0, 10);
  const [date] = useState(today);
  const [rawNotes, setRawNotes] = useState('');
  const [structuredLog, setStructuredLog] = useState<Record<string, any> | null>(null);
  const [structuring, setStructuring] = useState(false);
  const [structureError, setStructureError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleStructure = async () => {
    if (!rawNotes.trim()) {
      Alert.alert('Required', 'Enter some notes first to structure with AI.');
      return;
    }
    setStructuring(true);
    setStructureError('');
    try {
      const res = await authPost<any>('/api/ai/diary-structure', {
        raw_notes: rawNotes.trim(),
        date,
      });
      if (res.ok && res.data) {
        setStructuredLog(res.data);
      } else {
        const errMsg = 'error' in res ? res.error : 'AI structuring failed';
        setStructureError(errMsg);
      }
    } catch (err: any) {
      setStructureError(err?.message || 'AI structuring failed');
    }
    setStructuring(false);
  };

  const handleSave = async (withStructure: boolean) => {
    if (!rawNotes.trim()) {
      Alert.alert('Required', 'Please enter your site diary notes.');
      return;
    }
    setSaving(true);
    try {
      const user = await getStoredUser();
      await createItem('site-diary', {
        workspace_id: user?.org_id || 'default',
        date,
        raw_notes: rawNotes.trim(),
        structured_log: withStructure ? structuredLog : undefined,
      });
      Alert.alert('Saved', 'Site diary entry submitted.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to save diary entry.');
    }
    setSaving(false);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <View testID="diary-capture" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity testID="diary-back" onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.white} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Site Diary</Text>
        </View>

        <ScrollView contentContainerStyle={s.formScroll} keyboardShouldPersistTaps="handled">
          <Text style={s.label}>Date</Text>
          <View style={s.dateRow}>
            <Ionicons name="calendar-outline" size={18} color={Colors.orange} />
            <Text style={s.dateText}>{date}</Text>
          </View>

          <Text style={s.label}>Raw Notes *</Text>
          <TextInput
            testID="diary-notes-input"
            style={[s.input, s.bigMultiline]}
            value={rawNotes}
            onChangeText={setRawNotes}
            placeholder="Write your site diary notes for today..."
            placeholderTextColor={C.card.textLabel}
            multiline
            numberOfLines={8}
          />

          <View style={s.aiRow}>
            <TouchableOpacity
              testID="diary-structure-btn"
              style={s.aiBtn}
              onPress={handleStructure}
              disabled={structuring || !rawNotes.trim()}
              activeOpacity={0.7}
            >
              {structuring ? (
                <ActivityIndicator size="small" color="#7C3AED" />
              ) : (
                <Ionicons name="sparkles" size={18} color="#7C3AED" />
              )}
              <Text style={s.aiBtnText}>
                {structuring ? 'Structuring…' : 'Structure with AI ✨'}
              </Text>
            </TouchableOpacity>
          </View>

          {structureError ? (
            <View style={s.errorBanner}>
              <Ionicons name="alert-circle" size={16} color="#F59E0B" />
              <Text style={s.errorText}>{structureError}</Text>
            </View>
          ) : null}

          {structuredLog && (
            <View testID="diary-structured-output" style={s.structuredCard}>
              <View style={s.structuredHeader}>
                <Ionicons name="sparkles" size={16} color="#7C3AED" />
                <Text style={s.structuredTitle}>AI-Structured Output</Text>
              </View>
              {Object.entries(structuredLog).map(([key, value]) => {
                if (key === 'date' || key === 'raw_notes') return null;
                return (
                  <View key={key} style={s.structuredRow}>
                    <Text style={s.structuredLabel}>
                      {key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    </Text>
                    <Text style={s.structuredValue}>
                      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          <View style={s.actionRow}>
            {structuredLog && (
              <TouchableOpacity
                testID="diary-save-structured"
                style={s.saveBtn}
                onPress={() => handleSave(true)}
                disabled={saving}
                activeOpacity={0.7}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <>
                    <Ionicons name="sparkles" size={18} color={Colors.white} />
                    <Text style={s.saveBtnText}>Save with AI Structure</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              testID="diary-save-raw"
              style={[s.saveRawBtn, structuredLog && { flex: 1 }]}
              onPress={() => handleSave(false)}
              disabled={saving}
              activeOpacity={0.7}
            >
              {saving ? (
                <ActivityIndicator size="small" color={Colors.info} />
              ) : (
                <Text style={s.saveRawBtnText}>
                  {structuredLog ? 'Save without AI' : 'Save Diary Entry'}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.screen.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.screen.bar, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14,
  },
  backBtn: { padding: 4, marginRight: 8 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: C.textOnNavy.main, flex: 1 },
  formScroll: { padding: 16, paddingBottom: 32 },

  label: {
    fontSize: 12, fontWeight: '700', color: C.textOnNavy.secondary,
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6, marginTop: 14,
  },
  input: {
    backgroundColor: C.card.bg, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: C.card.textMain, borderWidth: 1, borderColor: C.card.border,
  },
  bigMultiline: { minHeight: 180, textAlignVertical: 'top' },

  dateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.card.bg, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.card.border,
  },
  dateText: { fontSize: 15, fontWeight: '600', color: C.card.textMain },

  aiRow: { marginTop: 14, alignItems: 'flex-start' },
  aiBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F5F3FF', borderRadius: 12,
    paddingHorizontal: 18, paddingVertical: 12,
    borderWidth: 1.5, borderColor: '#7C3AED40',
    minHeight: 48,
  },
  aiBtnText: { fontSize: 14, fontWeight: '700', color: '#7C3AED' },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FEF3C7', borderRadius: 10, padding: 12, marginTop: 12,
    borderWidth: 1, borderColor: '#F59E0B',
  },
  errorText: { fontSize: 13, color: '#92400E', flex: 1 },

  structuredCard: {
    backgroundColor: '#F5F3FF', borderRadius: 16, padding: 16, marginTop: 16,
    borderWidth: 1, borderColor: '#7C3AED30',
  },
  structuredHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  structuredTitle: { fontSize: 14, fontWeight: '700', color: '#7C3AED' },
  structuredRow: { marginBottom: 10 },
  structuredLabel: {
    fontSize: 11, fontWeight: '700', color: '#7C3AED', textTransform: 'uppercase',
    letterSpacing: 0.5, marginBottom: 2,
  },
  structuredValue: { fontSize: 14, color: C.card.textMain, lineHeight: 20 },

  actionRow: { marginTop: 24, gap: 10 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#7C3AED', borderRadius: 16, paddingVertical: 18, minHeight: 56,
  },
  saveBtnText: { color: Colors.white, fontSize: 16, fontWeight: '800' },
  saveRawBtn: {
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: `${Colors.info}40`, borderRadius: 16,
    paddingVertical: 16, backgroundColor: 'rgba(59,130,246,0.06)', minHeight: 52,
  },
  saveRawBtnText: { color: Colors.info, fontSize: 15, fontWeight: '700' },
});
