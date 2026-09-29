/**
 * Hazard Report from Photo — Phase 4.
 * Camera → AI analysis → pre-filled form → save.
 * MOST IMPORTANT field flow per spec.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Colors, C } from '../../src/theme/colors';
import { analyzePhoto, createItem } from '../../src/services/capture';
import { getStoredUser } from '../../src/services/auth';

type Severity = 'low' | 'medium' | 'high' | 'critical';
const SEVERITIES: { value: Severity; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: '#22C55E' },
  { value: 'medium', label: 'Medium', color: '#F59E0B' },
  { value: 'high', label: 'High', color: '#F97316' },
  { value: 'critical', label: 'Critical', color: '#EF4444' },
];

export default function HazardCapture() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [controls, setControls] = useState<string[]>([]);
  const [newControl, setNewControl] = useState('');
  const [location, setLocation] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const takePhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera access is required to take hazard photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      handlePhoto(result.assets[0].uri);
    }
  }, []);

  const pickFromLibrary = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Photo library access is required.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      handlePhoto(result.assets[0].uri);
    }
  }, []);

  const handlePhoto = async (uri: string) => {
    setPhotoUri(uri);
    setAnalyzing(true);
    setAiUnavailable(false);

    try {
      const analysis = await analyzePhoto(uri);
      setTitle(analysis.summary || '');
      setDescription(
        analysis.identified_hazards?.join('. ') || analysis.summary || ''
      );
      if (analysis.severity) {
        const sev = analysis.severity.toLowerCase() as Severity;
        if (['low', 'medium', 'high', 'critical'].includes(sev)) {
          setSeverity(sev);
        }
      }
      if (analysis.suggested_controls?.length) {
        setControls(analysis.suggested_controls);
      }
      if (analysis.photo_url) {
        setPhotoUrl(analysis.photo_url);
      }
    } catch (err: any) {
      console.warn('[hazard] AI analysis failed:', err?.message);
      setAiUnavailable(true);
    } finally {
      setAnalyzing(false);
      setShowForm(true);
    }
  };

  const addControl = () => {
    const trimmed = newControl.trim();
    if (trimmed && !controls.includes(trimmed)) {
      setControls([...controls, trimmed]);
      setNewControl('');
    }
  };

  const removeControl = (idx: number) => {
    setControls(controls.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('Required', 'Please enter a hazard title.');
      return;
    }
    setSaving(true);
    try {
      const user = await getStoredUser();
      await createItem('hazards', {
        workspace_id: user?.org_id || 'default',
        title: title.trim(),
        description: description.trim(),
        severity,
        controls,
        location: location.trim(),
        photo_url: photoUrl || undefined,
        reported_by: user?.name || undefined,
        status: 'open',
      });
      Alert.alert('Saved', 'Hazard report submitted successfully.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to save hazard report.');
    }
    setSaving(false);
  };

  // Initial state — camera prompt
  if (!showForm && !photoUri) {
    return (
      <View testID="hazard-capture" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity testID="hazard-back" onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.white} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Report Hazard</Text>
        </View>
        <View style={s.cameraPrompt}>
          <View style={s.cameraIconWrap}>
            <Ionicons name="camera" size={48} color="#EF4444" />
          </View>
          <Text style={s.cameraTitle}>Take a photo of the hazard</Text>
          <Text style={s.cameraSub}>
            AI will analyze the photo and pre-fill the report form for you.
          </Text>
          <TouchableOpacity
            testID="hazard-take-photo"
            style={s.cameraBtn}
            onPress={takePhoto}
            activeOpacity={0.7}
          >
            <Ionicons name="camera" size={22} color={Colors.white} />
            <Text style={s.cameraBtnText}>Take Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="hazard-pick-library"
            style={s.libraryBtn}
            onPress={pickFromLibrary}
            activeOpacity={0.7}
          >
            <Ionicons name="images-outline" size={18} color={Colors.info} />
            <Text style={s.libraryBtnText}>Choose from Library</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="hazard-skip-photo"
            style={s.skipBtn}
            onPress={() => { setShowForm(true); }}
            activeOpacity={0.7}
          >
            <Text style={s.skipBtnText}>Skip photo — fill in manually</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Analyzing state
  if (analyzing) {
    return (
      <View testID="hazard-analyzing" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.white} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Report Hazard</Text>
        </View>
        <View style={s.analyzingWrap}>
          {photoUri && (
            <Image source={{ uri: photoUri }} style={s.analyzingPhoto} resizeMode="cover" />
          )}
          <View style={s.analyzingOverlay}>
            <Ionicons name="sparkles" size={32} color="#7C3AED" />
            <Text style={s.analyzingTitle}>Analyzing with AI…</Text>
            <ActivityIndicator size="large" color="#7C3AED" />
            <Text style={s.analyzingSub}>Identifying hazards and suggesting controls</Text>
          </View>
        </View>
      </View>
    );
  }

  // Form state
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <View testID="hazard-form" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.white} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Report Hazard</Text>
          <TouchableOpacity
            testID="hazard-save-btn"
            style={s.saveHeaderBtn}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Text style={s.saveHeaderBtnText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={s.formScroll} keyboardShouldPersistTaps="handled">
          {aiUnavailable && (
            <View testID="hazard-ai-unavailable" style={s.aiBanner}>
              <Ionicons name="alert-circle" size={16} color="#F59E0B" />
              <Text style={s.aiBannerText}>AI unavailable — fill in manually</Text>
            </View>
          )}

          {photoUri && (
            <View style={s.photoPreview}>
              <Image source={{ uri: photoUri }} style={s.photoImage} resizeMode="cover" />
              <TouchableOpacity
                testID="hazard-retake-photo"
                style={s.retakeBtn}
                onPress={takePhoto}
              >
                <Ionicons name="camera-reverse-outline" size={16} color={Colors.white} />
                <Text style={s.retakeBtnText}>Retake</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={s.label}>Title *</Text>
          <TextInput
            testID="hazard-title-input"
            style={s.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Unstable trench wall"
            placeholderTextColor={C.card.textLabel}
          />

          <Text style={s.label}>Description</Text>
          <TextInput
            testID="hazard-desc-input"
            style={[s.input, s.multiline]}
            value={description}
            onChangeText={setDescription}
            placeholder="Describe the hazard..."
            placeholderTextColor={C.card.textLabel}
            multiline
            numberOfLines={4}
          />

          <Text style={s.label}>Severity</Text>
          <View style={s.severityRow}>
            {SEVERITIES.map((sev) => (
              <TouchableOpacity
                key={sev.value}
                testID={`hazard-severity-${sev.value}`}
                style={[
                  s.severityChip,
                  severity === sev.value && { backgroundColor: sev.color, borderColor: sev.color },
                ]}
                onPress={() => setSeverity(sev.value)}
              >
                <Text style={[
                  s.severityChipText,
                  severity === sev.value && { color: '#FFF' },
                ]}>{sev.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.label}>Location</Text>
          <TextInput
            testID="hazard-location-input"
            style={s.input}
            value={location}
            onChangeText={setLocation}
            placeholder="e.g. Lot 7, near excavation"
            placeholderTextColor={C.card.textLabel}
          />

          <Text style={s.label}>Suggested Controls</Text>
          <View style={s.controlsWrap}>
            {controls.map((ctrl, i) => (
              <View key={i} style={s.controlChip}>
                <Text style={s.controlChipText}>{ctrl}</Text>
                <TouchableOpacity onPress={() => removeControl(i)} testID={`hazard-remove-control-${i}`}>
                  <Ionicons name="close-circle" size={18} color={C.card.textLabel} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
          <View style={s.addControlRow}>
            <TextInput
              testID="hazard-new-control-input"
              style={[s.input, { flex: 1 }]}
              value={newControl}
              onChangeText={setNewControl}
              placeholder="Add a control measure..."
              placeholderTextColor={C.card.textLabel}
              returnKeyType="done"
              onSubmitEditing={addControl}
            />
            <TouchableOpacity
              testID="hazard-add-control-btn"
              style={s.addControlBtn}
              onPress={addControl}
            >
              <Ionicons name="add" size={20} color={Colors.white} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            testID="hazard-submit-btn"
            style={s.submitBtn}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.7}
          >
            {saving ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color={Colors.white} />
                <Text style={s.submitBtnText}>Save Hazard Report</Text>
              </>
            )}
          </TouchableOpacity>

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
  saveHeaderBtn: {
    backgroundColor: C.green.base, borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 8, minWidth: 60, alignItems: 'center',
  },
  saveHeaderBtnText: { color: C.green.buttonText, fontSize: 14, fontWeight: '700' },

  // Camera prompt
  cameraPrompt: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  cameraIconWrap: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  cameraTitle: { fontSize: 22, fontWeight: '800', color: C.textOnNavy.main, marginBottom: 8, textAlign: 'center' },
  cameraSub: { fontSize: 14, color: C.textOnNavy.faint, textAlign: 'center', lineHeight: 20, marginBottom: 28 },
  cameraBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#EF4444', borderRadius: 16,
    paddingHorizontal: 32, paddingVertical: 16, marginBottom: 14, minHeight: 56,
  },
  cameraBtnText: { color: Colors.white, fontSize: 17, fontWeight: '800' },
  libraryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1.5, borderColor: `${Colors.info}40`, borderRadius: 14,
    paddingHorizontal: 24, paddingVertical: 14, marginBottom: 14, minHeight: 48,
  },
  libraryBtnText: { color: Colors.info, fontSize: 15, fontWeight: '600' },
  skipBtn: { marginTop: 8, padding: 12 },
  skipBtnText: { color: C.textOnNavy.faint, fontSize: 13, fontWeight: '600' },

  // Analyzing
  analyzingWrap: { flex: 1, position: 'relative' },
  analyzingPhoto: { width: '100%', height: '100%' },
  analyzingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center', gap: 16,
  },
  analyzingTitle: { fontSize: 20, fontWeight: '800', color: Colors.white },
  analyzingSub: { fontSize: 14, color: 'rgba(255,255,255,0.7)', textAlign: 'center' },

  // Form
  formScroll: { padding: 16, paddingBottom: 32 },
  aiBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FEF3C7', borderRadius: 12, padding: 12, marginBottom: 14,
    borderWidth: 1, borderColor: '#F59E0B',
  },
  aiBannerText: { fontSize: 13, fontWeight: '600', color: '#92400E' },

  photoPreview: { marginBottom: 16, borderRadius: 14, overflow: 'hidden', position: 'relative' },
  photoImage: { width: '100%', height: 200, borderRadius: 14 },
  retakeBtn: {
    position: 'absolute', bottom: 10, right: 10,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  retakeBtnText: { color: Colors.white, fontSize: 12, fontWeight: '600' },

  label: {
    fontSize: 12, fontWeight: '700', color: C.textOnNavy.secondary,
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6, marginTop: 12,
  },
  input: {
    backgroundColor: C.card.bg, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: C.card.textMain, borderWidth: 1, borderColor: C.card.border,
  },
  multiline: { minHeight: 100, textAlignVertical: 'top' },

  severityRow: { flexDirection: 'row', gap: 8 },
  severityChip: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.card.border, backgroundColor: C.card.bg,
    alignItems: 'center', minHeight: 44,
  },
  severityChipText: { fontSize: 13, fontWeight: '700', color: C.card.textMain },

  controlsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  controlChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.card.bg, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: C.card.border,
  },
  controlChipText: { fontSize: 13, color: C.card.textMain },
  addControlRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addControlBtn: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center',
  },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#EF4444', borderRadius: 16, paddingVertical: 18,
    marginTop: 24, minHeight: 56,
  },
  submitBtnText: { color: Colors.white, fontSize: 16, fontWeight: '800' },
});
