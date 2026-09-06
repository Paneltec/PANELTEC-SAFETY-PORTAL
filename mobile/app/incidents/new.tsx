/**
 * New Incident — with AI photo analysis + category pre-fill.
 * v58.13.132e
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
import PhotoCapture from '../../src/components/PhotoCapture';
import { createItem, analyzePhoto, type AIAnalysis } from '../../src/services/capture';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CATEGORIES = ['near_miss', 'first_aid', 'medical', 'ltc', 'env', 'property'] as const;
const CAT_LABELS: Record<string, string> = {
  near_miss: 'Near Miss', first_aid: 'First Aid', medical: 'Medical Treatment',
  ltc: 'Lost Time', env: 'Environmental', property: 'Property Damage',
};

export default function NewIncident() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState<string>('near_miss');
  const [immediateActions, setImmediateActions] = useState('');
  const [personInvolved, setPersonInvolved] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handlePhoto = useCallback(async (uri: string) => {
    setPhotoUri(uri);
    setAiLoading(true);
    try {
      const analysis = await analyzePhoto(uri);
      setAiAnalysis(analysis);
      if (analysis.photo_url) setPhotoUrl(analysis.photo_url);
      if (analysis.summary && !title) setTitle(analysis.summary);
    } catch {
      // AI unavailable — continue without analysis
    }
    setAiLoading(false);
  }, [title]);

  const handleSubmit = useCallback(async (asDraft: boolean) => {
    if (!asDraft && !title.trim()) {
      Alert.alert('Required', 'Please enter a title');
      return;
    }
    setSubmitting(true);
    try {
      const userRaw = await AsyncStorage.getItem('paneltec_user');
      const user = userRaw ? JSON.parse(userRaw) : {};
      await createItem('incidents', {
        workspace_id: user.active_company_id || '',
        title: title.trim() || 'Untitled Incident',
        occurred_at: new Date().toISOString(),
        location: location.trim() || null,
        category,
        description: description.trim(),
        immediate_actions: immediateActions.trim(),
        evidence_photos: photoUrl ? [photoUrl] : [],
        follow_up_actions: [],
        follow_up_status: asDraft ? 'open' : 'open',  // IncidentStatus: open|in_progress|closed
        person_involved: personInvolved.trim() || null,
      });
      qc.invalidateQueries({ queryKey: ['capture', 'incidents'] });
      Alert.alert(asDraft ? 'Draft saved' : 'Incident reported', '', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.detail || 'Failed to save');
    }
    setSubmitting(false);
  }, [title, description, location, category, immediateActions, personInvolved, photoUrl, qc, router]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View testID="new-incident-screen" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity testID="new-incident-back" onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={22} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>New Incident Report</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
          <PhotoCapture
            imageUri={photoUri}
            onImageCaptured={handlePhoto}
            onClear={() => { setPhotoUri(null); setAiAnalysis(null); setPhotoUrl(null); }}
            loading={aiLoading}
            label="Evidence photo (AI will analyze)"
          />

          {aiAnalysis && (
            <View testID="incident-ai-suggestions" style={s.aiCard}>
              <View style={s.aiHeader}>
                <Ionicons name="sparkles" size={16} color={Colors.orange} />
                <Text style={s.aiTitle}>AI Analysis</Text>
              </View>
              {aiAnalysis.identified_hazards.map((h, i) => (
                <Text key={i} style={s.aiItem}>⚠️ {h}</Text>
              ))}
            </View>
          )}

          <View style={s.field}>
            <Text style={s.label}>Title *</Text>
            <TextInput testID="incident-title-input" style={s.input} value={title}
              onChangeText={setTitle} placeholder="Brief incident description"
              placeholderTextColor={Colors.placeholder} />
          </View>

          <View style={s.field}>
            <Text style={s.label}>Category</Text>
            <View style={s.catRow}>
              {CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat} testID={`category-${cat}`}
                  style={[s.catChip, category === cat && s.catChipActive]}
                  onPress={() => setCategory(cat)}
                >
                  <Text style={[s.catText, category === cat && s.catTextActive]}>
                    {CAT_LABELS[cat]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={s.field}>
            <Text style={s.label}>Description</Text>
            <TextInput testID="incident-desc-input" style={[s.input, s.inputMulti]} value={description}
              onChangeText={setDescription} placeholder="What happened?"
              multiline numberOfLines={4} placeholderTextColor={Colors.placeholder} />
          </View>

          <View style={s.field}>
            <Text style={s.label}>Location</Text>
            <TextInput style={s.input} value={location}
              onChangeText={setLocation} placeholder="Where did it occur?"
              placeholderTextColor={Colors.placeholder} />
          </View>

          <View style={s.field}>
            <Text style={s.label}>Person involved</Text>
            <TextInput style={s.input} value={personInvolved}
              onChangeText={setPersonInvolved} placeholder="Name of person(s) involved"
              placeholderTextColor={Colors.placeholder} />
          </View>

          <View style={s.field}>
            <Text style={s.label}>Immediate actions taken</Text>
            <TextInput style={[s.input, s.inputMulti]} value={immediateActions}
              onChangeText={setImmediateActions} placeholder="What was done immediately?"
              multiline numberOfLines={3} placeholderTextColor={Colors.placeholder} />
          </View>

          <View style={{ height: 32 }} />
        </ScrollView>

        <View style={s.footer}>
          <TouchableOpacity testID="incident-save-draft" style={s.draftBtn}
            onPress={() => handleSubmit(true)} disabled={submitting}>
            <Text style={s.draftText}>Save as Draft</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="incident-submit-btn" style={[s.submitBtn, submitting && s.disabled]}
            onPress={() => handleSubmit(false)} disabled={submitting}>
            {submitting ? <ActivityIndicator color={Colors.white} /> :
              <Text style={s.submitText}>Submit Report</Text>}
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
  inputMulti: { minHeight: 100, textAlignVertical: 'top' },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    borderWidth: 2, borderColor: Colors.border,
  },
  catChipActive: { backgroundColor: '#DC2626', borderColor: '#DC2626' },
  catText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  catTextActive: { color: Colors.white },
  aiCard: {
    backgroundColor: '#FFFBEB', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#FDE68A', marginBottom: 16,
  },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  aiTitle: { fontSize: 14, fontWeight: '700', color: Colors.orange },
  aiItem: { fontSize: 13, color: '#991B1B', marginBottom: 4 },
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
    borderRadius: 12, backgroundColor: '#DC2626',
  },
  disabled: { opacity: 0.5 },
  submitText: { fontSize: 15, fontWeight: '700', color: Colors.white },
});
