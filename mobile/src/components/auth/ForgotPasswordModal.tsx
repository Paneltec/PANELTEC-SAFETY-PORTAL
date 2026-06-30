import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { Colors } from '../../lib/colors';

const API_BASE = (process.env.EXPO_PUBLIC_BACKEND_URL || '') + '/api';

interface Props { visible: boolean; onClose: () => void; }

export default function ForgotPasswordModal({ visible, onClose }: Props) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim()) { Alert.alert('Enter your email'); return; }
    setBusy(true);
    try {
      await axios.post(`${API_BASE}/auth/forgot-password`, { email: email.trim() });
    } catch { /* no-enumeration: always show success */ }
    finally { setBusy(false); }
    Alert.alert('Check your inbox', "If that email is on file, we've sent a reset link.");
    setEmail('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.overlay}>
        <View style={s.modal}>
          <View style={s.header}>
            <View style={s.headerIcon}>
              <Ionicons name="key" size={16} color="#F97316" />
            </View>
            <Text style={s.headerTitle}>Forgot your password?</Text>
            <TouchableOpacity testID="forgot-close" onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={20} color={Colors.ink} />
            </TouchableOpacity>
          </View>
          <Text style={s.desc}>Enter the email on your Paneltec account and we'll send a reset link.</Text>
          <TextInput
            testID="forgot-email-input"
            style={s.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={Colors.textTertiary}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={s.actions}>
            <TouchableOpacity testID="forgot-cancel" style={s.cancelBtn} onPress={onClose}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="forgot-submit"
              style={[s.submitBtn, busy && { opacity: 0.6 }]}
              onPress={submit}
              disabled={busy}
            >
              {busy ? <ActivityIndicator size="small" color="#fff" /> : (
                <Text style={s.submitText}>Send reset link</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 32, paddingTop: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  headerIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: Colors.ink },
  desc: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 12 },
  input: {
    backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: Colors.text,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  cancelText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  submitBtn: { flex: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F97316', borderRadius: 12, paddingVertical: 14 },
  submitText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
