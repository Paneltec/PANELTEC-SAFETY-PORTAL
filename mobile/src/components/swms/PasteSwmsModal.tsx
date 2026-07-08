import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../../lib/api';
import { Colors } from '../../lib/colors';

const MAX = 12000;
const MIN = 200;

interface Props { visible: boolean; onClose: () => void; onCreated: (swms: any) => void; }

export default function PasteSwmsModal({ visible, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const chars = text.length;
  const valid = chars >= MIN && chars <= MAX;

  const reset = () => { setTitle(''); setText(''); setBusy(false); };

  const submit = async () => {
    setBusy(true);
    try {
      const payload: any = { text };
      if (title.trim()) payload.title_hint = title.trim();
      const { data } = await api.post('/swms/from-paste', payload);
      reset();
      onClose();
      onCreated(data);
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 413) Alert.alert('Too long', 'Paste is too large — split into sections.');
      else if (status === 400) Alert.alert('Too short', 'Paste at least 200 characters of SWMS text.');
      else Alert.alert('Error', apiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.overlay}>
        <View style={s.modal}>
          {/* Header */}
          <View style={s.header}>
            <View style={s.headerIcon}>
              <Ionicons name="clipboard" size={16} color="#F97316" />
            </View>
            <Text style={s.headerTitle}>Paste SWMS Text</Text>
            <TouchableOpacity testID="paste-modal-close" onPress={() => { reset(); onClose(); }} hitSlop={12}>
              <Ionicons name="close" size={20} color={Colors.ink} />
            </TouchableOpacity>
          </View>

          {/* Title input */}
          <Text style={s.label}>Title hint (optional)</Text>
          <TextInput
            testID="paste-title-input"
            style={s.titleInput}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Roof Works — Erskineville"
            placeholderTextColor={Colors.textTertiary}
          />

          {/* Paste area */}
          <Text style={s.label}>SWMS text</Text>
          <TextInput
            testID="paste-text-input"
            style={s.textArea}
            value={text}
            onChangeText={t => setText(t.slice(0, MAX + 100))}
            placeholder="Paste the full SWMS content here..."
            placeholderTextColor={Colors.textTertiary}
            multiline
            textAlignVertical="top"
          />

          {/* Char counter */}
          <View style={s.counterRow}>
            <Text style={[s.counter, chars > MAX ? { color: Colors.red } : chars >= MIN ? { color: Colors.emerald } : {}]}>
              {chars.toLocaleString()} / {MAX.toLocaleString()} chars
            </Text>
            <Text style={s.counterHint}>{chars < MIN ? `min ${MIN}` : 'ready'}</Text>
          </View>

          {/* Actions */}
          <View style={s.actions}>
            <TouchableOpacity testID="paste-cancel" style={s.cancelBtn} onPress={() => { reset(); onClose(); }}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="paste-submit"
              style={[s.submitBtn, !valid && { opacity: 0.4 }]}
              onPress={submit}
              disabled={!valid || busy}
              activeOpacity={0.7}
            >
              {busy ? <ActivityIndicator size="small" color="#fff" /> : (
                <>
                  <Ionicons name="sparkles" size={14} color="#fff" />
                  <Text style={s.submitText}>Parse with AI</Text>
                </>
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
  modal: { backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 32, paddingTop: 16, maxHeight: '90%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  headerIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: Colors.ink },
  label: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4, marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  titleInput: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: Colors.text },
  textArea: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: Colors.text, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', minHeight: 200, maxHeight: 300 },
  counterRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  counter: { fontSize: 11, fontWeight: '600', color: Colors.textTertiary },
  counterHint: { fontSize: 11, color: Colors.textTertiary },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  cancelText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  submitBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#F97316', borderRadius: 12, paddingVertical: 14 },
  submitText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
