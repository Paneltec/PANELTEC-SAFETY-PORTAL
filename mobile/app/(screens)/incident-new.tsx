/**
 * Phase 4 — Incident report form.
 * Title, datetime, location, category, description, immediate actions, evidence photos.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { civilPost, getDefaultWorkspaceId } from '../../src/services/civilApi';

const BLUE = '#2C6BFF';
const RED = '#EF4444';
const BG = '#F8FAFC';
const INK = '#0F172A';
const MUTED = '#64748B';

const CATEGORIES = [
  { value: 'near_miss', label: 'Near Miss' },
  { value: 'first_aid', label: 'First Aid' },
  { value: 'medical', label: 'Medical Treatment' },
  { value: 'ltc', label: 'Lost Time (LTC)' },
  { value: 'env', label: 'Environmental' },
  { value: 'property', label: 'Property Damage' },
];

export default function IncidentNewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [occurredAt] = useState(new Date().toISOString());
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('near_miss');
  const [description, setDescription] = useState('');
  const [immediateActions, setImmediateActions] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const addPhoto = async (source: 'camera' | 'library') => {
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ['images'], allowsMultipleSelection: true });

    if (!result.canceled) {
      const uris = result.assets.map(a => a.uri);
      setPhotos(prev => [...prev, ...uris]);
    }
  };

  const removePhoto = (idx: number) => {
    setPhotos(photos.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('Required', 'Enter an incident title.');
      return;
    }
    setSaving(true);
    const wsId = await getDefaultWorkspaceId();
    const res = await civilPost('/incidents', {
      title: title.trim(),
      occurred_at: occurredAt,
      location: location.trim(),
      category,
      description: description.trim(),
      immediate_actions: immediateActions.trim(),
      evidence_photos: photos,
      workspace_id: wsId,
    });
    setSaving(false);
    if (res.ok) {
      Alert.alert('Saved', 'Incident report created.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } else {
      Alert.alert('Error', res.error || 'Failed to save.');
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View testID="incident-screen" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity testID="incident-back-btn" onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={INK} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Incident Report</Text>
        </View>

        <ScrollView contentContainerStyle={s.formContent} keyboardShouldPersistTaps="handled">
          {/* Title */}
          <Text style={s.label}>Title *</Text>
          <TextInput
            testID="incident-title-input"
            style={s.input}
            value={title}
            onChangeText={setTitle}
            placeholder="What happened?"
            placeholderTextColor="#94A3B8"
          />

          {/* DateTime */}
          <Text style={s.label}>Occurred At</Text>
          <View style={s.dateBox}>
            <Ionicons name="time-outline" size={18} color={MUTED} />
            <Text testID="incident-datetime" style={s.dateText}>
              {new Date(occurredAt).toLocaleString('en-AU', {
                day: 'numeric', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </Text>
          </View>

          {/* Location */}
          <Text style={s.label}>Location</Text>
          <TextInput
            testID="incident-location-input"
            style={s.input}
            value={location}
            onChangeText={setLocation}
            placeholder="Where did it occur?"
            placeholderTextColor="#94A3B8"
          />

          {/* Category */}
          <Text style={s.label}>Category</Text>
          <View style={s.categoryWrap}>
            {CATEGORIES.map(cat => (
              <TouchableOpacity
                key={cat.value}
                testID={`incident-cat-${cat.value}`}
                style={[s.catBtn, category === cat.value && s.catBtnActive]}
                onPress={() => setCategory(cat.value)}
              >
                <Text style={[s.catBtnText, category === cat.value && s.catBtnTextActive]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Description */}
          <Text style={s.label}>Description</Text>
          <TextInput
            testID="incident-description-input"
            style={[s.input, s.textarea]}
            value={description}
            onChangeText={setDescription}
            placeholder="Detailed description of the incident..."
            placeholderTextColor="#94A3B8"
            multiline
          />

          {/* Immediate actions */}
          <Text style={s.label}>Immediate Actions Taken</Text>
          <TextInput
            testID="incident-actions-input"
            style={[s.input, s.textarea]}
            value={immediateActions}
            onChangeText={setImmediateActions}
            placeholder="What actions were taken immediately?"
            placeholderTextColor="#94A3B8"
            multiline
          />

          {/* Evidence photos */}
          <Text style={s.label}>Evidence Photos</Text>
          <View style={s.photosWrap}>
            {photos.map((uri, idx) => (
              <View key={idx} style={s.photoThumb}>
                <Image source={{ uri }} style={s.photoImg} />
                <TouchableOpacity
                  testID={`incident-remove-photo-${idx}`}
                  style={s.photoRemove}
                  onPress={() => removePhoto(idx)}
                >
                  <Ionicons name="close-circle" size={22} color={RED} />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity testID="incident-add-photo-camera" style={s.photoAdd} onPress={() => addPhoto('camera')}>
              <Ionicons name="camera-outline" size={24} color={BLUE} />
              <Text style={s.photoAddText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="incident-add-photo-library" style={s.photoAdd} onPress={() => addPhoto('library')}>
              <Ionicons name="images-outline" size={24} color={BLUE} />
              <Text style={s.photoAddText}>Library</Text>
            </TouchableOpacity>
          </View>

          {/* Save */}
          <TouchableOpacity
            testID="incident-save-btn"
            style={[s.saveBtn, saving && s.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#FFF" /> : (
              <Text style={s.saveBtnText}>Save Incident</Text>
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
  textarea: { minHeight: 100, textAlignVertical: 'top' },
  dateBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFF', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0',
    paddingHorizontal: 14, paddingVertical: 14, marginBottom: 8,
  },
  dateText: { fontSize: 15, fontWeight: '600', color: INK },

  categoryWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  catBtn: {
    borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#FFF',
  },
  catBtnActive: { borderColor: RED, backgroundColor: '#FEF2F2' },
  catBtnText: { fontSize: 13, fontWeight: '600', color: MUTED },
  catBtnTextActive: { color: RED },

  photosWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  photoThumb: { width: 80, height: 80, borderRadius: 12, overflow: 'hidden' },
  photoImg: { width: 80, height: 80 },
  photoRemove: { position: 'absolute', top: -2, right: -2 },
  photoAdd: {
    width: 80, height: 80, borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0',
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: '#FFF',
  },
  photoAddText: { fontSize: 10, fontWeight: '600', color: BLUE },

  saveBtn: {
    backgroundColor: RED, borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    marginTop: 16, minHeight: 56,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
});
