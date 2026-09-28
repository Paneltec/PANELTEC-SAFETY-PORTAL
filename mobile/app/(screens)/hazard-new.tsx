/**
 * Phase 4 — Hazard report from photo.
 * Camera → AI analysis → pre-filled form → save.
 */
import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Image, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { civilPostForm, civilPost, getDefaultWorkspaceId } from '../../src/services/civilApi';

const BLUE = '#2C6BFF';
const AMBER = '#F59E0B';
const VIOLET = '#7C3AED';
const GREEN = '#10B981';
const RED = '#EF4444';
const BG = '#F8FAFC';
const INK = '#0F172A';
const MUTED = '#64748B';

const SEVERITY_OPTIONS = ['low', 'medium', 'high', 'critical'];

export default function HazardNewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [controls, setControls] = useState<string[]>([]);
  const [newControl, setNewControl] = useState('');
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<'photo' | 'form'>('photo');

  const takePhoto = async () => {
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setPhotoUri(uri);
      analyzePhoto(uri);
    }
  };

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.7,
      allowsEditing: false,
      mediaTypes: ['images'],
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setPhotoUri(uri);
      analyzePhoto(uri);
    }
  };

  const analyzePhoto = async (uri: string) => {
    setAnalyzing(true);
    setAiUnavailable(false);
    setStep('form');

    const formData = new FormData();
    const filename = uri.split('/').pop() || 'photo.jpg';
    formData.append('image', {
      uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
      name: filename,
      type: 'image/jpeg',
    } as any);

    const res = await civilPostForm('/ai/hazard-vision', formData);
    setAnalyzing(false);

    if (res.ok && res.data) {
      const d = res.data as any;
      setTitle(d.title || '');
      setDescription(d.description || '');
      setSeverity(d.severity || 'medium');
      setControls(d.suggested_controls || d.controls || []);
    } else if (res.status === 503 || res.status === 504) {
      setAiUnavailable(true);
    } else {
      setAiUnavailable(true);
    }
  };

  const addControl = () => {
    if (newControl.trim()) {
      setControls([...controls, newControl.trim()]);
      setNewControl('');
    }
  };

  const removeControl = (idx: number) => {
    setControls(controls.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('Required', 'Enter a hazard title.');
      return;
    }
    setSaving(true);
    const wsId = await getDefaultWorkspaceId();
    const res = await civilPost('/hazards', {
      title: title.trim(),
      description: description.trim(),
      severity,
      controls,
      photo_url: photoUri || '',
      workspace_id: wsId,
    });
    setSaving(false);
    if (res.ok) {
      Alert.alert('Saved', 'Hazard report created.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } else {
      Alert.alert('Error', res.error || 'Failed to save hazard.');
    }
  };

  // Photo capture step
  if (step === 'photo') {
    return (
      <View testID="hazard-photo-screen" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity testID="hazard-back-btn" onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={INK} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>New Hazard</Text>
        </View>
        <View style={s.photoWrap}>
          <Ionicons name="camera" size={64} color={AMBER} />
          <Text style={s.photoTitle}>Capture the hazard</Text>
          <Text style={s.photoSub}>Take a photo or choose from library</Text>
          <TouchableOpacity testID="hazard-take-photo-btn" style={s.photoBtnPrimary} onPress={takePhoto}>
            <Ionicons name="camera-outline" size={22} color="#FFF" />
            <Text style={s.photoBtnPrimaryText}>Take Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="hazard-pick-photo-btn" style={s.photoBtnSecondary} onPress={pickPhoto}>
            <Ionicons name="images-outline" size={22} color={BLUE} />
            <Text style={s.photoBtnSecondaryText}>Choose from Library</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="hazard-skip-photo-btn" style={s.skipBtn} onPress={() => setStep('form')}>
            <Text style={s.skipText}>Skip photo — fill manually</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Form step
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View testID="hazard-form-screen" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity testID="hazard-form-back-btn" onPress={() => setStep('photo')} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={INK} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Hazard Report</Text>
        </View>

        <ScrollView contentContainerStyle={s.formContent} keyboardShouldPersistTaps="handled">
          {/* AI Analyzing loader */}
          {analyzing && (
            <View testID="hazard-ai-loading" style={s.aiLoader}>
              <Ionicons name="sparkles" size={24} color={VIOLET} />
              <View>
                <Text style={s.aiLoaderTitle}>Analyzing with AI…</Text>
                <Text style={s.aiLoaderSub}>Identifying hazards in your photo</Text>
              </View>
              <ActivityIndicator color={VIOLET} />
            </View>
          )}

          {/* AI unavailable banner */}
          {aiUnavailable && (
            <View testID="hazard-ai-unavailable" style={s.aiBanner}>
              <Ionicons name="alert-circle" size={18} color={AMBER} />
              <Text style={s.aiBannerText}>AI unavailable — fill in manually</Text>
            </View>
          )}

          {/* Photo preview */}
          {photoUri && (
            <Image testID="hazard-photo-preview" source={{ uri: photoUri }} style={s.photoPreview} />
          )}

          {/* Title */}
          <Text style={s.label}>Title *</Text>
          <TextInput
            testID="hazard-title-input"
            style={s.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Describe the hazard"
            placeholderTextColor="#94A3B8"
          />

          {/* Description */}
          <Text style={s.label}>Description</Text>
          <TextInput
            testID="hazard-description-input"
            style={[s.input, s.textarea]}
            value={description}
            onChangeText={setDescription}
            placeholder="More detail about the hazard..."
            placeholderTextColor="#94A3B8"
            multiline
            numberOfLines={4}
          />

          {/* Severity */}
          <Text style={s.label}>Severity</Text>
          <View style={s.severityRow}>
            {SEVERITY_OPTIONS.map(sev => (
              <TouchableOpacity
                key={sev}
                testID={`hazard-severity-${sev}`}
                style={[s.sevBtn, severity === sev && s.sevBtnActive]}
                onPress={() => setSeverity(sev)}
              >
                <Text style={[s.sevBtnText, severity === sev && s.sevBtnTextActive]}>
                  {sev}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Controls */}
          <Text style={s.label}>Suggested Controls</Text>
          <View style={s.chipsWrap}>
            {controls.map((c, i) => (
              <View key={i} style={s.controlChip}>
                <Text style={s.controlChipText}>{c}</Text>
                <TouchableOpacity testID={`hazard-remove-control-${i}`} onPress={() => removeControl(i)}>
                  <Ionicons name="close-circle" size={18} color={RED} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
          <View style={s.addControlRow}>
            <TextInput
              testID="hazard-add-control-input"
              style={[s.input, { flex: 1, marginBottom: 0 }]}
              value={newControl}
              onChangeText={setNewControl}
              placeholder="Add a control measure"
              placeholderTextColor="#94A3B8"
              onSubmitEditing={addControl}
            />
            <TouchableOpacity testID="hazard-add-control-btn" style={s.addControlBtn} onPress={addControl}>
              <Ionicons name="add" size={22} color="#FFF" />
            </TouchableOpacity>
          </View>

          {/* Save */}
          <TouchableOpacity
            testID="hazard-save-btn"
            style={[s.saveBtn, saving && s.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#FFF" /> : (
              <Text style={s.saveBtnText}>Save Hazard</Text>
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
    backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#E5E7EB', gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: INK },
  formContent: { padding: 16, paddingBottom: 32 },

  // Photo step
  photoWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  photoTitle: { fontSize: 22, fontWeight: '700', color: INK, marginTop: 16 },
  photoSub: { fontSize: 14, color: MUTED, marginBottom: 16 },
  photoBtnPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: AMBER, borderRadius: 14, paddingVertical: 16, width: '100%', minHeight: 56,
  },
  photoBtnPrimaryText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
  photoBtnSecondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    borderWidth: 1.5, borderColor: BLUE, borderRadius: 14, paddingVertical: 16,
    width: '100%', minHeight: 56, backgroundColor: '#FFF',
  },
  photoBtnSecondaryText: { fontSize: 16, fontWeight: '700', color: BLUE },
  skipBtn: { paddingVertical: 12, marginTop: 8 },
  skipText: { fontSize: 14, color: MUTED, fontWeight: '500' },

  // AI loader
  aiLoader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#F5F3FF', borderRadius: 14, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: '#E9E5FF',
  },
  aiLoaderTitle: { fontSize: 15, fontWeight: '700', color: VIOLET },
  aiLoaderSub: { fontSize: 12, color: MUTED, marginTop: 2 },
  aiBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FEF3C7', borderRadius: 12, padding: 14, marginBottom: 16,
    borderWidth: 1, borderColor: '#FDE68A',
  },
  aiBannerText: { fontSize: 13, color: '#92400E', fontWeight: '600', flex: 1 },

  // Photo preview
  photoPreview: {
    width: '100%', height: 200, borderRadius: 14, marginBottom: 16, backgroundColor: '#E5E7EB',
  },

  // Form fields
  label: { fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0',
    paddingHorizontal: 14, paddingVertical: 14, fontSize: 15, color: INK, marginBottom: 8,
  },
  textarea: { minHeight: 100, textAlignVertical: 'top' },

  // Severity
  severityRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  sevBtn: {
    flex: 1, borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 10,
    paddingVertical: 12, alignItems: 'center', backgroundColor: '#FFF',
  },
  sevBtnActive: { borderColor: BLUE, backgroundColor: '#EFF6FF' },
  sevBtnText: { fontSize: 13, fontWeight: '600', color: MUTED, textTransform: 'capitalize' },
  sevBtnTextActive: { color: BLUE },

  // Controls
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  controlChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#D1FAE5', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  controlChipText: { fontSize: 13, fontWeight: '600', color: '#065F46' },
  addControlRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 16 },
  addControlBtn: {
    width: 48, height: 48, borderRadius: 12, backgroundColor: GREEN,
    alignItems: 'center', justifyContent: 'center',
  },

  // Save
  saveBtn: {
    backgroundColor: BLUE, borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    marginTop: 16, minHeight: 56,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
});
