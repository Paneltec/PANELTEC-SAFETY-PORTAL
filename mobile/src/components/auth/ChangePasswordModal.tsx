import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../../lib/api';
import { Colors } from '../../lib/colors';
import { passwordRuleError, passwordStrength, STRENGTH_COLORS } from '../../lib/passwordRules';

interface Props {
  visible: boolean;
  onClose: () => void;
  locked?: boolean;
  onChanged?: () => void;
}

function StrengthMeter({ value }: { value: string }) {
  const { score, label } = passwordStrength(value);
  const color = STRENGTH_COLORS[score] || '#CBD5E1';
  const width = `${((score + 1) * 20)}%`;
  return (
    <View style={sm.wrap}>
      <View style={sm.track}>
        <View style={[sm.bar, { width: width as any, backgroundColor: color }]} />
      </View>
      <Text style={sm.label}>Strength: <Text style={{ fontWeight: '600', color: Colors.ink }}>{label}</Text> · Min 10 chars, 1 letter + 1 digit + 1 special</Text>
    </View>
  );
}
const sm = StyleSheet.create({
  wrap: { marginTop: 4 },
  track: { height: 5, borderRadius: 3, backgroundColor: '#F1F5F9', overflow: 'hidden' },
  bar: { height: 5, borderRadius: 3 },
  label: { fontSize: 10, color: Colors.textTertiary, marginTop: 3 },
});

export default function ChangePasswordModal({ visible, onClose, locked = false, onChanged }: Props) {
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [cf, setCf] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => { setCur(''); setPw(''); setCf(''); };

  const submit = async () => {
    const err = passwordRuleError(pw);
    if (err) { Alert.alert('Password too weak', err); return; }
    if (pw !== cf) { Alert.alert('Mismatch', "Passwords don't match."); return; }
    setBusy(true);
    try {
      await api.post('/auth/change-password', {
        current_password: cur,
        new_password: pw,
        confirm_password: cf,
      });
      Alert.alert('Success', 'Password changed. Other sessions signed out.');
      reset();
      onChanged?.();
      if (!locked) onClose();
    } catch (e: any) {
      Alert.alert('Error', apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const handleClose = () => {
    if (locked) return;
    reset();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={!locked} onRequestClose={handleClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={locked ? s.fullOverlay : s.overlay}>
        <View style={locked ? s.fullModal : s.modal}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={s.header}>
              <View style={s.headerIcon}>
                <Ionicons name="lock-closed" size={16} color="#F97316" />
              </View>
              <Text style={s.headerTitle}>{locked ? 'Set a new password' : 'Change password'}</Text>
              {!locked && (
                <TouchableOpacity testID="change-pw-close" onPress={handleClose} hitSlop={12}>
                  <Ionicons name="close" size={20} color={Colors.ink} />
                </TouchableOpacity>
              )}
            </View>
            <Text style={s.desc}>
              {locked
                ? 'Your admin requires you to choose a new password before you can use the app.'
                : 'You will be signed out of other browsers and devices on success.'}
            </Text>

            <Text style={s.label}>Current password</Text>
            <TextInput
              testID="change-pw-current"
              style={s.input}
              value={cur}
              onChangeText={setCur}
              placeholder="••••••••"
              placeholderTextColor={Colors.textTertiary}
              secureTextEntry
            />

            <Text style={s.label}>New password</Text>
            <TextInput
              testID="change-pw-new"
              style={s.input}
              value={pw}
              onChangeText={setPw}
              placeholder="••••••••"
              placeholderTextColor={Colors.textTertiary}
              secureTextEntry
            />
            <StrengthMeter value={pw} />

            <Text style={s.label}>Confirm password</Text>
            <TextInput
              testID="change-pw-confirm"
              style={s.input}
              value={cf}
              onChangeText={setCf}
              placeholder="••••••••"
              placeholderTextColor={Colors.textTertiary}
              secureTextEntry
            />

            <View style={s.actions}>
              {!locked && (
                <TouchableOpacity testID="change-pw-cancel" style={s.cancelBtn} onPress={handleClose}>
                  <Text style={s.cancelText}>Cancel</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                testID="change-pw-submit"
                style={[s.submitBtn, busy && { opacity: 0.6 }, locked && { flex: 1 }]}
                onPress={submit}
                disabled={busy}
              >
                {busy ? <ActivityIndicator size="small" color="#fff" /> : (
                  <Text style={s.submitText}>Change password</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
  fullOverlay: { flex: 1, backgroundColor: Colors.bg, justifyContent: 'center', padding: 20 },
  modal: { backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 32, paddingTop: 16, maxHeight: '90%' },
  fullModal: { backgroundColor: Colors.surface, borderRadius: 24, paddingHorizontal: 20, paddingBottom: 32, paddingTop: 16, borderWidth: 1, borderColor: Colors.border },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  headerIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: Colors.ink },
  desc: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 12 },
  label: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: Colors.text,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  cancelText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  submitBtn: { flex: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F97316', borderRadius: 12, paddingVertical: 14 },
  submitText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
