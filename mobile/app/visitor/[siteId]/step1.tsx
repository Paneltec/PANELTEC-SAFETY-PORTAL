/**
 * Visitor Step 1 — Photo capture.
 * v58.13.132c
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../../src/theme/colors';

export default function VisitorStep1() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const capturePhoto = async () => {
    if (Platform.OS === 'web') {
      // Web fallback — simulate capture
      setPhotoUri('web-placeholder');
      return;
    }
    try {
      const Camera = require('expo-camera');
      const { status } = await Camera.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Camera', 'Camera permission required for visitor photo');
        return;
      }
      // In real app: open camera capture modal
      setPhotoUri('native-placeholder');
    } catch {
      Alert.alert('Error', 'Camera not available');
    }
  };

  return (
    <View testID="visitor-step1" style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity testID="visitor-step1-back" onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Visitor Sign-in</Text>
        <Text style={s.step}>1 / 4</Text>
      </View>

      <View style={s.content}>
        <Text style={s.title}>Visitor Photo</Text>
        <Text style={s.sub}>Take a photo of the visitor for identification</Text>

        <TouchableOpacity testID="visitor-capture-photo" style={s.cameraArea} onPress={capturePhoto}>
          {photoUri ? (
            <View style={s.photoDone}>
              <Ionicons name="checkmark-circle" size={48} color={Colors.success} />
              <Text style={s.photoText}>Photo captured</Text>
            </View>
          ) : (
            <>
              <View style={s.cameraIcon}>
                <Ionicons name="camera" size={48} color={Colors.textTertiary} />
              </View>
              <Text style={s.cameraText}>Tap to take photo</Text>
              <Text style={s.cameraSub}>Front camera preferred</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <View style={s.footer}>
        <TouchableOpacity testID="visitor-skip-photo" style={s.skipBtn}
          onPress={() => router.push({ pathname: '/visitor/[siteId]/step2', params: { siteId: siteId || '' } } as any)}>
          <Text style={s.skipText}>Skip photo</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="visitor-next-step1" style={[s.nextBtn, !photoUri && s.nextDisabled]}
          onPress={() => router.push({ pathname: '/visitor/[siteId]/step2', params: { siteId: siteId || '' } } as any)}>
          <Text style={s.nextText}>Next</Text>
          <Ionicons name="arrow-forward" size={18} color={Colors.white} />
        </TouchableOpacity>
      </View>
    </View>
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
  content: { flex: 1, padding: 24 },
  title: { fontSize: 22, fontWeight: '800', color: Colors.ink },
  sub: { fontSize: 14, color: Colors.textSecondary, marginTop: 4, marginBottom: 24 },
  cameraArea: {
    flex: 1, maxHeight: 300, borderRadius: 16,
    backgroundColor: Colors.borderLight, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.border, borderStyle: 'dashed',
  },
  cameraIcon: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  cameraText: { fontSize: 16, fontWeight: '600', color: Colors.textSecondary },
  cameraSub: { fontSize: 12, color: Colors.textTertiary, marginTop: 4 },
  photoDone: { alignItems: 'center', gap: 8 },
  photoText: { fontSize: 16, fontWeight: '600', color: Colors.success },
  footer: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, backgroundColor: Colors.surface,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  skipBtn: { paddingVertical: 12, paddingHorizontal: 16 },
  skipText: { fontSize: 15, color: Colors.textTertiary, fontWeight: '500' },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.orange, borderRadius: 12,
    paddingHorizontal: 24, paddingVertical: 12,
  },
  nextDisabled: { opacity: 0.7 },
  nextText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
});
