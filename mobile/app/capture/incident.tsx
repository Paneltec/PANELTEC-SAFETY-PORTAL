/**
 * Incident Report — Phase 4.
 * Title, datetime, location, category, description, immediate actions, evidence photos.
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
import { createItem } from '../../src/services/capture';
import { getStoredUser } from '../../src/services/auth';

type IncidentCategory = 'near_miss' | 'first_aid' | 'medical' | 'ltc' | 'env' | 'property';

const CATEGORIES: { value: IncidentCategory; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'near_miss', label: 'Near Miss', icon: 'eye-outline' },
  { value: 'first_aid', label: 'First Aid', icon: 'medkit-outline' },
  { value: 'medical', label: 'Medical', icon: 'fitness-outline' },
  { value: 'ltc', label: 'Lost Time', icon: 'time-outline' },
  { value: 'env', label: 'Environmental', icon: 'leaf-outline' },
  { value: 'property', label: 'Property', icon: 'business-outline' },
];

export default function IncidentCapture() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [occurredAt] = useState(new Date().toISOString());
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState<IncidentCategory>('near_miss');
  const [description, setDescription] = useState('');
  const [immediateActions, setImmediateActions] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const addPhoto = useCallback(async (source: 'camera' | 'library') => {
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Camera access is required.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.7,
      });
      if (!result.canceled && result.assets[0]) {
        setPhotos([...photos, result.assets[0].uri]);
      }
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Photo library access is required.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        allowsMultipleSelection: true,
        selectionLimit: 5,
      });
      if (!result.canceled && result.assets) {
        setPhotos([...photos, ...result.assets.map((a) => a.uri)]);
      }
    }
  }, [photos]);

  const removePhoto = (idx: number) => {
    setPhotos(photos.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('Required', 'Please enter an incident title.');
      return;
    }
    setSaving(true);
    try {
      const user = await getStoredUser();
      await createItem('incidents', {
        workspace_id: user?.org_id || 'default',
        title: title.trim(),
        occurred_at: occurredAt,
        location: location.trim(),
        category,
        description: description.trim(),
        immediate_actions: immediateActions.trim(),
        evidence_photos: [], // Photos would need to be uploaded separately
        follow_up_status: 'open',
      });
      Alert.alert('Saved', 'Incident report submitted.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to save incident.');
    }
    setSaving(false);
  };

  const formatDateTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('en-AU', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
      });
    } catch { return iso; }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <View testID="incident-capture" style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity testID="incident-back" onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.white} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Report Incident</Text>
          <TouchableOpacity
            testID="incident-save-header"
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
          <Text style={s.label}>Title *</Text>
          <TextInput
            testID="incident-title-input"
            style={s.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Brief incident title"
            placeholderTextColor={C.card.textLabel}
          />

          <Text style={s.label}>Date & Time</Text>
          <View style={s.dateRow}>
            <Ionicons name="time-outline" size={18} color={Colors.orange} />
            <Text style={s.dateText}>{formatDateTime(occurredAt)}</Text>
          </View>

          <Text style={s.label}>Location</Text>
          <TextInput
            testID="incident-location-input"
            style={s.input}
            value={location}
            onChangeText={setLocation}
            placeholder="Where did this happen?"
            placeholderTextColor={C.card.textLabel}
          />

          <Text style={s.label}>Category</Text>
          <View style={s.catGrid}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.value}
                testID={`incident-cat-${cat.value}`}
                style={[
                  s.catChip,
                  category === cat.value && s.catChipActive,
                ]}
                onPress={() => setCategory(cat.value)}
              >
                <Ionicons
                  name={cat.icon}
                  size={18}
                  color={category === cat.value ? Colors.white : C.card.textMain}
                />
                <Text style={[
                  s.catChipText,
                  category === cat.value && s.catChipTextActive,
                ]}>{cat.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.label}>Description</Text>
          <TextInput
            testID="incident-desc-input"
            style={[s.input, s.multiline]}
            value={description}
            onChangeText={setDescription}
            placeholder="Describe what happened..."
            placeholderTextColor={C.card.textLabel}
            multiline
            numberOfLines={4}
          />

          <Text style={s.label}>Immediate Actions Taken</Text>
          <TextInput
            testID="incident-actions-input"
            style={[s.input, s.multiline]}
            value={immediateActions}
            onChangeText={setImmediateActions}
            placeholder="What was done immediately?"
            placeholderTextColor={C.card.textLabel}
            multiline
            numberOfLines={3}
          />

          <Text style={s.label}>Evidence Photos</Text>
          <View style={s.photoGrid}>
            {photos.map((uri, idx) => (
              <View key={idx} style={s.photoThumb}>
                <Image source={{ uri }} style={s.photoThumbImage} resizeMode="cover" />
                <TouchableOpacity
                  testID={`incident-remove-photo-${idx}`}
                  style={s.photoRemoveBtn}
                  onPress={() => removePhoto(idx)}
                >
                  <Ionicons name="close-circle" size={22} color={Colors.error} />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity
              testID="incident-add-photo-camera"
              style={s.addPhotoBtn}
              onPress={() => addPhoto('camera')}
            >
              <Ionicons name="camera" size={24} color={Colors.orange} />
              <Text style={s.addPhotoText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="incident-add-photo-library"
              style={s.addPhotoBtn}
              onPress={() => addPhoto('library')}
            >
              <Ionicons name="images-outline" size={24} color={Colors.info} />
              <Text style={s.addPhotoText}>Library</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            testID="incident-submit-btn"
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
                <Text style={s.submitBtnText}>Submit Incident Report</Text>
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
  formScroll: { padding: 16, paddingBottom: 32 },

  label: {
    fontSize: 12, fontWeight: '700', color: C.textOnNavy.secondary,
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6, marginTop: 14,
  },
  input: {
    backgroundColor: C.card.bg, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: C.card.textMain, borderWidth: 1, borderColor: C.card.border,
  },
  multiline: { minHeight: 100, textAlignVertical: 'top' },

  dateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.card.bg, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.card.border,
  },
  dateText: { fontSize: 15, fontWeight: '600', color: C.card.textMain },

  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.card.border, backgroundColor: C.card.bg,
    minHeight: 44,
  },
  catChipActive: { backgroundColor: '#DC2626', borderColor: '#DC2626' },
  catChipText: { fontSize: 13, fontWeight: '600', color: C.card.textMain },
  catChipTextActive: { color: Colors.white },

  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  photoThumb: { width: 80, height: 80, borderRadius: 12, overflow: 'hidden', position: 'relative' },
  photoThumbImage: { width: '100%', height: '100%' },
  photoRemoveBtn: { position: 'absolute', top: 2, right: 2 },
  addPhotoBtn: {
    width: 80, height: 80, borderRadius: 12,
    borderWidth: 1.5, borderColor: C.card.border, borderStyle: 'dashed',
    backgroundColor: C.card.bg, alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  addPhotoText: { fontSize: 10, fontWeight: '600', color: C.card.textLabel },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#DC2626', borderRadius: 16, paddingVertical: 18,
    marginTop: 24, minHeight: 56,
  },
  submitBtnText: { color: Colors.white, fontSize: 16, fontWeight: '800' },
});
