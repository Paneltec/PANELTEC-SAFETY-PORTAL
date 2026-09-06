import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  Modal, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api, { apiError } from '../../lib/api';
import { Colors } from '../../lib/colors';

const CATEGORIES = [
  { key: 'incident', label: 'Incident' },
  { key: 'inspection', label: 'Inspection' },
  { key: 'toolbox', label: 'Toolbox' },
  { key: 'near_miss', label: 'Near Miss' },
  { key: 'general', label: 'General' },
];

export default function AiBuilderModal({ onClose, onCreated }: {
  onClose: () => void; onCreated: (t: any) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [category, setCategory] = useState('general');
  const [busy, setBusy] = useState(false);
  const [catOpen, setCatOpen] = useState(false);

  const submit = async () => {
    if (prompt.trim().length < 10) {
      Alert.alert('Too short', 'Describe the form in more detail.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/forms/templates/ai-generate', {
        prompt: prompt.trim(), category,
      });
      onCreated(data);
      onClose();
    } catch (e: any) {
      Alert.alert('Error', apiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.safe}>
        {/* Header with purple/pink tint */}
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Ionicons name="sparkles" size={12} color={Colors.paneltecViolet} />
              <Text style={s.headerLabel}>AI FORM BUILDER</Text>
            </View>
            <Text style={s.headerTitle}>Build a form with AI</Text>
            <Text style={s.headerDesc}>
              Describe what you need — AI generates a draft template you can refine.
            </Text>
          </View>
          <TouchableOpacity testID="ai-close" onPress={onClose} style={{ padding: 8 }}>
            <Ionicons name="close" size={20} color={Colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}
          keyboardShouldPersistTaps="handled">
          <Text style={s.label}>Describe the form you want to build</Text>
          <TextInput testID="ai-prompt-input" style={s.textarea} multiline
            value={prompt} onChangeText={setPrompt} numberOfLines={6}
            placeholder='e.g. "A daily scaffold inspection with sign-on, weather check, anchor points, photo evidence and supervisor signature"'
            placeholderTextColor={Colors.textTertiary}
            textAlignVertical="top" />

          <Text style={[s.label, { marginTop: 20 }]}>Category</Text>
          <TouchableOpacity testID="ai-category-select" style={s.selectBtn}
            onPress={() => setCatOpen(true)}>
            <Text style={s.selectBtnText}>
              {CATEGORIES.find((c) => c.key === category)?.label || category}
            </Text>
            <Ionicons name="chevron-down" size={14} color={Colors.textTertiary} />
          </TouchableOpacity>
        </ScrollView>

        {/* Footer */}
        <View style={s.footer}>
          <TouchableOpacity onPress={onClose} disabled={busy}
            style={s.cancelBtn}>
            <Text style={s.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="ai-generate-btn" onPress={submit}
            disabled={busy || !prompt.trim()}
            style={[s.genBtn, (busy || !prompt.trim()) && { opacity: 0.5 }]}>
            {busy ? (
              <ActivityIndicator size="small" color={Colors.imSurface} />
            ) : (
              <Ionicons name="sparkles" size={14} color={Colors.imSurface} />
            )}
            <Text style={s.genBtnText}>Generate</Text>
          </TouchableOpacity>
        </View>

        {/* Category picker */}
        <Modal visible={catOpen} transparent animationType="fade"
          onRequestClose={() => setCatOpen(false)}>
          <TouchableOpacity style={s.overlay} activeOpacity={1}
            onPress={() => setCatOpen(false)}>
            <View style={s.pickerBox}>
              <Text style={s.pickerTitle}>Select category</Text>
              {CATEGORIES.map((c) => (
                <TouchableOpacity key={c.key}
                  style={[s.pickerItem, category === c.key && { backgroundColor: Colors.imConcrete }]}
                  onPress={() => { setCategory(c.key); setCatOpen(false); }}>
                  <Text style={s.pickerItemText}>{c.label}</Text>
                  {category === c.key && (
                    <Ionicons name="checkmark" size={14} color={Colors.paneltecViolet} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.imConcrete,
  },
  headerLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: Colors.paneltecViolet },
  headerTitle: { fontSize: 20, fontWeight: '800', color: Colors.ink },
  headerDesc: { fontSize: 12, color: Colors.textSecondary, marginTop: 2, lineHeight: 17 },
  label: { fontSize: 12, fontWeight: '600', color: Colors.ink, marginBottom: 6 },
  textarea: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
    padding: 12, fontSize: 14, color: Colors.text, minHeight: 140,
    backgroundColor: Colors.surface,
  },
  selectBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 12, backgroundColor: Colors.surface, minHeight: 48,
  },
  selectBtnText: { fontSize: 14, color: Colors.text },
  footer: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: 8,
    padding: 16, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  cancelBtn: {
    paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  cancelBtnText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  genBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12,
    backgroundColor: Colors.paneltecViolet,
  },
  genBtnText: { fontSize: 14, fontWeight: '700', color: Colors.imSurface },
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  pickerBox: {
    backgroundColor: Colors.surface, borderRadius: 18, padding: 16,
    width: '100%', maxWidth: 320,
  },
  pickerTitle: { fontSize: 16, fontWeight: '700', color: Colors.ink, marginBottom: 8 },
  pickerItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10,
  },
  pickerItemText: { fontSize: 14, color: Colors.text, fontWeight: '500' },
});
