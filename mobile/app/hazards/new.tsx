/**
 * New Hazard Report — mockup #3 alignment.
 * v58.13.132f — 6 category cards with colour-coded left border,
 * big camera zone, severity chips, sticky orange Submit.
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

// ── Hazard categories with mockup #3 colour-coded left borders ──
const CATEGORIES = [
  { key: 'slip_trip', label: 'Slip / Trip / Fall', icon: 'footsteps-outline', color: '#EAB308' },
  { key: 'vehicle', label: 'Vehicle / Plant', icon: 'car-outline', color: '#F97316' },
  { key: 'environmental', label: 'Environmental', icon: 'leaf-outline', color: '#22C55E' },
  { key: 'electrical', label: 'Electrical', icon: 'flash-outline', color: '#EF4444' },
  { key: 'manual', label: 'Manual Handling', icon: 'hand-left-outline', color: '#3B82F6' },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline', color: '#94A3B8' },
] as const;

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const SEV_COLORS: Record<string, string> = {
  low: '#10B981', medium: '#F59E0B', high: '#F97316', critical: '#EF4444',
};

export default function NewHazard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();

  const [category, setCategory] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [severity, setSeverity] = useState<string>('medium');
  const [controls, setControls] = useState<string[]>([]);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [controlInput, setControlInput] = useState('');

  const handlePhoto = useCallback(async (uri: string) => {
    setPhotoUri(uri);
    setAiLoading(true);
    try {
      const analysis = await analyzePhoto(uri);
      setAiAnalysis(analysis);
      if (analysis.photo_url) setPhotoUrl(analysis.photo_url);
      if (analysis.severity) setSeverity(analysis.severity);
      if (analysis.summary && !title) setTitle(analysis.summary);
      if (analysis.suggested_controls?.length) {
        setControls((prev) => [...new Set([...prev, ...analysis.suggested_controls])]);
      }
    } catch {
      Alert.alert('AI Analysis', 'Photo analysis unavailable — fill in details manually');
    }
    setAiLoading(false);
  }, [title]);

  const addControl = () => {
    if (controlInput.trim()) {
      setControls((prev) => [...prev, controlInput.trim()]);
      setControlInput('');
    }
  };

  const removeControl = (idx: number) => {
    setControls((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = useCallback(async (asDraft: boolean) => {
    if (!asDraft && !title.trim()) {
      Alert.alert('Required', 'Please enter a title');
      return;
    }
    setSubmitting(true);
    try {
      const userRaw = await AsyncStorage.getItem('paneltec_user');
      const user = userRaw ? JSON.parse(userRaw) : {};
      await createItem('hazards', {
        workspace_id: user.active_company_id || '',
        title: title.trim() || 'Untitled Hazard',
        description: description.trim(),
        photo_url: photoUrl || null,
        location: location.trim() || null,
        severity,
        controls: [...(category ? [CATEGORIES.find(c => c.key === category)?.label || ''] : []), ...controls],
        status: asDraft ? 'open' : 'open',
        ai_analysis: aiAnalysis ? {
          identified_hazards: aiAnalysis.identified_hazards,
          suggested_controls: aiAnalysis.suggested_controls,
          severity: aiAnalysis.severity,
          summary: aiAnalysis.summary,
        } : null,
        reported_by: user.name || user.email || null,
      });
      qc.invalidateQueries({ queryKey: ['capture', 'hazards'] });
      Alert.alert(asDraft ? 'Draft saved' : 'Hazard reported', '', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.detail || 'Failed to save');
    }
    setSubmitting(false);
  }, [title, description, location, severity, controls, category, photoUrl, aiAnalysis, qc, router]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View testID="new-hazard-screen" style={[s.container, { paddingTop: insets.top }]}>
        {/* Navy header */}
        <View style={s.header}>
          <TouchableOpacity testID="new-hazard-back" onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={22} color={Colors.white} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>New Hazard Report</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
          {/* ── 6 Category tiles with colour-coded left border (mockup #3) ── */}
          <Text style={s.sectionLabel}>CATEGORY</Text>
          <View style={s.catGrid}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.key}
                testID={`hazard-cat-${cat.key}`}
                style={[
                  s.catCard,
                  { borderLeftColor: cat.color },
                  category === cat.key && { backgroundColor: cat.color + '14', borderColor: cat.color },
                ]}
                onPress={() => setCategory(cat.key === category ? '' : cat.key)}
              >
                <Ionicons name={cat.icon as any} size={20} color={cat.color} />
                <Text style={[s.catLabel, category === cat.key && { color: cat.color, fontWeight: '700' }]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Big camera zone ── */}
          <Text style={s.sectionLabel}>EVIDENCE PHOTO</Text>
          <PhotoCapture
            imageUri={photoUri}
            onImageCaptured={handlePhoto}
            onClear={() => { setPhotoUri(null); setAiAnalysis(null); setPhotoUrl(null); }}
            loading={aiLoading}
          />

          {/* ── AI Suggestions chips ── */}
          {aiAnalysis && (
            <View testID="ai-suggestions" style={s.aiCard}>
              <View style={s.aiHeader}>
                <Ionicons name="sparkles" size={16} color={Colors.orange} />
                <Text style={s.aiTitle}>AI Analysis</Text>
              </View>
              {aiAnalysis.identified_hazards.map((h, i) => (
                <View key={i} style={s.aiChip}>
                  <Ionicons name="alert-circle" size={14} color="#EF4444" />
                  <Text style={s.aiChipText}>{h}</Text>
                </View>
              ))}
              <View style={s.aiControlsRow}>
                {aiAnalysis.suggested_controls.map((c, i) => (
                  <TouchableOpacity
                    key={`c${i}`}
                    testID={`ai-control-${i}`}
                    style={[s.aiControlChip, controls.includes(c) && s.aiControlChipActive]}
                    onPress={() => {
                      if (!controls.includes(c)) setControls((prev) => [...prev, c]);
                    }}
                  >
                    <Ionicons name={controls.includes(c) ? 'checkmark-circle' : 'add-circle-outline'} size={14} color={controls.includes(c) ? Colors.success : Colors.orange} />
                    <Text style={s.aiControlText}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* ── Title ── */}
          <Text style={s.sectionLabel}>DETAILS</Text>
          <View style={s.fieldCard}>
            <Text style={s.fieldLabel}>Title *</Text>
            <TextInput testID="hazard-title-input" style={s.input} value={title}
              onChangeText={setTitle} placeholder="Brief hazard description"
              placeholderTextColor={Colors.placeholder} />
          </View>

          {/* ── Severity chips ── */}
          <View style={s.fieldCard}>
            <Text style={s.fieldLabel}>Severity</Text>
            <View style={s.sevRow}>
              {SEVERITIES.map((sev) => (
                <TouchableOpacity
                  key={sev}
                  testID={`severity-${sev}`}
                  style={[s.sevChip, severity === sev && { backgroundColor: SEV_COLORS[sev], borderColor: SEV_COLORS[sev] }]}
                  onPress={() => setSeverity(sev)}
                >
                  <Text style={[s.sevText, severity === sev && { color: Colors.white }]}>{sev}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ── Description ── */}
          <View style={s.fieldCard}>
            <Text style={s.fieldLabel}>Description</Text>
            <TextInput testID="hazard-desc-input" style={[s.input, s.inputMulti]} value={description}
              onChangeText={setDescription} placeholder="What was observed? What are the risks?"
              multiline numberOfLines={4} placeholderTextColor={Colors.placeholder} />
          </View>

          {/* ── Location ── */}
          <View style={s.fieldCard}>
            <Text style={s.fieldLabel}>Location</Text>
            <TextInput testID="hazard-location-input" style={s.input} value={location}
              onChangeText={setLocation} placeholder="e.g. Building A, Level 2"
              placeholderTextColor={Colors.placeholder} />
          </View>

          {/* ── Controls ── */}
          <View style={s.fieldCard}>
            <Text style={s.fieldLabel}>Controls</Text>
            <View style={s.controlsWrap}>
              {controls.map((c, i) => (
                <View key={i} style={s.controlTag}>
                  <Text style={s.controlTagText}>{c}</Text>
                  <TouchableOpacity onPress={() => removeControl(i)}>
                    <Ionicons name="close" size={14} color={Colors.textTertiary} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
            <View style={s.addControlRow}>
              <TextInput style={[s.input, { flex: 1 }]} value={controlInput}
                onChangeText={setControlInput} placeholder="Add a control measure"
                placeholderTextColor={Colors.placeholder} onSubmitEditing={addControl} />
              <TouchableOpacity testID="add-control-btn" style={s.addControlBtn} onPress={addControl}>
                <Ionicons name="add" size={20} color={Colors.white} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>

        {/* ── Sticky orange footer (mockup #3) ── */}
        <View style={s.footer}>
          <TouchableOpacity testID="hazard-save-draft" style={s.draftBtn}
            onPress={() => handleSubmit(true)} disabled={submitting}>
            <Text style={s.draftText}>Save Draft</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="hazard-submit-btn"
            style={[s.submitBtn, submitting && s.disabled]}
            onPress={() => handleSubmit(false)} disabled={submitting}>
            {submitting ? <ActivityIndicator color={Colors.white} /> : (
              <>
                <Ionicons name="shield-checkmark" size={18} color={Colors.white} />
                <Text style={s.submitText}>Submit Report</Text>
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
    backgroundColor: Colors.navy,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.white },
  form: { padding: 16, paddingBottom: 120 },
  sectionLabel: {
    fontSize: 11, fontWeight: '800', color: Colors.textTertiary,
    letterSpacing: 1.2, marginBottom: 10, marginTop: 20,
  },
  // ── Category tiles ──
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  catCard: {
    width: '47%', flexGrow: 1,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.surface, borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 14,
    borderLeftWidth: 4, borderWidth: 1, borderColor: Colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  catLabel: { fontSize: 13, fontWeight: '600', color: Colors.ink, flexShrink: 1 },
  // ── AI ──
  aiCard: {
    backgroundColor: '#FFFBEB', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#FDE68A', marginTop: 12,
  },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  aiTitle: { fontSize: 14, fontWeight: '700', color: Colors.orange },
  aiChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 },
  aiChipText: { fontSize: 13, color: '#991B1B', fontWeight: '500' },
  aiControlsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  aiControlChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#F0FDF4', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: '#BBF7D0',
  },
  aiControlChipActive: { backgroundColor: '#D1FAE5', borderColor: Colors.success },
  aiControlText: { fontSize: 12, color: '#166534', fontWeight: '500' },
  // ── Fields ──
  fieldCard: {
    backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 0.5, marginBottom: 8 },
  input: {
    backgroundColor: Colors.bg, borderRadius: 12, borderWidth: 1,
    borderColor: Colors.border, padding: 14, fontSize: 15, color: Colors.ink,
  },
  inputMulti: { minHeight: 100, textAlignVertical: 'top' },
  sevRow: { flexDirection: 'row', gap: 8 },
  sevChip: {
    flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12,
    borderWidth: 2, borderColor: Colors.border,
  },
  sevText: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, textTransform: 'capitalize' },
  controlsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  controlTag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.successSoft, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  controlTagText: { fontSize: 13, color: '#059669', fontWeight: '600' },
  addControlRow: { flexDirection: 'row', gap: 8 },
  addControlBtn: {
    width: 48, height: 48, borderRadius: 12, backgroundColor: Colors.orange,
    alignItems: 'center', justifyContent: 'center',
  },
  // ── Footer ──
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 12, padding: 16, paddingBottom: 32,
    backgroundColor: Colors.surface,
    borderTopWidth: 1, borderTopColor: Colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08, shadowRadius: 8, elevation: 8,
  },
  draftBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 16,
    borderRadius: 14, borderWidth: 2, borderColor: Colors.border,
  },
  draftText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  submitBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 16,
    borderRadius: 14, backgroundColor: Colors.orange,
  },
  disabled: { opacity: 0.5 },
  submitText: { fontSize: 15, fontWeight: '700', color: Colors.white },
});
