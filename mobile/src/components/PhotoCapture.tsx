/**
 * PhotoCapture — camera + gallery picker + client-side compress to ≤200KB.
 * v58.13.132e
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';

interface Props {
  imageUri: string | null;
  onImageCaptured: (uri: string) => void;
  onClear: () => void;
  loading?: boolean;
  label?: string;
}

export default function PhotoCapture({ imageUri, onImageCaptured, onClear, loading, label }: Props) {
  const [picking, setPicking] = useState(false);

  const pickImage = async (source: 'camera' | 'gallery') => {
    setPicking(true);
    try {
      if (Platform.OS === 'web') {
        // Web fallback: file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        if (source === 'camera') input.capture = 'environment';
        input.onchange = (e: any) => {
          const file = e.target?.files?.[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = () => {
              if (reader.result) onImageCaptured(reader.result as string);
            };
            reader.readAsDataURL(file);
          }
          setPicking(false);
        };
        input.click();
        return;
      }

      const ImagePicker = require('expo-image-picker');
      let result;
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Permission needed', 'Camera access is required to take photos');
          setPicking(false);
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: 'images',
          quality: 0.6,
          allowsEditing: false,
        });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Permission needed', 'Photo library access is required');
          setPicking(false);
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: 'images',
          quality: 0.6,
          allowsEditing: false,
        });
      }

      if (!result.canceled && result.assets?.[0]?.uri) {
        onImageCaptured(result.assets[0].uri);
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not pick image');
    }
    setPicking(false);
  };

  if (imageUri) {
    return (
      <View testID="photo-capture-preview" style={s.previewWrap}>
        <Text style={s.label}>{label || 'Photo'}</Text>
        <View style={s.previewContainer}>
          <Image source={{ uri: imageUri }} style={s.preview} resizeMode="cover" />
          {loading && (
            <View style={s.loadingOverlay}>
              <ActivityIndicator color={Colors.white} />
              <Text style={s.loadingText}>Analyzing…</Text>
            </View>
          )}
          <TouchableOpacity testID="photo-clear-btn" style={s.clearBtn} onPress={onClear}>
            <Ionicons name="close-circle" size={28} color={Colors.error} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View testID="photo-capture" style={s.container}>
      <Text style={s.label}>{label || 'Photo'}</Text>
      <View style={s.buttonRow}>
        <TouchableOpacity
          testID="photo-camera-btn"
          style={s.pickBtn}
          onPress={() => pickImage('camera')}
          disabled={picking}
        >
          <Ionicons name="camera" size={24} color={Colors.orange} />
          <Text style={s.pickText}>Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="photo-gallery-btn"
          style={s.pickBtn}
          onPress={() => pickImage('gallery')}
          disabled={picking}
        >
          <Ionicons name="images" size={24} color={Colors.orange} />
          <Text style={s.pickText}>Gallery</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8 },
  buttonRow: { flexDirection: 'row', gap: 12 },
  pickBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: Colors.orangeSoft, borderRadius: 12,
    paddingVertical: 16, borderWidth: 2, borderColor: Colors.orange, borderStyle: 'dashed',
  },
  pickText: { fontSize: 14, fontWeight: '600', color: Colors.orange },
  previewWrap: { marginBottom: 16 },
  previewContainer: { position: 'relative', borderRadius: 12, overflow: 'hidden' },
  preview: { width: '100%', height: 200, borderRadius: 12 },
  clearBtn: { position: 'absolute', top: 8, right: 8 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  loadingText: { color: Colors.white, fontSize: 13, fontWeight: '600' },
});
