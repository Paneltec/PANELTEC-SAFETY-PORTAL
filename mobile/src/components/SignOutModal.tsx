/**
 * Worker Sign-Out Modal — confirmation before signing out.
 * v58.13.132c
 */
import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';

type Props = {
  visible: boolean;
  siteName: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
};

export default function SignOutModal({ visible, siteName, onConfirm, onCancel, loading }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.iconWrap}>
            <Ionicons name="log-out-outline" size={32} color={Colors.orange} />
          </View>
          <Text style={s.title}>Sign out of {siteName}?</Text>
          <Text style={s.sub}>Your GPS will be recorded at sign-out.</Text>

          <View style={s.btnRow}>
            <TouchableOpacity testID="signout-modal-cancel" style={s.cancelBtn} onPress={onCancel}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="signout-modal-confirm"
              style={[s.confirmBtn, loading && s.disabled]}
              onPress={onConfirm}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text style={s.confirmText}>Sign out</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  sheet: {
    backgroundColor: Colors.surface, borderRadius: 20, padding: 24, alignItems: 'center',
  },
  iconWrap: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.orangeSoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: '700', color: Colors.ink, textAlign: 'center' },
  sub: { fontSize: 14, color: Colors.textSecondary, marginTop: 8, marginBottom: 24, textAlign: 'center' },
  btnRow: { flexDirection: 'row', gap: 12, width: '100%' },
  cancelBtn: {
    flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
    padding: 14, alignItems: 'center',
  },
  cancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  confirmBtn: {
    flex: 1, backgroundColor: Colors.orange, borderRadius: 12,
    padding: 14, alignItems: 'center',
  },
  disabled: { opacity: 0.6 },
  confirmText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
});
