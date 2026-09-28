/**
 * Phase 4 — Site Diary form.
 * Raw notes + optional AI structuring → save.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { civilPost, getDefaultWorkspaceId } from '../../src/services/civilApi';

const BLUE = '#2C6BFF';
const VIOLET = '#7C3AED';
const GREEN = '#10B981';
const BG = '#F8FAFC';
const INK = '#0F172A';
const MUTED = '#64748B';

export default function DiaryNewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [date] = useState(new Date().toISOString().split('T')[0]);
  const [rawNotes, setRawNotes] = useState('');
  const [structuredLog, setStructuredLog] = useState<any>(null);
  const [structuring, setStructuring] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleStructure = async () => {
    if (!rawNotes.trim()) {
      Alert.alert('Required', 'Enter some notes first.');
      return;
    }
    setStructuring(true);
    const res = await civilPost('/ai/diary-structure', { raw_notes: rawNotes.trim() });
    setStructuring(false);
    if (res.ok && res.data) {
      setStructuredLog(res.data);
    } else {
      Alert.alert('AI Unavailable', 'Could not structure notes. You can still save them as-is.');
    }
  };

  const handleSave = async (withAi: boolean) => {
    if (!rawNotes.trim()) {
      Alert.alert('Required', 'Enter some notes.');
      return;
    }
    setSaving(true);
    const wsId = await getDefaultWorkspaceId();
    const res = await civilPost('/site-diary', {
      date,
      raw_notes: rawNotes.trim(),
      structured_log: withAi && structuredLog ? structuredLog : null,
      workspace_id: wsId,
    });
    setSaving(false);
    if (res.ok) {
      Alert.alert('Saved', 'Site diary entry created.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } else {
      Alert.alert('Error', res.error || 'Failed to save.');
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View testID="diary-screen" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity testID="diary-back-btn" onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={INK} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Site Diary</Text>
        </View>

        <ScrollView contentContainerStyle={s.formContent} keyboardShouldPersistTaps="handled">
          {/* Date */}
          <Text style={s.label}>Date</Text>
          <View style={s.dateBox}>
            <Ionicons name="calendar-outline" size={18} color={MUTED} />
            <Text testID="diary-date" style={s.dateText}>{date}</Text>
          </View>

          {/* Raw notes */}
          <Text style={s.label}>Daily Notes</Text>
          <TextInput
            testID="diary-notes-input"
            style={[s.input, s.textarea]}
            value={rawNotes}
            onChangeText={setRawNotes}
            placeholder="Write your daily site notes here..."
            placeholderTextColor="#94A3B8"
            multiline
          />

          {/* AI Structure button */}
          <TouchableOpacity
            testID="diary-structure-btn"
            style={s.aiBtn}
            onPress={handleStructure}
            disabled={structuring}
          >
            {structuring ? (
              <ActivityIndicator color={VIOLET} size="small" />
            ) : (
              <>
                <Ionicons name="sparkles" size={18} color={VIOLET} />
                <Text style={s.aiBtnText}>Structure with AI ✨</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Structured output */}
          {structuredLog && (
            <View testID="diary-structured-output" style={s.structuredCard}>
              <View style={s.structuredHeader}>
                <Ionicons name="sparkles" size={16} color={VIOLET} />
                <Text style={s.structuredTitle}>AI Structured Log</Text>
              </View>
              {typeof structuredLog === 'object' ? (
                Object.entries(structuredLog).map(([key, val]) => (
                  <View key={key} style={s.structuredRow}>
                    <Text style={s.structuredKey}>{key.replace(/_/g, ' ')}</Text>
                    <Text style={s.structuredVal}>
                      {typeof val === 'string' ? val : JSON.stringify(val)}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={s.structuredVal}>{String(structuredLog)}</Text>
              )}
            </View>
          )}

          {/* Save buttons */}
          {structuredLog ? (
            <TouchableOpacity
              testID="diary-save-with-ai-btn"
              style={[s.saveBtn, saving && s.saveBtnDisabled]}
              onPress={() => handleSave(true)}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color="#FFF" /> : (
                <Text style={s.saveBtnText}>Save with AI Structure</Text>
              )}
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            testID="diary-save-without-ai-btn"
            style={[s.saveNoAiBtn, saving && s.saveBtnDisabled]}
            onPress={() => handleSave(false)}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color={BLUE} /> : (
              <Text style={s.saveNoAiBtnText}>
                {structuredLog ? 'Save without AI' : 'Save Diary Entry'}
              </Text>
            )}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFF', paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#E5E7EB', gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: INK },
  formContent: { padding: 16, paddingBottom: 32 },

  label: { fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: '#FFF', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0',
    paddingHorizontal: 14, paddingVertical: 14, fontSize: 15, color: INK, marginBottom: 8,
  },
  textarea: { minHeight: 140, textAlignVertical: 'top' },
  dateBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFF', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0',
    paddingHorizontal: 14, paddingVertical: 14, marginBottom: 8,
  },
  dateText: { fontSize: 15, fontWeight: '600', color: INK },

  aiBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#F5F3FF', borderRadius: 14, paddingVertical: 14, marginTop: 8,
    borderWidth: 1, borderColor: '#E9E5FF', minHeight: 52,
  },
  aiBtnText: { fontSize: 15, fontWeight: '700', color: VIOLET },

  structuredCard: {
    backgroundColor: '#F5F3FF', borderRadius: 14, padding: 16, marginTop: 16,
    borderWidth: 1, borderColor: '#E9E5FF',
  },
  structuredHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  structuredTitle: { fontSize: 14, fontWeight: '700', color: VIOLET },
  structuredRow: { marginBottom: 8 },
  structuredKey: { fontSize: 12, fontWeight: '700', color: '#4B5563', textTransform: 'capitalize', marginBottom: 2 },
  structuredVal: { fontSize: 14, color: INK, lineHeight: 20 },

  saveBtn: {
    backgroundColor: VIOLET, borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    marginTop: 16, minHeight: 56,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
  saveNoAiBtn: {
    borderWidth: 1.5, borderColor: BLUE, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginTop: 10, backgroundColor: '#FFF', minHeight: 56,
  },
  saveNoAiBtnText: { fontSize: 16, fontWeight: '700', color: BLUE },
});
