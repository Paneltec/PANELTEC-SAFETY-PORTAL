/**
 * Worker Sign-In Modal — confirmation sheet before signing into a site.
 * v58.13.132c
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import type { Site } from '../services/sites';

type Props = {
  visible: boolean;
  site: Site | null;
  onConfirm: (photoUri?: string) => void;
  onCancel: () => void;
  loading?: boolean;
};

export default function SignInModal({ visible, site, onConfirm, onCancel, loading }: Props) {
  const [photoUri, setPhotoUri] = useState<string | undefined>();

  if (!site) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.title}>Sign in to site</Text>
            <TouchableOpacity testID="signin-modal-close" onPress={onCancel}>
              <Ionicons name="close" size={24} color={Colors.textTertiary} />
            </TouchableOpacity>
          </View>

          <View style={s.siteInfo}>
            <View style={s.siteIcon}>
              <Ionicons name="location" size={24} color={Colors.orange} />
            </View>
            <View style={s.siteText}>
              <Text style={s.siteName}>{site.name}</Text>
              <Text style={s.siteAddr}>{site.address}</Text>
            </View>
          </View>

          {/* Photo area */}
          <TouchableOpacity
            testID="signin-modal-photo-btn"
            style={s.photoArea}
            onPress={() => {
              if (Platform.OS === 'web') {
                Alert.alert('Camera', 'Camera not available on web preview');
              }
            }}
          >
            {photoUri ? (
              <Text style={s.photoText}>Photo captured ✓</Text>
            ) : (
              <>
                <Ionicons name="camera-outline" size={32} color={Colors.textTertiary} />
                <Text style={s.photoText}>Take a selfie (optional)</Text>
                <Text style={s.photoSub}>Tap to capture or skip</Text>
              </>
            )}
          </TouchableOpacity>

          {/* GPS notice */}
          <View style={s.gpsRow}>
            <Ionicons name="navigate-outline" size={16} color={Colors.info} />
            <Text style={s.gpsText}>GPS location will be recorded</Text>
          </View>

          {/* Confirm button */}
          <TouchableOpacity
            testID="signin-modal-confirm"
            style={[s.confirmBtn, loading && s.confirmBtnDisabled]}
            onPress={() => onConfirm(photoUri)}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={s.confirmText}>Confirm sign-in</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 20,
  },
  title: { fontSize: 20, fontWeight: '700', color: Colors.ink },
  siteInfo: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 12 },
  siteIcon: {
    width: 48, height: 48, borderRadius: 12, backgroundColor: Colors.orangeSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  siteText: { flex: 1 },
  siteName: { fontSize: 16, fontWeight: '700', color: Colors.ink },
  siteAddr: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  photoArea: {
    borderWidth: 2, borderColor: Colors.border, borderStyle: 'dashed',
    borderRadius: 12, padding: 24, alignItems: 'center', gap: 8, marginBottom: 16,
  },
  photoText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  photoSub: { fontSize: 12, color: Colors.textTertiary },
  gpsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
  gpsText: { fontSize: 13, color: Colors.info },
  confirmBtn: {
    backgroundColor: Colors.orange, borderRadius: 12, padding: 16,
    alignItems: 'center',
  },
  confirmBtnDisabled: { opacity: 0.6 },
  confirmText: { color: Colors.white, fontSize: 16, fontWeight: '700' },
});
